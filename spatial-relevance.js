import { SPATIAL_LIMITS } from './constants.js';
import { resolveEffectiveLocations, resolveEffectiveRoutes } from './spatial-core.js';

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

function addPosting(map, key, id) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(id);
}

function deletePosting(map, key, id) {
  const posting = map.get(key);
  if (!posting) return;
  posting.delete(id);
  if (!posting.size) map.delete(key);
}

function nonAsciiBigrams(value, max = 64) {
  const compact = normalizeText(value).replace(/\s+/g, '');
  if (!/[^\x00-\x7F]/u.test(compact)) return [];
  const chars = [...compact];
  if (chars.length < 2) return chars.length ? [chars[0]] : [];
  const out = [];
  const seen = new Set();
  for (let index = 0; index < chars.length - 1 && out.length < max; index += 1) {
    const gram = chars[index] + chars[index + 1];
    if (seen.has(gram)) continue;
    seen.add(gram);
    out.push(gram);
  }
  return out;
}

function phraseCandidates(tokenList, maxWords = 4, maxPhrases = 256) {
  const out = [];
  const seen = new Set();
  for (let start = 0; start < tokenList.length && out.length < maxPhrases; start += 1) {
    let phrase = '';
    for (let width = 1; width <= maxWords && start + width <= tokenList.length; width += 1) {
      phrase = width === 1 ? tokenList[start] : phrase + ' ' + tokenList[start + width - 1];
      if (seen.has(phrase)) continue;
      seen.add(phrase);
      out.push(phrase);
      if (out.length >= maxPhrases) break;
    }
  }
  return out;
}

function indexLocationTerms(loc, index) {
  const nameNorm = normalizeText(loc.name);
  if (!nameNorm) return;

  const owned = {
    namePhrases: [],
    nameTokens: [],
    nameBigrams: [],
    contextTokens: [],
    routeTokens: [],
  };

  owned.namePhrases.push(nameNorm);
  addPosting(index.namePhrases, nameNorm, loc.id);

  for (const token of tokens(nameNorm)) {
    owned.nameTokens.push(token);
    addPosting(index.nameTokens, token, loc.id);
  }

  for (const gram of nonAsciiBigrams(nameNorm)) {
    owned.nameBigrams.push(gram);
    addPosting(index.nameBigrams, gram, loc.id);
  }

  if (loc.context) {
    for (const token of tokens(loc.context)) {
      owned.contextTokens.push(token);
      addPosting(index.contextTokens, token, loc.id);
    }
  }

  for (const rt of loc.routeRefs || []) {
    const rtNorm = normalizeText(rt);
    if (!rtNorm) continue;
    owned.routeTokens.push(rtNorm);
    addPosting(index.routeNames, rtNorm, loc.id);
  }

  index.locTerms.set(loc.id, owned);
}

function removeLocationFromTerms(locId, index) {
  const owned = index.locTerms.get(locId);
  if (!owned) return;
  for (const key of owned.namePhrases || []) deletePosting(index.namePhrases, key, locId);
  for (const key of owned.nameTokens || []) deletePosting(index.nameTokens, key, locId);
  for (const key of owned.nameBigrams || []) deletePosting(index.nameBigrams, key, locId);
  for (const key of owned.contextTokens || []) deletePosting(index.contextTokens, key, locId);
  for (const key of owned.routeTokens || []) deletePosting(index.routeNames, key, locId);
  index.locTerms.delete(locId);
}

export function buildSpatialRelevanceIndex(spatialState, baseMap = null) {
  const locations = resolveEffectiveLocations(spatialState, baseMap);
  const routes = resolveEffectiveRoutes(spatialState, baseMap);

  const index = {
    byId: new Map(),
    namePhrases: new Map(),
    nameTokens: new Map(),
    nameBigrams: new Map(),
    contextTokens: new Map(),
    routeNames: new Map(),
    locTerms: new Map(),
    routesByName: new Map(),
    routesById: new Map(),
    routeNameById: new Map(),
    relationsByLoc: new Map(),
    relationsById: new Map(),
    corpusCount: locations.length,
  };

  for (const loc of locations) {
    if (loc.status !== 'active') continue;
    index.byId.set(loc.id, loc);
    indexLocationTerms(loc, index);
  }

  for (const rt of routes) {
    const nameNorm = normalizeText(rt.name);
    index.routesById.set(rt.id, rt);
    index.routeNameById.set(rt.id, nameNorm);
    if (nameNorm) index.routesByName.set(nameNorm, rt);
  }

  for (const rel of spatialState?.relations || []) {
    index.relationsById.set(rel.id, rel);
    if (!index.relationsByLoc.has(rel.fromId)) index.relationsByLoc.set(rel.fromId, []);
    if (!index.relationsByLoc.has(rel.toId)) index.relationsByLoc.set(rel.toId, []);
    index.relationsByLoc.get(rel.fromId).push(rel);
    index.relationsByLoc.get(rel.toId).push(rel);
  }

  return index;
}

