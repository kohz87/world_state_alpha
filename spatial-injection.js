import { selectRelevantLocations } from './spatial-relevance.js';
import { singleLine, tokenBudget } from './common.js';
import { estimateInjectionTokens, fitLine } from './injection.js';
import { SPATIAL_LIMITS } from './constants.js';
import { resolveSpatialProfile } from './spatial-core.js';

export const WORLD_STATE_SPATIAL_HEADER = [
  '[WORLD STATE ALPHA | SPATIAL CONTINUITY]',
  'These notes are private spatial continuity, not automatic player-character knowledge.',
  'Established places, known coordinates, and travel routes:',
].join('\n');

const normalizeBudget = value => tokenBudget(value, SPATIAL_LIMITS.promptBudgetTokens);

function locationLine(loc) {
  const name = singleLine(loc.name);
  if (!name) return '';
  const type = singleLine(loc.type) || 'place';
  const hasCoord = Number.isFinite(loc.coordinate?.x) && Number.isFinite(loc.coordinate?.y);
  const coordStr = hasCoord ? ` [coord: ${loc.coordinate.x}, ${loc.coordinate.y}]` : '';
  const routes = (Array.isArray(loc.routeRefs) ? loc.routeRefs : []).slice(0, 3);
  const routeStr = routes.length ? ` (on route: ${routes.join(', ')})` : '';
  const context = singleLine(loc.context);
  const contextStr = context ? ` - ${context}` : '';

  return `- ${name} (${type})${coordStr}${routeStr}${contextStr}`;
}

function relationLine(rel, locMap) {
  // Both ends must be places shown in this injection; a placeholder name would read as a real place.
  const from = singleLine(locMap.get(rel.fromId)?.name);
  const to = singleLine(locMap.get(rel.toId)?.name);
  if (!from || !to) return '';
  const dir = rel.direction ? ` ${rel.direction} of ` : ' connected to ';
  const mode = rel.distanceMode === 'route' ? ' by route' : rel.distanceMode === 'straight_line' ? ' straight-line' : '';
  const dist = Number.isFinite(rel.distanceKm) ? ` (${rel.distanceKm} km${mode})` : '';
  return `- ${to} is${dir}${from}${dist}`;
}

function routeLine(route, locMap) {
  const name = singleLine(route?.name);
  if (!name) return '';
  const type = singleLine(route.type) || 'route';
  // Endpoints are named only when they are places shown in this injection.
  const ends = (Array.isArray(route.endpoints) ? route.endpoints : [])
    .map(id => singleLine(locMap.get(id)?.name))
    .filter(Boolean);
  const between = ends.length >= 2 ? ` between ${ends.join(' and ')}` : ends.length ? ` from ${ends[0]}` : '';
  const context = singleLine(route.context);
  return `- Route: ${name} (${type})${between}${context ? ` - ${context}` : ''}`;
}

export function renderSpatialInjection(selectedLocations = [], relations = [], routes = [], {
  budgetTokens = SPATIAL_LIMITS.promptBudgetTokens,
  trueNorthLocked = false,
} = {}) {
  const budget = normalizeBudget(budgetTokens);
  const entries = Array.isArray(selectedLocations) ? selectedLocations : [];
  if (!entries.length) return { text: '', included: [], estimatedTokens: 0, budgetTokens: budget };

  let header = WORLD_STATE_SPATIAL_HEADER;
  if (trueNorthLocked) {
    header += '\nTrue North is locked: coordinate deltas govern narrative direction; route curvature does not change cardinal direction.';
  }

  if (estimateInjectionTokens(header) > budget) {
    return { text: '', included: [], estimatedTokens: 0, budgetTokens: budget };
  }

  let text = header;
  const included = [];
  const locMap = new Map();

  for (const entry of entries) {
    const loc = entry?.location || entry;
    if (!loc || loc.status === 'archived') continue;
    const line = fitLine(locationLine(loc), text, budget);
    if (!line) continue;
    // Only places whose line actually made it in may be named by a relation line.
    locMap.set(loc.id, loc);
    text += `\n${line}`;
    included.push({
      locationId: loc.id,
      name: loc.name,
      score: Number(entry?.score) || 0,
      source: entry?.source || 'seed',
    });
  }

  if (!included.length) {
    return { text: '', included: [], estimatedTokens: 0, budgetTokens: budget };
  }

  // Add relations if space permits
  for (const rel of Array.isArray(relations) ? relations : []) {
    // relationLine itself requires both ends to be shown places.
    if (!rel) continue;
    const line = fitLine(relationLine(rel, locMap), text, budget);
    if (line) text += `\n${line}`;
  }

  // Routes of the selected places, if space permits.
  for (const route of Array.isArray(routes) ? routes : []) {
    const line = fitLine(routeLine(route, locMap), text, budget);
    if (line) text += `\n${line}`;
  }

  const estimatedTokens = estimateInjectionTokens(text);
  if (estimatedTokens > budget) throw new Error('Spatial injection exceeded its local token budget');

  return { text, included, estimatedTokens, budgetTokens: budget };
}

export function buildSpatialInjection(spatialState, {
  baseMap = null,
  index = null,
  recentText = '',
  loreText = '',
  budgetTokens = SPATIAL_LIMITS.promptBudgetTokens,
  maxLocations = SPATIAL_LIMITS.maxSelectedLocations,
  candidateCap = SPATIAL_LIMITS.candidateCap,
} = {}) {
  const retrieval = selectRelevantLocations(spatialState, {
    baseMap,
    index,
    recentText,
    loreText,
    maxLocations,
    candidateCap,
  });

  const activeProfile = resolveSpatialProfile(spatialState, baseMap);
  const trueNorthLocked = activeProfile?.trueNorthLocked === true;

  const rendered = renderSpatialInjection(
    retrieval.selected,
    retrieval.relations,
    retrieval.routes,
    { budgetTokens, trueNorthLocked },
  );

  return {
    ...rendered,
    selected: retrieval.selected,
    retrievalMetrics: retrieval.metrics,
  };
}
