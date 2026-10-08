import { sanitizeExchangeMessage } from './narrative-sanitizer.js';

const WORD_NUMBERS = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  a: 1,
  an: 1,
  couple: 2,
  // "A few", "several" and "many" name no amount: it stays unknown.
  few: null,
  several: null,
  many: null,
});

const UNIT_ALIASES = Object.freeze({
  minute: 'minute',
  minutes: 'minute',
  hour: 'hour',
  hours: 'hour',
  day: 'day',
  days: 'day',
  week: 'week',
  weeks: 'week',
  month: 'month',
  months: 'month',
  year: 'year',
  years: 'year',
  term: 'term',
  terms: 'term',
  semester: 'term',
  semesters: 'term',
  season: 'season',
  seasons: 'season',
  cycle: 'cycle',
  cycles: 'cycle',
  fortnight: 'week',
  fortnights: 'week',
  decade: 'year',
  decades: 'year',
});
// Units named through a larger one: a fortnight is two weeks, a decade ten years.
const UNIT_FACTORS = Object.freeze({ fortnight: 2, fortnights: 2, decade: 10, decades: 10 });

function text(value, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function amountValue(value) {
  const raw = String(value || '').trim().toLocaleLowerCase();
  if (/^\d+$/.test(raw)) return Number(raw);
  // "twenty-five", "twenty five"
  const compound = raw.match(/^(\p{L}+)[\s-]+(\p{L}+)$/u);
  if (compound && WORD_NUMBERS[compound[1]] >= 20 && WORD_NUMBERS[compound[2]] > 0 && WORD_NUMBERS[compound[2]] < 10) {
    return WORD_NUMBERS[compound[1]] + WORD_NUMBERS[compound[2]];
  }
  return WORD_NUMBERS[raw] ?? null;
}

// The amount and canonical unit of a matched phrase; an unknown amount stays unknown.
function measure(amountRaw, unitRaw) {
  const unitWord = String(unitRaw || '').toLocaleLowerCase();
  const unit = UNIT_ALIASES[unitWord] || '';
  const factor = UNIT_FACTORS[unitWord] || 1;
  const counted = amountRaw === undefined ? null : amountValue(amountRaw);
  // "A fortnight" is two weeks, "a decade" ten years.
  return { amount: counted === null ? null : counted * factor, unit };
}

function meaningfulAmount(amount, unit) {
  if (['week', 'month', 'year', 'term', 'season', 'cycle'].includes(unit)) return true;
  if (unit === 'day') return amount === null || amount >= 2;
  if (unit === 'hour') return amount !== null && amount >= 48;
  if (unit === 'minute') return amount !== null && amount >= 2880;
  return false;
}

function hint(raw, {
  amount = null,
  unit = '',
  meaningful = false,
  sourceMessageId = null,
  lineageKey = '',
  source = 'detected',
  context = '',
} = {}) {
  const clean = text(raw);
  if (!clean) return null;
  return {
    raw: clean,
    amount: Number.isFinite(amount) ? amount : null,
    unit: text(unit, 40),
    meaningful: meaningful === true,
    sourceMessageId: Number.isInteger(sourceMessageId) && sourceMessageId >= 0 ? sourceMessageId : null,
    lineageKey: text(lineageKey, 80),
    source,
    context: text(context, 400),
  };
}

export function normalizeElapsedHint(input, defaults = {}) {
  if (!input) return null;
  if (typeof input === 'string') {
    return hint(input, { ...defaults, meaningful: defaults.meaningful !== false, source: defaults.source || 'explicit' });
  }
  if (typeof input !== 'object') return null;
  const unit = UNIT_ALIASES[String(input.unit || '').toLocaleLowerCase()] || text(input.unit, 40);
  // Number(null) and Number('') are 0: an unknown amount must stay unknown.
  const rawAmount = input.amount;
  const amount = rawAmount !== null && rawAmount !== undefined && rawAmount !== '' && Number.isFinite(Number(rawAmount))
    ? Math.max(0, Number(rawAmount))
    : null;
  const meaningful = input.meaningful === undefined
    ? (unit ? meaningfulAmount(amount, unit) : true)
    : input.meaningful === true;
  return hint(input.raw || input.text || input.label, {
    amount,
    unit,
    meaningful,
    sourceMessageId: input.sourceMessageId ?? defaults.sourceMessageId,
    lineageKey: input.lineageKey ?? defaults.lineageKey,
    source: input.source || defaults.source || 'explicit',
    context: input.context || defaults.context || '',
  });
}

const TENS = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
const AMOUNT_WORD = `(\\d+|(?:${TENS})(?:[\\s-](?:one|two|three|four|five|six|seven|eight|nine)\\b)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|hundred|couple|few|several|many)(?:\\s+of)?`;
const UNIT_WORD = '(minutes?|hours?|days?|weeks?|months?|years?|terms?|semesters?|seasons?|cycles?|fortnights?|decades?)';
// A plural unit with no amount ("Weeks later", "Months passed") is time passing of unknown amount.
const PLURAL_UNIT_WORD = '(days|weeks|months|years|seasons|fortnights|decades)';
const PASSED = '(?:(?:have|has|had)\\s+)?(?:passed|gone\\s+by|went\\s+by|elapsed)';
// "After three days, ..." opens its sentence or clause (markdown emphasis and an opening quote allowed);
// "kills after three days" or "leaves after two weeks of waiting" is a duration or schedule, not time
// passing in the story. The rule is part of the pattern, so every caller and the day step share it.
const CLAUSE_START = `(?<=(?:^|[.!?;:,\\n—–(]|\\b(?:and|then|but|so))\\s*[*_~"'“”‘’]*\\s*)`;
const AFTER_PATTERN = new RegExp(`${CLAUSE_START}\\bafter\\s+${AMOUNT_WORD}\\s+${UNIT_WORD}\\b`, 'iu');
const ELAPSED_PATTERNS = Object.freeze([
  // "Two days on, ..." ends the phrase (or its line); "a week on foot" is a travel time.
  new RegExp(`\\b${AMOUNT_WORD}\\s+${UNIT_WORD}\\s+(?:later|afterwards?|on(?=[*_~]*\\s*(?:[,.;:!?—–…]|\\n|$)))`, 'iu'),
  AFTER_PATTERN,
  new RegExp(`\\b${AMOUNT_WORD}\\s+${UNIT_WORD}\\s+${PASSED}\\b`, 'iu'),
  // No amount: group 1 is empty and group 2 the unit.
  new RegExp(`${CLAUSE_START}\\b(?:the\\s+)?()${PLURAL_UNIT_WORD}\\s+(?:later|afterwards?|${PASSED})\\b`, 'iu'),
]);

// "The next month" / "the following week" narrate a step; a bare "next week" is usually still ahead.
const NAMED_STEP = /\b(?:the\s+)?(?:next|following)\s+(day|week|month|year|term|semester|season|cycle)\b/iu;

export function extractElapsedHint(textValue, defaults = {}) {
  const source = String(textValue ?? '');
  if (!source.trim()) return null;

  for (const pattern of ELAPSED_PATTERNS) {
    const match = source.match(pattern);
    if (!match) continue;
    const { amount, unit } = measure(match[1] || undefined, match[2]);
    return hint(match[0], {
      amount,
      unit,
      meaningful: meaningfulAmount(amount, unit),
      ...defaults,
      source: 'detected',
    });
  }

  const named = source.match(NAMED_STEP);
  if (named) {
    const unit = UNIT_ALIASES[String(named[1]).toLocaleLowerCase()] || named[1].toLocaleLowerCase();
    return hint(named[0], {
      amount: 1,
      unit,
      meaningful: unit !== 'day',
      ...defaults,
      source: 'detected',
    });
  }

  // ("several/many <unit> later" is the first pattern above.)
  return null;
}

function messageRole(message) {
  if (message?.role === 'user' || message?.is_user === true) return 'user';
  if (message?.role === 'assistant' || (message?.is_user === false && message?.is_system !== true)) return 'assistant';
  return 'system';
}

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (typeof message?.mes === 'string') return message.mes;
  if (typeof message?.text === 'string') return message.text;
  return '';
}

