import { clone, messageRole, messageText } from './common.js';
import { sanitizeAssistantNarration } from './narrative-sanitizer.js';
import { SPACELESS_SCRIPT, canonicalText, sharedSpacelessBigrams } from './hash.js';

// Shared with rebuild's lifecycle check; never modify it.
export const SUPPORT_STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'into', 'onto', 'over', 'under', 'after', 'before',
  'while', 'where', 'when', 'then', 'than', 'they', 'them', 'their', 'there', 'here', 'have', 'has',
  'had', 'was', 'were', 'are', 'is', 'been', 'being', 'will', 'would', 'could', 'should', 'about',
  'among', 'through', 'around', 'still', 'current', 'currently', 'now', 'near', 'behind', 'outside',
]);

// Content words of at least three letters, plural endings folded ('bridges' -> 'bridge').
export function significantTokens(value, stopwords = SUPPORT_STOPWORDS) {
  return canonicalText(value)
    .split(' ')
    .filter(token => token.length >= 3 && !stopwords.has(token))
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

  // Distinct words: a summary repeating one word does not share two.
  const leftTokens = [...new Set(significantTokens(a))];
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

// Polarity and endings. An excerpt sharing a summary's words does not establish it when it says the opposite
// ("Northbridge has not collapsed" for "Northbridge has collapsed"), and a condition that the excerpt says
// continues ("the garrison still occupies Northbridge") is not ended by it. Judged per clause and only where a
// clause carries every content word of the statement, so a paraphrase is never refused on wording alone.
const NEGATION = /\b(?:not|never|cannot|nor|neither|none|no|nobody|nothing|nowhere|no\s+longer)\b|n['’]t\b/iu;
const NEGATION_WORDS = new Set(['not', 'never', 'cannot', 'nor', 'neither', 'none', 'nobody', 'nothing', 'nowhere', 'longer', 'anymore']);
const CONTINUATION = /\b(?:still|remains?|remained|continues?|continued|persists?|persisted|keeps?|kept|yet)\b/giu;
// Clauses, subordinate and relative ones included ("Northbridge collapsed because the engineers did not
// reinforce it": the negation belongs to the reason, not to the collapse).
const CLAIM_CLAUSE = /[;,:—–()]|\s(?:and|but|while|whereas|though|although|because|since|until|unless|after|before|when|whenever|where|which|who|whom|whose|that)\s|(?<=[.!?])\s+/iu;

// The statement's content words, its negation words left out (they are its polarity, judged apart).
function contentWords(statement) {
  return [...new Set(significantTokens(statement))].filter(word => !NEGATION_WORDS.has(word));
}

function clausesCarrying(statement, claim) {
  const words = contentWords(statement);
  if (words.length < 2) return [];
  return String(claim ?? '').split(CLAIM_CLAUSE).filter(clause => {
    const tokens = new Set(significantTokens(clause ?? ''));
    return words.every(word => tokens.has(word));
  });
}

// Every clause of the claim that states the summary's content states it with the opposite polarity.
export function claimContradictsStatement(statement, claim) {
  const clauses = clausesCarrying(statement, claim);
  const negated = NEGATION.test(String(statement ?? ''));
  return clauses.length > 0 && clauses.every(clause => NEGATION.test(clause) !== negated);
}

// The claim says the record's own condition continues: a clause carrying it with the same polarity and a word
// of continuation ("still", "remains", "continues") beyond those the record's own summary uses.
export function claimStatesContinuation(recordSummary, claim) {
  const summary = String(recordSummary ?? '');
  const negated = NEGATION.test(summary);
  const own = (summary.match(CONTINUATION) || []).length;
  return clausesCarrying(summary, claim)
    .some(clause => (clause.match(CONTINUATION) || []).length > own && NEGATION.test(clause) === negated);
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
  + '|predicts?|predicted|prediction|predictions|forecasts?|forecasted|said to|(?:says?|said)(?!\\s+(?:nothing|little|no\\s+more)\\b)|states' + REPORTED_CLAUSE + '|stated'
  + '|announces?|announced|declares?|declared|confesses?|confessed|admits?|admitted|denies|denied|accuses?|accused'
  + '|proclaims?|proclaimed|(?:swears?|swore)(?=\\s+(?:that|to|on|by|an?\\s+oath|he|she|they|it|we|i|you|the|his|her|their)\\b)'
  + '|vows?|vowed|word is|word was|word has|news of|news that|news about|accounts? of|accounts? that|talk of|gossip|hearsay';
// A summary keeps a reported account reported with these words.
const REPORTED_ACCOUNT_RE = new RegExp('\\b(?:' + REPORTING_WORDS + '|warnings?(?=\\s+(?:of|that|about)\\b)|supposedly|purportedly|unconfirmed|unverified)\\b', 'iu');
// ... or describes the speech act itself. "Orders" counts only as a verb with an object ("orders every vendor
// to pay"), never as a noun ("Holy Orders", "under orders of").
const SPEECH_ACT_OBJECT = '(?=\\s+(?:that|to|the|a|an|all|every|each|his|her|their|its|them|him|us|everyone|everybody|anyone|no|any|some)\\b)';
// "Refuses" is left out: it states a condition ("the gate refuses to open", "the guild refuses entry").
const SPEECH_ACT_SUMMARY_RE = new RegExp('\\b(?:demands?|demanded|demanding|orders?' + SPEECH_ACT_OBJECT + '|ordered|ordering|threatens?|threatened|threatening'
  + '|promises?|promised|promising|offers?|offered|offering|asks?|asked|asking|requests?|requested|requesting|insists?|insisted)\\b', 'iu');
// ... or keeps a plan, expectation or condition prospective.
// Modal verbs and "hope" count in lower case only, so a name (Will, Hope, May) does not keep a summary
// prospective; "going to" counts only before a verb ("going to the capital" is travel).
const PROSPECTIVE_SUMMARY_RE = /\b(?:will|shall|might|hopes?)\b|\b(?:[Gg]oing to(?!\s+(?:the|a|an|his|her|their|its|my|our|your|this|that|these|those)\b|\s+\p{Lu})|[Aa]bout to|[Pp]lans?|[Pp]lanned|[Pp]lanning|[Pp]lotting|[Ii]ntends?|[Ii]ntended|[Ii]ntending|[Ii]ntention|[Aa]ims?|[Ee]xpects?|[Ee]xpected|[Ee]xpecting|[Pp]repares?|[Pp]reparing|[Ii]f|[Uu]nless|[Tt]hreat|[Tt]hreatened|[Tt]omorrow|[Tt]onight)\b/u;
// Speech verbs of an action beat ("the guard shouted") attribute dialogue like "said". Forms that are also
// nouns or other verbs ("screams echoed", "the council answered the petition") are left out.
const ATTRIBUTION_RE = new RegExp('\\b(?:' + REPORTING_WORDS + '|insists?|insisted|tells?|(?<!\\ball )told|explains?|explained|mentions?|mentioned|whispers?|whispered|informs?|informed'
  + '|shouts|shouted|yells|yelled|cried|screamed|called\\s+out|muttered|murmured|replied|exclaimed)\\b', 'iu');
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

// Elided words open no quotation mid-sentence in lower case ("we drove 'em off"); at the start of a line or
// sentence ('Cause the duke ...', 'Round here ...) they may open dialogue.
const ELISION = /^(?:em|tis|twas|til|cause|bout|round|nuff|neath|cept|ere)\b/u;

function closingSingleQuote(source, index) {
  const char = source[index];
  return (char === "'" || char === '’') && !LETTER.test(source[index + 1] || '') && /[\p{L}\p{N}.,!?;:…\-—]/u.test(source[index - 1] || '');
}

// A plural possessive ("'The soldiers' horses are gone,' ...") is no closing quote: an apostrophe after "s"
// and before a lower-case word, when the quotation closes again later in its paragraph. Without a later
// close it is the end of the line ("'Fetch the horses' ordered Mira.").
function singleQuoteEnd(source, from) {
  let possessive = -1;
  for (let index = from + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === '\n' && NEW_QUOTED_LINE.test(source.slice(index + 1, index + 4))) break;
    if (!closingSingleQuote(source, index)) continue;
    if (/s/iu.test(source[index - 1] || '') && /^ \p{Ll}/u.test(source.slice(index + 1, index + 3))) {
      if (possessive < 0) possessive = index;
      continue;
    }
    return index;
  }
  return possessive;
}

// A short title-cased quotation introduced as a name ("the "Black Gull" anchors offshore", "a ship named
// "Sea Wolf"") is a name, not speech; a shouted word ("The sentry yelled "Bandits"") stays dialogue.
const NAME_CONNECTORS = new Set(['of', 'the', 'and', 'de', 'la', 'le', 'du', 'von', 'van', 'del', 'da']);
const NAME_INTRODUCER = /(?:^|[^\p{L}])(?:the|a|an|aboard|named|called|dubbed|known as)\s*$/iu;
function nameLikeQuote(text, before) {
  if (!NAME_INTRODUCER.test(before) || /[.!?,;:…]/u.test(text)) return false;
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (!words.length || words.length > 4) return false;
  return words.every(word => /^\p{Lu}/u.test(word) || NAME_CONNECTORS.has(word.toLowerCase())) && /^\p{Lu}/u.test(words[0]);
}

// Inner ranges [from, to) of the quoted spans, in reading order and never overlapping (also exported for
// callers that blank dialogue out themselves).
export { quotedSpans as quotedDialogueRanges };
// The spans of the last few texts: one evidence check reads the same message's quotes many times (each claim,
// each sentence test), so they are paired once per text. Callers never mutate the returned spans.
const QUOTED_SPAN_CACHE = new Map();
const QUOTED_SPAN_CACHE_SIZE = 8;
function quotedSpans(sourceText) {
  const source = String(sourceText ?? '');
  const cached = QUOTED_SPAN_CACHE.get(source);
  if (cached) return cached;
  const spans = Object.freeze(pairQuotedSpans(source).map(span => Object.freeze(span)));
  if (QUOTED_SPAN_CACHE.size >= QUOTED_SPAN_CACHE_SIZE) QUOTED_SPAN_CACHE.delete(QUOTED_SPAN_CACHE.keys().next().value);
  QUOTED_SPAN_CACHE.set(source, spans);
  return spans;
}

function pairQuotedSpans(source) {
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
    } else if ((char === "'" || char === '‘') && !LETTER.test(source[index - 1] || '') && LETTER.test(source[index + 1] || '')
      && !(ELISION.test(source.slice(index + 1, index + 8)) && /\p{L}[\s,]*$/u.test(source.slice(Math.max(0, index - 12), index)))) {
      const end = singleQuoteEnd(source, index);
      if (end > index) {
        spans.push([index + 1, end]);
        index = end;
      }
    }
  }
  if (open >= 0) spans.push([open + 1, source.length]);
  return spans.filter(([from, to]) => to > from && !nameLikeQuote(source.slice(from, to), source.slice(Math.max(0, from - 21), from - 1)));
}

