import { clone } from './state-core.js';
import { sanitizeAssistantNarration } from './narrative-sanitizer.js';
import { SPACELESS_SCRIPT, canonicalText, sharedSpacelessBigrams } from './hash.js';

export { sanitizeAssistantNarration } from './narrative-sanitizer.js';

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (typeof message?.mes === 'string') return message.mes;
  if (typeof message?.text === 'string') return message.text;
  return '';
}

function messageRole(message) {
  if (message?.role === 'user' || message?.is_user === true) return 'user';
  if (message?.role === 'assistant' || (message?.is_user === false && message?.is_system !== true)) return 'assistant';
  return 'system';
}

const SUPPORT_STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'into', 'onto', 'over', 'under', 'after', 'before',
  'while', 'where', 'when', 'then', 'than', 'they', 'them', 'their', 'there', 'here', 'have', 'has',
  'had', 'was', 'were', 'are', 'is', 'been', 'being', 'will', 'would', 'could', 'should', 'about',
  'among', 'through', 'around', 'still', 'current', 'currently', 'now', 'near', 'behind', 'outside',
]);

function significantTokens(value) {
  return canonicalText(value)
    .split(' ')
    .filter(token => token.length >= 3 && !SUPPORT_STOPWORDS.has(token))
    .map(token => {
      if (token.length > 5 && token.endsWith('ies')) return token.slice(0, -3) + 'y';
      if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1);
      return token;
    });
}

function lexicalAffinity(left, right, anchors = []) {
  const a = canonicalText(left);
  const b = canonicalText(right);
  if (!a || !b) return false;
  if (a.length >= 8 && containsOnWordBoundaries(b, a)) return true;
  if (b.length >= 8 && containsOnWordBoundaries(a, b)) return true;

  const leftTokens = significantTokens(a);
  const rightTokens = new Set(significantTokens(b));
  const shared = leftTokens.filter(token => rightTokens.has(token));
  if (shared.length >= 2) return true;
  // Spaceless scripts: a summary paraphrasing its excerpt shares character pairs, not words.
  if (sharedSpacelessBigrams(a, b) >= 3) return true;

  for (const anchor of Array.isArray(anchors) ? anchors : []) {
    const normalized = canonicalText(anchor);
    if (anchorLongEnough(normalized) && containsOnWordBoundaries(a, normalized) && containsOnWordBoundaries(b, normalized)) return true;
  }

  return shared.length === 1
    && shared[0].length >= 6;
}

// An anchor of two characters names something in a spaceless script ("王都"); elsewhere it needs three.
function anchorLongEnough(anchor) {
  return anchor.length >= 3 || (anchor.length >= 2 && SPACELESS_SCRIPT.test(anchor));
}

function targetAffinity(record, text) {
  if (!record) return false;

  const left = new Set(significantTokens(record.summary || ''));
  const right = new Set(significantTokens(text));
  const shared = [...left].filter(token => right.has(token));
  if (shared.length >= 2) return true;
  if (shared.length === 1) {
    const denominator = Math.min(left.size, right.size);
    if (shared[0].length >= 6 && denominator > 0 && (shared.length / denominator) >= 0.5) return true;
  }

  const haystack = canonicalText(text);
  if (!haystack) return false;
  if (sharedSpacelessBigrams(record.summary || '', haystack) >= 3) return true;
  const anchors = (Array.isArray(record.anchors) ? record.anchors : [])
    .map(canonicalText)
    .filter(anchorLongEnough);
  const matched = anchors.filter(anchor => containsOnWordBoundaries(haystack, anchor));
  if (matched.some(anchor => anchor.includes(' '))) return true;
  if (matched.length >= 2) return true;
  // A single anchor identifies the record when it is specific: five letters, or two ideographs.
  return anchors.length === 1 && matched.length === 1
    && (matched[0].length >= 5 || SPACELESS_SCRIPT.test(matched[0]));
}