const ELAPSED_CANDIDATES_PER_MESSAGE = 12;

// Every elapsed phrase in the text with its offset, in reading order. Each is
// judged where it stands, with its whole sentence and any quotation around it,
// so rejecting one never strips the context a later one needs.
function elapsedCandidates(source, defaults = {}) {
  const found = [];
  const add = (match, build) => {
    if (found.some(item => match.index < item.end && match.index + match[0].length > item.at)) return;
    const built = build(match);
    if (built) found.push({ at: match.index, end: match.index + match[0].length, hint: built });
  };
  for (const pattern of ELAPSED_PATTERNS) {
    for (const match of source.matchAll(new RegExp(pattern.source, 'giu'))) {
      add(match, item => {
        const { amount, unit } = measure(item[1] || undefined, item[2]);
        return hint(item[0], { amount, unit, meaningful: meaningfulAmount(amount, unit), ...defaults, source: 'detected' });
      });
    }
  }
  for (const match of source.matchAll(new RegExp(NAMED_STEP.source, 'giu'))) {
    add(match, item => {
      const unit = UNIT_ALIASES[String(item[1]).toLocaleLowerCase()] || item[1].toLocaleLowerCase();
      return hint(item[0], { amount: 1, unit, meaningful: unit !== 'day', ...defaults, source: 'detected' });
    });
  }
  return found.sort((a, b) => a.at - b.at).slice(0, ELAPSED_CANDIDATES_PER_MESSAGE);
}

