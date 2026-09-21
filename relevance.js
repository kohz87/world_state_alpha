function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return normalizeText(value).match(/[\p{L}\p{N}]+/gu) || [];
}

function tokenSet(value) {
  return new Set(tokens(value));
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function overlapScore(leftText, rightText) {
  const left = tokenSet(leftText);
  const right = tokenSet(rightText);
  if (!left.size || !right.size) return 0;

  const shared = [];
  for (const token of left) if (right.has(token)) shared.push(token);
  if (!shared.length) return 0;

  if (shared.length === 1) {
    const token = shared[0];
    if (token.length < 7 || left.size > 3) return 0;
    return Math.min(0.7, token.length / 16);
  }

  const denominator = Math.max(2, Math.min(left.size, 8));
  return Math.min(1, shared.length / denominator);
}

function anchorStrength(anchor, normalizedHaystack, haystackTokens) {
  const normalized = normalizeText(anchor);
  if (!normalized) return 0;

  const anchorTokens = normalized.split(' ').filter(Boolean);
  const hasNonAscii = /[^\x00-\x7F]/u.test(normalized);
  const exactPhrase = anchorTokens.length > 1
    ? ` ${normalizedHaystack} `.includes(` ${normalized} `)
    : haystackTokens.has(normalized) || (hasNonAscii && normalized.length >= 2 && normalizedHaystack.includes(normalized));

  if (exactPhrase) {
    const lengthBonus = Math.min(1.5, normalized.length / 24);
    return 1 + lengthBonus;
  }

  if (anchorTokens.length < 2) return 0;
  return anchorTokens.every(token => haystackTokens.has(token)) ? 0.8 : 0;
}

function recordRecency(record, currentMessageId) {
  if (!Number.isInteger(currentMessageId)) return 0;
  const last = Number.isInteger(record?.lastChangedMessage) ? record.lastChangedMessage : null;
  if (last === null || last > currentMessageId) return 0;
  const age = currentMessageId - last;
  if (age <= 4) return 0.8;
  if (age <= 16) return 0.45;
  if (age <= 48) return 0.2;
  return 0;
}

function prepareContext({ recentText = '', loreText = '', currentMessageId = null } = {}) {
  const recentNorm = normalizeText(recentText);
  const loreNorm = normalizeText(loreText);
  return {
    recentNorm,
    loreNorm,
    recentTokens: tokenSet(recentNorm),
    loreTokens: tokenSet(loreNorm),
    currentMessageId,
  };
}

function baseRelevance(record, context) {
  const { recentNorm, loreNorm, recentTokens, loreTokens } = context;

  let score = 0;
  const reasons = [];

  let bestRecentAnchor = 0;
  let bestLoreAnchor = 0;
  for (const anchor of Array.isArray(record.anchors) ? record.anchors : []) {
    bestRecentAnchor = Math.max(bestRecentAnchor, anchorStrength(anchor, recentNorm, recentTokens));
    bestLoreAnchor = Math.max(bestLoreAnchor, anchorStrength(anchor, loreNorm, loreTokens));
  }
  if (bestRecentAnchor > 0) {
    score += 5 * bestRecentAnchor;
    reasons.push('recent-anchor');
  }
  if (bestLoreAnchor > 0) {
    score += 2.25 * bestLoreAnchor;
    reasons.push('lore-anchor');
  }

  const recentSummary = overlapScore(record.summary, recentNorm);
  if (recentSummary > 0) {
    score += 2.5 * recentSummary;
    reasons.push('recent-summary');
  }

  const loreSummary = overlapScore(record.summary, loreNorm);
  if (loreSummary > 0) {
    score += 0.9 * loreSummary;
    reasons.push('lore-summary');
  }

  if (score > 0) {
    const recency = recordRecency(record, context.currentMessageId);
    if (recency > 0) {
      score += recency;
      reasons.push('recent-change');
    }
  }

  return { score, reasons };
}

function activeRecords(state) {
  return (Array.isArray(state?.records) ? state.records : [])
    .filter(record => record && record.status === 'active' && typeof record.summary === 'string' && record.summary.trim());
}

function adjacency(state, activeIds) {
  const map = new Map();
  const add = (a, b) => {
    if (!activeIds.has(a) || !activeIds.has(b) || a === b) return;
    if (!map.has(a)) map.set(a, new Set());
    map.get(a).add(b);
  };

  for (const link of Array.isArray(state?.links) ? state.links : []) {
    add(link?.from, link?.to);
    add(link?.to, link?.from);
  }

  for (const record of activeRecords(state)) {
    for (const id of Array.isArray(record.causedBy) ? record.causedBy : []) {
      add(record.id, id);
      add(id, record.id);
    }
    for (const id of Array.isArray(record.affects) ? record.affects : []) {
      add(record.id, id);
      add(id, record.id);
    }
  }
  return map;
}

function rankedCompare(left, right) {
  if (right.score !== left.score) return right.score - left.score;
  const rightChanged = Number.isInteger(right.record.lastChangedMessage) ? right.record.lastChangedMessage : -1;
  const leftChanged = Number.isInteger(left.record.lastChangedMessage) ? left.record.lastChangedMessage : -1;
  if (rightChanged !== leftChanged) return rightChanged - leftChanged;
  const leftId = String(left.record.id);
  const rightId = String(right.record.id);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

export function normalizeAnchor(value) {
  return normalizeText(value);
}

export function extractContextTerms(value, { maxTerms = 96 } = {}) {
  const out = [];
  const seen = new Set();
  for (const token of tokens(value)) {
    if ((token.length < 2 && !/^\d+$/u.test(token)) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= boundedInt(maxTerms, 96, 1, 256)) break;
  }
  return out;
}

export function scoreRecordRelevance(record, {
  recentText = '',
  loreText = '',
  currentMessageId = null,
} = {}) {
  if (!record || record.status !== 'active') return { score: 0, reasons: [] };
  const result = baseRelevance(record, prepareContext({ recentText, loreText, currentMessageId }));
  return {
    score: Math.round(result.score * 1000) / 1000,
    reasons: result.reasons,
  };
}

export function selectRelevantRecords(state, {
  recentText = '',
  loreText = '',
  currentMessageId = null,
  maxRecords = 6,
  minScore = 0.9,
  maxSeedExpansion = 4,
  maxNeighborsPerSeed = 3,
} = {}) {
  const records = activeRecords(state);
  if (!records.length || (!String(recentText).trim() && !String(loreText).trim())) {
    return {
      selected: [],
      metrics: {
        scannedRecords: records.length,
        seedMatches: 0,
        linkedCandidates: 0,
        selectedRecords: 0,
      },
    };
  }

  const byId = new Map(records.map(record => [record.id, record]));
  const prepared = prepareContext({ recentText, loreText, currentMessageId });
  const scored = [];
  for (const record of records) {
    const result = baseRelevance(record, prepared);
    const score = Math.round(result.score * 1000) / 1000;
    if (score >= minScore) scored.push({ record, score, reasons: result.reasons, source: 'seed' });
  }
  scored.sort(rankedCompare);

  const combined = new Map(scored.map(item => [item.record.id, item]));
  const graph = adjacency(state, new Set(byId.keys()));
  let linkedCandidates = 0;

  const seedLimit = boundedInt(maxSeedExpansion, 4, 0, 16);
  const neighborLimit = boundedInt(maxNeighborsPerSeed, 3, 0, 12);
  for (const seed of scored.slice(0, seedLimit)) {
    const neighbors = [...(graph.get(seed.record.id) || [])].sort().slice(0, neighborLimit);
    for (const id of neighbors) {
      if (combined.has(id)) continue;
      const record = byId.get(id);
      if (!record) continue;
      linkedCandidates += 1;
      const recency = recordRecency(record, currentMessageId);
      const rawLinkedScore = Math.max(0.75, seed.score * 0.24) + recency;
      const linkedScore = Math.min(Math.max(0.001, seed.score - 0.001), rawLinkedScore);
      combined.set(id, {
        record,
        score: Math.round(linkedScore * 1000) / 1000,
        reasons: ['one-hop-link', ...(recency > 0 ? ['recent-change'] : [])],
        source: 'linked',
        linkedFrom: seed.record.id,
      });
    }
  }

  const selected = [...combined.values()]
    .filter(item => item.score >= minScore || item.source === 'linked')
    .sort(rankedCompare)
    .slice(0, boundedInt(maxRecords, 6, 1, 16));

  return {
    selected,
    metrics: {
      scannedRecords: records.length,
      seedMatches: scored.length,
      linkedCandidates,
      selectedRecords: selected.length,
    },
  };
}
