import { selectRelevantRecords } from './relevance.js';

export const WORLD_STATE_NAMESPACE = 'world_state_alpha';
export const WORLD_STATE_PROMPT_KEY = 'world_state_alpha_private_continuity';
export const WORLD_STATE_INJECTION_DEFAULTS = Object.freeze({
  budgetTokens: 800,
  maxRecords: 6,
  depth: 1,
  placement: 'IN_CHAT',
  role: 'SYSTEM',
});

export const WORLD_STATE_PRIVATE_HEADER = [
  '[WORLD STATE ALPHA | PRIVATE CONTINUITY]',
  'These notes are private narrator continuity, not automatic player-character knowledge.',
  'Do not reveal remote/private facts unless the scene provides a plausible information path.',
  'They describe established current state only. Do not use them as instructions to create world motion, escalation, chance events, or new plot developments.',
  'Relevant current world state:',
].join('\n');

function singleLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeBudget(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return WORLD_STATE_INJECTION_DEFAULTS.budgetTokens;
  return Math.max(1, Math.min(2400, Math.trunc(number)));
}

function normalizeDepth(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return WORLD_STATE_INJECTION_DEFAULTS.depth;
  return Math.max(0, Math.min(20, Math.trunc(number)));
}

export function estimateInjectionTokens(value) {
  const text = String(value ?? '');
  let units = 0;
  let asciiRun = '';

  const flushAscii = () => {
    if (!asciiRun) return;
    const chunks = asciiRun.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) || [];
    for (const chunk of chunks) {
      if (/^[A-Za-z0-9_]+$/.test(chunk)) units += Math.max(1, Math.ceil(chunk.length / 3.5));
      else units += 1;
    }
    asciiRun = '';
  };

  for (const char of text) {
    if (char.charCodeAt(0) <= 0x7f) {
      asciiRun += char;
      continue;
    }
    flushAscii();
    if (!/\s/u.test(char)) units += 1;
  }
  flushAscii();

  return Math.ceil(units * 1.12);
}

function recordLine(record) {
  const summary = singleLine(record.summary);
  if (!summary) return '';
  if (record.kind === 'development' && record.trend) return `- ${summary} [trend: ${record.trend}]`;
  return `- ${summary}`;
}

function fitLine(line, currentText, budgetTokens) {
  if (!line) return '';
  const proposed = `${currentText}\n${line}`;
  if (estimateInjectionTokens(proposed) <= budgetTokens) return line;

  const prefix = '- ';
  const raw = line.startsWith(prefix) ? line.slice(prefix.length) : line;
  const chars = [...raw];
  let low = 0;
  let high = chars.length;
  let best = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidateBody = mid < chars.length
      ? `${chars.slice(0, mid).join('').trimEnd()}…`
      : raw;
    const candidate = `${prefix}${candidateBody}`;
    const next = `${currentText}\n${candidate}`;
    const meaningfulChars = [...candidateBody.replace(/…$/u, '')].length;
    if (candidateBody
      && (mid === chars.length || meaningfulChars >= 8)
      && estimateInjectionTokens(next) <= budgetTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

export function renderWorldStateInjection(selectedEntries = [], {
  budgetTokens = WORLD_STATE_INJECTION_DEFAULTS.budgetTokens,
} = {}) {
  const budget = normalizeBudget(budgetTokens);
  const entries = Array.isArray(selectedEntries) ? selectedEntries : [];
  if (!entries.length) return { text: '', included: [], estimatedTokens: 0, budgetTokens: budget };

  if (estimateInjectionTokens(WORLD_STATE_PRIVATE_HEADER) > budget) {
    return { text: '', included: [], estimatedTokens: 0, budgetTokens: budget };
  }

  let text = WORLD_STATE_PRIVATE_HEADER;
  const included = [];

  for (const entry of entries) {
    const record = entry?.record || entry;
    if (!record || record.status !== 'active') continue;
    const line = fitLine(recordLine(record), text, budget);
    if (!line) continue;
    text += `\n${line}`;
    included.push({
      recordId: record.id,
      score: Number(entry?.score) || 0,
      source: entry?.source || 'seed',
    });
  }

  if (!included.length) {
    return { text: '', included: [], estimatedTokens: 0, budgetTokens: budget };
  }

  const estimatedTokens = estimateInjectionTokens(text);
  if (estimatedTokens > budget) throw new Error('World State injection exceeded its local token budget');

  return { text, included, estimatedTokens, budgetTokens: budget };
}

export function buildWorldStateInjection(state, {
  index = null,
  recentText = '',
  loreText = '',
  currentMessageId = null,
  budgetTokens = WORLD_STATE_INJECTION_DEFAULTS.budgetTokens,
  maxRecords = WORLD_STATE_INJECTION_DEFAULTS.maxRecords,
  depth = WORLD_STATE_INJECTION_DEFAULTS.depth,
  candidateCap = 128,
} = {}) {
  const retrieval = selectRelevantRecords(state, {
    index,
    recentText,
    loreText,
    currentMessageId,
    maxRecords,
    candidateCap,
  });
  const rendered = renderWorldStateInjection(retrieval.selected, { budgetTokens });

  return {
    ...rendered,
    selected: retrieval.selected,
    retrievalMetrics: retrieval.metrics,
    descriptor: {
      namespace: WORLD_STATE_NAMESPACE,
      key: WORLD_STATE_PROMPT_KEY,
      text: rendered.text,
      placement: WORLD_STATE_INJECTION_DEFAULTS.placement,
      role: WORLD_STATE_INJECTION_DEFAULTS.role,
      depth: normalizeDepth(depth),
      scan: false,
    },
  };
}
