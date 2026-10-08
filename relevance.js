import { canonicalText as normalizeText } from './hash.js';

function tokens(value) {
  return normalizeText(value).match(/[\p{L}\p{N}]+/gu) || [];
}

// Function words carry no topical signal: shared 'a'/'the'/'in' must never make an unrelated record or
// place look relevant. English only by necessity; content words in any script still match.
export const RELEVANCE_STOPWORDS = Object.freeze(new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'from',
  'with', 'into', 'onto', 'over', 'under', 'up', 'down', 'out', 'off', 'about', 'as', 'than', 'then', 'that',
  'this', 'these', 'those', 'there', 'here', 'it', 'its', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'am', 'do', 'does', 'did', 'has', 'have', 'had', 'will', 'would', 'can', 'could', 'should', 'may', 'might',
  'must', 'shall', 'not', 'no', 'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his', 'she',
  'her', 'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'any',
  'some', 'each', 'if', 'while', 'still', 'now', 'just', 'very', 'too', 'also',
]));

function tokenSet(value) {
  return new Set(tokens(value));
}

// A function word used as a name ("Will", "May"): capitalized, and either inside a sentence ("ask Will") or
// opening one (or a quotation) followed by a word that is not itself a function word, in a sentence that is
// not a question ("Will nods."). The modal "will", "Will you ...?" and "May the gods ..." are not the name.
const NAME_SPACE = /[\s*_~(\[—–-]/u;
const NAME_QUOTE = /["'“”‘’«»「『]/u;
export function functionWordNames(value) {
  const source = String(value ?? '');
  const out = new Set();
  for (const match of source.matchAll(/(?<![\p{L}\p{N}])\p{Lu}\p{Ll}*(?![\p{L}\p{N}])/gu)) {
    const word = match[0].toLocaleLowerCase();
    if (!RELEVANCE_STOPWORDS.has(word) || out.has(word)) continue;
    let at = match.index - 1;
    while (at >= 0 && source[at] !== '\n' && NAME_SPACE.test(source[at])) at -= 1;
    const opens = at < 0 || source[at] === '\n' || NAME_QUOTE.test(source[at]) || /[.!?…:;]/u.test(source[at]);
    if (!opens) {
      out.add(word);
      continue;
    }
    const end = match.index + match[0].length;
    // A modal is never followed straight by a comma or "!": "Will, the ferryman, waves", "Will!".
    if (/^[,!]/u.test(source.slice(end, end + 1))) {
      out.add(word);
      continue;
    }
    const next = /^\s*([\p{L}\p{N}]+)/u.exec(source.slice(end, end + 40))?.[1]?.toLocaleLowerCase() || '';
    const sentenceEnd = /[.!?…\n]/u.exec(source.slice(end));
    const question = sentenceEnd?.[0] === '?';
    if (next && !RELEVANCE_STOPWORDS.has(next) && !question) out.add(word);
  }
  return out;
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

// The right side is the context's token set, tokenised once per context rather than once per record.
function overlapScore(leftText, right) {
  const left = tokenSet(leftText);
  if (!left.size || !right.size) return 0;

  // Function words never count as shared evidence, but the summary's full size still calibrates the
  // single-token gate and the denominator exactly as before.
  const shared = [];
  for (const token of left) if (right.has(token) && !RELEVANCE_STOPWORDS.has(token)) shared.push(token);
  if (!shared.length) return 0;

  if (shared.length === 1) {
    const token = shared[0];
    if (token.length < 7 || left.size > 3) return 0;
    return Math.min(0.7, token.length / 16);
  }

  const denominator = Math.max(2, Math.min(left.size, 8));
  return Math.min(1, shared.length / denominator);
}

function anchorStrength(anchor, normalizedHaystack, haystackTokens, haystackNames) {
  const normalized = normalizeText(anchor);
  if (!normalized) return 0;

  const anchorTokens = normalized.split(' ').filter(Boolean);
  const hasNonAscii = /[^\x00-\x7F]/u.test(normalized);
  const exactPhrase = anchorTokens.length > 1
    ? ` ${normalizedHaystack} `.includes(` ${normalized} `)
    : RELEVANCE_STOPWORDS.has(normalized)
      ? haystackNames.has(normalized)
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

const RELEVANCE_RECENT_PHRASE_TOKENS = 160;
const RELEVANCE_LOOKUP_TOKENS = 192;

function lookupTokens(list, { newestFirst = false, keepStopwords = false } = {}) {
  const out = [];
  const seen = new Set();
  const ordered = newestFirst ? [...list].reverse() : list;
  for (const token of ordered) {
    if (seen.has(token) || (!keepStopwords && RELEVANCE_STOPWORDS.has(token))) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= RELEVANCE_LOOKUP_TOKENS) break;
  }
  return out;
}

function prepareContext({ recentText = '', loreText = '', currentMessageId = null } = {}) {
  const recentNorm = normalizeText(recentText);
  const loreNorm = normalizeText(loreText);
  const recentAll = tokens(recentNorm);
  const loreAll = tokens(loreNorm);
  // The recent window is joined oldest-first, so the bounded phrase scan takes its newest tokens; scoring
  // still sees every token. Candidate token lookups walk newest-first and skip function words.
  const recentTokenList = recentAll.slice(-RELEVANCE_RECENT_PHRASE_TOKENS);
  const loreTokenList = loreAll.slice(0, 64);
  return {
    recentNorm,
    loreNorm,
    recentTokenList,
    loreTokenList,
    recentTokens: new Set(recentAll),
    loreTokens: new Set(loreAll),
    recentNames: functionWordNames(recentText),
    loreNames: functionWordNames(loreText),
    recentLookupTokens: lookupTokens(recentAll, { newestFirst: true }),
    loreLookupTokens: lookupTokens(loreAll.slice(0, 64)),
    // An anchor may itself be a function word used as a name ('Will', 'May'); anchor lookups keep them.
    recentAnchorTokens: lookupTokens(recentAll, { newestFirst: true, keepStopwords: true }),
    loreAnchorTokens: lookupTokens(loreAll.slice(0, 64), { keepStopwords: true }),
    currentMessageId,
  };
}

function baseRelevance(record, context) {
  const { recentNorm, loreNorm, recentTokens, loreTokens, recentNames, loreNames } = context;

  let score = 0;
  const reasons = [];

  let bestRecentAnchor = 0;
  let bestLoreAnchor = 0;
  for (const anchor of Array.isArray(record.anchors) ? record.anchors : []) {
    bestRecentAnchor = Math.max(bestRecentAnchor, anchorStrength(anchor, recentNorm, recentTokens, recentNames));
    bestLoreAnchor = Math.max(bestLoreAnchor, anchorStrength(anchor, loreNorm, loreTokens, loreNames));
  }
  if (bestRecentAnchor > 0) {
    score += 5 * bestRecentAnchor;
    reasons.push('recent-anchor');
  }
  if (bestLoreAnchor > 0) {
    score += 2.25 * bestLoreAnchor;
    reasons.push('lore-anchor');
  }

  const recentSummary = overlapScore(record.summary, recentTokens);
  if (recentSummary > 0) {
    score += 2.5 * recentSummary;
    reasons.push('recent-summary');
  }

  const loreSummary = overlapScore(record.summary, loreTokens);
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

function addPosting(map, key, recordId) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(recordId);
}

function deletePosting(map, key, recordId) {
  const posting = map.get(key);
  if (!posting) return;
  posting.delete(recordId);
  if (!posting.size) map.delete(key);
}

// newestFirst walks from the end, so a bounded query covers the newest mention first.
export function nonAsciiBigrams(value, max = 64, { newestFirst = false } = {}) {
  const compact = normalizeText(value).replace(/\s+/g, '');
  if (!/[^\x00-\x7F]/u.test(compact)) return [];
  const chars = [...compact];
  if (chars.length < 2) return chars.length ? [chars[0]] : [];
  const out = [];
  const seen = new Set();
  for (let step = 0; step < chars.length - 1 && out.length < max; step += 1) {
    const index = newestFirst ? chars.length - 2 - step : step;
    const gram = chars[index] + chars[index + 1];
    // Only pairs with a non-ASCII letter (the CJK case this path exists for): plain-ASCII pairs of an
    // accented Latin text ('de', 'on') are already words, and would spend the whole lookup budget.
    if (seen.has(gram) || !/[^\x00-\x7F]/u.test(gram)) continue;
    seen.add(gram);
    out.push(gram);
  }
  return out;
}

function indexRecordTerms(record, index) {
  const owned = {
    anchorPhrases: [],
    anchorTokens: [],
    anchorBigrams: [],
    summaryTokens: [],
  };
  const seenPhrase = new Set();
  const seenAnchorToken = new Set();
  const seenBigram = new Set();
  const seenSummaryToken = new Set();

  for (const anchor of Array.isArray(record.anchors) ? record.anchors : []) {
    const norm = normalizeText(anchor);
    if (!norm) continue;
    if (!seenPhrase.has(norm)) {
      seenPhrase.add(norm);
      owned.anchorPhrases.push(norm);
      addPosting(index.anchorPhrases, norm, record.id);
    }
    // A multi-word anchor is posted under its content words only ('the shrine 4' under 'shrine' and '4'):
    // a function word in the scene must not hit every record whose anchor contains it. A one-word anchor
    // (or one made only of function words) keeps every token, since a name may be one ('Will', 'May').
    const anchorWords = tokens(norm);
    // (A multi-word anchor scores only when all its words are in the scene, so its content words find it.)
    const contentWords = anchorWords.filter(token => !RELEVANCE_STOPWORDS.has(token));
    for (const token of contentWords.length && anchorWords.length > 1 ? contentWords : anchorWords) {
      if (seenAnchorToken.has(token)) continue;
      seenAnchorToken.add(token);
      owned.anchorTokens.push(token);
      addPosting(index.anchorTokens, token, record.id);
    }
    for (const gram of nonAsciiBigrams(norm)) {
      if (seenBigram.has(gram)) continue;
      seenBigram.add(gram);
      owned.anchorBigrams.push(gram);
      addPosting(index.anchorBigrams, gram, record.id);
    }
  }

  for (const token of tokens(record.summary)) {
    if (seenSummaryToken.has(token)) continue;
    seenSummaryToken.add(token);
    owned.summaryTokens.push(token);
    addPosting(index.summaryTokens, token, record.id);
  }
  index.recordTerms.set(record.id, owned);
}

function removeRecordFromTerms(recordId, index) {
  const owned = index.recordTerms.get(recordId);
  if (!owned) return;
  for (const key of owned.anchorPhrases || []) deletePosting(index.anchorPhrases, key, recordId);
  for (const key of owned.anchorTokens || []) deletePosting(index.anchorTokens, key, recordId);
  for (const key of owned.anchorBigrams || []) deletePosting(index.anchorBigrams, key, recordId);
  for (const key of owned.summaryTokens || []) deletePosting(index.summaryTokens, key, recordId);
  index.recordTerms.delete(recordId);
}

function clearRecordRelations(index, recordId) {
  const previous = index.recordRelations.get(recordId);
  if (!previous) return;
  for (const targetId of previous) {
    const reverse = index.reverseRecordRelations.get(targetId);
    if (!reverse) continue;
    reverse.delete(recordId);
    if (!reverse.size) index.reverseRecordRelations.delete(targetId);
  }
  index.recordRelations.delete(recordId);
}

function setRecordRelations(index, record) {
  clearRecordRelations(index, record.id);
  if (record.status !== 'active') return;
  const related = new Set(
    [...(record.causedBy || []), ...(record.affects || [])]
      .filter(id => id && id !== record.id),
  );
  if (!related.size) return;
  index.recordRelations.set(record.id, related);
  for (const targetId of related) {
    if (!index.reverseRecordRelations.has(targetId)) index.reverseRecordRelations.set(targetId, new Set());
    index.reverseRecordRelations.get(targetId).add(record.id);
  }
}

function addExplicitLink(index, from, to) {
  if (!from || !to || from === to) return;
  if (!index.linkGraph.has(from)) index.linkGraph.set(from, new Set());
  if (!index.linkGraph.has(to)) index.linkGraph.set(to, new Set());
  index.linkGraph.get(from).add(to);
  index.linkGraph.get(to).add(from);
}

function indexedNeighbors(index, recordId) {
  const out = new Set();
  for (const map of [index.linkGraph, index.recordRelations, index.reverseRecordRelations]) {
    for (const id of map.get(recordId) || []) out.add(id);
  }
  out.delete(recordId);
  return out;
}

function createTombstoneIndex() {
  return {
    byId: new Map(),
    anchorPhrases: new Map(),
    anchorTokens: new Map(),
    anchorBigrams: new Map(),
    summaryTokens: new Map(),
    recordTerms: new Map(),
  };
}

function ensureTombstoneIndex(index) {
  if (!index.tombstones || typeof index.tombstones !== 'object' || !index.tombstones.byId) {
    index.tombstones = createTombstoneIndex();
  }
  return index.tombstones;
}

export function latestElapsedEvolutionBoundary(state) {
  let latest = -1;
  for (const evidence of Object.values(state?.evidence || {})) {
    if (evidence?.sourceClass !== 'elapsed_hint') continue;
    if (!Number.isInteger(evidence.sourceMessageId)) continue;
    latest = Math.max(latest, evidence.sourceMessageId);
  }
  return latest;
}

export function buildRelevanceIndex(state) {
  const records = activeRecords(state);
  const index = {
    byId: new Map(),
    anchorPhrases: new Map(),
    anchorTokens: new Map(),
    anchorBigrams: new Map(),
    summaryTokens: new Map(),
    recordTerms: new Map(),
    linkGraph: new Map(),
    recordRelations: new Map(),
    reverseRecordRelations: new Map(),
    backgroundDevelopmentIds: [],
    backgroundDevelopmentSet: new Set(),
    backgroundCursor: 0,
    backgroundElapsedBoundary: latestElapsedEvolutionBoundary(state),
    // Latest persisted elapsed_hint evidence boundary. Computed once during the
    // already-authorized full build, then advanced from reducer deltas so the
    // per-turn accumulated-time walk never scans the evidence map.
    elapsedEvidenceBoundary: latestElapsedEvolutionBoundary(state),
    tombstones: createTombstoneIndex(),
    corpusRecords: Array.isArray(state?.records) ? state.records.length : 0,
    activeCount: records.length,
  };

  for (const record of records) {
    index.byId.set(record.id, record);
    indexRecordTerms(record, index);
    setRecordRelations(index, record);
    if (record.kind === 'development') {
      index.backgroundDevelopmentIds.push(record.id);
      index.backgroundDevelopmentSet.add(record.id);
    }
  }
  for (const record of Array.isArray(state?.records) ? state.records : []) {
    if (!record || !['resolved', 'superseded'].includes(record.status) || !String(record.summary || '').trim()) continue;
    index.tombstones.byId.set(record.id, record);
    indexRecordTerms(record, index.tombstones);
  }
  for (const link of Array.isArray(state?.links) ? state.links : []) {
    addExplicitLink(index, link?.from, link?.to);
  }
  return index;
}

export function updateRelevanceIndex(index, delta = {}) {
  if (!index || typeof index !== 'object') return index;
  const upserted = Array.isArray(delta.upsertedRecords) ? delta.upsertedRecords : [];
  const removedIds = Array.isArray(delta.removedRecordIds) ? delta.removedRecordIds : [];
  const appendedLinks = Array.isArray(delta.appendedLinks) ? delta.appendedLinks : [];

  const backgroundSet = index.backgroundDevelopmentSet instanceof Set
    ? index.backgroundDevelopmentSet
    : (index.backgroundDevelopmentSet = new Set());
  const tombstones = ensureTombstoneIndex(index);
  if (!Array.isArray(index.backgroundDevelopmentIds)) index.backgroundDevelopmentIds = [];
  if (!Number.isInteger(index.backgroundCursor) || index.backgroundCursor < 0) index.backgroundCursor = 0;
  if (!Number.isInteger(index.backgroundElapsedBoundary)) index.backgroundElapsedBoundary = -1;
  if (!Number.isInteger(index.elapsedEvidenceBoundary)) index.elapsedEvidenceBoundary = -1;
  if (Number.isInteger(delta.elapsedEvidenceBoundary)) {
    index.elapsedEvidenceBoundary = Math.max(index.elapsedEvidenceBoundary, delta.elapsedEvidenceBoundary);
  }

  for (const id of removedIds) {
    index.byId.delete(id);
    backgroundSet.delete(id);
    removeRecordFromTerms(id, index);
    clearRecordRelations(index, id);
    tombstones.byId.delete(id);
    removeRecordFromTerms(id, tombstones);
  }

  for (const record of upserted) {
    if (!record || !record.id) continue;
    const wasBackground = backgroundSet.has(record.id);
    index.byId.delete(record.id);
    removeRecordFromTerms(record.id, index);
    clearRecordRelations(index, record.id);
    tombstones.byId.delete(record.id);
    removeRecordFromTerms(record.id, tombstones);

    if (record.status === 'active' && typeof record.summary === 'string' && record.summary.trim()) {
      index.byId.set(record.id, record);
      indexRecordTerms(record, index);
      setRecordRelations(index, record);
      if (record.kind === 'development') {
        if (!wasBackground) index.backgroundDevelopmentIds.push(record.id);
        backgroundSet.add(record.id);
      } else {
        backgroundSet.delete(record.id);
      }
    } else {
      backgroundSet.delete(record.id);
      if (['resolved', 'superseded'].includes(record.status) && typeof record.summary === 'string' && record.summary.trim()) {
        tombstones.byId.set(record.id, record);
        indexRecordTerms(record, tombstones);
      }
    }
  }

  for (const link of appendedLinks) addExplicitLink(index, link?.from, link?.to);

  // Developments that left the pool (resolved, superseded, removed) leave the background scan list too, so
  // they never use a slot of its bounded scan. The cursor keeps its place on the next id still listed.
  if (index.backgroundDevelopmentIds.length > backgroundSet.size) {
    const ids = index.backgroundDevelopmentIds;
    const cursor = ids.length ? index.backgroundCursor % ids.length : 0;
    // Each id once (a delta may retire and re-add the same development), so the list matches the set again.
    const seen = new Set();
    const keep = id => backgroundSet.has(id) && !seen.has(id) && seen.add(id);
    const kept = ids.filter(keep);
    seen.clear();
    index.backgroundCursor = ids.slice(0, cursor).filter(keep).length % Math.max(1, kept.length);
    index.backgroundDevelopmentIds = kept;
  }

  index.activeCount = index.byId.size;
  if (typeof delta.corpusRecords === 'number') index.corpusRecords = delta.corpusRecords;
  return index;
}

function evaluationBoundary(record) {
  if (Number.isInteger(record?.lastEvaluatedMessage)) return record.lastEvaluatedMessage;
  if (Number.isInteger(record?.lastChangedMessage)) return record.lastChangedMessage;
  if (Number.isInteger(record?.createdAtMessage)) return record.createdAtMessage;
  return -1;
}

export function selectBackgroundDevelopments(index, {
  excludeIds = [],
  currentMessageId = null,
  maxRecords = 3,
  scanCap = 32,
} = {}) {
  if (!index?.byId || !Array.isArray(index.backgroundDevelopmentIds)) {
    return { selected: [], metrics: { examined: 0, poolSize: 0, available: 0 } };
  }

  const ids = index.backgroundDevelopmentIds;
  const activeSet = index.backgroundDevelopmentSet instanceof Set
    ? index.backgroundDevelopmentSet
    : new Set();
  const poolSize = activeSet.size;
  if (!ids.length || !poolSize || !Number.isInteger(currentMessageId)) {
    return { selected: [], metrics: { examined: 0, poolSize, available: 0 } };
  }
  if (currentMessageId <= Number(index.backgroundElapsedBoundary ?? -1)) {
    return {
      selected: [],
      metrics: { examined: 0, poolSize, available: 0, selected: 0, boundaryAlreadyProcessed: true },
    };
  }

  const excluded = excludeIds instanceof Set ? excludeIds : new Set(excludeIds || []);
  const limit = Math.max(0, Math.min(6, Number(maxRecords) || 0));
  const budget = Math.max(0, Math.min(ids.length, Number(scanCap) || 0));
  if (!limit || !budget) {
    return { selected: [], metrics: { examined: 0, poolSize, available: 0 } };
  }

  const seen = new Set();
  const candidates = [];
  const start = Math.max(0, Number(index.backgroundCursor) || 0) % ids.length;
  let examined = 0;

  while (examined < budget) {
    const id = ids[(start + examined) % ids.length];
    examined += 1;
    if (!id || seen.has(id) || excluded.has(id) || !activeSet.has(id)) continue;
    seen.add(id);
    const record = index.byId.get(id);
    if (record?.kind !== 'development' || record?.status !== 'active') continue;
    const boundary = evaluationBoundary(record);
    if (boundary >= currentMessageId) continue;
    candidates.push({ record, boundary });
  }

  index.backgroundCursor = (start + examined) % ids.length;
  index.backgroundElapsedBoundary = currentMessageId;
  candidates.sort((left, right) =>
    left.boundary - right.boundary || String(left.record.id).localeCompare(String(right.record.id)));

  const selected = candidates.slice(0, limit).map(({ record }) => ({
    record,
    score: 0,
    source: 'background',
    reasons: ['bounded-background-catch-up'],
  }));

  return {
    selected,
    metrics: {
      examined,
      poolSize,
      available: candidates.length,
      selected: selected.length,
    },
  };
}

// newestFirst walks start positions from the end, so the phrase budget covers the newest text first. The
// chosen phrases come out longest first (newest first among equals); callers then order them rarest first.
// Shared with Places relevance.
export function phraseCandidates(tokenList, maxWords = 6, maxPhrases = 384, { newestFirst = false } = {}) {
  const out = [];
  const seen = new Set();
  const starts = tokenList.map((_, index) => index);
  if (newestFirst) starts.reverse();
  for (const start of starts) {
    if (out.length >= maxPhrases) break;
    let phrase = '';
    for (let width = 1; width <= maxWords && start + width <= tokenList.length; width += 1) {
      phrase = width === 1 ? tokenList[start] : phrase + ' ' + tokenList[start + width - 1];
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      out.push({ phrase, width, order: out.length });
      if (out.length >= maxPhrases) break;
    }
  }
  return out
    .sort((left, right) => right.width - left.width || left.order - right.order)
    .map(item => item.phrase);
}

// Rarest first (by the postings a key will visit; input order among equals): a word or phrase shared by
// hundreds of records cannot use up the visit budget before the one that singles out the record the scene
// is about. Shared with Places relevance.
export function rarestFirst(list, ...postings) {
  return list
    .map((key, order) => ({ key, order, size: postings.reduce((sum, map) => sum + (map.get(key)?.size || 0), 0) }))
    .sort((left, right) => left.size - right.size || left.order - right.order)
    .map(item => item.key);
}

function gatherCandidateRecords(index, context, { candidateCap = 128 } = {}) {
  const cap = boundedInt(candidateCap, 128, 1, 1024);
  const poolCap = Math.max(cap, Math.min(4096, cap * 4));
  const visitBudget = Math.max(64, Math.min(8192, cap * 12));
  const candidateScores = new Map();
  let postingVisits = 0;
  let phraseLookups = 0;

  const addScore = (recordId, score) => {
    if (!index.byId.has(recordId)) return;
    if (!candidateScores.has(recordId) && candidateScores.size >= poolCap) return;
    candidateScores.set(recordId, (candidateScores.get(recordId) || 0) + score);
  };

  const visitPosting = (posting, score) => {
    if (!posting || postingVisits >= visitBudget) return;
    for (const id of posting) {
      if (postingVisits >= visitBudget) break;
      postingVisits += 1;
      addScore(id, score);
    }
  };

  for (const phrase of rarestFirst(phraseCandidates(context.recentTokenList, 6, 384, { newestFirst: true }), index.anchorPhrases)) {
    phraseLookups += 1;
    visitPosting(index.anchorPhrases.get(phrase), 1000 + Math.min(100, phrase.length));
  }
  for (const phrase of rarestFirst(phraseCandidates(context.loreTokenList, 6, 256), index.anchorPhrases)) {
    phraseLookups += 1;
    visitPosting(index.anchorPhrases.get(phrase), 400 + Math.min(100, phrase.length));
  }

  for (const gram of nonAsciiBigrams(context.recentNorm, 128, { newestFirst: true })) {
    visitPosting(index.anchorBigrams.get(gram), 350);
  }
  for (const gram of nonAsciiBigrams(context.loreNorm, 96)) {
    visitPosting(index.anchorBigrams.get(gram), 120);
  }

  for (const token of rarestFirst(context.recentAnchorTokens, index.anchorTokens)) visitPosting(index.anchorTokens.get(token), 300);
  for (const token of rarestFirst(context.loreAnchorTokens, index.anchorTokens)) visitPosting(index.anchorTokens.get(token), 100);

  for (const token of rarestFirst(context.recentLookupTokens, index.summaryTokens)) {
    visitPosting(index.summaryTokens.get(token), token.length >= 4 ? 10 : 2);
  }
  for (const token of context.loreLookupTokens) {
    visitPosting(index.summaryTokens.get(token), token.length >= 4 ? 4 : 1);
  }

  const candidateList = [];
  for (const [id, score] of candidateScores.entries()) {
    const record = index.byId.get(id);
    if (record) candidateList.push({ record, candidateScore: score });
  }
  candidateList.sort((a, b) => {
    if (b.candidateScore !== a.candidateScore) return b.candidateScore - a.candidateScore;
    const bChanged = Number.isInteger(b.record.lastChangedMessage) ? b.record.lastChangedMessage : -1;
    const aChanged = Number.isInteger(a.record.lastChangedMessage) ? a.record.lastChangedMessage : -1;
    if (bChanged !== aChanged) return bChanged - aChanged;
    const aId = String(a.record.id);
    const bId = String(b.record.id);
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  return {
    records: candidateList.slice(0, cap).map(item => item.record),
    postingVisits,
    phraseLookups,
    candidatePoolRecords: candidateScores.size,
    visitBudget,
  };
}

export function selectRelevantTombstones(index, {
  recentText = '',
  loreText = '',
  currentMessageId = null,
  maxRecords = 2,
  minScore = 0.7,
  candidateCap = 32,
} = {}) {
  const tombstones = index?.tombstones;
  if (!tombstones?.byId || (!String(recentText).trim() && !String(loreText).trim())) {
    return { selected: [], metrics: { candidateRecords: 0, selectedRecords: 0, postingVisits: 0 } };
  }

  const prepared = prepareContext({ recentText, loreText, currentMessageId });
  const work = gatherCandidateRecords(tombstones, prepared, {
    candidateCap: boundedInt(candidateCap, 32, 1, 128),
  });
  const selected = [];
  for (const record of work.records) {
    if (!['resolved', 'superseded'].includes(record?.status)) continue;
    const scored = baseRelevance(record, prepared);
    const score = Math.round(scored.score * 1000) / 1000;
    if (score < minScore) continue;
    selected.push({ record, score, reasons: scored.reasons, source: 'tombstone' });
  }
  selected.sort(rankedCompare);

  return {
    selected: selected.slice(0, boundedInt(maxRecords, 2, 1, 4)),
    metrics: {
      candidateRecords: work.records.length,
      selectedRecords: Math.min(selected.length, boundedInt(maxRecords, 2, 1, 4)),
      postingVisits: work.postingVisits,
      phraseLookups: work.phraseLookups,
      candidatePoolRecords: work.candidatePoolRecords,
    },
  };
}

export function selectLifecycleCandidates(state, {
  index = null,
  currentText = '',
  contextText = '',
  currentMessageId = null,
  maxRecords = 2,
  minScore = 0.7,
  candidateCap = 128,
} = {}) {
  const limit = boundedInt(maxRecords, 2, 1, 4);
  const rankedDevelopments = (text, lifecycleSource) => {
    if (!String(text || '').trim()) return [];
    return selectRelevantRecords(state, {
      index,
      recentText: text,
      currentMessageId,
      maxRecords: 16,
      minScore,
      candidateCap,
    }).selected
      .filter(item => item?.record?.kind === 'development' && item.record.status === 'active')
      .map(item => ({ ...item, lifecycleSource }));
  };

  const current = rankedDevelopments(currentText, 'current-exchange');
  const context = String(contextText || '').trim() === String(currentText || '').trim()
    ? []
    : rankedDevelopments(contextText, 'scene-context');

  // Reserve the strongest exact match first, then one distinct wider-context
  // antecedent before filling remaining slots. This prevents several newly
  // mentioned developments from crowding out the older thread that an
  // anaphoric ending ("the last two", "it finally ends") is closing.
  const selected = [];
  const seen = new Set();
  const add = item => {
    const id = item?.record?.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    selected.push(item);
    return true;
  };

  if (current[0]) add(current[0]);
  for (const item of context) {
    if (add(item)) break;
  }
  for (const item of current.slice(1)) add(item);
  for (const item of context) add(item);

  return {
    selected: selected.slice(0, limit),
    metrics: {
      selectedRecords: Math.min(selected.length, limit),
      candidateRecords: selected.length,
      currentExchangeMatches: current.length,
      sceneContextMatches: context.length,
    },
  };
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

export function selectRelevantRecords(state, {
  index = null,
  recentText = '',
  loreText = '',
  currentMessageId = null,
  maxRecords = 6,
  minScore = 0.9,
  maxSeedExpansion = 4,
  maxNeighborsPerSeed = 3,
  candidateCap = 128,
} = {}) {
  const isIndexed = Boolean(index && typeof index === 'object' && index.byId);
  const totalCorpus = isIndexed
    ? (index.corpusRecords ?? (Array.isArray(state?.records) ? state.records.length : index.byId.size))
    : (Array.isArray(state?.records) ? state.records.length : 0);

  if (!String(recentText).trim() && !String(loreText).trim()) {
    return {
      selected: [],
      metrics: {
        corpusRecords: totalCorpus,
        scannedRecords: 0,
        candidateRecords: 0,
        scoredRecords: 0,
        seedMatches: 0,
        linkedCandidates: 0,
        selectedRecords: 0,
        indexUsed: isIndexed,
        candidateCap: isIndexed ? boundedInt(candidateCap, 128, 1, 1024) : null,
        postingVisits: 0,
        phraseLookups: 0,
        candidatePoolRecords: 0,
        postingVisitBudget: isIndexed ? Math.max(64, Math.min(8192, boundedInt(candidateCap, 128, 1, 1024) * 12)) : null,
      },
    };
  }

  const prepared = prepareContext({ recentText, loreText, currentMessageId });
  let candidateRecords;
  let indexWork = null;

  if (isIndexed) {
    indexWork = gatherCandidateRecords(index, prepared, { candidateCap });
    candidateRecords = indexWork.records;
  } else {
    candidateRecords = activeRecords(state);
  }

  if (!candidateRecords.length) {
    return {
      selected: [],
      metrics: {
        corpusRecords: totalCorpus,
        scannedRecords: 0,
        candidateRecords: 0,
        scoredRecords: 0,
        seedMatches: 0,
        linkedCandidates: 0,
        selectedRecords: 0,
        indexUsed: isIndexed,
        candidateCap: isIndexed ? boundedInt(candidateCap, 128, 1, 1024) : null,
        postingVisits: indexWork?.postingVisits || 0,
        phraseLookups: indexWork?.phraseLookups || 0,
        candidatePoolRecords: indexWork?.candidatePoolRecords || 0,
        postingVisitBudget: indexWork?.visitBudget ?? null,
      },
    };
  }

  const byId = isIndexed ? index.byId : new Map(candidateRecords.map(record => [record.id, record]));
  const scored = [];
  for (const record of candidateRecords) {
    const result = baseRelevance(record, prepared);
    const score = Math.round(result.score * 1000) / 1000;
    if (score >= minScore) scored.push({ record, score, reasons: result.reasons, source: 'seed' });
  }
  scored.sort(rankedCompare);

  const combined = new Map(scored.map(item => [item.record.id, item]));
  const graph = isIndexed ? null : adjacency(state, new Set(byId.keys()));
  let linkedCandidates = 0;

  const seedLimit = boundedInt(maxSeedExpansion, 4, 0, 16);
  const neighborLimit = boundedInt(maxNeighborsPerSeed, 3, 0, 12);
  for (const seed of scored.slice(0, seedLimit)) {
    // The cap counts only neighbours that can still be linked: retired or already chosen ones never use it up.
    const neighbors = [...(isIndexed ? indexedNeighbors(index, seed.record.id) : (graph.get(seed.record.id) || []))]
      .filter(id => !combined.has(id) && byId.get(id)?.status === 'active')
      .sort()
      .slice(0, neighborLimit);
    for (const id of neighbors) {
      const record = byId.get(id);
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
      corpusRecords: totalCorpus,
      scannedRecords: candidateRecords.length,
      candidateRecords: candidateRecords.length,
      scoredRecords: candidateRecords.length,
      seedMatches: scored.length,
      linkedCandidates,
      selectedRecords: selected.length,
      indexUsed: isIndexed,
      candidateCap: isIndexed ? boundedInt(candidateCap, 128, 1, 1024) : null,
      postingVisits: indexWork?.postingVisits || 0,
      phraseLookups: indexWork?.phraseLookups || 0,
      candidatePoolRecords: indexWork?.candidatePoolRecords || candidateRecords.length,
      postingVisitBudget: indexWork?.visitBudget ?? null,
    },
  };
}