export function updateSpatialRelevanceIndex(index, delta = {}) {
  if (!index || typeof index !== 'object') return index;
  const upserted = Array.isArray(delta.upsertedLocations) ? delta.upsertedLocations : [];
  const removedIds = Array.isArray(delta.removedLocationIds) ? delta.removedLocationIds : [];
  const upsertedRelations = Array.isArray(delta.upsertedRelations) ? delta.upsertedRelations : [];
  const removedRelationIds = Array.isArray(delta.removedRelationIds) ? delta.removedRelationIds : [];
  const upsertedRoutes = Array.isArray(delta.upsertedRoutes) ? delta.upsertedRoutes : [];
  const removedRouteIds = Array.isArray(delta.removedRouteIds) ? delta.removedRouteIds : [];

  for (const id of removedIds) {
    index.byId.delete(id);
    removeLocationFromTerms(id, index);
  }

  for (const loc of upserted) {
    if (!loc || !loc.id) continue;
    index.byId.delete(loc.id);
    removeLocationFromTerms(loc.id, index);

    if (loc.status === 'active') {
      index.byId.set(loc.id, loc);
      indexLocationTerms(loc, index);
    }
  }

  const removeRelation = id => {
    const prior = index.relationsById?.get(id);
    if (!prior) return;
    for (const endpoint of [prior.fromId, prior.toId]) {
      const rows = index.relationsByLoc.get(endpoint) || [];
      const next = rows.filter(rel => rel.id !== id);
      if (next.length) index.relationsByLoc.set(endpoint, next);
      else index.relationsByLoc.delete(endpoint);
    }
    index.relationsById.delete(id);
  };

  for (const id of removedRelationIds) removeRelation(id);
  for (const rel of upsertedRelations) {
    if (!rel?.id) continue;
    removeRelation(rel.id);
    index.relationsById.set(rel.id, rel);
    for (const endpoint of [rel.fromId, rel.toId]) {
      if (!index.relationsByLoc.has(endpoint)) index.relationsByLoc.set(endpoint, []);
      index.relationsByLoc.get(endpoint).push(rel);
    }
  }

  const removeRoute = id => {
    const priorName = index.routeNameById?.get(id);
    if (priorName && index.routesByName.get(priorName)?.id === id) index.routesByName.delete(priorName);
    index.routeNameById?.delete(id);
    index.routesById?.delete(id);
  };

  for (const id of removedRouteIds) removeRoute(id);
  for (const route of upsertedRoutes) {
    if (!route?.id) continue;
    removeRoute(route.id);
    const nameNorm = normalizeText(route.name);
    index.routesById.set(route.id, route);
    index.routeNameById.set(route.id, nameNorm);
    if (nameNorm) index.routesByName.set(nameNorm, route);
  }

  index.corpusCount = index.byId.size;
  return index;
}

function nameMatchStrength(name, normalizedHaystack, haystackTokens) {
  const norm = normalizeText(name);
  if (!norm) return 0;

  const nameTokens = norm.split(' ').filter(Boolean);
  const hasNonAscii = /[^\x00-\x7F]/u.test(norm);

  const exactPhrase = nameTokens.length > 1
    ? ` ${normalizedHaystack} `.includes(` ${norm} `)
    : haystackTokens.has(norm) || (hasNonAscii && norm.length >= 2 && normalizedHaystack.includes(norm));

  if (exactPhrase) {
    return 10 + Math.min(2, norm.length / 10);
  }

  if (nameTokens.length > 1 && nameTokens.every(t => haystackTokens.has(t))) {
    return 6;
  }

  return 0;
}