function quotedDialogueSegments(sourceText) {
  const source = String(sourceText ?? '');
  return quotedSpans(source).map(([from, to]) => source.slice(from, to)).filter(segment => segment.trim());
}

export function sourceWithoutQuotedDialogue(sourceText) {
  const source = String(sourceText ?? '');
  // Spans come in reading order and never overlap.
  const spans = quotedSpans(source);
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
// An earlier clause attributes a later one only as a frame: it ends with its reporting word ("The scout said,"
// "Rumour has it"), introduces it ("According to the scouts,"), or is a short reporting clause. A clause that
// reports something of its own ("The captain announced the curfew, soldiers barred the gates") does not.
const ATTRIBUTION_FRAME_TOKENS = 4;
function attributionFrame(text) {
  const canon = canonicalText(text);
  const match = ATTRIBUTION_RE.exec(canon);
  if (!match) return false;
  const after = canon.slice(match.index + match[0].length).trim().split(' ').filter(Boolean);
  return !after.length || (after.length === 1 && after[0] === 'that') || /^according to\b/u.test(match[0])
    || canon.split(' ').filter(Boolean).length <= ATTRIBUTION_FRAME_TOKENS;
}

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
      if (attributionFrame(clauses[earlier].text)) return true;
    }
    const next = clauses[index + 1];
    return Boolean(next && !next.contrastiveBefore && !SUBORDINATE_CLAUSE.test(next.text) && ATTRIBUTION_RE.test(next.text)
      && canonicalText(next.text).split(' ').filter(Boolean).length <= ATTRIBUTION_ONLY_TOKENS);
  });
}