// Single-quoted dialogue: an opening quote after a space or bracket, a closing
// quote after punctuation; apostrophes between letters ("we'll") stay inside.
const SINGLE_QUOTED = /(^|[\s(\[—–-])'(?:[^'\n]|(?<=\p{L})'(?=\p{L}))+?[.,!?;:…—–-]'(?=[\s)\],.;:!?—–-]|$)/gu;
const CURLY_SINGLE_QUOTED = /‘[^’\n]*’/gu;

// Quoted spans of a text, paired line by line with no length limit (a long
// speech never shifts the pairing onto the narration after it). An opening
// double quote left open runs to the end of its line.
function quotedRanges(source) {
  const ranges = [];
  let lineStart = 0;
  for (const line of source.split('\n')) {
    let open = -1;
    let curlyOpen = -1;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (open < 0) open = index;
        else {
          ranges.push([lineStart + open, lineStart + index + 1]);
          open = -1;
        }
      } else if (char === '“' && curlyOpen < 0) {
        curlyOpen = index;
      } else if (char === '”' && curlyOpen >= 0) {
        ranges.push([lineStart + curlyOpen, lineStart + index + 1]);
        curlyOpen = -1;
      }
    }
    if (open >= 0) ranges.push([lineStart + open, lineStart + line.length]);
    if (curlyOpen >= 0) ranges.push([lineStart + curlyOpen, lineStart + line.length]);
    lineStart += line.length + 1;
  }
  for (const match of source.matchAll(SINGLE_QUOTED)) {
    ranges.push([match.index + match[1].length, match.index + match[0].length]);
  }
  for (const match of source.matchAll(CURLY_SINGLE_QUOTED)) ranges.push([match.index, match.index + match[0].length]);
  return ranges;
}

function insideQuotationAt(at, ranges) {
  return ranges.some(([from, to]) => at >= from && at < to);
}

function sentenceAt(source, at, end) {
  const before = Math.max(
    source.lastIndexOf('\n', at - 1),
    source.lastIndexOf('.', at - 1),
    source.lastIndexOf('!', at - 1),
    source.lastIndexOf('?', at - 1),
  );
  const after = ['\n', '.', '!', '?']
    .map(mark => source.indexOf(mark, end))
    .filter(value => value >= 0);
  const stop = after.length ? Math.min(...after) + 1 : Math.min(source.length, end + 220);
  return source.slice(before < 0 ? 0 : before + 1, stop).trim().slice(0, 400);
}