export function selectRelevantLocations(spatialState, {
  baseMap = null,
  index = null,
  recentText = '',
  loreText = '',
  maxLocations = SPATIAL_LIMITS.maxSelectedLocations,
  candidateCap = SPATIAL_LIMITS.candidateCap,
} = {}) {
  const isIndexed = Boolean(index && typeof index === 'object' && index.byId);
  const spatialIndex = isIndexed ? index : buildSpatialRelevanceIndex(spatialState, baseMap);
  const totalCorpus = spatialIndex.corpusCount;

  const recentNorm = normalizeText(recentText);
  const loreNorm = normalizeText(loreText);
  const recentTokenList = tokens(recentNorm).slice(0, 96);
  const loreTokenList = tokens(loreNorm).slice(0, 64);
  const recentTokens = new Set(recentTokenList);
  const loreTokens = new Set(loreTokenList);

  if (!recentNorm && !loreNorm) {
    return {
      selected: [],
      routes: [],
      relations: [],
      metrics: {
        corpusLocations: totalCorpus,
        candidateLocations: 0,
        scoredLocations: 0,
        selectedLocations: 0,
        indexUsed: isIndexed,
      },
    };
  }

  const cap = boundedInt(candidateCap, SPATIAL_LIMITS.candidateCap, 1, 512);
  const visitBudget = cap * 8;
  let postingVisits = 0;
  const candidateScores = new Map();

  const addScore = (id, score) => {
    if (!spatialIndex.byId.has(id)) return;
    if (!candidateScores.has(id) && candidateScores.size >= cap * 2) return;
    candidateScores.set(id, (candidateScores.get(id) || 0) + score);
  };

  const visitPosting = (posting, score) => {
    if (!posting || postingVisits >= visitBudget) return;
    for (const id of posting) {
      if (postingVisits >= visitBudget) break;
      postingVisits += 1;
      addScore(id, score);
    }
  };

  // 1. Phrase candidates from recent text
  for (const phrase of phraseCandidates(recentTokenList)) {
    visitPosting(spatialIndex.namePhrases.get(phrase), 100);
    visitPosting(spatialIndex.routeNames.get(phrase), 60);
  }

  // 2. Phrase candidates from lore text
  for (const phrase of phraseCandidates(loreTokenList, 4, 128)) {
    visitPosting(spatialIndex.namePhrases.get(phrase), 40);
    visitPosting(spatialIndex.routeNames.get(phrase), 20);
  }

  // 3. Name bigrams and tokens
  for (const gram of nonAsciiBigrams(recentNorm, 64)) {
    visitPosting(spatialIndex.nameBigrams.get(gram), 50);
  }
  for (const token of recentTokens) {
    visitPosting(spatialIndex.nameTokens.get(token), 30);
    visitPosting(spatialIndex.contextTokens.get(token), 12);
  }
  for (const token of loreTokens) {
    visitPosting(spatialIndex.nameTokens.get(token), 15);
    visitPosting(spatialIndex.contextTokens.get(token), 6);
  }

  // Score candidate records
  const candidates = [];
  for (const [id, seedScore] of candidateScores.entries()) {
    const loc = spatialIndex.byId.get(id);
    if (!loc) continue;

    let score = seedScore;
    const recentMatch = nameMatchStrength(loc.name, recentNorm, recentTokens);
    const loreMatch = nameMatchStrength(loc.name, loreNorm, loreTokens);

    if (recentMatch > 0) score += recentMatch * 10;
    if (loreMatch > 0) score += loreMatch * 4;

    candidates.push({ location: loc, score, source: 'seed' });
  }

  candidates.sort((a, b) => b.score - a.score);

  // Link expansion: 1-2 related locations/routes
  const selectedMap = new Map();
  const maxLocs = boundedInt(maxLocations, SPATIAL_LIMITS.maxSelectedLocations, 1, 16);

  for (const item of candidates.slice(0, maxLocs)) {
    selectedMap.set(item.location.id, item);
  }

  // Add 1-2 direct relations/routes connected to the top seed location
  const topSeed = candidates[0]?.location;
  const connectedRelations = [];
  const connectedRoutes = [];

  if (topSeed) {
    const rels = spatialIndex.relationsByLoc.get(topSeed.id) || [];
    for (const rel of rels.slice(0, 3)) {
      connectedRelations.push(rel);
      const otherId = rel.fromId === topSeed.id ? rel.toId : rel.fromId;
      if (!selectedMap.has(otherId) && selectedMap.size < maxLocs) {
        const otherLoc = spatialIndex.byId.get(otherId);
        if (otherLoc) {
          selectedMap.set(otherId, { location: otherLoc, score: 5, source: 'relation' });
        }
      }
    }

    for (const rtName of topSeed.routeRefs || []) {
      const rtNorm = normalizeText(rtName);
      const routeObj = spatialIndex.routesByName.get(rtNorm);
      if (routeObj && !connectedRoutes.some(r => r.name === routeObj.name)) {
        connectedRoutes.push(routeObj);
      }
    }
  }

  const finalSelected = [...selectedMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLocs);

  return {
    selected: finalSelected,
    routes: connectedRoutes,
    relations: connectedRelations,
    metrics: {
      corpusLocations: totalCorpus,
      candidateLocations: candidates.length,
      scoredLocations: candidates.length,
      selectedLocations: finalSelected.length,
      indexUsed: isIndexed,
      postingVisits,
    },
  };
}