// "X reports that ..." / "X insisted ... that ...": everything after the
// complementizer is the reported content, whatever turns it takes.
// "that" is the complementizer only within twelve words of the reporting verb, with no turn between, and not
// as a demonstrative ("said nothing, but that night the river flooded").
const COMPLEMENT_GAP = '(?:\\s+(?!but\\b|while\\b|yet\\b|although\\b|though\\b|whereas\\b|meanwhile\\b|and\\b|then\\b)\\S+){0,12}?';
const DEMONSTRATIVE_THAT = '(?!\\s+(?:night|day|morning|evening|afternoon|dawn|dusk|week|month|year|time|moment|hour|winter|summer|spring|autumn|season|same)\\b)';
const REPORTED_COMPLEMENT_RE = new RegExp(ATTRIBUTION_RE.source + COMPLEMENT_GAP + '\\s+that\\b' + DEMONSTRATIVE_THAT, 'iu');
function claimInsideReportedComplement(claim, sentence) {
  const text = canonicalText(sentence);
  const needle = canonicalText(claim);
  const match = REPORTED_COMPLEMENT_RE.exec(text);
  if (!match || !needle) return false;
  const at = text.indexOf(needle);
  return at >= match.index + match[0].length - 4;
}

// A sentence also ends after a closing quote or bracket that follows its stop ("The gate is sealed." The ...).
const SENTENCE_SEPARATOR = /((?<=[.!?]["'”’»」』)\]]*)[ \t]+|\s*\r?\n\s*)/u;
// A full stop after a title or an initial does not end the sentence ("Lt. Varro reported that ...").
// Titles are capitalized; a lower-case word ("the scout said no.") or a unit ("10 ft.") ends its sentence.
const ABBREVIATIONS = 'Mr|Mrs|Ms|Dr|St|Mt|Lt|Col|Gen|Capt|Cpt|Sgt|Cmdr|Cdr|Adm|Maj|Prof|Rev|Fr|Sr|Jr|Hon|Gov|Pres|Sen|vs|e\\.g|i\\.e';
const ABBREVIATION_END = new RegExp('(?:^|[\\s(\\["“\'‘])(?:' + ABBREVIATIONS + '|\\p{Lu})\\.$', 'u');
// Titles only: a lone capital before a full stop is as often a sentence's last word ("plan B.") as an initial.
const TITLE_END = new RegExp('(?:^|[\\s(\\["“\'‘])(?:' + ABBREVIATIONS + ')\\.$', 'u');

// Whether the character at `index` ends a sentence: a line break, "!" or "?", or a full stop that does not
// close a title ("Mt.", "Lt.", "Capt."). Used by the elapsed-time detector, which must not join two real
// sentences ("... plan B. Two days later ..."), so a lone capital before a full stop ends its sentence here.
export function endsSentenceAt(source, index) {
  const char = source[index];
  if (char === '\n' || char === '!' || char === '?') return true;
  if (char !== '.') return false;
  const from = Math.max(0, index - 16);
  // A cut-off word start is marked with a letter so the pattern's start anchor does not see a word boundary.
  return !TITLE_END.test(`${from > 0 ? 'x' : ''}${source.slice(from, index + 1)}`);
}

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

// The excerpt is a threat or promise together with what it threatens or promises ("threatened to burn the
// granary", "promised the miners that wages would rise"): the act is narrated, its content is not done. A
// coordinated narrated act after it ("... and burned the granary") is narration. A demand or order with its
// content stays a narrated act: one shown demand may establish a levy or toll (an arrangement).
const SPEECH_ACT_CONTENT_RE = /\b(?:threatens?|threatened|threatening)\s+to\s+\S+|\b(?:promises?|promised|promising|vows?|vowed)(?:\s+\S+){0,3}?\s+(?:to|that)\s+\S+/iu;
function claimCarriesSpeechActContent(claim) {
  const text = canonicalText(claim);
  const match = SPEECH_ACT_CONTENT_RE.exec(text);
  if (!match) return false;
  const after = text.slice(match.index + match[0].length).split(' ').filter(Boolean);
  return !after.some(word => COORDINATING.has(word));
}

function sentenceReported(claim, sourceText) {
  if (claimCarriesSpeechActContent(claim)) return true;
  if (evidenceClaimQuotedOnly(claim, sourceText)) return true;
  if (claimSubstanceQuoted(claim, sourceText)) return true;
  const source = String(sourceText ?? '');
  const claimTokens = new Set(significantTokens(claim));
  let segments = sentencesOf(source).filter(segment => evidenceClaimGrounded(claim, segment));
  // An excerpt running across a sentence end is judged within its line.
  if (!segments.length) segments = source.split(/\r?\n+/u).filter(segment => evidenceClaimGrounded(claim, segment));
  // Reported only when every sentence stating it reports it: narration repeated in a report is still narration.
  return segments.length > 0 && segments.every(segment => (
    claimInsideSpeechActComplement(claim, segment)
    || (ATTRIBUTION_RE.test(segment) && (claimInsideReportedComplement(claim, segment) || clauseAttributes(segment, claimTokens)))
  ));
}

// An excerpt spanning several sentences is judged by the sentences that carry the change it supports (all
// of them when none does): it is reported only when every such sentence is, so a cited rumour stays a rumour
// beside unrelated narration, while narration of the change itself still establishes it.
// `judge` decides one sentence: reported (sentenceReported) or planned/conditional (evidenceClaimProspective).
function evidenceClaimAttributed(claim, sourceText, focusText = '', judge = sentenceReported) {
  const parts = sentencesOf(claim).map(part => part.trim())
    .filter(part => canonicalText(part).length >= 8);
  if (parts.length < 2) return judge(claim, sourceText);
  const focus = new Set(significantTokens(focusText));
  // A sentence carries the change when it shares two of its content words (one when the change has one):
  // naming the same place is not enough.
  const needed = Math.min(2, focus.size);
  const bearing = needed ? parts.filter(part => new Set(significantTokens(part).filter(token => focus.has(token))).size >= needed) : [];
  return (bearing.length ? bearing : parts).every(part => judge(part, sourceText));
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
  return REPORTED_ACCOUNT_RE.test(text) || SPEECH_ACT_SUMMARY_RE.test(text);
}

// A summary that keeps a plan or condition prospective. It answers only for planned or conditional evidence,
// never for reported evidence ("The king is dead and the court will choose a successor" is still promotion).
function preservesProspectiveStatus(summary) {
  return PROSPECTIVE_SUMMARY_RE.test(String(summary ?? ''));
}

// A record that is itself a reported account (a rumour, a report): another report may end it. A record of an
// arrangement worded as a speech act ("men demanding a levy") is an established condition.
export function reportedAccountRecord(summary) {
  return REPORTED_ACCOUNT_RE.test(String(summary ?? ''));
}

// Hearsay read from a stored text on its own (evolution has no source message to judge it in): an account
// framed as a report or rumour. A narrated speech act ("the duke declared martial law", "denied", "admitted")
// is an event, not hearsay.
const HEARSAY_RE = /\b(?:reports?|reported|reportedly|rumou?rs?|rumou?red|allegedly|supposedly|purportedly|unconfirmed|unverified|gossip|hearsay|word\s+(?:is|has\s+it)|it\s+is\s+said|heard\s+that|claims?\s+that|claimed\s+that|says?\s+that|said\s+that)\b/iu;
export function hearsayText(text) {
  return HEARSAY_RE.test(String(text ?? ''));
}

// A stored claim read on its own: hearsay, or a plan or expectation. Such a claim keeps its uncertainty when
// another writer reuses it.
export function claimTextAttributed(claim) {
  const text = String(claim ?? '');
  return HEARSAY_RE.test(text) || PROSPECTIVE_CLAIM_RE.test(text);
}

// What is planned, expected or conditional has not happened: a claim stating it ("the valley will flood",
// "the duke plans to march") or standing in a conditional sentence ("If the dam breaks tonight, ...").
// Modal verbs count in lower case only, so a character named Will or May does not.
// A modal followed by its verb, never the noun ("against their will", "with all their might", "the king's
// will"). Narrated day steps ("the next morning") and "tonight" are narration, not plans.
const PROSPECTIVE_CLAIM_RE = /(?<!\b(?:their|his|her|its|my|our|your|the|own|free|good|ill|all)\s+)(?<!['’]s\s+)\b(?:will|shall|might)\s+(?:not\s+|never\s+|soon\s+|surely\s+|likely\s+)?\p{Ll}|\bgoing\s+to\b(?!\s+(?:the|a|an|his|her|their|its|my|our|your|this|that|these|those)\b|\s+\p{Lu})|\babout\s+to\b|\b(?:plans?|planned|planning|plotting|intends?|intended|intending|aims?|hopes?|expects?|expected|prepares?|preparing)\s+to\b|\b[Tt]omorrow\b/u;
const CONDITIONAL_START = /^[^\p{L}\p{N}]*(?:even\s+)?(?:if|unless|lest|suppose|supposing|in case|should)\b/iu;

function evidenceClaimProspective(claim, sourceText) {
  if (PROSPECTIVE_CLAIM_RE.test(String(claim ?? ''))) return true;
  // Conditional only when every sentence stating it is: a narrated statement repeated in an "if" stays narrated.
  const stating = sentencesOf(sourceText).filter(sentence => evidenceClaimGrounded(claim, sentence));
  return stating.length > 0 && stating.every(sentence => CONDITIONAL_START.test(sentence)
    || sentenceClauses(sentence).some(clause => CONDITIONAL_START.test(clause.text) && evidenceClaimGrounded(claim, clause.text)));
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

// Reported or prospective evidence is `attributed`: it cannot end an established condition, and it may
// establish only a summary that keeps its status.
function evidenceStatus(claim, sourceText, focusText) {
  const reported = evidenceClaimAttributed(claim, sourceText, focusText, sentenceReported);
  const prospective = !reported && evidenceClaimAttributed(claim, sourceText, focusText, evidenceClaimProspective);
  return { attributed: reported || prospective, reported };
}

// The per-response context of the firewall: the sanitized exchange and the record lookups. A caller judging
// several rows of one response builds it once (createCaptureFirewallContext) and passes it as `context`.
export function createCaptureFirewallContext({ exchange = [], visibleRecords = [], state } = {}) {
  return {
    exchangeById: captureExchangeIndex(exchange),
    visibleIds: new Set((Array.isArray(visibleRecords) ? visibleRecords : []).map(record => record?.id).filter(Boolean)),
    stateRecords: new Map((Array.isArray(state?.records) ? state.records : []).map(record => [record.id, record])),
  };
}

export function applyCaptureSourceFirewall(mutation, {
  exchange = [],
  visibleRecords = [],
  lifecycleContextRecordIds = [],
  state,
  context = null,
} = {}) {
  const candidate = clone(mutation);
  if (candidate.action === 'noop') return { ok: true, mutation: candidate };

  const { exchangeById, visibleIds, stateRecords } = context || createCaptureFirewallContext({ exchange, visibleRecords, state });
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
      ...evidenceStatus(item.claim, source.text, candidate.summary || stateRecords.get(candidate.recordId)?.summary || ''),
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

  const endsRecord = ['resolve', 'supersede'].includes(candidate.action)
    || ['resolved', 'superseded'].includes(candidate.status);

  // A summary the cited clauses state the opposite of is not established by them.
  if (!endsRecord && candidate.summary && supportingEvidence.every(item => claimContradictsStatement(candidate.summary, item.claim))) {
    return {
      ok: false,
      reason: 'the cited evidence states the opposite of the proposed summary (a negation), so it cannot establish it',
    };
  }
  // An ending needs evidence of the ending: a claim that says the condition still holds ends nothing.
  if (existing && endsRecord && supportingEvidence.every(item => claimStatesContinuation(existing.summary, item.claim))) {
    return {
      ok: false,
      reason: 'the cited evidence says the condition continues, so it cannot resolve or supersede it',
    };
  }

  // An unconfirmed account cannot end an established condition: ending it needs narrated support.
  // (A record that is itself reported information may be ended by another report.)
  if (existing && endsRecord && supportingEvidence.every(item => item.attributed)
    && !reportedAccountRecord(existing.summary)) {
    return {
      ok: false,
      reason: 'a reported, quoted, attributed, planned or conditional account cannot resolve or supersede an established condition; narrated confirmation is required',
    };
  }

  if (supportingEvidence.every(item => item.attributed)) {
    const epistemicSummary = candidate.summary || existing?.summary || '';
    const plansOnly = supportingEvidence.every(item => !item.reported);
    if (!preservesReportedInformationStatus(epistemicSummary) && !(plansOnly && preservesProspectiveStatus(epistemicSummary))) {
      return {
        ok: false,
        reason: 'quoted dialogue alone, other attributed evidence, or a plan or condition may establish reported information, the speech act or the plan itself, but the mutation summary must preserve reporting/uncertainty, describe the speech act, or keep the plan or condition prospective instead of promoting the underlying claim to fact',
      };
    }
  }

  candidate.evidence = evidence;
  return { ok: true, mutation: candidate };
}
