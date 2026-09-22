import { selectRelevantLocations } from './spatial-relevance.js';
import { estimateInjectionTokens } from './injection.js';
import { SPATIAL_LIMITS } from './constants.js';

export const WORLD_STATE_SPATIAL_HEADER = [
  '[WORLD STATE ALPHA | SPATIAL CONTINUITY]',
  'These notes are private spatial continuity, not automatic player-character knowledge.',
  'Established places, known coordinates, and travel routes:',
].join('\n');

function singleLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeBudget(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return SPATIAL_LIMITS.promptBudgetTokens;
  return Math.max(1, Math.min(2400, Math.trunc(number)));
}

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
  const from = locMap.get(rel.fromId)?.name || 'known anchor';
  const to = locMap.get(rel.toId)?.name || 'target';
  const dir = rel.direction ? ` ${rel.direction} of ` : ' connected to ';
  const dist = Number.isFinite(rel.distanceKm) ? ` (${rel.distanceKm} km)` : '';
  return `- ${to} is${dir}${from}${dist}`;
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
    locMap.set(loc.id, loc);
    const line = fitLine(locationLine(loc), text, budget);
    if (!line) continue;
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
    if (!rel || (!locMap.has(rel.fromId) && !locMap.has(rel.toId))) continue;
    const line = fitLine(relationLine(rel, locMap), text, budget);
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

  const activeProfile = spatialState?.profile || baseMap?.profile || null;
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
