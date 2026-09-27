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
  a: 1,
  an: 1,
  couple: 2,
  few: 3,
  several: 3,
  many: 5,
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
});

function text(value, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function amountValue(value) {
  const raw = String(value || '').trim().toLocaleLowerCase();
  if (/^\d+$/.test(raw)) return Number(raw);
  return WORD_NUMBERS[raw] ?? null;
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
  const amount = Number.isFinite(Number(input.amount)) ? Math.max(0, Number(input.amount)) : null;
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

const AMOUNT_WORD = '(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few|several|many)(?:\\s+of)?';
const UNIT_WORD = '(minutes?|hours?|days?|weeks?|months?|years?|terms?|semesters?|seasons?|cycles?)';
const ELAPSED_PATTERNS = Object.freeze([
  new RegExp(`\\b${AMOUNT_WORD}\\s+${UNIT_WORD}\\s+(?:later|afterwards?|on)\\b`, 'iu'),
  new RegExp(`\\bafter\\s+${AMOUNT_WORD}\\s+${UNIT_WORD}\\b`, 'iu'),
  new RegExp(`\\b${AMOUNT_WORD}\\s+${UNIT_WORD}\\s+(?:have\\s+)?passed\\b`, 'iu'),
]);

export function extractElapsedHint(textValue, defaults = {}) {
  const source = String(textValue ?? '');
  if (!source.trim()) return null;

  for (const pattern of ELAPSED_PATTERNS) {
    const match = source.match(pattern);
    if (!match) continue;
    const amount = amountValue(match[1]);
    const unit = UNIT_ALIASES[String(match[2] || '').toLocaleLowerCase()] || '';
    return hint(match[0], {
      amount,
      unit,
      meaningful: meaningfulAmount(amount, unit),
      ...defaults,
      source: 'detected',
    });
  }

  const named = source.match(/\b(?:next|following)\s+(day|week|month|year|term|semester|season|cycle)\b/iu);
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

  const vague = source.match(/\b(?:several|many)\s+(days?|weeks?|months?|years?|terms?|semesters?|seasons?|cycles?)\s+later\b/iu);
  if (vague) {
    const unit = UNIT_ALIASES[String(vague[1]).toLocaleLowerCase()] || '';
    return hint(vague[0], {
      amount: null,
      unit,
      meaningful: true,
      ...defaults,
      source: 'detected',
    });
  }

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

function sentenceAround(textValue, phrase) {
  const source = String(textValue || '');
  const lower = source.toLocaleLowerCase();
  const needle = String(phrase || '').toLocaleLowerCase();
  const at = lower.indexOf(needle);
  if (at < 0) return source.slice(0, 400).trim();
  const beforeBreak = Math.max(
    source.lastIndexOf('\n', at - 1),
    source.lastIndexOf('.', at - 1),
    source.lastIndexOf('!', at - 1),
    source.lastIndexOf('?', at - 1),
  );
  const starts = beforeBreak < 0 ? 0 : beforeBreak + 1;
  const endCandidates = [
    source.indexOf('\n', at + needle.length),
    source.indexOf('.', at + needle.length),
    source.indexOf('!', at + needle.length),
    source.indexOf('?', at + needle.length),
  ].filter(value => value >= 0);
  const ends = endCandidates.length ? Math.min(...endCandidates) + 1 : Math.min(source.length, at + needle.length + 220);
  return source.slice(Math.max(0, starts), Math.min(source.length, ends)).trim().slice(0, 400);
}

function phraseInsideQuotation(textValue, phrase) {
  const source = String(textValue || '');
  const lower = source.toLocaleLowerCase();
  const at = lower.indexOf(String(phrase || '').toLocaleLowerCase());
  if (at < 0) return false;
  const prefix = source.slice(0, at);
  const straight = (prefix.match(/"/g) || []).length % 2 === 1;
  const curlyOpen = (prefix.match(/“/g) || []).length;
  const curlyClose = (prefix.match(/”/g) || []).length;
  return straight || curlyOpen > curlyClose;
}

function establishedElapsedContext(source, found) {
  if (!found?.raw) return null;
  const context = sentenceAround(source, found.raw);
  if (!context) return null;
  if (phraseInsideQuotation(source, found.raw)) return null;

  const normalized = context.toLocaleLowerCase();
  const raw = String(found.raw || '').toLocaleLowerCase().trim();
  // Bare "next week/month/..." is inherently prospective without stronger
  // chronology evidence. Prefer explicit "N weeks later/after/passed" forms.
  if (/^next\s+(?:day|week|month|year|term|semester|season|cycle)\b/u.test(raw)) return null;
  const prospective = /\b(?:will|would|could|might|should|going\s+to|plan(?:s|ned|ning)?|intend(?:s|ed|ing)?|expect(?:s|ed|ing)?|schedule(?:s|d|ing)?|appointment|proposal|hypothetical(?:ly)?)\b/u;
  const conditional = /\bif\b[^.!?\n]{0,160}\b(?:later|after|next|following|passed)\b/u;
  if (prospective.test(normalized) || conditional.test(normalized)) return null;

  return context;
}

export function detectElapsedHintFromExchange(exchange = []) {
  const rows = Array.isArray(exchange) ? exchange : [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const rawMessage = rows[index];
    if (!Number.isInteger(rawMessage?.messageId) || rawMessage.messageId < 0) continue;
    if (messageRole(rawMessage) === 'system') continue;
    const message = sanitizeExchangeMessage(rawMessage);
    const source = messageText(message);
    const found = extractElapsedHint(source, {
      sourceMessageId: rawMessage.messageId,
      lineageKey: typeof rawMessage.lineageKey === 'string' ? rawMessage.lineageKey : '',
    });
    if (!found) continue;
    const context = establishedElapsedContext(source, found);
    if (!context) continue;
    return { ...found, context };
  }
  return null;
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
  /\bafter\s+(?:a|one)\s+day\b/iu,
  /\b(?:a|one|another)\s+(?:full\s+)?day\s+(?:has\s+|had\s+)?passed\b/iu,
]);

const DAY_STEP_PROSPECTIVE = /(?:\b(?:will|would|could|might|should|shall|going\s+to|plan(?:s|ned|ning)?|intend(?:s|ed|ing)?|expect(?:s|ed|ing)?|schedule(?:s|d|ing)?|tomorrow|proposal|hypothetical(?:ly)?)\b|'ll\b|’ll\b)/u;

// Dialogue is removed before matching, so a spoken plan never counts and a
// quoted first mention cannot hide real narration later in the same message.
const QUOTED_SPANS = Object.freeze([
  /"[^"\n]{0,600}"/gu,
  /“[^”\n]{0,600}”/gu,
  /‘[^’\n]{0,600}’/gu,
  /(^|[\s(\[—–-])'[^'\n]{1,600}?[.,!?;:…—–-]'(?=[\s)\],.;:!?—–-]|$)/gu,
]);

function narrationOnly(source) {
  let out = String(source || '');
  for (const pattern of QUOTED_SPANS) out = out.replace(pattern, (match, lead) => (typeof lead === 'string' ? lead : '') + ' ');
  return out;
}

function narratedDayStep(source) {
  const narration = narrationOnly(source);
  for (const pattern of DAY_STEP_PATTERNS) {
    const match = narration.match(pattern);
    if (!match) continue;
    const context = sentenceAround(narration, match[0]);
    const normalized = context.toLocaleLowerCase();
    if (DAY_STEP_PROSPECTIVE.test(normalized)) continue;
    if (/\bif\b/u.test(normalized)) continue;
    return { phrase: match[0], context };
  }
  return null;
}

function explicitMeaningfulSkip(source) {
  const found = extractElapsedHint(source);
  if (!found?.meaningful) return false;
  return Boolean(establishedElapsedContext(source, found));
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