// Any case ("Hypothetically, ...", "Could ..."), except "will", which counts in lower case only.
const ELAPSED_PROSPECTIVE = /(?:\b(?:would|could|might|should|shall|going\s+to|plan(?:s|ned|ning)?|intend(?:s|ed|ing)?|expect(?:s|ed|ing)?|schedule(?:s|d|ing)?|appointment|proposal|hypothetical(?:ly)?)\b|'ll\b|’ll\b)/iu;
const DAY_STEP_PROSPECTIVE = /(?:\b(?:would|could|might|should|shall|going\s+to|plan(?:s|ned|ning)?|intend(?:s|ed|ing)?|expect(?:s|ed|ing)?|schedule(?:s|d|ing)?|tomorrow|proposal|hypothetical(?:ly)?)\b|'ll\b|’ll\b)/iu;
const LOWER_CASE_WILL = /\bwill\b/u;
const CLAUSE_BREAKS = /[,;:—–]|\s(?:and|but|while|then|so)\s/gu;

// The clause of `sentence` holding the phrase at `offset`: a modal or "if" elsewhere in the sentence ("Three
// weeks later, the bridge that would never be rebuilt ...") says nothing about the phrase itself.
// A fronted time phrase ("Two weeks later, we'll be gone") belongs to the clause it introduces.
function clauseAt(sentence, offset, length = 0) {
  let start = 0;
  let end = sentence.length;
  let extend = false;
  for (const match of sentence.matchAll(CLAUSE_BREAKS)) {
    if (match.index + match[0].length <= offset) start = match.index + match[0].length;
    else if (match.index >= offset) {
      if (!extend && !/[\p{L}\p{N}]/u.test(sentence.slice(start, offset).replace(/\b(?:and|then|but|so)\b/giu, ''))
        && !/[\p{L}\p{N}]/u.test(sentence.slice(offset + length, match.index))) {
        extend = true;
        continue;
      }
      end = match.index;
      break;
    }
  }
  return sentence.slice(start, end);
}

// A phrase is not established when its own clause is prospective or conditional, or its sentence opens with
// a condition ("If the rains come, three weeks later ...").
function prospectivePhrase(sentence, offset, length, prospective) {
  const clause = clauseAt(sentence, offset, length);
  if (prospective.test(clause) || LOWER_CASE_WILL.test(clause)) return true;
  if (/(?:^|[^\p{L}])(?:if|unless)\b/iu.test(clause)) return true;
  return /^[^\p{L}]*(?:if|unless|should|suppose|supposing|hypothetically|imagine|imagining|in theory)\b/iu.test(sentence);
}

// The candidate's own sentence, or null when it is quoted, prospective,
// conditional, or a bare "next week" without stronger chronology.
function establishedCandidateContext(source, candidate, ranges) {
  if (insideQuotationAt(candidate.at, ranges)) return null;
  const raw = String(candidate.hint.raw || '').toLocaleLowerCase().trim();
  if (/^next\s+(?:day|week|month|year|term|semester|season|cycle)\b/u.test(raw)) return null;
  const context = sentenceAt(source, candidate.at, candidate.end);
  if (!context) return null;
  const offset = context.toLocaleLowerCase().indexOf(raw);
  if (prospectivePhrase(context, offset < 0 ? 0 : offset, raw.length, ELAPSED_PROSPECTIVE)) return null;
  return context;
}

// The established elapsed hints of one text, in reading order.
function establishedElapsedHints(source, defaults = {}) {
  const textValue = String(source || '');
  if (!textValue.trim()) return [];
  const ranges = quotedRanges(textValue);
  const out = [];
  for (const candidate of elapsedCandidates(textValue, defaults)) {
    const context = establishedCandidateContext(textValue, candidate, ranges);
    if (context) out.push({ ...candidate.hint, context });
  }
  return out;
}

export function detectElapsedHintFromExchange(exchange = []) {
  const rows = Array.isArray(exchange) ? exchange : [];
  let shortSpan = null;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const rawMessage = rows[index];
    if (!Number.isInteger(rawMessage?.messageId) || rawMessage.messageId < 0) continue;
    if (messageRole(rawMessage) === 'system') continue;
    const message = sanitizeExchangeMessage(rawMessage);
    const hints = establishedElapsedHints(messageText(message), {
      sourceMessageId: rawMessage.messageId,
      lineageKey: typeof rawMessage.lineageKey === 'string' ? rawMessage.lineageKey : '',
    });
    // The newest meaningful skip in the exchange decides: a later short span ("An hour later") adds to it
    // rather than cancelling it. With none, the newest short span is reported.
    const meaningful = hints.find(item => item.meaningful);
    if (meaningful) return meaningful;
    if (!shortSpan && hints.length) shortSpan = hints[0];
  }
  return shortSpan;
}

// Accumulated day steps. Day-by-day narration ("The next morning…", "The
// following day…") never states a meaningful span in one place, so each step
// alone stays non-meaningful. When enough narrated day steps pile up since the
// last recorded elapsed catch-up, they are combined into one meaningful hint.
//
// Firing points are a pure function of the current branch's messages: the walk
// starts after the last persisted elapsed-evolution boundary (bounded by a
// short lookback), counts at most one day per user->assistant exchange, treats
// a user message that repeats the day step the narrator just gave as the same
// day, resets after each firing and on any explicit meaningful skip, and fires
// when the running total reaches the threshold. Nothing is stored, so swipes,
// deletes, and branches cannot leave a stale counter behind. A firing point is
// only offered while it is inside the current exchange window, exactly like an
// explicit skip. Time remains permission to evaluate, never evidence of change.
export const ACCUMULATED_ELAPSED_LIMITS = Object.freeze({
  lookbackMessages: 40,
  thresholdDays: 2,
});

const DAY_STEP_PATTERNS = Object.freeze([
  /\bthe\s+(?:next|following)\s+(?:day|morning|dawn|afternoon|evening|night)\b/iu,
  /\bnext\s+morning\b/iu,
  /\bthe\s+(?:morning|day)\s+after\b(?!\s+tomorrow)/iu,
  /\b(?:a|one)\s+day\s+later\b/iu,
  new RegExp(`${CLAUSE_START}\\bafter\\s+(?:a|one)\\s+day\\b`, 'iu'),
  /\b(?:a|one|another)\s+(?:full\s+)?day\s+(?:has\s+|had\s+)?passed\b/iu,
]);

// Dialogue is removed before matching, so a spoken plan never counts and a
// quoted first mention cannot hide real narration later in the same message.
function narrationOnly(source) {
  const text = String(source || '');
  const ranges = quotedRanges(text).sort((a, b) => a[0] - b[0]);
  let out = '';
  let at = 0;
  for (const [from, to] of ranges) {
    if (to <= at) continue;
    out += text.slice(at, Math.max(at, from)) + ' ';
    at = Math.max(at, to);
  }
  return out + text.slice(at);
}

// Every occurrence is judged in its own clause, in reading order: a prospective first mention ("we will set
// out the next morning") does not hide a real step later in the same message.
function narratedDayStep(source) {
  const narration = narrationOnly(source);
  const matches = DAY_STEP_PATTERNS
    .flatMap(pattern => [...narration.matchAll(new RegExp(pattern.source, 'giu'))])
    .sort((a, b) => a.index - b.index);
  for (const match of matches) {
    const context = sentenceAt(narration, match.index, match.index + match[0].length);
    const offset = context.indexOf(match[0]);
    if (prospectivePhrase(context, offset < 0 ? 0 : offset, match[0].length, DAY_STEP_PROSPECTIVE)) continue;
    return { phrase: match[0], context };
  }
  return null;
}

function explicitMeaningfulSkip(source) {
  return establishedElapsedHints(source).some(item => item.meaningful);
}

// Hidden SillyTavern rows carry is_system even when is_user is true.
function walkRole(message) {
  if (message?.is_system === true) return 'system';
  return messageRole(message);
}

export function detectAccumulatedDayStepHint(chat = [], endMessageId, {
  sinceMessageId = -1,
  lineage = null,
  minFiringMessageId = -1,
  lookbackMessages = ACCUMULATED_ELAPSED_LIMITS.lookbackMessages,
  thresholdDays = ACCUMULATED_ELAPSED_LIMITS.thresholdDays,
} = {}) {
  const rows = Array.isArray(chat) ? chat : [];
  if (!Number.isInteger(endMessageId) || endMessageId < 0 || endMessageId >= rows.length) return null;
  const lookback = Math.max(1, Math.min(200, Math.trunc(Number(lookbackMessages)) || ACCUMULATED_ELAPSED_LIMITS.lookbackMessages));
  const threshold = Math.max(2, Math.trunc(Number(thresholdDays)) || ACCUMULATED_ELAPSED_LIMITS.thresholdDays);
  const since = Number.isInteger(sinceMessageId) ? sinceMessageId : -1;
  const start = Math.max(0, since + 1, endMessageId - lookback + 1);

  let steps = [];
  let fired = null;
  let exchangeCounted = false;
  let previousRole = '';
  let previousAssistantHadStep = false;

  for (let messageId = start; messageId <= endMessageId; messageId += 1) {
    const raw = rows[messageId];
    const role = walkRole(raw);
    if (role === 'system') continue;
    if (role === 'user' && previousRole === 'assistant') exchangeCounted = false;
    const followsAssistantStep = role === 'user' && previousRole === 'assistant' && previousAssistantHadStep;
    previousRole = role;

    const source = messageText(sanitizeExchangeMessage({ ...raw, messageId }));
    if (role === 'assistant') previousAssistantHadStep = false;
    if (!source.trim()) continue;

    if (explicitMeaningfulSkip(source)) {
      // The explicit detector owns this skip; restart the count after it.
      steps = [];
      fired = null;
      exchangeCounted = true;
      continue;
    }

    const step = narratedDayStep(source);
    if (!step) continue;
    if (role === 'assistant') previousAssistantHadStep = true;
    if (followsAssistantStep) {
      // The user is acting on the day the narrator just opened, not a new one.
      exchangeCounted = true;
      continue;
    }
    if (exchangeCounted) continue;
    exchangeCounted = true;
    steps.push({ messageId, ...step });
    if (steps.length >= threshold) {
      fired = { messageId, steps };
      steps = [];
    }
  }

  if (!fired || fired.messageId < minFiringMessageId) return null;
  const lineageKey = Array.isArray(lineage) && typeof lineage[fired.messageId]?.lineageKey === 'string'
    ? lineage[fired.messageId].lineageKey
    : '';
  // Automatic elapsed evidence must stay traceable to raw-message lineage.
  if (!lineageKey) return null;
  return hint(`${fired.steps.length} narrated day steps`, {
    amount: fired.steps.length,
    unit: 'day',
    meaningful: true,
    sourceMessageId: fired.messageId,
    lineageKey,
    source: 'accumulated',
    context: fired.steps.map(step => step.context).join(' … '),
  });
}

// Continuity-boundary precedence: an explicit meaningful skip in the current
// exchange wins; otherwise accumulated day steps may supply one; a
// non-meaningful explicit phrase ("an hour later") never blocks accumulation.
export function resolveContinuityElapsedHint({
  exchange = [],
  chat = [],
  messageId = null,
  sinceMessageId = -1,
  lineage = null,
  hasActiveDevelopments = true,
} = {}) {
  const explicit = detectElapsedHintFromExchange(exchange);
  if (explicit?.meaningful) return explicit;
  if (hasActiveDevelopments) {
    const window = (Array.isArray(exchange) ? exchange : [])
      .map(row => row?.messageId)
      .filter(Number.isInteger);
    const accumulated = detectAccumulatedDayStepHint(chat, messageId, {
      sinceMessageId,
      lineage,
      minFiringMessageId: window.length ? Math.min(...window) : messageId,
    });
    if (accumulated) return accumulated;
  }
  return explicit || null;
}
