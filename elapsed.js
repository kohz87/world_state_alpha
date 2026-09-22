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

export function extractElapsedHint(textValue, defaults = {}) {
  const source = String(textValue ?? '');
  if (!source.trim()) return null;

  const amountWord = '(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few|several|many)(?:\\s+of)?';
  const unitWord = '(minutes?|hours?|days?|weeks?|months?|years?|terms?|semesters?|seasons?|cycles?)';
  const patterns = [
    new RegExp(`\\b${amountWord}\\s+${unitWord}\\s+(?:later|afterwards?|on)\\b`, 'iu'),
    new RegExp(`\\bafter\\s+${amountWord}\\s+${unitWord}\\b`, 'iu'),
    new RegExp(`\\b${amountWord}\\s+${unitWord}\\s+(?:have\\s+)?passed\\b`, 'iu'),
  ];

  for (const pattern of patterns) {
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