// Word boundaries are enforced where words are separated by spaces and carry no attached particles or
// prefixes (Latin, Greek, Cyrillic, Armenian, Georgian letters, and digits). Korean particles ("서울에"),
// Arabic/Hebrew prefixes and scripts written without spaces may attach to the excerpt's edge.
const BOUNDED_WORD_EDGE = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Armenian}\p{Script=Georgian}\p{N}]/u;

// The excerpt occurs verbatim on word boundaries: "active volcano" is not in "inactive volcano".
export function containsOnWordBoundaries(haystack, needle) {
  const first = !BOUNDED_WORD_EDGE.test(needle[0]);
  const last = !BOUNDED_WORD_EDGE.test(needle[needle.length - 1]);
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    const before = haystack[at - 1];
    const after = haystack[at + needle.length];
    if ((first || before === undefined || before === ' ') && (last || after === undefined || after === ' ')) return true;
  }
  return false;
}

export function evidenceClaimGrounded(claim, sourceText) {
  const needle = canonicalText(claim);
  const haystack = canonicalText(sourceText);
  const tokens = needle.split(' ').filter(token => token.length > 1);
  if (needle.length < 8) return false;
  // A run of spaceless script is one token but holds many words.
  if (tokens.length < 2 && !SPACELESS_SCRIPT.test(needle)) return false;
  return containsOnWordBoundaries(haystack, needle);
}

// Words that report what someone said, heard or believes. Words used as often as nouns or idioms count only
// in their reporting use: "claims" and "states" followed by what is reported ("claims that", "claims the
// strike ended", never "land claims are disputed" or "the Free States levy"), "swore" with an object
// ("swore the gate was sealed", never "Bram swore"), "told" outside "all told"; "warning" is no reporting
// word ("without warning", "warning bells") while "warns" and "warned" are.
// A reporting verb is followed by what is reported: "that", "to", or the reported clause's subject.
const REPORTED_CLAUSE = '(?=\\s+(?:that|to|the|a|an|this|these|those|his|her|their|its|our|my|he|she|they|it|we|i|you|there|someone|everyone|no)\\b)';
const REPORTING_WORDS = 'reports?|reported|reportedly|reporting|rumou?rs?|rumou?red|claimed|claiming|claims?' + REPORTED_CLAUSE
  + '|alleges?|alleged|allegedly|according to|warns?|warned|believes?|believed|belief|beliefs|suspects?|suspected'
  + '|predicts?|predicted|prediction|predictions|forecasts?|forecasted|said to|says?|said|states' + REPORTED_CLAUSE + '|stated'
  + '|announces?|announced|declares?|declared|confesses?|confessed|admits?|admitted|denies|denied|accuses?|accused'
  + '|proclaims?|proclaimed|(?:swears?|swore)(?=\\s+(?:that|to|on|by|an?\\s+oath|he|she|they|it|we|i|you|the|his|her|their)\\b)'
  + '|vows?|vowed|word is|word was|word has|news of|news that|news about|accounts? of|accounts? that|talk of|gossip|hearsay';
// A summary keeps a reported account reported with these words.
const REPORTED_ACCOUNT_RE = new RegExp('\\b(?:' + REPORTING_WORDS + '|warnings?(?=\\s+(?:of|that|about)\\b)|supposedly|purportedly|unconfirmed|unverified)\\b', 'iu');
// ... or describes the speech act itself. "Orders" counts only as a verb with an object ("orders every vendor
// to pay"), never as a noun ("Holy Orders", "under orders of").
const SPEECH_ACT_OBJECT = '(?=\\s+(?:that|to|the|a|an|all|every|each|his|her|their|its|them|him|us|everyone|everybody|anyone|no|any|some)\\b)';
const SPEECH_ACT_SUMMARY_RE = new RegExp('\\b(?:demands?|demanded|demanding|orders?' + SPEECH_ACT_OBJECT + '|ordered|ordering|threatens?|threatened|threatening'
  + '|promises?|promised|promising|offers?|offered|offering|refuses?|refused|asks?|asked|asking|requests?|requested|requesting|insists?|insisted)\\b', 'iu');
