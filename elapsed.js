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

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (typeof message?.mes === 'string') return message.mes;
  if (typeof message?.text === 'string') return message.text;
  return '';
}

export function detectElapsedHintFromExchange(exchange = []) {
  const rows = Array.isArray(exchange) ? exchange : [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const message = rows[index];
    if (!Number.isInteger(message?.messageId) || message.messageId < 0) continue;
    const found = extractElapsedHint(messageText(message), {
      sourceMessageId: message.messageId,
      lineageKey: typeof message.lineageKey === 'string' ? message.lineageKey : '',
    });
    if (found) return found;
  }
  return null;
}