// ... or keeps a plan, expectation or condition prospective.
const PROSPECTIVE_SUMMARY_RE = /\b(?:will|shall|might|going to|about to|plans?|planned|planning|plotting|intends?|intended|intending|intention|aims?|hopes?|expects?|expected|expecting|prepares?|preparing|if|unless|threat|threatened|tomorrow|tonight)\b/iu;
const ATTRIBUTION_RE = new RegExp('\\b(?:' + REPORTING_WORDS + '|insists?|insisted|tells?|(?<!\\ball )told|explains?|explained|mentions?|mentioned|whispers?|whispered|informs?|informed)\\b', 'iu');
// A demand, order, threat or promise is itself a narrated act ("Orson demands an unloading fee" shows the
// extortion); only what is demanded, ordered, threatened or promised (the text after the verb) is not
// established by it.
export const SPEECH_ACT_RE = /\b(?:demands?|demanded|demanding|orders|ordered|ordering|threatens?|threatened|threatening|promises?|promised|promising|offers|offered|offering|asks?|asked|asking|requests|requested|requesting|insists?|insisted)\b/giu;

// Quoted spans. A quotation runs across a wrapped line until its closing mark; it ends at a blank line or
// where a new line opens with a quote mark (speech continued into the next paragraph leaves the earlier one
// open to the end of its paragraph), so a stray quote cannot turn the rest of the reply into dialogue.
// Double quotes, curly quotes, 「」『』 and «» open dialogue; single quotes ('...', ‘...’) do only when they
// close within the paragraph (otherwise they are apostrophes: 'tis, 'em). A straight double quote right after
// a digit is an inch mark outside dialogue (6'2") and inside it only after feet ("he is 6'2" tall"), so
// dialogue ending in a number ("The toll is now 20") closes.
const PAIRED_QUOTES = Object.freeze({ '“': '”', '„': '“', '「': '」', '『': '』', '«': '»' });
const NEW_QUOTED_LINE = /^[ \t]*(?:["“„「『«‘']|\r?\n)/u;
const LETTER = /[\p{L}\p{N}]/u;

function singleQuoteEnd(source, from) {
  for (let index = from + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\n' && NEW_QUOTED_LINE.test(source.slice(index + 1, index + 4))) return -1;
    if ((char === "'" || char === '’') && !LETTER.test(source[index + 1] || '') && /[\p{L}\p{N}.,!?;:…\-—]/u.test(source[index - 1] || '')) return index;
  }
  return -1;
}

// A short title-cased quotation inside a sentence is a name ("the "Black Gull" anchors offshore"), not speech.
const NAME_CONNECTORS = new Set(['of', 'the', 'and', 'de', 'la', 'le', 'du', 'von', 'van', 'del', 'da']);
function nameLikeQuote(text) {
  if (/[.!?,;:…]/u.test(text)) return false;
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (!words.length || words.length > 4) return false;
  return words.every(word => /^\p{Lu}/u.test(word) || NAME_CONNECTORS.has(word.toLocaleLowerCase())) && /^\p{Lu}/u.test(words[0]);
}

function quotedSpans(sourceText) {
  const source = String(sourceText ?? '');
  const spans = [];
  let open = -1;
  let closer = '';
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\n' && open >= 0) {
      if (NEW_QUOTED_LINE.test(source.slice(index + 1, index + 4))) {
        spans.push([open + 1, index]);
        open = -1;
      }
      continue;
    }
    if (open >= 0) {
      if (char !== closer) continue;
      if (closer === '"' && /\d['’]\s?\d{1,2}$/u.test(source.slice(Math.max(0, index - 6), index))) continue;
      spans.push([open + 1, index]);
      open = -1;
      continue;
    }
    if (char === '"') {
      if (/\d/u.test(source[index - 1] || '')) continue;
      open = index;
      closer = '"';
    } else if (PAIRED_QUOTES[char]) {
      open = index;
      closer = PAIRED_QUOTES[char];
    } else if ((char === "'" || char === '‘') && !LETTER.test(source[index - 1] || '') && LETTER.test(source[index + 1] || '')) {
      const end = singleQuoteEnd(source, index);
      if (end > index) {
        spans.push([index + 1, end]);
        index = end;
      }
    }
  }
  if (open >= 0) spans.push([open + 1, source.length]);
  return spans.filter(([from, to]) => to > from && !nameLikeQuote(source.slice(from, to)));
}

function quotedDialogueSegments(sourceText) {
  const source = String(sourceText ?? '');
  return quotedSpans(source).map(([from, to]) => source.slice(from, to)).filter(segment => segment.trim());
}

export function sourceWithoutQuotedDialogue(sourceText) {
  const source = String(sourceText ?? '');
  const spans = quotedSpans(source).sort((a, b) => a[0] - b[0]);
  let out = '';
  let at = 0;
  for (const [from, to] of spans) {
    if (from < at) continue;
    out += source.slice(at, Math.max(at, from - 1)) + ' ';
    at = Math.min(source.length, to + 1);
  }
  return out + source.slice(at);
}

export function evidenceClaimQuotedOnly(claim, sourceText) {
  if (!evidenceClaimGrounded(claim, sourceText)) return false;
  const quoted = quotedDialogueSegments(sourceText)
    .some(segment => evidenceClaimGrounded(claim, segment));
  if (!quoted) return false;
  return !evidenceClaimGrounded(claim, sourceWithoutQuotedDialogue(sourceText));
}

// Most of the claim's substance lies inside quoted dialogue (its words occur in
// the quotes and nowhere in the narration around them): an excerpt that wraps
// a quotation together with its "A trader says," frame is still a quotation.
function claimSubstanceQuoted(claim, sourceText) {
  const tokens = significantTokens(claim);
  if (tokens.length < 2) return false;
  const quoted = new Set(quotedDialogueSegments(sourceText).flatMap(segment => significantTokens(segment)));
  if (!quoted.size) return false;
  const narrated = new Set(significantTokens(sourceWithoutQuotedDialogue(sourceText)));
  const quotedOnly = tokens.filter(token => quoted.has(token) && !narrated.has(token));
  return quotedOnly.length >= 2 && quotedOnly.length * 2 >= tokens.length;
}

// Clauses of one sentence, with whether the separator before each one turns to
// a different proposition ("while", "but", ";"): a reporting verb there does not
// carry over.
const CLAUSE_SEPARATOR = /(\s*[,;:]\s*|\s+(?:while|whereas|but|although|though|meanwhile|yet)\s+)/iu;
const CONTRASTIVE_SEPARATOR = /;|\b(?:while|whereas|but|although|though|meanwhile|yet)\b/iu;
const ATTRIBUTION_ONLY_TOKENS = 4;
// A relative, participial or temporal clause describes its subject or a time ("The guard, who reported the
// theft, now patrols ..."); a reporting verb inside it does not report the main clause.
const SUBORDINATE_CLAUSE = /^(?:who|whom|whose|which|where|having|after|before|when|once|since|until)\b/iu;

function sentenceClauses(sentence) {
  const parts = String(sentence).split(CLAUSE_SEPARATOR);
  const clauses = [];
  let contrastive = false;
  for (let index = 0; index < parts.length; index += 1) {
    if (index % 2 === 1) {
      contrastive = CONTRASTIVE_SEPARATOR.test(parts[index]);
      continue;
    }
    const text = parts[index].trim();
    if (text) clauses.push({ text, contrastiveBefore: clauses.length > 0 && contrastive });
    contrastive = false;
  }
  return clauses;
}

// Attribution follows the claim's own clause: a reporting verb in that clause
// or an earlier one of the same sentence (unless a contrastive turn intervenes),
// or a short trailing attribution clause ("..., the trader said."). A reporting
// clause about something else in the same sentence does not make a narrated
// claim hearsay.
function clauseAttributes(sentence, claimTokens) {
  const clauses = sentenceClauses(sentence);
  const bearing = clauses.map(clause => {
    const tokens = significantTokens(clause.text);
    const shared = tokens.filter(token => claimTokens.has(token)).length;
    return shared > 0 && shared * 5 >= tokens.length * 2;
  });
  return clauses.some((clause, index) => {
    if (!bearing[index]) return false;
    if (ATTRIBUTION_RE.test(clause.text)) return true;
    for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
      if (clauses[earlier + 1].contrastiveBefore) break;
      if (SUBORDINATE_CLAUSE.test(clauses[earlier].text)) continue;
      if (ATTRIBUTION_RE.test(clauses[earlier].text)) return true;
    }
    const next = clauses[index + 1];
    return Boolean(next && !next.contrastiveBefore && !SUBORDINATE_CLAUSE.test(next.text) && ATTRIBUTION_RE.test(next.text)
      && canonicalText(next.text).split(' ').filter(Boolean).length <= ATTRIBUTION_ONLY_TOKENS);
  });
}

// "X reports that ..." / "X insisted ... that ...": everything after the
// complementizer is the reported content, whatever turns it takes.
function claimInsideReportedComplement(claim, sentence) {
  const text = canonicalText(sentence);
  const needle = canonicalText(claim);
  const match = new RegExp(ATTRIBUTION_RE.source + '[^.!?]*?\\bthat\\b', 'iu').exec(text);
  if (!match || !needle) return false;
  const at = text.indexOf(needle);
  return at >= match.index + match[0].length - 4;
}

const SENTENCE_SEPARATOR = /((?<=[.!?])[ \t]+|\s*\r?\n\s*)/u;
// A full stop after a title or an initial does not end the sentence ("Lt. Varro reported that ...").
const ABBREVIATION_END = /(?:^|[\s(\["“'‘])(?:mr|mrs|ms|dr|st|mt|ft|lt|col|gen|capt|cpt|sgt|cmdr|cdr|adm|maj|prof|rev|fr|sr|jr|hon|gov|pres|sen|rep|no|vol|ch|vs|e\.g|i\.e|\p{Lu})\.$/iu;

export function sentencesOf(text) {
  const parts = String(text ?? '').split(SENTENCE_SEPARATOR);
  const out = [];
  for (let index = 0; index < parts.length; index += 2) {
    const part = parts[index];
    const separator = parts[index - 1] || '';
    if (out.length && !/\n/u.test(separator) && ABBREVIATION_END.test(out[out.length - 1])) out[out.length - 1] += separator + part;
    else if (part) out.push(part);
  }
  return out.filter(part => part.trim());
}

// The claim is the content of a demand, order, threat or promise made earlier in its sentence, and does
// not itself include the verb (that would be the narrated act).
// The verb must govern the claim: in the same clause (no comma, semicolon or contrastive turn between) and
// within a few words before it ("demand that every vendor pay"), so "Under the captain's orders, the bridge
// burned" or "The inn offers no rooms; the city is under quarantine" stays narration.
const SPEECH_ACT_REACH = 4;
const COORDINATING = new Set(['and', 'then', 'or', 'but', 'before', 'after', 'while', 'yet']);
function claimInsideSpeechActComplement(claim, sentence) {
  const needle = canonicalText(claim);
  if (!needle || new RegExp(SPEECH_ACT_RE.source, 'iu').test(needle)) return false;
  return sentenceClauses(sentence).some(clause => {
    const text = canonicalText(clause.text);
    const at = ` ${text} `.indexOf(` ${needle} `);
    if (at < 0) return false;
    for (const match of text.matchAll(SPEECH_ACT_RE)) {
      const end = match.index + match[0].length;
      if (end > at) continue;
      const between = text.slice(end, at).split(' ').filter(Boolean);
      // "threatened the villagers and burned the granary": the burning is a second narrated act.
      if (between.some(word => COORDINATING.has(word))) continue;
      if (between.length <= SPEECH_ACT_REACH) return true;
    }
    return false;
  });
}

// Reported (quoted, attributed, a speech act's content), or planned or conditional.
function sentenceAttributed(claim, sourceText) {
  return sentenceReported(claim, sourceText) || evidenceClaimProspective(claim, sourceText);
}

function sentenceReported(claim, sourceText) {
  if (evidenceClaimQuotedOnly(claim, sourceText)) return true;
  if (claimSubstanceQuoted(claim, sourceText)) return true;
  const source = String(sourceText ?? '');
  const claimTokens = new Set(significantTokens(claim));
  let segments = sentencesOf(source).filter(segment => evidenceClaimGrounded(claim, segment));
  // An excerpt running across a sentence end is judged within its line.
  if (!segments.length) segments = source.split(/\r?\n+/u).filter(segment => evidenceClaimGrounded(claim, segment));
  return segments.some(segment => (
    claimInsideSpeechActComplement(claim, segment)
    || (ATTRIBUTION_RE.test(segment) && (claimInsideReportedComplement(claim, segment) || clauseAttributes(segment, claimTokens)))
  ));
}

// An excerpt spanning several sentences is judged by the sentences that carry the change it supports (all
// of them when none does): it is reported only when every such sentence is, so a cited rumour stays a rumour
// beside unrelated narration, while narration of the change itself still establishes it.
function evidenceClaimAttributed(claim, sourceText, focusText = '') {
  const parts = sentencesOf(claim).map(part => part.trim())
    .filter(part => canonicalText(part).length >= 8);
  if (parts.length < 2) return sentenceAttributed(claim, sourceText);
  const focus = new Set(significantTokens(focusText));
  // A sentence carries the change when it shares two of its content words (one when the change has one):
  // naming the same place is not enough.
  const needed = Math.min(2, focus.size);
  const bearing = needed ? parts.filter(part => new Set(significantTokens(part).filter(token => focus.has(token))).size >= needed) : [];
  return (bearing.length ? bearing : parts).every(part => sentenceAttributed(part, sourceText));
}

function anchorSupported(anchor, evidence, existingRecord = null, assertionText = '') {
  const normalized = canonicalText(anchor);
  if (!normalized) return false;
  if ((existingRecord?.anchors || []).some(item => canonicalText(item) === normalized)) return true;
  if (evidence.some(item => {
    const claim = canonicalText(item.claim);
    // Whole words only: "rat" is not in "pirate".
    if (containsOnWordBoundaries(claim, normalized)) return true;
    const anchorTokens = significantTokens(normalized);
    const claimTokens = new Set(significantTokens(claim));
    if (anchorTokens.length === 0) return false;
    const shared = anchorTokens.filter(token => claimTokens.has(token));
    return shared.length >= Math.ceil(anchorTokens.length / 2)
      && shared.some(token => token.length >= 4);
  })) return true;
  if (!containsOnWordBoundaries(canonicalText(assertionText), normalized)) return false;
  const anchorTokens = significantTokens(normalized);
  return evidence.some(item => {
    const claimTokens = new Set(significantTokens(item.claim));
    return anchorTokens.some(token => token.length >= 5 && claimTokens.has(token));
  });
}

export function preservesReportedInformationStatus(summary) {
  const text = String(summary ?? '');
  return REPORTED_ACCOUNT_RE.test(text) || SPEECH_ACT_SUMMARY_RE.test(text) || PROSPECTIVE_SUMMARY_RE.test(text);
}

// A record that is itself a reported account (a rumour, a report): another report may end it. A record of an
// arrangement worded as a speech act ("men demanding a levy") is an established condition.
function reportedAccountRecord(summary) {
  return REPORTED_ACCOUNT_RE.test(String(summary ?? ''));
}

// What is planned, expected or conditional has not happened: a claim stating it ("the valley will flood",
// "the duke plans to march") or standing in a conditional sentence ("If the dam breaks tonight, ...").
// Modal verbs count in lower case only, so a character named Will or May does not.
const PROSPECTIVE_CLAIM_RE = /\b(?:will|shall|might|going to|about to)\b|\b(?:plans?|planned|planning|plotting|intends?|intended|intending|aims?|hopes?|expects?|expected|prepares?|preparing)\s+to\b|\b(?:[Tt]omorrow|[Tt]onight|[Nn]ext (?:day|morning|evening|week|month|year|season|spring|summer|autumn|fall|winter))\b/u;
const CONDITIONAL_START = /^[^\p{L}\p{N}]*(?:even\s+)?(?:if|unless|whether|lest|suppose|supposing|in case|should)\b/iu;

function evidenceClaimProspective(claim, sourceText) {
  if (PROSPECTIVE_CLAIM_RE.test(String(claim ?? ''))) return true;
  return sentencesOf(sourceText).some(sentence => evidenceClaimGrounded(claim, sentence) && (
    CONDITIONAL_START.test(sentence)
    || sentenceClauses(sentence).some(clause => CONDITIONAL_START.test(clause.text) && evidenceClaimGrounded(claim, clause.text))
  ));
}

export function captureExchangeIndex(exchange = []) {
  const map = new Map();
  for (const message of Array.isArray(exchange) ? exchange : []) {
    if (!Number.isInteger(message?.messageId) || message.messageId < 0) continue;
    const role = messageRole(message);
    const raw = messageText(message);
    const text = role === 'assistant' ? sanitizeAssistantNarration(raw) : raw;
    map.set(message.messageId, {
      messageId: message.messageId,
      role,
      text,
      lineageKey: typeof message.lineageKey === 'string' ? message.lineageKey : '',
    });
  }
  return map;
}

export function applyCaptureSourceFirewall(mutation, {
  exchange = [],
  visibleRecords = [],
  lifecycleContextRecordIds = [],
  state,
} = {}) {
  const candidate = clone(mutation);
  if (candidate.action === 'noop') return { ok: true, mutation: candidate };

  const exchangeById = captureExchangeIndex(exchange);
  const visibleIds = new Set((Array.isArray(visibleRecords) ? visibleRecords : []).map(record => record?.id).filter(Boolean));
  const stateRecords = new Map((Array.isArray(state?.records) ? state.records : []).map(record => [record.id, record]));
  const lifecycleContextIds = new Set(
    (Array.isArray(lifecycleContextRecordIds) ? lifecycleContextRecordIds : [])
      .map(value => String(value || '').trim())
      .filter(id => id && visibleIds.has(id))
      .slice(0, 4),
  );

  if (candidate.action !== 'create') {
    if (!visibleIds.has(candidate.recordId) || !stateRecords.has(candidate.recordId)) {
      return { ok: false, reason: 'target record was not part of the bounded capture context' };
    }
  }

  if (candidate.action === 'create' && candidate.newEpisodeOfRecordId) {
    const prior = stateRecords.get(candidate.newEpisodeOfRecordId);
    if (!visibleIds.has(candidate.newEpisodeOfRecordId) || !prior || !['resolved', 'superseded'].includes(prior.status)) {
      return { ok: false, reason: 'newEpisodeOfRecordId must reference a visible resolved/superseded record' };
    }
  }

  for (const relatedId of candidate.relatedRecordIds || []) {
    if (!visibleIds.has(relatedId) || !stateRecords.has(relatedId)) {
      return { ok: false, reason: 'relatedRecordIds may reference only visible current-state records' };
    }
  }

  const evidence = [];
  const evidenceSupport = [];
  for (const item of candidate.evidence || []) {
    const source = exchangeById.get(item.sourceMessageId);
    if (!source || source.role === 'system') {
      return { ok: false, reason: 'automatic capture evidence must come from the current user/assistant exchange' };
    }
    if (!evidenceClaimGrounded(item.claim, source.text)) {
      return { ok: false, reason: 'evidence claim is not grounded as an excerpt of its source message' };
    }
    const normalizedEvidence = {
      sourceMessageId: item.sourceMessageId,
      lineageKey: source.lineageKey,
      sourceClass: source.role === 'user' ? 'user_narration' : 'assistant_narration',
      claim: item.claim,
    };
    evidence.push(normalizedEvidence);
    evidenceSupport.push({
      ...normalizedEvidence,
      attributed: evidenceClaimAttributed(item.claim, source.text, candidate.summary || stateRecords.get(candidate.recordId)?.summary || ''),
    });
  }

  if (evidence.length === 0) {
    return { ok: false, reason: 'automatic capture mutation has no grounded current-exchange evidence' };
  }

  const existing = candidate.recordId ? stateRecords.get(candidate.recordId) : null;
  if (existing && existing.status !== 'active') {
    return {
      ok: false,
      reason: 'resolved/superseded history is immutable during automatic capture; create a genuinely new episode instead',
    };
  }

  const assertionText = candidate.summary || existing?.summary || '';
  const affinityAnchors = candidate.anchors ?? existing?.anchors ?? [];
  const supportingEvidence = evidenceSupport.filter(item => lexicalAffinity(assertionText, item.claim, affinityAnchors));
  if (!supportingEvidence.length) {
    return { ok: false, reason: 'mutation summary/current subject is not supported by its cited evidence claims' };
  }

  if (existing) {
    const targetEvidence = evidenceSupport.filter(item => targetAffinity(existing, item.claim));
    const uniqueInterpretiveBinding = lifecycleContextIds.size === 1
      && lifecycleContextIds.has(existing.id);
    if (!targetEvidence.length && !uniqueInterpretiveBinding) {
      return {
        ok: false,
        reason: 'current-exchange evidence does not identify the existing target record being mutated',
      };
    }
    if (uniqueInterpretiveBinding
      && candidate.summary
      && !targetAffinity(existing, candidate.summary)) {
      return {
        ok: false,
        reason: 'interpretive lifecycle context may bind an indirect reference only when the proposed summary still refers to that existing target',
      };
    }
  }

  if (candidate.anchors !== undefined) {
    const proposedAnchors = candidate.anchors.length;
    candidate.anchors = candidate.anchors.filter(anchor => anchorSupported(anchor, evidenceSupport, existing, assertionText));
    // An update whose proposed anchors were all unsupported keeps the record's anchors (the reducer would
    // otherwise replace them with []); an explicit empty list from the provider still clears them.
    if (existing && proposedAnchors && !candidate.anchors.length) delete candidate.anchors;
  }

  // An unconfirmed account cannot end an established condition: ending it needs narrated support.
  // (A record that is itself reported information may be ended by another report.)
  const endsRecord = ['resolve', 'supersede'].includes(candidate.action)
    || ['resolved', 'superseded'].includes(candidate.status);
  if (existing && endsRecord && supportingEvidence.every(item => item.attributed)
    && !reportedAccountRecord(existing.summary)) {
    return {
      ok: false,
      reason: 'a reported, quoted, attributed, planned or conditional account cannot resolve or supersede an established condition; narrated confirmation is required',
    };
  }

  if (supportingEvidence.every(item => item.attributed)) {
    const epistemicSummary = candidate.summary || existing?.summary || '';
    if (!preservesReportedInformationStatus(epistemicSummary)) {
      return {
        ok: false,
        reason: 'quoted dialogue alone, other attributed evidence, or a plan or condition may establish reported information, the speech act or the plan itself, but the mutation summary must preserve reporting/uncertainty, describe the speech act, or keep the plan or condition prospective instead of promoting the underlying claim to fact',
      };
    }
  }

  candidate.evidence = evidence;
  return { ok: true, mutation: candidate };
}
