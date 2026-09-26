import { sanitizeCaptureDiagnostic } from './diagnostics.js';
import { inspectWorldStateRecord, queryWorldState } from './manual.js';
import { clone, normalizeState } from './state-core.js';
import { resolveEffectiveLocations, resolveSpatialProfile } from './spatial-core.js';

export const WORLD_STATE_UI_NAMESPACE = 'world_state_alpha_ui';

export const WORLD_STATE_UI_LIMITS = Object.freeze({
  currentRecords: 120,
  recentRecords: 40,
  resolvedRecords: 80,
  searchRecords: 100,
  spatialLocations: 200,
  diagnostics: 80,
  evidence: 32,
  relations: 24,
});

export const WORLD_STATE_UI_TABS = Object.freeze([
  'current',
  'recent',
  'resolved',
  'spatial',
  'search',
  'diagnostics',
  'maintenance',
]);

export const WORLD_STATE_UI_MAINTENANCE_ACTIONS = Object.freeze([
  Object.freeze({ id: 'export', label: 'Export data', tone: 'normal' }),
  Object.freeze({ id: 'import', label: 'Import data', tone: 'normal' }),
  Object.freeze({ id: 'rebuild', label: 'Rebuild from chat', tone: 'caution' }),
  Object.freeze({ id: 'reset', label: 'Clear World State', tone: 'danger' }),
]);

function clean(value, max = 700) {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, max)
    : '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function integer(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function statusLabel(value) {
  if (value === 'resolved') return 'Resolved';
  if (value === 'superseded') return 'Superseded';
  return 'Current';
}

function kindLabel(value) {
  return value === 'development' ? 'Development' : 'Fact';
}

function titleWords(value) {
  return clean(value, 80)
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map(word => word.charAt(0).toLocaleUpperCase() + word.slice(1))
    .join(' ');
}

function reasonLabel(value) {
  const reason = clean(value, 80).toLocaleLowerCase();
  if (!reason) return '';
  if (reason === 'capture') return 'Captured from story';
  if (reason === 'evolution') return 'Updated by grounded catch-up';
  if (reason === 'manual') return 'Manual correction';
  if (reason === 'spatial-manual') return 'Manual spatial edit';
  if (reason === 'rebuild') return 'Rebuilt from chat';
  return titleWords(reason);
}

function sourceLabel(value) {
  switch (value) {
    case 'user_narration': return 'User narration';
    case 'assistant_narration': return 'Assistant narration';
    case 'recent_history': return 'Recent history';
    case 'elapsed_hint': return 'Elapsed-time evidence';
    case 'lore_baseline': return 'Lore baseline';
    case 'manual': return 'Manual correction';
    case 'rebuild': return 'Rebuilt from chat';
    case 'foreign_import': return 'Imported data';
    default: return 'Recorded evidence';
  }
}

function authorityLabel(auth, locked = false) {
  const lockIcon = locked ? ' 🔒' : '';
  switch (auth) {
    case 'base_canonical': return 'Base Canonical' + lockIcon;
    case 'campaign_override': return 'Campaign Override' + lockIcon;
    case 'manual': return 'Manual' + lockIcon;
    case 'narrative_explicit': return 'Narrative Explicit' + lockIcon;
    case 'derived': return 'Derived' + lockIcon;
    case 'relative': return 'Relative' + lockIcon;
    default: return 'Unknown' + lockIcon;
  }
}

function inverseDirection(value) {
  const map = {
    north: 'south',
    northeast: 'southwest',
    east: 'west',
    southeast: 'northwest',
    south: 'north',
    southwest: 'northeast',
    west: 'east',
    northwest: 'southeast',
  };
  return map[clean(value, 30).toLowerCase()] || clean(value, 30).toLowerCase();
}

function recordSort(left, right) {
  const leftChanged = integer(left?.lastChangedMessage) ?? -1;
  const rightChanged = integer(right?.lastChangedMessage) ?? -1;
  if (rightChanged !== leftChanged) return rightChanged - leftChanged;
  const leftCreated = integer(left?.createdAtMessage) ?? -1;
  const rightCreated = integer(right?.createdAtMessage) ?? -1;
  if (rightCreated !== leftCreated) return rightCreated - leftCreated;
  return String(left?.summary || '').localeCompare(String(right?.summary || ''));
}

function latestReasonByMessage(state) {
  const map = new Map();
  for (const entry of Array.isArray(state?.rollbackJournal) ? state.rollbackJournal : []) {
    if (!Number.isInteger(entry?.messageId)) continue;
    const prior = map.get(entry.messageId);
    if (!prior || Number(entry?.seq) >= Number(prior?.seq)) map.set(entry.messageId, entry);
  }
  return map;
}

function projectRecord(record, reasonMap, key = '') {
  const changedMessage = integer(record?.lastChangedMessage);
  const journalReason = changedMessage === null ? null : reasonMap.get(changedMessage);
  return {
    key: clean(key, 120),
    kind: record?.kind === 'development' ? 'development' : 'fact',
    kindLabel: kindLabel(record?.kind),
    summary: clean(record?.summary, 700),
    status: ['resolved', 'superseded'].includes(record?.status) ? record.status : 'active',
    statusLabel: statusLabel(record?.status),
    trend: record?.kind === 'development' ? clean(record?.trend, 40) : '',
    trendLabel: record?.kind === 'development' ? titleWords(record?.trend) : '',
    anchors: (Array.isArray(record?.anchors) ? record.anchors : [])
      .map(anchor => clean(anchor, 120))
      .filter(Boolean)
      .slice(0, 20),
    createdAtMessage: integer(record?.createdAtMessage),
    lastChangedMessage: changedMessage,
    lastEvaluatedMessage: integer(record?.lastEvaluatedMessage),
    timeAnchor: clean(record?.timeAnchor, 160),
    changeReason: reasonLabel(journalReason?.reason),
  };
}

function relationRows(state, record) {
  const normalized = normalizeState(state);
  const byId = new Map(normalized.records.map(item => [item.id, item]));
  const rows = [];
  const seen = new Set();

  function add(id, relation) {
    if (!id || id === record.id || rows.length >= WORLD_STATE_UI_LIMITS.relations) return;
    const signature = relation + ':' + id;
    if (seen.has(signature)) return;
    seen.add(signature);
    const related = byId.get(id);
    rows.push({
      relation,
      summary: clean(related?.summary, 700) || 'Related record is no longer available.',
      statusLabel: related ? statusLabel(related.status) : '',
    });
  }

  for (const id of Array.isArray(record.causedBy) ? record.causedBy : []) add(id, 'Caused by');
  for (const id of Array.isArray(record.affects) ? record.affects : []) add(id, 'Affects');
  for (const link of normalized.links) {
    if (link?.from === record.id) add(link.to, 'Related');
    else if (link?.to === record.id) add(link.from, 'Related');
  }

  return rows;
}

function projectDetail(state, recordId, reasonMap, key) {
  const detail = inspectWorldStateRecord(state, recordId);
  if (!detail?.record) return null;
  const base = projectRecord(detail.record, reasonMap, key);
  const evidence = detail.evidence
    .slice(-WORLD_STATE_UI_LIMITS.evidence)
    .reverse()
    .map(item => ({
      source: sourceLabel(item?.sourceClass),
      sourceMessageId: integer(item?.sourceMessageId),
      claim: clean(item?.claim, 500),
      timeAnchor: clean(item?.timeAnchor, 160),
    }));

  return {
    ...base,
    evidence,
    relations: relationRows(state, detail.record),
  };
}

function projectDiagnostics(rows) {
  return (Array.isArray(rows) ? rows : [])
    .slice(-WORLD_STATE_UI_LIMITS.diagnostics)
    .reverse()
    .map(raw => {
      const item = sanitizeCaptureDiagnostic(raw);
      return {
        operationId: clean(item.operationId, 120),
        at: item.at,
        label: clean(item.label, 48),
        sourceMessageId: item.sourceMessageId,
        outcome: clean(item.outcome, 48) || 'unknown',
        code: clean(item.code, 80),
        detail: clean(item.detail, 320),
        route: clean(item.route, 24),
        profileId: clean(item.profileId, 120),
        providerCalls: item.providerCalls,
        proposed: item.proposed,
        accepted: item.accepted,
        applied: item.applied,
        rejected: item.rejected,
        aliasRepairs: item.aliasRepairs,
        completenessHints: item.completenessHints,
        processedBoundaries: item.processedBoundaries,
        totalBoundaries: item.totalBoundaries,
        candidateRecords: item.candidateRecords,
        promptChars: item.promptChars,
        responseChars: item.responseChars,
        durationMs: item.durationMs,
        responseJson: clean(item.responseJson, 16000),
        rejectionsJson: clean(item.rejectionsJson, 12000),
      };
    });
}

function projectSpatialLocation(loc, key) {
  const coord = loc.coordinate || {};
  const hasCoord = Number.isFinite(coord.x) && Number.isFinite(coord.y);
  return {
    key,
    id: loc.id,
    overrideId: loc.overrideId || null,
    baseRefId: loc.baseRefId || null,
    name: clean(loc.name, 120),
    type: clean(loc.type, 60) || 'place',
    isBase: Boolean(loc.isBase),
    isOverridden: Boolean(loc.isOverridden),
    hasCoord,
    coordText: hasCoord ? `[${coord.x}, ${coord.y}]` : '(no coord)',
    x: Number.isFinite(coord.x) ? coord.x : '',
    y: Number.isFinite(coord.y) ? coord.y : '',
    authority: clean(coord.authority, 30) || 'unknown',
    authorityLabel: authorityLabel(coord.authority, coord.locked),
    locked: Boolean(coord.locked),
    context: clean(loc.context, 600),
    routeRefs: Array.isArray(loc.routeRefs) ? loc.routeRefs.map(r => clean(r, 120)).filter(Boolean) : [],
    notes: clean(loc.notes, 400),
    status: loc.status || 'active',
    lastChangedMessage: integer(loc.lastChangedMessage),
  };
}

function projectSpatialDetail(spatialState, loc, baseMap, key) {
  const base = projectSpatialLocation(loc, key);
  const evidence = (loc.evidenceIds || [])
    .map(evId => spatialState?.evidence?.[evId])
    .filter(Boolean)
    .slice(-WORLD_STATE_UI_LIMITS.evidence)
    .reverse()
    .map(item => ({
      source: sourceLabel(item?.sourceClass),
      sourceMessageId: integer(item?.sourceMessageId),
      claim: clean(item?.claim, 500),
    }));

  const allEffective = resolveEffectiveLocations(spatialState, baseMap);
  const locMap = new Map(allEffective.map(item => [item.id, item]));
  const campaignId = loc.overrideId || loc.id;

  const relations = (spatialState?.relations || [])
    .filter(r => r.fromId === loc.id || r.toId === loc.id
      || r.fromId === campaignId || r.toId === campaignId)
    .slice(0, WORLD_STATE_UI_LIMITS.relations)
    .map(rel => {
      const selectedIsTarget = rel.toId === loc.id || rel.toId === campaignId;
      const otherId = selectedIsTarget ? rel.fromId : rel.toId;
      const other = locMap.get(otherId);
      const selectedDirection = selectedIsTarget ? rel.direction : inverseDirection(rel.direction);
      const distText = Number.isFinite(rel.distanceKm) ? ` (${rel.distanceKm} km)` : '';
      return {
        id: clean(rel.id, 140),
        anchorId: clean(otherId, 120),
        anchorName: clean(other?.name, 120) || 'known place',
        direction: clean(selectedDirection, 30),
        distanceKm: Number.isFinite(rel.distanceKm) ? rel.distanceKm : null,
        distanceMode: clean(rel.distanceMode, 30) || 'unspecified',
        summary: `${selectedDirection || 'connected'} relative to ${other?.name || 'known place'}${distText}`,
        notes: clean(rel.notes, 200),
      };
    });

  const primaryRelation = relations[0] || {
    id: '',
    anchorId: '',
    anchorName: '',
    direction: '',
    distanceKm: null,
    distanceMode: 'unspecified',
    summary: '',
    notes: '',
  };

  return {
    ...base,
    evidence,
    relations,
    primaryRelation,
    locationOptions: allEffective
      .filter(item => item.id !== loc.id && item.status !== 'archived')
      .slice(0, WORLD_STATE_UI_LIMITS.spatialLocations)
      .map(item => ({ id: clean(item.id, 120), name: clean(item.name, 120) })),
  };
}

// Display-only place grouping. Nothing here is persisted or fed back into
// Spatial state: a place whose name extends another visible place's name at a
// word boundary ("High Ghyll Sheep Station" / "High Ghyll") is listed beneath it.
const PLACE_DUPLICATE_POOL = 400;
const PLACE_NAME_STOPWORDS = new Set(['the', 'and', 'of', 'at', 'in', 'on', 'to', 'by', 'near']);
const PLACE_MENTION_LIMIT = 6;

function placeParentKeys(locations) {
  const keyByName = new Map();
  for (const loc of locations) {
    const name = loc.name.toLocaleLowerCase();
    if (name && !keyByName.has(name)) keyByName.set(name, loc.key);
  }
  const parents = new Map();
  for (const loc of locations) {
    const words = loc.name.split(/\s+/u).filter(Boolean);
    for (let size = words.length - 1; size >= 1; size -= 1) {
      const parentKey = keyByName.get(words.slice(0, size).join(' ').toLocaleLowerCase());
      if (parentKey && parentKey !== loc.key) {
        parents.set(loc.key, parentKey);
        break;
      }
    }
  }
  return parents;
}

function placeNameTokens(name) {
  return new Set(name.toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word.length >= 3 && !PLACE_NAME_STOPWORDS.has(word)));
}

function isPlaceAncestor(parents, ancestorKey, key) {
  for (let cursor = parents.get(key), depth = 0; cursor && depth < 8; cursor = parents.get(cursor), depth += 1) {
    if (cursor === ancestorKey) return true;
  }
  return false;
}

// Conservative advisory flag only; merging stays an explicit operator action.
function possibleDuplicatePlaceKeys(locations, parents) {
  const rows = locations.map(loc => ({
    loc,
    normalizedName: loc.name.toLocaleLowerCase().replace(/\s+/gu, ' ').trim(),
    tokens: placeNameTokens(loc.name),
  }));
  const flagged = new Map();
  const flag = (key, partnerKey) => {
    if (!flagged.has(key)) flagged.set(key, new Set());
    flagged.get(key).add(partnerKey);
  };
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i];
      const b = rows[j];
      if (isPlaceAncestor(parents, a.loc.key, b.loc.key) || isPlaceAncestor(parents, b.loc.key, a.loc.key)) continue;
      let shared = 0;
      for (const token of a.tokens) if (b.tokens.has(token)) shared += 1;
      const smaller = Math.min(a.tokens.size, b.tokens.size);
      const sameName = a.normalizedName && a.normalizedName === b.normalizedName;
      const samePoint = a.loc.hasCoord && b.loc.hasCoord
        && Math.abs(a.loc.x - b.loc.x) <= 0.05
        && Math.abs(a.loc.y - b.loc.y) <= 0.05;
      const nameContained = smaller >= 2 && shared === smaller;
      if (sameName || (samePoint && shared >= 2) || nameContained) {
        flag(a.loc.key, b.loc.key);
        flag(b.loc.key, a.loc.key);
      }
    }
  }
  return flagged;
}

function placeTreeOrder(locations, parents, duplicateKeys) {
  const visible = new Map(locations.map(loc => [loc.key, loc]));
  const children = new Map();
  const roots = [];
  for (const loc of locations) {
    const parentKey = parents.get(loc.key);
    if (parentKey && visible.has(parentKey)) {
      if (!children.has(parentKey)) children.set(parentKey, []);
      children.get(parentKey).push(loc);
    } else {
      roots.push(loc);
    }
  }
  const ordered = [];
  const seen = new Set();
  function visit(loc, depth) {
    if (seen.has(loc.key)) return;
    seen.add(loc.key);
    const parent = depth > 0 ? visible.get(parents.get(loc.key)) : null;
    const trimmed = parent ? loc.name.slice(parent.name.length).trim() : '';
    ordered.push({
      ...loc,
      depth: Math.min(depth, 3),
      displayName: trimmed || loc.name,
      possibleDuplicate: duplicateKeys.has(loc.key),
    });
    for (const child of children.get(loc.key) || []) visit(child, depth + 1);
  }
  for (const loc of roots) visit(loc, 0);
  for (const loc of locations) visit(loc, 0);
  return ordered;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function placeMentions(records, name) {
  const needle = clean(name, 120).toLocaleLowerCase();
  if (needle.length < 3) return { rows: [], total: 0 };
  const pattern = needle.length >= 4
    ? new RegExp('(^|[^\\p{L}\\p{N}])' + escapeRegExp(needle) + '($|[^\\p{L}\\p{N}])', 'iu')
    : null;
  const matches = records.filter(record =>
    record.anchors.some(anchor => anchor.toLocaleLowerCase() === needle)
      || (pattern && pattern.test(record.summary)))
    .sort((left, right) => {
      const leftActive = left.status === 'active' ? 0 : 1;
      const rightActive = right.status === 'active' ? 0 : 1;
      return leftActive - rightActive || recordSort(left, right);
    });
  return {
    rows: matches.slice(0, PLACE_MENTION_LIMIT).map(record => ({
      key: record.key,
      kind: record.kind,
      status: record.status,
      trend: record.trend,
      summary: record.summary,
    })),
    total: matches.length,
  };
}

export function buildWorldStateUiModel(state, {
  diagnostics = [],
  query = '',
  selectedRecordId = '',
  activeView = 'current',
  baseMap = null,
  selectedSpatialKey = '',
  spatialSearch = '',
  spatialDuplicatesOnly = false,
  runtimeInfo = {},
} = {}) {
  const normalized = normalizeState(clone(state));
  const reasons = latestReasonByMessage(normalized);
  const uiKeyByRecordId = new Map(normalized.records.map((record, index) => [record.id, 'row-' + index]));
  const recordIdByUiKey = new Map([...uiKeyByRecordId.entries()].map(([recordId, uiKey]) => [uiKey, recordId]));
  const projected = normalized.records.map(record => projectRecord(record, reasons, uiKeyByRecordId.get(record.id)));

  const currentAll = projected.filter(record => record.status === 'active').sort(recordSort);
  const recentAll = projected.filter(record => record.lastChangedMessage !== null).sort(recordSort);
  const resolvedAll = projected.filter(record => record.status !== 'active').sort(recordSort);

  const searchQuery = clean(query, 500);
  const searchResult = searchQuery
    ? queryWorldState(normalized, {
      text: searchQuery,
      limit: WORLD_STATE_UI_LIMITS.searchRecords,
    })
    : { records: [], totalMatched: 0 };
  const searched = searchResult.records.map(record => projectRecord(record, reasons, uiKeyByRecordId.get(record.id)));

  const current = currentAll.slice(0, WORLD_STATE_UI_LIMITS.currentRecords);
  const recent = recentAll.slice(0, WORLD_STATE_UI_LIMITS.recentRecords);
  const resolved = resolvedAll.slice(0, WORLD_STATE_UI_LIMITS.resolvedRecords);
  const requestedSelection = uiKeyByRecordId.get(clean(selectedRecordId, 120)) || clean(selectedRecordId, 120);
  const recordViews = { current, recent, resolved, search: searched };
  const preferredView = recordViews[activeView] || current;
  const key = requestedSelection && preferredView.some(row => row.key === requestedSelection)
    ? requestedSelection
    : preferredView[0]?.key || '';
  const detailRecordId = key ? recordIdByUiKey.get(key) : '';
  const detail = detailRecordId ? projectDetail(normalized, detailRecordId, reasons, key) : null;

  // Spatial Projection
  const resolvedLocations = resolveEffectiveLocations(normalized.spatial, baseMap);
  // Archived places (including merged duplicates) are history, not current
  // geography: Spatial injection already skips them, so the list does too.
  const effectiveLocations = resolvedLocations.filter(loc => loc.status !== 'archived');
  const hasBaseMap = Boolean(baseMap || normalized.spatial.baseMapRef);
  const activeSpatialProfile = resolveSpatialProfile(normalized.spatial, baseMap);
  const displaySpatialProfile = activeSpatialProfile || {
    system: 'cartesian2d',
    northAxis: '+y',
    eastAxis: '+x',
    unitKm: null,
    bounds: null,
    decimalStep: 0.1,
    trueNorthLocked: true,
  };
  const derivedCoordinateCount = normalized.spatial.locations.filter(location =>
    location?.coordinate?.authority === 'derived'
      && Number.isFinite(location.coordinate.x)
      && Number.isFinite(location.coordinate.y)
  ).length;
  const spatialKeyByLocId = new Map(effectiveLocations.map((loc, index) => [loc.id, 'sloc-' + index]));
  const locBySpatialKey = new Map(effectiveLocations.map((loc, index) => ['sloc-' + index, loc]));

  const spatialNeedle = clean(spatialSearch, 120).toLowerCase();
  const allSpatialProjected = effectiveLocations.map((loc, index) =>
    projectSpatialLocation(loc, 'sloc-' + index),
  );
  const placeParents = placeParentKeys(allSpatialProjected);
  const duplicatePool = allSpatialProjected.length <= PLACE_DUPLICATE_POOL
    ? allSpatialProjected
    : allSpatialProjected.filter(loc => !loc.isBase || loc.isOverridden).slice(0, PLACE_DUPLICATE_POOL);
  const duplicateKeys = possibleDuplicatePlaceKeys(duplicatePool, placeParents);

  const searchedSpatial = spatialNeedle
    ? allSpatialProjected.filter(l => l.name.toLowerCase().includes(spatialNeedle)
      || l.type.toLowerCase().includes(spatialNeedle)
      || l.context.toLowerCase().includes(spatialNeedle))
    : allSpatialProjected;
  const filteredSpatial = spatialDuplicatesOnly
    ? searchedSpatial.filter(loc => duplicateKeys.has(loc.key))
    : searchedSpatial;

  const boundedSpatial = placeTreeOrder(
    filteredSpatial.slice(0, WORLD_STATE_UI_LIMITS.spatialLocations),
    placeParents,
    duplicateKeys,
  );

  const activeSpatialKey = selectedSpatialKey && locBySpatialKey.has(selectedSpatialKey)
    ? selectedSpatialKey
    : boundedSpatial[0]?.key || '';

  const selectedLoc = activeSpatialKey ? locBySpatialKey.get(activeSpatialKey) : null;
  const spatialDetail = selectedLoc ? projectSpatialDetail(normalized.spatial, selectedLoc, baseMap, activeSpatialKey) : null;
  if (spatialDetail) {
    const projectedByKey = new Map(allSpatialProjected.map(loc => [loc.key, loc]));
    const parentKey = placeParents.get(activeSpatialKey);
    spatialDetail.parentName = parentKey ? projectedByKey.get(parentKey)?.name || '' : '';
    spatialDetail.childCount = [...placeParents.values()].filter(key => key === activeSpatialKey).length;
    spatialDetail.possibleDuplicate = duplicateKeys.has(activeSpatialKey);
    spatialDetail.duplicateNames = [...(duplicateKeys.get(activeSpatialKey) || [])]
      .map(key => projectedByKey.get(key)?.name)
      .filter(Boolean);
    spatialDetail.mentions = placeMentions(projected, spatialDetail.name);
  }

  const placeNames = new Set(allSpatialProjected.map(loc => loc.name.toLocaleLowerCase()).filter(Boolean));
  for (const row of [...projected, ...searched]) {
    row.anchorTags = row.anchors.map(label => ({ label, isPlace: placeNames.has(label.toLocaleLowerCase()) }));
  }
  if (detail) detail.anchorTags = detail.anchors.map(label => ({ label, isPlace: placeNames.has(label.toLocaleLowerCase()) }));
  const latestMessage = Math.max(
    (integer(runtimeInfo?.chatMessages) ?? 0) - 1,
    integer(normalized.lastCaptureMessage) ?? -1,
    ...projected.map(row => row.lastChangedMessage ?? -1),
  );

  return {
    namespace: WORLD_STATE_UI_NAMESPACE,
    counts: {
      total: projected.length,
      current: currentAll.length,
      resolved: resolvedAll.filter(record => record.status === 'resolved').length,
      superseded: resolvedAll.filter(record => record.status === 'superseded').length,
      evidence: Object.keys(normalized.evidence).length,
      links: normalized.links.length,
      spatialLocations: effectiveLocations.length,
      spatialCampaign: normalized.spatial.locations.length,
      spatialBase: baseMap ? (baseMap.locations?.length || 0) : 0,
    },
    views: { current, recent, resolved, search: searched },
    latestMessage: latestMessage >= 0 ? latestMessage : null,
    spatial: {
      locations: boundedSpatial,
      totalCount: effectiveLocations.length,
      filteredCount: filteredSpatial.length,
      duplicateCount: duplicateKeys.size,
      archivedCount: resolvedLocations.length - effectiveLocations.length,
      duplicatesOnly: Boolean(spatialDuplicatesOnly),
      search: spatialSearch,
      selectedKey: activeSpatialKey,
      detail: spatialDetail,
      baseMapName: baseMap?.name || normalized.spatial.baseMapRef?.name || 'None',
      baseMapVersion: baseMap?.version || normalized.spatial.baseMapRef?.version || '',
      hasBaseMap,
      profile: displaySpatialProfile,
      profileConfigured: Boolean(activeSpatialProfile),
      profileSource: hasBaseMap ? 'base_map' : 'manual',
      profileEditable: !hasBaseMap,
      derivedCoordinateCount,
    },
    totals: {
      recent: recentAll.length,
      resolved: resolvedAll.length,
    },
    truncation: {
      current: Math.max(0, currentAll.length - current.length),
      recent: Math.max(0, recentAll.length - recent.length),
      resolved: Math.max(0, resolvedAll.length - resolved.length),
      search: Math.max(0, searchResult.totalMatched - searched.length),
      spatial: Math.max(0, filteredSpatial.length - boundedSpatial.length),
    },
    search: {
      query: searchQuery,
      totalMatched: searchResult.totalMatched,
    },
    selectedRecordId: key,
    detail,
    diagnostics: projectDiagnostics(diagnostics),
    maintenance: {
      recoveryAttention: Boolean(normalized.recoveryRequired) || Boolean(runtimeInfo?.bootstrapRequired),
      recoveryMessage: runtimeInfo?.bootstrapRequired
        ? 'Durable World State was not found for this established chat. Automatic continuity is paused until Full chat rebuild, import, or explicit reset establishes a baseline.'
        : normalized.recoveryRequired
          ? 'Branch recovery needs attention. Review the current chat branch before choosing rebuild.'
          : 'Branch continuity is healthy.',
      bootstrapRequired: Boolean(runtimeInfo?.bootstrapRequired),
      hydrationSource: clean(runtimeInfo?.hydrationSource, 80),
      hostHydrationReady: Boolean(runtimeInfo?.hostHydrationReady),
      lastCaptureMessage: integer(normalized.lastCaptureMessage),
      actions: WORLD_STATE_UI_MAINTENANCE_ACTIONS.map(item => ({ ...item })),
      rebuild: {
        chatMessages: integer(runtimeInfo?.chatMessages) ?? 0,
        assistantBoundaries: integer(runtimeInfo?.assistantBoundaries) ?? 0,
        defaultMaxBoundaries: integer(runtimeInfo?.defaultRebuildBoundaries) ?? 1024,
        maxAllowedBoundaries: integer(runtimeInfo?.maxRebuildBoundaries) ?? 4096,
        spatialEnabled: Boolean(runtimeInfo?.spatialEnabled),
        bootstrapRequired: Boolean(runtimeInfo?.bootstrapRequired),
        status: runtimeInfo?.rebuildStatus && typeof runtimeInfo.rebuildStatus === 'object'
          ? {
            phase: clean(runtimeInfo.rebuildStatus.phase, 24),
            operationId: clean(runtimeInfo.rebuildStatus.operationId, 120),
            mode: clean(runtimeInfo.rebuildStatus.mode, 20),
            startMessageId: integer(runtimeInfo.rebuildStatus.startMessageId) ?? 0,
            maxBoundaries: integer(runtimeInfo.rebuildStatus.maxBoundaries) ?? 0,
            includeHiddenMessages: runtimeInfo.rebuildStatus.includeHiddenMessages !== false,
            hiddenMessagesIncluded: integer(runtimeInfo.rebuildStatus.hiddenMessagesIncluded) ?? 0,
            hiddenAssistantBoundaries: integer(runtimeInfo.rebuildStatus.hiddenAssistantBoundaries) ?? 0,
            processedBoundaries: integer(runtimeInfo.rebuildStatus.processedBoundaries) ?? 0,
            totalBoundaries: integer(runtimeInfo.rebuildStatus.totalBoundaries) ?? 0,
            currentMessageId: integer(runtimeInfo.rebuildStatus.currentMessageId),
            providerCalls: integer(runtimeInfo.rebuildStatus.providerCalls) ?? 0,
            applied: integer(runtimeInfo.rebuildStatus.applied) ?? 0,
            rejected: integer(runtimeInfo.rebuildStatus.rejected) ?? 0,
            currentRecords: integer(runtimeInfo.rebuildStatus.currentRecords) ?? 0,
            places: integer(runtimeInfo.rebuildStatus.places) ?? 0,
            startedAt: integer(runtimeInfo.rebuildStatus.startedAt),
            completedAt: integer(runtimeInfo.rebuildStatus.completedAt),
            detail: clean(runtimeInfo.rebuildStatus.detail, 320),
          }
          : null,
      },
    },
  };
}

const ICON_PATHS = Object.freeze({
  refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  emerging: '<path d="M7 17L17 7M9 7h8v8"/>',
  rising: '<path d="M6 13l6-6 6 6M6 19l6-6 6 6"/>',
  stable: '<path d="M5 12h14"/>',
  falling: '<path d="M7 7l10 10M17 9v8H9"/>',
  uncertain: '<path d="M9 9a3 3 0 1 1 4 2.8c-.6.3-1 .9-1 1.6V14M12 18h.01"/>',
  fact: '<path d="M12 4l7 8-7 8-7-8z"/>',
  resolved: '<path d="M5 12l5 5 9-10"/>',
  superseded: '<path d="M6 3v5a6 6 0 0 0 6 6h6"/><path d="M15 11l3 3-3 3"/>',
  pin: '<path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/>',
  route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  merge: '<path d="M6 3v5a6 6 0 0 0 6 6h6M6 21v-5"/><path d="M15 11l3 3-3 3"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8M10 12h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
});

function icon(name, className = '') {
  const paths = ICON_PATHS[name];
  if (!paths) return '';
  return '<svg class="wsa-ico' + (className ? ' ' + className : '') +
    '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + paths + '</svg>';
}

function pill(label, className) {
  if (!label) return '';
  return '<span class="wsa-pill ' + escapeHtml(className || '') + '">' + escapeHtml(label) + '</span>';
}

const RECENT_CHANGE_WINDOW = 10;
const COLLAPSED_ANCHOR_LIMIT = 4;

function recordTone(record) {
  if (record.status === 'resolved' || record.status === 'superseded') return record.status;
  if (record.kind === 'fact') return 'fact';
  return ['emerging', 'rising', 'stable', 'falling', 'uncertain'].includes(record.trend) ? record.trend : 'stable';
}

function recordStateLabel(record) {
  if (record.status !== 'active') return record.statusLabel;
  if (record.kind === 'fact') return 'Fact';
  return record.trendLabel || 'Development';
}

function messagesAgo(model, messageId) {
  if (messageId === null || messageId === undefined) return '';
  const latest = model.latestMessage;
  if (latest === null || latest === undefined || messageId > latest) return 'msg ' + messageId;
  const ago = latest - messageId;
  if (ago === 0) return 'latest message';
  if (ago <= 30) return ago + (ago === 1 ? ' message ago' : ' messages ago');
  return 'msg ' + messageId;
}

function anchorTagHtml(tag) {
  return '<span class="wsa-tag' + (tag.isPlace ? ' is-place' : '') + '">' +
    (tag.isPlace ? icon('pin') : '') + escapeHtml(tag.label) + '</span>';
}

function anchorTags(record, limit = COLLAPSED_ANCHOR_LIMIT) {
  const tags = Array.isArray(record.anchorTags)
    ? record.anchorTags
    : record.anchors.map(label => ({ label, isPlace: false }));
  const shown = tags.slice(0, limit).map(anchorTagHtml).join('');
  const hidden = tags.length - Math.min(tags.length, limit);
  return shown + (hidden > 0 ? '<span class="wsa-tag is-more">+' + hidden + '</span>' : '');
}

function recordDisclosure(record, expanded, index, detail = null, model = {}) {
  const tone = recordTone(record);
  const when = messagesAgo(model, record.lastChangedMessage);
  return '<details class="wsa-record-disclosure' + (expanded ? ' is-expanded' : '') + ' wsa-rec-' + tone + '"' + (expanded ? ' open' : '') + '>' +
    '<summary data-wsa-record-index="' + index + '">' +
    '<span class="wsa-record-glyph" aria-hidden="true">' + icon(tone) + '</span>' +
    '<span class="wsa-record-summary-main">' +
    '<span class="wsa-record-text">' + escapeHtml(record.summary || 'Untitled world state') + '</span>' +
    '<span class="wsa-record-meta">' + anchorTags(record) +
    '<span class="wsa-record-when"><b>' + escapeHtml(recordStateLabel(record)) + '</b>' +
    (when ? ' · ' + escapeHtml(when) : '') + '</span></span>' +
    '</span>' +
    '<span class="wsa-disclosure-icon" aria-hidden="true">' + icon('chevron') + '</span>' +
    '</summary>' +
    (expanded && detail ? '<div class="wsa-record-expanded">' + recordExpandedHtml(detail) + '</div>' : '') +
    '</details>';
}

function emptyState(title, body) {
  return '<div class="wsa-empty"><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(body) + '</p></div>';
}

function groupHeading(title, note = '') {
  return '<h3 class="wsa-group-head"><span>' + escapeHtml(title) + '</span>' +
    (note ? '<small>' + escapeHtml(note) + '</small>' : '') + '</h3>';
}

function currentRecordGroups(records, model) {
  const latest = model.latestMessage;
  const recent = [];
  const ongoing = [];
  const facts = [];
  records.forEach((record, index) => {
    const entry = { record, index };
    const changed = record.lastChangedMessage;
    if (latest !== null && changed !== null && latest - changed <= RECENT_CHANGE_WINDOW) recent.push(entry);
    else if (record.kind === 'development') ongoing.push(entry);
    else facts.push(entry);
  });
  return [
    { title: 'Changed recently', note: 'last ' + RECENT_CHANGE_WINDOW + ' messages', entries: recent },
    { title: 'Ongoing', note: 'active developments', entries: ongoing },
    { title: 'Facts', note: 'presently true', entries: facts },
  ].filter(group => group.entries.length);
}

function recordsPane(records, model, emptyTitle, emptyBody, truncated, expanded = false, { grouped = false } = {}) {
  const row = ({ record, index }) => {
    const isExpanded = expanded && record.key === model.selectedRecordId;
    return recordDisclosure(record, isExpanded, index, isExpanded ? model.detail : null, model);
  };
  let rows;
  if (!records.length) {
    rows = emptyState(emptyTitle, emptyBody);
  } else if (grouped) {
    rows = currentRecordGroups(records, model).map(group =>
      '<section class="wsa-record-group">' + groupHeading(group.title, group.note) +
      group.entries.map(row).join('') + '</section>'
    ).join('');
  } else {
    rows = records.map((record, index) => row({ record, index })).join('');
  }
  const note = truncated > 0
    ? '<p class="wsa-list-note">' + truncated + ' additional records are hidden from this bounded view. Use Search to narrow the list.</p>'
    : '';
  return '<div class="wsa-record-list wsa-flat-records">' + rows + note + '</div>';
}

function messageValue(value) {
  return value === null || value === undefined ? 'not recorded' : 'msg ' + value;
}

function kvRow(label, html) {
  return '<div class="wsa-kv"><dt>' + escapeHtml(label) + '</dt><dd>' + html + '</dd></div>';
}

function evidenceListHtml(items, emptyText) {
  if (!items.length) return '<p class="wsa-muted">' + escapeHtml(emptyText) + '</p>';
  return '<div class="wsa-evidence-list">' + items.map(item => {
    const parts = [
      item.source,
      item.sourceMessageId === null ? 'no local message' : 'msg ' + item.sourceMessageId,
      item.timeAnchor ? item.timeAnchor : '',
    ].filter(Boolean).map(escapeHtml).join(' · ');
    return '<blockquote class="wsa-evidence"><p>' + escapeHtml(item.claim || 'Evidence claim not retained.') + '</p>' +
      '<footer>' + parts + '</footer></blockquote>';
  }).join('') + '</div>';
}

function recordExpandedHtml(detail) {
  if (!detail) return '';
  const tone = recordTone(detail);

  const lifecycleActions = detail.status === 'active'
    ? '<section class="wsa-manual-lifecycle"><div><strong>Manual lifecycle</strong>' +
      '<p>Use this only when you need to override automatic lifecycle detection. The record stays in history with manual evidence.</p></div>' +
      '<div class="wsa-record-action-row">' +
      '<button type="button" class="wsa-btn" data-wsa-record-action="resolve">' + icon('resolved') + 'Mark resolved</button>' +
      '<button type="button" class="wsa-btn" data-wsa-record-action="supersede">' + icon('superseded') + 'Mark superseded</button>' +
      '</div></section>'
    : '';

  const anchors = detail.anchors.length
    ? '<div class="wsa-chip-row">' + anchorTags(detail, 20) + '</div>'
    : '<span class="wsa-muted">No anchors recorded.</span>';

  const relations = detail.relations.length
    ? '<ul class="wsa-relations">' + detail.relations.map(item =>
      '<li><span class="wsa-rel-kind">' + escapeHtml(item.relation) + '</span>' +
      '<span class="wsa-rel-text">' + escapeHtml(item.summary) + '</span>' +
      (item.statusLabel ? '<small>' + escapeHtml(item.statusLabel) + '</small>' : '') + '</li>'
    ).join('') + '</ul>'
    : '<span class="wsa-muted">No causal or related records are attached.</span>';

  const timeline = 'Created ' + messageValue(detail.createdAtMessage) +
    ' · changed ' + messageValue(detail.lastChangedMessage) +
    ' · checked ' + messageValue(detail.lastEvaluatedMessage);

  return '<dl class="wsa-record-expanded-grid">' +
    kvRow('State', '<span class="wsa-state-badge wsa-rec-' + tone + '">' + icon(tone) + escapeHtml(recordStateLabel(detail)) + '</span>' +
      '<span class="wsa-muted">' + escapeHtml(detail.kindLabel.toLocaleLowerCase()) + ' · ' + escapeHtml(detail.statusLabel.toLocaleLowerCase()) + '</span>') +
    (detail.timeAnchor ? kvRow('Story time', escapeHtml(detail.timeAnchor)) : '') +
    kvRow('Timeline', '<span>' + escapeHtml(timeline) + '</span>' +
      (detail.changeReason ? '<span class="wsa-change-reason">' + escapeHtml(detail.changeReason) + '</span>' : '')) +
    kvRow('Anchors', anchors) +
    kvRow('Connections', relations) +
    kvRow('Evidence', evidenceListHtml(detail.evidence, 'No bounded evidence is attached to this record.')) +
    '</dl>' +
    lifecycleActions;
}

function placeOriginLabel(loc) {
  if (!loc.isBase) return 'Campaign';
  return loc.isOverridden ? 'Campaign override' : 'Base map';
}

function placeRow(loc, selected) {
  const trailing = loc.possibleDuplicate
    ? '<span class="wsa-place-flag" title="Possible duplicate">' + icon('warn') + 'duplicate?</span>'
    : '<span class="wsa-place-type">' + escapeHtml(loc.type) + '</span>';
  return '<button type="button" class="wsa-place-row wsa-depth-' + (loc.depth || 0) + (selected ? ' is-selected' : '') +
    '" data-wsa-spatial-key="' + escapeHtml(loc.key) + '" aria-pressed="' + (selected ? 'true' : 'false') + '"' +
    (loc.displayName !== loc.name ? ' title="' + escapeHtml(loc.name) + '"' : '') + '>' +
    '<span class="wsa-place-icon" aria-hidden="true">' + icon('pin') + '</span>' +
    '<span class="wsa-place-name">' + escapeHtml(loc.displayName || loc.name) + '</span>' +
    trailing +
    '</button>';
}

function placeSection(title, body) {
  return '<section class="wsa-place-section"><h3 class="wsa-group-head"><span>' + escapeHtml(title) + '</span></h3>' + body + '</section>';
}

// item.direction is the selected place's bearing from the other place; the row
// reads from the selected place, so show the other place's bearing instead.
function relationDistanceText(item) {
  const parts = [];
  if (item.direction) parts.push(inverseDirection(item.direction));
  if (Number.isFinite(item.distanceKm)) {
    parts.push(item.distanceKm + ' km' + (item.distanceMode === 'route' ? ' by route' : item.distanceMode === 'straight_line' ? ' straight-line' : ''));
  } else if (item.distanceMode === 'route') {
    parts.push('route known');
  }
  return parts.join(' · ');
}

function spatialReadHtml(detail) {
  const editable = !detail.isBase || detail.isOverridden;
  const headAction = editable
    ? '<button type="button" class="wsa-btn" data-wsa-spatial-edit>' + icon('edit') + 'Edit</button>'
    : '<button type="button" class="wsa-btn wsa-btn-accent" data-wsa-spatial-action="create_override">Create campaign override</button>';

  const lockButton = editable && detail.hasCoord
    ? '<button type="button" class="wsa-icon-btn wsa-lock-btn' + (detail.locked ? ' is-locked' : '') +
      '" data-wsa-spatial-action="toggle_lock" aria-label="' + (detail.locked ? 'Unlock coordinates' : 'Lock coordinates') +
      '" title="' + (detail.locked ? 'Unlock coordinates' : 'Lock coordinates') + '">' + icon(detail.locked ? 'lock' : 'unlock') + '</button>'
    : '';

  const cards = [
    '<div class="wsa-fact-card"><small>Position</small><span>' +
      escapeHtml(detail.hasCoord ? detail.x + ', ' + detail.y : 'Unknown') + lockButton + '</span></div>',
    detail.childCount > 0 ? '<div class="wsa-fact-card"><small>Sub-places</small><span>' + detail.childCount + '</span></div>' : '',
    detail.lastChangedMessage !== null ? '<div class="wsa-fact-card"><small>Updated</small><span>msg ' + detail.lastChangedMessage + '</span></div>' : '',
  ].join('');

  const relations = detail.relations.length
    ? '<ul class="wsa-connection-list">' + detail.relations.map(item => {
      const distance = relationDistanceText(item);
      return '<li>' + icon(item.distanceMode === 'route' ? 'route' : 'arrow') +
        '<span>' + escapeHtml(item.anchorName) + '</span>' +
        '<small' + (distance ? '' : ' class="is-unknown"') + '>' + escapeHtml(distance || 'relation recorded') + '</small></li>';
    }).join('') + '</ul>'
    : '<p class="wsa-muted">No spatial relations recorded.</p>';

  const routes = detail.routeRefs.length
    ? placeSection('Routes', '<div class="wsa-chip-row">' + detail.routeRefs.map(route =>
      '<span class="wsa-tag">' + icon('route') + escapeHtml(route) + '</span>').join('') + '</div>')
    : '';

  const mentions = detail.mentions?.rows?.length
    ? '<ul class="wsa-mention-list">' + detail.mentions.rows.map(item => {
      const tone = recordTone(item);
      return '<li><button type="button" class="wsa-mention wsa-rec-' + tone + '" data-wsa-open-record="' + escapeHtml(item.key) + '">' +
        '<span class="wsa-mention-bar" aria-hidden="true"></span><span class="wsa-mention-text">' + escapeHtml(item.summary) + '</span>' +
        '<small>' + escapeHtml(item.status !== 'active' ? item.status : item.kind === 'fact' ? 'fact' : (item.trend || 'development')) + '</small></button></li>';
    }).join('') + '</ul>' +
      (detail.mentions.total > detail.mentions.rows.length
        ? '<p class="wsa-list-note">' + (detail.mentions.total - detail.mentions.rows.length) +
          (detail.mentions.total - detail.mentions.rows.length === 1 ? ' more record mentions' : ' more records mention') + ' this place.</p>'
        : '')
    : '<p class="wsa-muted">No world-state records mention this place.</p>';

  const duplicateNote = detail.possibleDuplicate && editable
    ? '<div class="wsa-inline-warning">' + icon('warn') + '<span>' +
      (detail.duplicateNames?.length
        ? 'May duplicate ' + detail.duplicateNames.map(name => '“' + escapeHtml(name) + '”').join(', ') + '.'
        : 'This place may duplicate another entry.') + '</span>' +
      '<button type="button" class="wsa-btn wsa-btn-sm" data-wsa-spatial-action="merge_location">' + icon('merge') + 'Merge…</button></div>'
    : '';

  return '<article class="wsa-place-detail">' +
    '<header class="wsa-place-head"><span class="wsa-place-badge" aria-hidden="true">' + icon('pin') + '</span>' +
    '<div class="wsa-place-title"><h2>' + escapeHtml(detail.name) + '</h2>' +
    '<p><span>' + escapeHtml(detail.type) + '</span>' +
    pill(detail.authorityLabel, 'wsa-auth') +
    '<span>' + escapeHtml(placeOriginLabel(detail)) + '</span>' +
    (detail.parentName ? '<span>in ' + escapeHtml(detail.parentName) + '</span>' : '') +
    '</p></div>' +
    '<div class="wsa-place-actions">' + headAction + '</div></header>' +
    duplicateNote +
    (detail.context
      ? '<p class="wsa-place-desc">' + escapeHtml(detail.context) + '</p>'
      : '<p class="wsa-place-desc wsa-muted">No description recorded.</p>') +
    '<div class="wsa-fact-cards">' + cards + '</div>' +
    placeSection('Connections', relations) +
    routes +
    placeSection('In world state' + (detail.mentions?.total ? ' · ' + detail.mentions.total : ''), mentions) +
    (detail.notes ? placeSection('Notes', '<p class="wsa-place-notes">' + escapeHtml(detail.notes) + '</p>') : '') +
    placeSection('Provenance & evidence', evidenceListHtml(detail.evidence, 'No evidence attached.')) +
    '</article>';
}

function spatialEditHtml(detail) {
  const editableAuthorities = ['manual', 'narrative_explicit', 'derived', 'relative', 'unknown'];
  const authorityChoices = editableAuthorities.includes(detail.authority)
    ? editableAuthorities
    : [detail.authority, ...editableAuthorities].filter(Boolean);
  const authorityOptions = authorityChoices.map(value =>
    '<option value="' + value + '"' + (detail.authority === value ? ' selected' : '') + '>' +
    escapeHtml(authorityLabel(value, false)) + '</option>'
  ).join('');
  const directionChoices = ['', 'north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  const directionOptions = directionChoices.map(value =>
    '<option value="' + value + '"' + (detail.primaryRelation.direction === value ? ' selected' : '') + '>' +
    escapeHtml(value ? titleWords(value) : 'Unspecified') + '</option>'
  ).join('');
  const distanceModes = ['unspecified', 'straight_line', 'route'];
  const distanceOptions = distanceModes.map(value =>
    '<option value="' + value + '"' + (detail.primaryRelation.distanceMode === value ? ' selected' : '') + '>' +
    escapeHtml(value === 'straight_line' ? 'Straight-line' : value === 'route' ? 'Route / travel' : 'Unspecified') + '</option>'
  ).join('');
  const locationOptions = (detail.locationOptions || []).map(item =>
    '<option value="' + escapeHtml(item.name) + '"></option>'
  ).join('');

  return '<article class="wsa-place-detail is-editing">' +
    '<header class="wsa-place-head"><span class="wsa-place-badge" aria-hidden="true">' + icon('edit') + '</span>' +
    '<div class="wsa-place-title"><h2>Editing ' + escapeHtml(detail.name) + '</h2>' +
    '<p><span>Manual edits are campaign authority and are recorded in the branch journal.</span></p></div>' +
    '<div class="wsa-place-actions"><button type="button" class="wsa-btn wsa-btn-ghost" data-wsa-spatial-cancel-edit>Cancel</button>' +
    '<button type="button" class="wsa-btn wsa-btn-primary" data-wsa-spatial-action="save_location">Save changes</button></div></header>' +
    '<form class="wsa-spatial-form" onsubmit="return false;">' +
    '<div class="wsa-form-grid">' +
    '<label class="wsa-field"><span>Name</span><input type="text" data-wsa-field="name" value="' + escapeHtml(detail.name) + '"></label>' +
    '<label class="wsa-field"><span>Type</span><input type="text" data-wsa-field="type" value="' + escapeHtml(detail.type) + '"></label>' +
    '<div class="wsa-field wsa-form-full"><span>Position</span><div class="wsa-coord-row">' +
    '<label class="wsa-coord"><b>X</b><input type="number" step="0.1" data-wsa-field="x" value="' + escapeHtml(detail.x) + '" aria-label="Coordinate X"></label>' +
    '<label class="wsa-coord"><b>Y</b><input type="number" step="0.1" data-wsa-field="y" value="' + escapeHtml(detail.y) + '" aria-label="Coordinate Y"></label>' +
    '<label class="wsa-switch"><input type="checkbox" data-wsa-field="locked"' + (detail.locked ? ' checked' : '') + '>' +
    '<span class="wsa-switch-track" aria-hidden="true"></span><span>' + icon('lock') + 'Locked</span></label>' +
    '</div><small class="wsa-help">Leave both blank if the position is unknown. Locked coordinates are not moved by later captures.</small></div>' +
    '<label class="wsa-field"><span>Authority</span><select data-wsa-field="authority">' + authorityOptions + '</select></label>' +
    '<label class="wsa-field"><span>Routes</span><input type="text" data-wsa-field="routeRefs" value="' + escapeHtml(detail.routeRefs.join(', ')) + '" placeholder="Comma-separated"></label>' +
    '<label class="wsa-field wsa-form-full"><span>Description / context</span><textarea data-wsa-field="context" rows="3">' + escapeHtml(detail.context) + '</textarea></label>' +
    '<label class="wsa-field wsa-form-full"><span>Notes / operator provenance</span><input type="text" data-wsa-field="notes" value="' + escapeHtml(detail.notes) + '"></label>' +
    '</div>' +
    '<h3 class="wsa-group-head"><span>Relative position</span><small>optional</small></h3>' +
    '<datalist id="wsa-spatial-location-options">' + locationOptions + '</datalist>' +
    '<div class="wsa-form-grid">' +
    '<label class="wsa-field"><span>Relative to</span><input type="text" list="wsa-spatial-location-options" data-wsa-field="relativeAnchor" value="' + escapeHtml(detail.primaryRelation.anchorName) + '" placeholder="Another place"></label>' +
    '<label class="wsa-field"><span>Direction</span><select data-wsa-field="direction">' + directionOptions + '</select></label>' +
    '<label class="wsa-field"><span>Distance (km)</span><input type="number" min="0" step="0.1" data-wsa-field="distanceKm" value="' + escapeHtml(detail.primaryRelation.distanceKm ?? '') + '"></label>' +
    '<label class="wsa-field"><span>Distance meaning</span><select data-wsa-field="distanceMode">' + distanceOptions + '</select></label>' +
    '</div>' +
    '<div class="wsa-danger-row">' +
    '<button type="button" class="wsa-btn wsa-btn-ghost" data-wsa-spatial-action="merge_location">' + icon('merge') + 'Merge into another place…</button>' +
    '<button type="button" class="wsa-btn wsa-btn-ghost" data-wsa-spatial-action="archive_location">' + icon('archive') + 'Archive</button>' +
    '<button type="button" class="wsa-btn wsa-btn-danger" data-wsa-spatial-action="delete_location">' + icon('trash') + 'Delete place</button>' +
    '</div>' +
    '</form>' +
    '</article>';
}

function spatialDetailHtml(detail, { editing = false } = {}) {
  if (!detail) return emptyState('No place selected', 'Choose a place from the list or add a new one.');
  const editable = !detail.isBase || detail.isOverridden;
  return editing && editable ? spatialEditHtml(detail) : spatialReadHtml(detail);
}

function mobileBackButton(label = 'Back') {
  return '<button type="button" class="wsa-mobile-back" data-wsa-back-list>' + icon('back') + escapeHtml(label) + '</button>';
}

function coordinateAxisLabel(value) {
  return String(value || '').toUpperCase();
}

function coordinateProfileSummary(sp) {
  const profile = sp.profile || {};
  const scale = Number.isFinite(profile.unitKm) ? profile.unitKm + ' km/unit' : 'no scale';
  const source = sp.profileSource === 'base_map' ? 'Base-map coordinates' : 'Manual coordinates';
  return source + (sp.profileConfigured ? '' : ' (not configured)') + ' · ' +
    coordinateAxisLabel(profile.northAxis) + ' north / ' + coordinateAxisLabel(profile.eastAxis) + ' east · ' + scale;
}

function coordinateProfileHtml(sp) {
  const profile = sp.profile || {};
  const bounds = profile.bounds || {};
  const disabled = sp.profileEditable ? '' : ' disabled';
  const checked = profile.trueNorthLocked !== false ? ' checked' : '';
  const axisChoices = ['+x', '-x', '+y', '-y'];
  const axisOptions = selected => axisChoices.map(value =>
    '<option value="' + value + '"' + (selected === value ? ' selected' : '') + '>' +
    escapeHtml(coordinateAxisLabel(value)) + '</option>'
  ).join('');
  const sourceLabel = sp.profileSource === 'base_map' ? 'Base Map' : 'Manual';
  const warning = sp.derivedCoordinateCount > 0 && sp.profileEditable
    ? '<p class="wsa-profile-warning">Changing orientation, scale, bounds, or precision will clear ' +
      sp.derivedCoordinateCount + ' derived coordinate' + (sp.derivedCoordinateCount === 1 ? '' : 's') +
      ' so stale geometry cannot survive the profile change.</p>'
    : '';
  const lockNote = sp.profileEditable
    ? '<p class="wsa-muted">Manual campaign profile. Cartesian 2D is the only supported math system in this release.</p>'
    : '<p class="wsa-muted">🔒 Defined by the attached base map. Detach the map before changing this profile.</p>';
  const actions = sp.profileEditable
    ? '<div class="wsa-form-actions"><button type="button" class="wsa-btn" data-wsa-spatial-action="reset_profile">Reset profile</button>' +
      '<button type="button" class="wsa-btn wsa-btn-primary" data-wsa-spatial-action="save_profile">Save profile</button></div>'
    : '';

  return '<section class="wsa-settings-block"><h3 class="wsa-group-head"><span>Coordinate Profile</span><small>' +
    escapeHtml(sourceLabel) + (sp.profileConfigured ? ' · configured' : ' · not configured') + '</small></h3>' +
    '<form class="wsa-spatial-profile-form" onsubmit="return false;">' +
    lockNote + warning +
    '<div class="wsa-form-grid wsa-form-grid-3">' +
    '<label class="wsa-field"><span>System</span><select data-wsa-profile-field="system" disabled><option value="cartesian2d" selected>Cartesian 2D</option></select></label>' +
    '<label class="wsa-field"><span>North axis</span><select data-wsa-profile-field="northAxis"' + disabled + '>' + axisOptions(profile.northAxis) + '</select></label>' +
    '<label class="wsa-field"><span>East axis</span><select data-wsa-profile-field="eastAxis"' + disabled + '>' + axisOptions(profile.eastAxis) + '</select></label>' +
    '<label class="wsa-field"><span>km per unit</span><input type="number" min="0" step="any" data-wsa-profile-field="unitKm" value="' +
      escapeHtml(Number.isFinite(profile.unitKm) ? profile.unitKm : '') + '"' + disabled + '></label>' +
    '<label class="wsa-field"><span>Precision</span><input type="number" min="0" step="any" data-wsa-profile-field="decimalStep" value="' +
      escapeHtml(Number.isFinite(profile.decimalStep) ? profile.decimalStep : 0.1) + '"' + disabled + '></label>' +
    '<label class="wsa-switch wsa-switch-field"><input type="checkbox" data-wsa-profile-field="trueNorthLocked"' + checked + disabled + '>' +
    '<span class="wsa-switch-track" aria-hidden="true"></span><span>Lock True North</span></label>' +
    '<label class="wsa-field"><span>X min</span><input type="number" step="any" data-wsa-profile-field="xMin" value="' + escapeHtml(Number.isFinite(bounds.xMin) ? bounds.xMin : '') + '"' + disabled + '></label>' +
    '<label class="wsa-field"><span>X max</span><input type="number" step="any" data-wsa-profile-field="xMax" value="' + escapeHtml(Number.isFinite(bounds.xMax) ? bounds.xMax : '') + '"' + disabled + '></label>' +
    '<span class="wsa-form-spacer" aria-hidden="true"></span>' +
    '<label class="wsa-field"><span>Y min</span><input type="number" step="any" data-wsa-profile-field="yMin" value="' + escapeHtml(Number.isFinite(bounds.yMin) ? bounds.yMin : '') + '"' + disabled + '></label>' +
    '<label class="wsa-field"><span>Y max</span><input type="number" step="any" data-wsa-profile-field="yMax" value="' + escapeHtml(Number.isFinite(bounds.yMax) ? bounds.yMax : '') + '"' + disabled + '></label>' +
    '</div>' + actions +
    '</form></section>';
}

function mapSettingsHtml(sp, { open = false } = {}) {
  const baseMapVersion = sp.baseMapVersion ? ' (v' + escapeHtml(sp.baseMapVersion) + ')' : '';
  const baseMap = sp.hasBaseMap
    ? '<section class="wsa-settings-block"><h3 class="wsa-group-head"><span>Base map</span></h3>' +
      '<div class="wsa-settings-row"><span>' + icon('map') + '<strong>' + escapeHtml(sp.baseMapName) + '</strong>' + baseMapVersion + '</span>' +
      '<button type="button" class="wsa-btn wsa-btn-sm" data-wsa-spatial-action="detach_base_map">Detach</button></div></section>'
    : '<section class="wsa-settings-block"><h3 class="wsa-group-head"><span>Base map</span></h3>' +
      '<div class="wsa-settings-row"><span>' + icon('map') + 'No base map attached.</span>' +
      '<button type="button" class="wsa-btn wsa-btn-sm wsa-btn-accent" data-wsa-spatial-action="import_base_map">Import base map</button></div></section>';

  return '<details class="wsa-map-settings"' + (open ? ' open' : '') + '>' +
    '<summary data-wsa-map-settings>' +
    '<span class="wsa-map-status">' + icon('map') + '<span>' + (sp.hasBaseMap ? escapeHtml(sp.baseMapName) : 'No base map') + '</span>' +
    '<span class="wsa-dot-sep" aria-hidden="true">·</span>' + icon('compass') + '<span>' + escapeHtml(coordinateProfileSummary(sp)) + '</span></span>' +
    '<span class="wsa-map-settings-link">Map settings' + icon('chevron') + '</span>' +
    '</summary>' +
    '<div class="wsa-map-settings-body">' + baseMap + coordinateProfileHtml(sp) + '</div>' +
    '</details>';
}

function spatialViewHtml(model, { detailOpen = false, editing = false, mapSettingsOpen = false } = {}) {
  const sp = model.spatial;
  const listRows = sp.locations.length
    ? sp.locations.map(loc => placeRow(loc, loc.key === sp.selectedKey)).join('')
    : emptyState(sp.duplicatesOnly ? 'No duplicates flagged' : 'No places found',
      sp.duplicatesOnly ? 'No possible duplicates match the current filter.' : 'No places match the search criteria.');

  const truncated = (model.truncation.spatial > 0
    ? '<p class="wsa-list-note">' + model.truncation.spatial + ' additional places hidden. Narrow the filter to view them.</p>'
    : '') +
    (sp.archivedCount > 0
      ? '<p class="wsa-list-note">' + sp.archivedCount + ' archived or merged place' + (sp.archivedCount === 1 ? ' is' : 's are') + ' not listed.</p>'
      : '');

  const duplicates = sp.duplicateCount > 0 || sp.duplicatesOnly
    ? '<button type="button" class="wsa-dup-banner' + (sp.duplicatesOnly ? ' is-active' : '') + '" data-wsa-spatial-dups>' +
      icon('warn') + '<span>' + sp.duplicateCount + ' possible duplicate' + (sp.duplicateCount === 1 ? '' : 's') + '</span>' +
      '<b>' + (sp.duplicatesOnly ? 'Show all' : 'Review') + '</b></button>'
    : '';

  return '<section class="wsa-view wsa-places-view" aria-label="Places">' +
    '<div class="wsa-two-pane wsa-adaptive-pane' + (detailOpen ? ' is-detail-open' : '') + '">' +
    '<aside class="wsa-list-pane">' +
    '<div class="wsa-place-tools">' +
    '<label class="wsa-input-icon">' + icon('search') + '<input type="search" data-wsa-spatial-search value="' +
    escapeHtml(sp.search) + '" autocomplete="off" spellcheck="false" placeholder="Filter places…" aria-label="Filter places"></label>' +
    duplicates +
    '</div>' +
    '<div class="wsa-pane-title"><h2>Places <span>' + sp.filteredCount + '</span></h2>' +
    '<button type="button" class="wsa-btn wsa-btn-sm" data-wsa-spatial-action="add_location_modal">' + icon('plus') + 'Add</button></div>' +
    '<div class="wsa-place-list">' + listRows + truncated + '</div>' +
    '</aside>' +
    '<div class="wsa-detail-pane"><div class="wsa-mobile-detail-head">' + mobileBackButton('Places') + '</div>' +
    spatialDetailHtml(sp.detail, { editing }) + '</div>' +
    '</div>' +
    mapSettingsHtml(sp, { open: mapSettingsOpen }) +
    '</section>';
}

function segmentButton(tab, activeTab, label, count, shortLabel = '') {
  const active = tab === activeTab;
  const text = shortLabel
    ? '<span class="wsa-seg-full">' + escapeHtml(label) + '</span><span class="wsa-seg-short">' + escapeHtml(shortLabel) + '</span>'
    : escapeHtml(label);
  return '<button type="button" class="wsa-segment' + (active ? ' is-active' : '') + '" data-wsa-tab="' + tab +
    '" aria-pressed="' + (active ? 'true' : 'false') + '">' + text +
    '<em>' + count + '</em></button>';
}

function recordsViewHtml(model, tab, { detailOpen = false } = {}) {
  let records = model.views.current;
  let title = 'Current world state';
  let emptyTitle = 'No current world state';
  let emptyBody = 'Established active world facts and developments will appear here.';
  let truncated = model.truncation.current;

  if (tab === 'recent') {
    records = model.views.recent;
    title = 'Recent changes';
    emptyTitle = 'No recorded changes';
    emptyBody = 'Grounded changes will appear here as the world state evolves.';
    truncated = model.truncation.recent;
  } else if (tab === 'resolved') {
    records = model.views.resolved;
    title = 'Resolved and superseded';
    emptyTitle = 'No resolved records';
    emptyBody = 'Finished or replaced episodes remain available as history-safe tombstones.';
    truncated = model.truncation.resolved;
  } else if (tab === 'search') {
    records = model.views.search;
    title = 'Search world state';
    emptyTitle = model.search.query ? 'No matching records' : 'Search the world state';
    emptyBody = model.search.query
      ? 'Try fewer or different words.'
      : 'Search summaries and anchors across current, resolved, and superseded records.';
    truncated = model.truncation.search;
  }

  const toolbar = tab === 'search'
    ? '<div class="wsa-view-toolbar wsa-search-toolbar">' +
      '<label class="wsa-input-icon wsa-search-inline">' + icon('search') + '<input type="search" data-wsa-search value="' +
      escapeHtml(model.search.query) + '" autocomplete="off" spellcheck="false" placeholder="Search records…" aria-label="Search world state records"></label>' +
      (model.search.query
        ? '<p class="wsa-search-summary">' + model.search.totalMatched + ' result' + (model.search.totalMatched === 1 ? '' : 's') +
          ' for “' + escapeHtml(model.search.query) + '”</p>' +
          '<button type="button" class="wsa-btn wsa-btn-sm wsa-btn-ghost" data-wsa-clear-search>' + icon('close') + 'Clear</button>'
        : '') +
      '</div>'
    : '<div class="wsa-view-toolbar"><div class="wsa-segmented" role="group" aria-label="Record filter">' +
      segmentButton('current', tab, 'Active', model.counts.current) +
      segmentButton('recent', tab, 'Recently changed', model.totals.recent, 'Recent') +
      segmentButton('resolved', tab, 'Resolved', model.totals.resolved) +
      '</div></div>';

  return '<section class="wsa-view wsa-records-view" aria-label="' + escapeHtml(title) + '">' +
    toolbar +
    recordsPane(records, model, emptyTitle, emptyBody, truncated, detailOpen, { grouped: tab === 'current' }) +
    '</section>';
}

function operationTime(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '';
  try {
    return new Date(Number(value)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function jsonInspector(title, textValue, index, kind) {
  if (!textValue) return '';
  return '<section class="wsa-operation-json"><div class="wsa-operation-json-head"><h4>' + escapeHtml(title) + '</h4>' +
    '<button type="button" class="wsa-btn wsa-btn-sm" data-wsa-copy-json="' + escapeHtml(kind) +
    '" data-wsa-diagnostic-index="' + index + '">Copy</button></div>' +
    '<pre tabindex="0">' + escapeHtml(textValue) + '</pre></section>';
}

function diagnosticsHtml(model) {
  const rows = model.diagnostics.length
    ? model.diagnostics.map((item, index) => ({ item, index })).reverse().map(({ item, index }) => {
      const code = item.code ? '<span class="wsa-op-code">' + escapeHtml(item.code) + '</span>' : '';
      const message = item.sourceMessageId === null ? 'n/a' : item.sourceMessageId;
      const progress = item.totalBoundaries > 0
        ? '<div><dt>Progress</dt><dd>' + item.processedBoundaries + '/' + item.totalBoundaries + '</dd></div>'
        : '';
      const repairs = item.aliasRepairs > 0
        ? '<div><dt>Alias repairs</dt><dd>' + item.aliasRepairs + '</dd></div>'
        : '';
      const checklist = item.completenessHints > 0
        ? '<div><dt>State checklist</dt><dd>' + item.completenessHints + '</dd></div>'
        : '';
      const provider = item.profileId
        ? '<div><dt>Profile</dt><dd>' + escapeHtml(item.profileId) + '</dd></div>'
        : '';
      const time = operationTime(item.at);
      const summary = (time ? '<span class="wsa-op-time">' + escapeHtml(time) + '</span>' : '') +
        '<span class="wsa-op-name">' + escapeHtml(titleWords(item.label || 'operation')) + ' · Msg ' + message + '</span>' +
        '<strong class="wsa-op-outcome">' + escapeHtml(item.outcome) + '</strong>' +
        '<span class="wsa-op-quick">+' + item.applied + ' / −' + item.rejected + ' · ' + item.durationMs + ' ms</span>';
      return '<details class="wsa-operation' + (/failed|invalid|timeout|cancel/i.test(item.outcome) ? ' has-error' : '') + '">' +
        '<summary>' + summary + '</summary>' +
        '<div class="wsa-operation-body">' +
        (item.detail ? '<p class="wsa-diagnostic-detail">' + escapeHtml(item.detail) + '</p>' : '') +
        (code ? '<div class="wsa-op-code-row">' + code + '</div>' : '') +
        '<dl>' +
        '<div><dt>Message</dt><dd>' + message + '</dd></div>' +
        '<div><dt>Route</dt><dd>' + escapeHtml(item.route || 'local/default') + '</dd></div>' +
        provider +
        '<div><dt>Provider calls</dt><dd>' + item.providerCalls + '</dd></div>' +
        '<div><dt>Proposed</dt><dd>' + item.proposed + '</dd></div>' +
        '<div><dt>Accepted</dt><dd>' + item.accepted + '</dd></div>' +
        '<div><dt>Applied</dt><dd>' + item.applied + '</dd></div>' +
        '<div><dt>Rejected</dt><dd>' + item.rejected + '</dd></div>' +
        repairs + checklist + progress +
        '<div><dt>Prompt chars</dt><dd>' + item.promptChars + '</dd></div>' +
        '<div><dt>Response chars</dt><dd>' + item.responseChars + '</dd></div>' +
        '<div><dt>Duration</dt><dd>' + item.durationMs + ' ms</dd></div>' +
        '</dl>' +
        jsonInspector('Model response JSON', item.responseJson, index, 'response') +
        jsonInspector('Rejected mutations / reasons', item.rejectionsJson, index, 'rejections') +
        '</div></details>';
    }).join('')
    : emptyState('No operations yet', 'Capture, rebuild, evolution, and maintenance telemetry will appear here.');

  return '<section class="wsa-view wsa-single-pane" aria-label="Operations">' +
    '<div class="wsa-section-head"><div><h2>Operations</h2>' +
    '<p>Expandable operation telemetry. Model response JSON is bounded and ephemeral; prompts, headers, reasoning content, credentials, and API secrets are never shown.</p></div></div>' +
    '<div class="wsa-diagnostics wsa-operations">' + rows + '</div></section>';
}

function maintenanceDescription(id) {
  if (id === 'export') return 'Create a portable World State bundle.';
  if (id === 'import') return 'Review an import before applying it.';
  if (id === 'rebuild') return 'Reconstruct from chat into an isolated candidate, then replace only after complete success.';
  return 'Permanently clear this chat’s current World State after confirmation.';
}

function maintenanceActionButton(action) {
  return '<button type="button" class="wsa-maintenance-action wsa-tone-' + escapeHtml(action.tone) +
    '" data-wsa-action="' + escapeHtml(action.id) + '">' +
    '<strong>' + escapeHtml(action.label) + '</strong>' +
    '<span>' + escapeHtml(maintenanceDescription(action.id)) + '</span>' +
    '</button>';
}

function maintenanceHtml(model) {
  const exportAction = model.maintenance.actions.find(action => action.id === 'export');
  const importAction = model.maintenance.actions.find(action => action.id === 'import');
  const resetAction = model.maintenance.actions.find(action => action.id === 'reset');
  const healthClass = model.maintenance.recoveryAttention ? ' needs-attention' : '';
  const healthTitle = model.maintenance.recoveryAttention ? 'Recovery attention needed' : 'Continuity healthy';
  const lastCapture = model.maintenance.lastCaptureMessage === null
    ? 'none'
    : 'message ' + model.maintenance.lastCaptureMessage;

  return '<section class="wsa-view wsa-single-pane" aria-label="Data and maintenance">' +
    '<div class="wsa-section-head"><div><h2>Data &amp; maintenance</h2>' +
    '<p>Rebuild does not require Clear. It builds an isolated candidate and replaces canonical state only after full success.</p></div></div>' +
    '<div class="wsa-health' + healthClass + '"><strong>' + healthTitle + '</strong>' +
    '<p>' + escapeHtml(model.maintenance.recoveryMessage) + '</p>' +
    '<small>Last automatic capture: ' + lastCapture + '</small>' +
    (model.maintenance.hydrationSource ? '<small>Hydration source: ' + escapeHtml(model.maintenance.hydrationSource) + '</small>' : '') +
    '</div>' +
    '<div class="wsa-stat-grid">' +
    '<div><b>' + model.counts.total + '</b><span>Total records</span></div>' +
    '<div><b>' + model.counts.current + '</b><span>Current</span></div>' +
    '<div><b>' + model.counts.spatialLocations + '</b><span>Places</span></div>' +
    '<div><b>' + model.counts.evidence + '</b><span>Evidence items</span></div>' +
    '</div>' +
    '<section class="wsa-maintenance-section"><h3>State files</h3><div class="wsa-maintenance-grid">' +
    (exportAction ? maintenanceActionButton(exportAction) : '') +
    (importAction ? maintenanceActionButton(importAction) : '') +
    '</div></section>' +
    '<section class="wsa-maintenance-section"><h3>Recovery</h3>' +
    '<button type="button" class="wsa-maintenance-action wsa-tone-caution" data-wsa-open-rebuild>' +
    '<strong>Rebuild from Chat</strong><span>' + escapeHtml(maintenanceDescription('rebuild')) + '</span></button>' +
    '</section>' +
    '<section class="wsa-maintenance-section wsa-danger-zone"><h3>Danger zone</h3>' +
    (resetAction ? maintenanceActionButton(resetAction) : '') +
    '</section>' +
    '</section>';
}

function tabLabel(tab) {
  if (tab === 'current') return 'Current';
  if (tab === 'recent') return 'Recent';
  if (tab === 'resolved') return 'Resolved';
  if (tab === 'spatial') return 'Places';
  if (tab === 'search') return 'Search';
  if (tab === 'diagnostics') return 'Operations';
  return 'Data';
}

function rebuildStatusHtml(status, { dismissible = true } = {}) {
  if (!status) return '';
  const total = Math.max(0, Number(status.totalBoundaries) || 0);
  const processed = Math.max(0, Number(status.processedBoundaries) || 0);
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((processed / total) * 100))) : 0;
  const cancellable = status.phase === 'running' || status.phase === 'cancelling';
  const tone = status.phase === 'failed' || status.phase === 'cancelled' ? ' error'
    : status.phase === 'completed' ? ' success' : ' running';
  const stateLabel = status.phase === 'committing'
    ? 'Saving rebuilt state…'
    : cancellable
      ? (status.phase === 'cancelling' ? 'Cancelling rebuild…' : 'Rebuilding chat…')
      : status.phase === 'completed' ? 'Rebuild completed'
        : status.phase === 'failed' ? 'Rebuild failed'
          : 'Rebuild ' + (status.phase || 'status');
  return '<aside class="wsa-rebuild-toast' + tone + '" aria-live="polite">' +
    '<div class="wsa-rebuild-toast-icon" aria-hidden="true">' + icon(tone === ' success' ? 'resolved' : tone === ' error' ? 'warn' : 'refresh') + '</div>' +
    '<div class="wsa-rebuild-toast-content"><div class="wsa-rebuild-toast-head"><strong>' + escapeHtml(stateLabel) + '</strong>' +
    (dismissible ? '<button type="button" class="wsa-icon-btn" data-wsa-dismiss-rebuild aria-label="Dismiss rebuild status">' + icon('close') + '</button>' : '') +
    '</div>' +
    '<span>' + escapeHtml(status.detail || '') + '</span>' +
    '<div class="wsa-rebuild-progress"><div style="width:' + percent + '%"></div></div>' +
    '<div class="wsa-rebuild-stats">' +
    '<span>' + processed + '/' + total + ' boundaries</span>' +
    '<span>' + status.providerCalls + ' calls</span>' +
    '<span>' + status.currentRecords + ' current</span>' +
    '<span>' + status.places + ' places</span>' +
    (Number(status.hiddenMessagesIncluded) > 0 ? '<span>' + Number(status.hiddenMessagesIncluded) + ' hidden included</span>' : '') +
    '</div></div>' +
    (cancellable ? '<button type="button" class="wsa-btn wsa-btn-sm" data-wsa-cancel-rebuild>Cancel</button>' : '') +
    '</aside>';
}

function rebuildSheetHtml(model, { open = false, form = {} } = {}) {
  if (!open) return '';
  const rebuild = model.maintenance.rebuild;
  const status = rebuild.status;
  const active = status && ['running', 'cancelling', 'committing'].includes(status.phase);
  const mode = rebuild.bootstrapRequired
    ? 'full'
    : (['full', 'last', 'from'].includes(form.mode) ? form.mode : 'full');
  const startMessageId = Number.isInteger(form.startMessageId) ? form.startMessageId : 0;
  const lastMessages = Number.isInteger(form.lastMessages) ? form.lastMessages : Math.min(20, Math.max(1, rebuild.chatMessages));
  const maxBoundaries = Number.isInteger(form.maxBoundaries) ? form.maxBoundaries : rebuild.defaultMaxBoundaries;
  const includeHiddenMessages = form.includeHiddenMessages !== false;

  const body = active
    ? '<div class="wsa-rebuild-running">' + rebuildStatusHtml(status, { dismissible: false }) +
      '<p class="wsa-muted">The existing canonical state remains authoritative until the entire candidate rebuild succeeds and is persisted.</p></div>'
    : '<form class="wsa-rebuild-form" onsubmit="return false;">' +
      (rebuild.bootstrapRequired
        ? '<div class="wsa-rebuild-safety wsa-bootstrap-safety"><strong>Full rebuild required</strong><p>This chat has history but no durable World State baseline on this session/backend. Partial rebuild cannot prove the missing earlier canonical state.</p></div>'
        : '') +
      '<fieldset><legend>Rebuild source</legend>' +
      '<label class="wsa-radio"><input type="radio" name="wsa-rebuild-mode" value="full" data-wsa-rebuild-mode' + (mode === 'full' ? ' checked' : '') + '><span><strong>Full chat</strong><small>Messages 0 → ' + Math.max(0, rebuild.chatMessages - 1) + '</small></span></label>' +
      '<label class="wsa-radio"><input type="radio" name="wsa-rebuild-mode" value="last" data-wsa-rebuild-mode' + (mode === 'last' ? ' checked' : '') + (rebuild.bootstrapRequired ? ' disabled' : '') + '><span><strong>Last messages</strong><small>Requires exact canonical history before the calculated start.</small></span></label>' +
      '<label class="wsa-inline-field"><span>Last N messages</span><input type="number" min="1" max="' + Math.max(1, rebuild.chatMessages) + '" value="' + lastMessages + '" data-wsa-rebuild-last></label>' +
      '<label class="wsa-radio"><input type="radio" name="wsa-rebuild-mode" value="from" data-wsa-rebuild-mode' + (mode === 'from' ? ' checked' : '') + (rebuild.bootstrapRequired ? ' disabled' : '') + '><span><strong>From message</strong><small>Fails closed if the exact prior canonical boundary is unavailable.</small></span></label>' +
      '<label class="wsa-inline-field"><span>Start message</span><input type="number" min="0" max="' + Math.max(0, rebuild.chatMessages - 1) + '" value="' + startMessageId + '" data-wsa-rebuild-start></label>' +
      '</fieldset>' +
      '<fieldset><legend>Safety &amp; limits</legend>' +
      '<label class="wsa-radio"><input type="checkbox" data-wsa-rebuild-hidden' + (includeHiddenMessages ? ' checked' : '') + '><span><strong>Include hidden chat messages</strong><small>Virtually scans eligible hidden roleplay messages without changing chat visibility or lineage.</small></span></label>' +
      '<label class="wsa-inline-field"><span>Maximum assistant boundaries</span><input type="number" min="1" max="' + rebuild.maxAllowedBoundaries + '" value="' + maxBoundaries + '" data-wsa-rebuild-max></label>' +
      '<div class="wsa-rebuild-scope"><span>Reality / Current State</span><strong>Enabled</strong></div>' +
      '<div class="wsa-rebuild-scope"><span>Places</span><strong>' + (rebuild.spatialEnabled ? 'Enabled' : 'Disabled in settings') + '</strong></div>' +
      '</fieldset>' +
      '<div class="wsa-rebuild-safety"><strong>Atomic replacement</strong><p>Current state is not cleared first. A failed or cancelled rebuild leaves the existing canonical state unchanged.</p></div>' +
      '<div class="wsa-sheet-actions"><button type="button" class="wsa-btn" data-wsa-close-rebuild>Cancel</button>' +
      '<button type="button" class="wsa-btn wsa-btn-primary" data-wsa-start-rebuild>Start Rebuild</button></div>' +
      '</form>';

  return '<div class="wsa-sheet-layer" data-wsa-rebuild-sheet><button type="button" class="wsa-sheet-backdrop" data-wsa-close-rebuild aria-label="Close rebuild settings"></button>' +
    '<section class="wsa-rebuild-sheet" role="dialog" aria-modal="true" aria-label="Rebuild from Chat">' +
    '<div class="wsa-sheet-handle" aria-hidden="true"></div><header><div><p class="wsa-eyebrow">Recovery</p><h2>Rebuild from Chat</h2>' +
    '<span>' + rebuild.chatMessages + ' messages · ' + rebuild.assistantBoundaries + ' assistant boundaries</span></div>' +
    '<button type="button" class="wsa-icon-btn wsa-close" data-wsa-close-rebuild aria-label="Close rebuild settings">' + icon('close') + '</button></header>' +
    body + '</section></div>';
}

const WORLD_RECORD_TABS = Object.freeze(['current', 'recent', 'resolved', 'search']);

function menuItem(attributes, iconName, label, hint = '') {
  return '<button type="button" class="wsa-menu-item" role="menuitem" ' + attributes + '>' + icon(iconName) +
    '<span>' + escapeHtml(label) + '</span>' + (hint ? '<small>' + escapeHtml(hint) + '</small>' : '') + '</button>';
}

function actionMenuItems(model) {
  return '<p class="wsa-menu-label">Maintenance</p>' +
    menuItem('data-wsa-open-rebuild', 'refresh', 'Rebuild from chat…') +
    menuItem('data-wsa-tab="diagnostics"', 'list', tabLabel('diagnostics'), model.diagnostics.length ? String(model.diagnostics.length) : '') +
    menuItem('data-wsa-tab="maintenance"', 'data', 'Data & maintenance') +
    '<div class="wsa-menu-sep" role="separator"></div>' +
    '<p class="wsa-menu-label">Map</p>' +
    menuItem('data-wsa-open-map-settings', 'compass', 'Map settings', model.spatial.hasBaseMap ? 'base map' : 'manual');
}

function actionMenuHtml(model, open) {
  return '<div class="wsa-menu" role="menu" aria-label="More World State actions"' + (open ? '' : ' hidden') + '>' +
    actionMenuItems(model) + '</div>';
}

function mobileNavigation(activeTab, moreOpen, model) {
  const primary = [
    ['current', 'World', 'world', ['current', 'recent', 'resolved']],
    ['spatial', 'Places', 'pin', ['spatial']],
    ['search', 'Search', 'search', ['search']],
  ];
  const buttons = primary.map(([id, label, iconName, owns]) =>
    '<button type="button" class="wsa-mobile-nav-btn' + (owns.includes(activeTab) ? ' is-active' : '') +
    '" data-wsa-tab="' + id + '">' + icon(iconName) + '<span>' + label + '</span></button>'
  ).join('');
  const moreActive = moreOpen || ['diagnostics', 'maintenance'].includes(activeTab);
  const more = '<button type="button" class="wsa-mobile-nav-btn' + (moreActive ? ' is-active' : '') +
    '" data-wsa-mobile-more aria-expanded="' + (moreOpen ? 'true' : 'false') + '">' + icon('more') + '<span>More</span></button>';
  const menu = moreOpen
    ? '<div class="wsa-mobile-more-menu wsa-menu" role="menu">' + actionMenuItems(model) + '</div>'
    : '';
  return '<nav class="wsa-mobile-nav" aria-label="World State mobile navigation">' + buttons + more + menu + '</nav>';
}

function bootstrapRecoveryBannerHtml(model) {
  if (!model?.maintenance?.bootstrapRequired) return '';
  const source = model.maintenance.hydrationSource
    ? ' Hydration source: ' + model.maintenance.hydrationSource + '.'
    : '';
  return '<aside class="wsa-bootstrap-warning" aria-live="polite">' +
    '<div><strong>Durable World State not found</strong><span>Automatic continuity is paused so this session cannot silently start from scratch.' +
    escapeHtml(source) + '</span></div>' +
    '<button type="button" class="wsa-btn wsa-btn-sm wsa-btn-accent" data-wsa-open-rebuild>Full rebuild</button>' +
    '</aside>';
}

function continuityIconHtml() {
  return '<span class="wsa-brand-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 48 48" focusable="false"><circle cx="24" cy="24" r="15"></circle>' +
    '<path d="M12 19l8-7 11 3 6 9-5 10-12 2-9-8z"></path>' +
    '<circle cx="20" cy="12" r="2.5"></circle><circle cx="31" cy="15" r="2.5"></circle>' +
    '<circle cx="37" cy="24" r="2.5"></circle><circle cx="32" cy="34" r="2.5"></circle>' +
    '<circle cx="20" cy="36" r="2.5"></circle><circle cx="11" cy="28" r="2.5"></circle></svg></span>';
}

function navTab(tab, label, active, count = null) {
  return '<button type="button" class="wsa-tab' + (active ? ' is-active' : '') +
    '" data-wsa-tab="' + tab + '" role="tab" aria-selected="' + (active ? 'true' : 'false') + '">' +
    label + (count === null ? '' : '<span class="wsa-tab-count">' + count + '</span>') + '</button>';
}

function statusBarHtml(model) {
  const attention = model.maintenance.recoveryAttention;
  const capture = model.maintenance.lastCaptureMessage === null
    ? 'no automatic capture yet'
    : 'last capture msg ' + model.maintenance.lastCaptureMessage;
  return '<footer class="wsa-statusbar">' +
    '<span class="wsa-status-dot' + (attention ? ' is-warn' : '') + '" aria-hidden="true"></span>' +
    '<span>' + (attention ? 'Recovery attention needed' : 'Continuity healthy') + ' · ' + escapeHtml(capture) + '</span>' +
    '<span class="wsa-statusbar-note">Private continuity context — not character knowledge</span>' +
    '</footer>';
}

export function renderWorldStatePanel(model, {
  activeTab = 'current',
  detailOpen = false,
  spatialDetailOpen = false,
  spatialEditing = false,
  mapSettingsOpen = false,
  menuOpen = false,
  mobileMoreOpen = false,
  rebuildOpen = false,
  rebuildForm = {},
  dismissedRebuildOperationId = '',
} = {}) {
  const tab = WORLD_STATE_UI_TABS.includes(activeTab) ? activeTab : 'current';
  const isWorld = WORLD_RECORD_TABS.includes(tab);
  const tabs = navTab('current', 'World', isWorld, model.counts.current) +
    navTab('spatial', 'Places', tab === 'spatial', model.counts.spatialLocations) +
    (['diagnostics', 'maintenance'].includes(tab) ? navTab(tab, tabLabel(tab), true) : '');

  let body;
  if (tab === 'spatial') body = spatialViewHtml(model, { detailOpen: spatialDetailOpen, editing: spatialEditing, mapSettingsOpen });
  else if (tab === 'diagnostics') body = diagnosticsHtml(model);
  else if (tab === 'maintenance') body = maintenanceHtml(model);
  else body = recordsViewHtml(model, tab, { detailOpen });

  const rebuildStatus = model.maintenance.rebuild.status;
  const showStatus = rebuildStatus && rebuildStatus.operationId !== dismissedRebuildOperationId;
  const historical = model.counts.resolved + model.counts.superseded;
  return '<div class="wsa-shell" data-world-state-alpha-ui>' +
    '<div class="wsa-backdrop" data-wsa-close aria-hidden="true"></div>' +
    '<section class="wsa-panel" role="dialog" aria-modal="true" aria-label="World State">' +
    '<header class="wsa-header"><div class="wsa-brand">' + continuityIconHtml() + '<div class="wsa-brand-copy"><h1>World continuity</h1>' +
    '<span><b>' + model.counts.current + '</b> active · <b>' + historical + '</b> resolved · <b>' + model.counts.spatialLocations + '</b> places</span></div></div>' +
    '<div class="wsa-header-actions">' +
    '<button type="button" class="wsa-icon-btn wsa-header-rebuild" data-wsa-open-rebuild aria-label="Rebuild from chat" title="Rebuild from chat">' + icon('refresh') + '</button>' +
    '<button type="button" class="wsa-icon-btn wsa-menu-toggle' + (menuOpen ? ' is-active' : '') + '" data-wsa-menu-toggle aria-haspopup="menu" aria-expanded="' +
    (menuOpen ? 'true' : 'false') + '" aria-label="More actions" title="More actions">' + icon('more') + '</button>' +
    '<button type="button" class="wsa-icon-btn wsa-close" data-wsa-close aria-label="Close World State" title="Close">' + icon('close') + '</button>' +
    actionMenuHtml(model, menuOpen) +
    '</div></header>' +
    (showStatus ? rebuildStatusHtml(rebuildStatus) : '') +
    bootstrapRecoveryBannerHtml(model) +
    '<nav class="wsa-tabs" role="tablist" aria-label="World State views">' + tabs +
    '<label class="wsa-input-icon wsa-nav-search">' + icon('search') + '<input type="search" data-wsa-search value="' +
    escapeHtml(model.search.query) + '" autocomplete="off" spellcheck="false" placeholder="Search records…" aria-label="Search world state records"></label>' +
    '</nav>' +
    '<main class="wsa-body">' + body + '</main>' +
    (tab === 'spatial' ? '' : statusBarHtml(model)) +
    mobileNavigation(tab, mobileMoreOpen, model) +
    '</section>' +
    rebuildSheetHtml(model, { open: rebuildOpen, form: rebuildForm }) +
    '</div>';
}

export function createWorldStateUiController({
  root,
  getState,
  getBaseMap = () => null,
  getDiagnostics = () => [],
  getRuntimeInfo = () => ({}),
  onMaintenanceAction = null,
  onRecordAction = null,
  onSpatialAction = null,
  onClose = null,
  initialTab = 'current',
} = {}) {
  if (!root || typeof root.addEventListener !== 'function') throw new Error('UI root element is required');
  if (typeof getState !== 'function') throw new Error('getState function is required');

  const ui = {
    activeTab: WORLD_STATE_UI_TABS.includes(initialTab) ? initialTab : 'current',
    query: '',
    selectedRecordId: '',
    selectedSpatialKey: '',
    spatialSearch: '',
    detailOpen: false,
    spatialDetailOpen: false,
    spatialEditing: false,
    spatialDuplicatesOnly: false,
    mapSettingsOpen: false,
    menuOpen: false,
    mobileMoreOpen: false,
    rebuildOpen: false,
    dismissedRebuildOperationId: '',
    rebuildForm: {
      mode: 'full',
      startMessageId: 0,
      lastMessages: 20,
      maxBoundaries: null,
      includeHiddenMessages: true,
    },
    destroyed: false,
  };

  function model() {
    return buildWorldStateUiModel(getState(), {
      diagnostics: getDiagnostics(),
      query: ui.query,
      selectedRecordId: ui.selectedRecordId,
      activeView: ui.activeTab,
      baseMap: typeof getBaseMap === 'function' ? getBaseMap() : null,
      selectedSpatialKey: ui.selectedSpatialKey,
      spatialSearch: ui.spatialSearch,
      spatialDuplicatesOnly: ui.spatialDuplicatesOnly,
      runtimeInfo: typeof getRuntimeInfo === 'function' ? getRuntimeInfo() : {},
    });
  }

  function refresh({ restoreSearchFocus = false, restoreSpatialFocus = false } = {}) {
    if (ui.destroyed) return null;
    const next = model();
    const liveOperationId = next.maintenance.rebuild.status?.operationId || '';
    if (ui.dismissedRebuildOperationId && liveOperationId && liveOperationId !== ui.dismissedRebuildOperationId) {
      ui.dismissedRebuildOperationId = '';
    }
    ui.selectedRecordId = next.selectedRecordId;
    ui.selectedSpatialKey = next.spatial.selectedKey;
    if (!Number.isInteger(ui.rebuildForm.maxBoundaries)) {
      ui.rebuildForm.maxBoundaries = next.maintenance.rebuild.defaultMaxBoundaries;
    }
    ui.rebuildForm.lastMessages = Math.max(
      1,
      Math.min(
        Number(ui.rebuildForm.lastMessages) || 20,
        Math.max(1, next.maintenance.rebuild.chatMessages),
      ),
    );
    root.innerHTML = renderWorldStatePanel(next, {
      activeTab: ui.activeTab,
      detailOpen: ui.detailOpen,
      spatialDetailOpen: ui.spatialDetailOpen,
      spatialEditing: ui.spatialEditing,
      mapSettingsOpen: ui.mapSettingsOpen,
      menuOpen: ui.menuOpen,
      mobileMoreOpen: ui.mobileMoreOpen,
      rebuildOpen: ui.rebuildOpen,
      rebuildForm: ui.rebuildForm,
      dismissedRebuildOperationId: ui.dismissedRebuildOperationId,
    });

    if (restoreSearchFocus) {
      const inputs = [...(root.querySelectorAll?.('[data-wsa-search]') || [])];
      const input = inputs.find(item => typeof item.getClientRects !== 'function' || item.getClientRects().length > 0) || inputs[0];
      input?.focus?.();
      if (input && typeof input.setSelectionRange === 'function') {
        const length = String(input.value || '').length;
        input.setSelectionRange(length, length);
      }
    }
    if (restoreSpatialFocus && ui.activeTab === 'spatial') {
      const input = root.querySelector?.('[data-wsa-spatial-search]');
      input?.focus?.();
      if (input && typeof input.setSelectionRange === 'function') {
        const length = String(input.value || '').length;
        input.setSelectionRange(length, length);
      }
    }
    return next;
  }

  function closest(target, selector) {
    return target && typeof target.closest === 'function' ? target.closest(selector) : null;
  }

  function selectedRecordRows(currentModel) {
    return ui.activeTab === 'recent'
      ? currentModel.views.recent
      : ui.activeTab === 'resolved'
        ? currentModel.views.resolved
        : ui.activeTab === 'search'
          ? currentModel.views.search
          : currentModel.views.current;
  }

  async function copyOperationJson(button) {
    const index = Number(button?.dataset?.wsaDiagnosticIndex);
    const kind = clean(button?.dataset?.wsaCopyJson, 20);
    const currentModel = model();
    const row = Number.isInteger(index) && index >= 0 ? currentModel.diagnostics[index] : null;
    const value = kind === 'rejections' ? row?.rejectionsJson : row?.responseJson;
    if (!value) return;
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(value);
      button.textContent = 'Copied';
      return;
    }
    const textarea = globalThis.document?.createElement?.('textarea');
    if (!textarea) return;
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    globalThis.document.body.appendChild(textarea);
    textarea.select();
    globalThis.document.execCommand?.('copy');
    textarea.remove();
    button.textContent = 'Copied';
  }

  async function click(event) {
    if (closest(event.target, '[data-wsa-menu-toggle]')) {
      ui.menuOpen = !ui.menuOpen;
      ui.mobileMoreOpen = false;
      refresh();
      return;
    }

    if ((ui.menuOpen || ui.mobileMoreOpen)
      && !closest(event.target, '.wsa-menu')
      && !closest(event.target, '[data-wsa-mobile-more]')) {
      ui.menuOpen = false;
      ui.mobileMoreOpen = false;
      if (!closest(event.target, 'button, summary, input, select, textarea, label')) {
        refresh();
        return;
      }
    }

    if (closest(event.target, '[data-wsa-close]')) {
      if (typeof onClose === 'function') onClose();
      return;
    }

    if (closest(event.target, '[data-wsa-close-rebuild]')) {
      ui.rebuildOpen = false;
      refresh();
      return;
    }

    if (closest(event.target, '[data-wsa-open-rebuild]')) {
      ui.rebuildOpen = true;
      ui.menuOpen = false;
      ui.mobileMoreOpen = false;
      refresh();
      return;
    }

    if (closest(event.target, '[data-wsa-open-map-settings]')) {
      ui.activeTab = 'spatial';
      ui.mapSettingsOpen = true;
      ui.menuOpen = false;
      ui.mobileMoreOpen = false;
      refresh();
      return;
    }

    if (closest(event.target, '[data-wsa-map-settings]')) {
      event.preventDefault?.();
      ui.mapSettingsOpen = !ui.mapSettingsOpen;
      refresh();
      return;
    }

    if (closest(event.target, '[data-wsa-clear-search]')) {
      ui.query = '';
      ui.activeTab = 'current';
      ui.detailOpen = false;
      refresh();
      return;
    }

    if (closest(event.target, '[data-wsa-spatial-dups]')) {
      ui.spatialDuplicatesOnly = !ui.spatialDuplicatesOnly;
      ui.spatialEditing = false;
      refresh();
      return;
    }

    if (closest(event.target, '[data-wsa-spatial-edit]')) {
      ui.spatialEditing = true;
      ui.spatialDetailOpen = true;
      refresh();
      return;
    }

    if (closest(event.target, '[data-wsa-spatial-cancel-edit]')) {
      ui.spatialEditing = false;
      refresh();
      return;
    }

    const openRecord = closest(event.target, '[data-wsa-open-record]');
    if (openRecord) {
      const key = clean(openRecord.dataset?.wsaOpenRecord, 120);
      const currentModel = model();
      const inCurrent = currentModel.views.current.some(row => row.key === key);
      ui.activeTab = inCurrent ? 'current' : 'resolved';
      ui.selectedRecordId = key;
      ui.detailOpen = true;
      refresh();
      return;
    }

    if (closest(event.target, '[data-wsa-mobile-more]')) {
      ui.mobileMoreOpen = !ui.mobileMoreOpen;
      ui.menuOpen = false;
      refresh();
      return;
    }

    if (closest(event.target, '[data-wsa-back-list]')) {
      if (ui.activeTab === 'spatial') {
        ui.spatialDetailOpen = false;
        ui.spatialEditing = false;
      }
      else ui.detailOpen = false;
      refresh();
      return;
    }

    const copy = closest(event.target, '[data-wsa-copy-json]');
    if (copy) {
      await copyOperationJson(copy);
      return;
    }

    if (closest(event.target, '[data-wsa-dismiss-rebuild]')) {
      const currentModel = model();
      ui.dismissedRebuildOperationId = currentModel.maintenance.rebuild.status?.operationId || '';
      refresh();
      return;
    }

    if (closest(event.target, '[data-wsa-cancel-rebuild]')) {
      if (typeof onMaintenanceAction === 'function') await onMaintenanceAction('cancel_rebuild', {});
      refresh();
      return;
    }

    if (closest(event.target, '[data-wsa-start-rebuild]')) {
      const form = root.querySelector?.('.wsa-rebuild-form');
      const checkedMode = form?.querySelector?.('[data-wsa-rebuild-mode]:checked')?.value;
      const startInput = form?.querySelector?.('[data-wsa-rebuild-start]');
      const lastInput = form?.querySelector?.('[data-wsa-rebuild-last]');
      const maxInput = form?.querySelector?.('[data-wsa-rebuild-max]');
      const hiddenInput = form?.querySelector?.('[data-wsa-rebuild-hidden]');
      const currentModel = model();
      const maxAllowed = currentModel.maintenance.rebuild.maxAllowedBoundaries;
      const chatMessages = currentModel.maintenance.rebuild.chatMessages;
      const mode = ['full', 'last', 'from'].includes(checkedMode) ? checkedMode : ui.rebuildForm.mode;
      const startMessageId = Math.max(0, Math.min(
        Math.max(0, chatMessages - 1),
        Number.isFinite(Number(startInput?.value)) ? Math.trunc(Number(startInput.value)) : 0,
      ));
      const lastMessages = Math.max(1, Math.min(
        Math.max(1, chatMessages),
        Number.isFinite(Number(lastInput?.value)) ? Math.trunc(Number(lastInput.value)) : 20,
      ));
      const maxBoundaries = Math.max(1, Math.min(
        maxAllowed,
        Number.isFinite(Number(maxInput?.value))
          ? Math.trunc(Number(maxInput.value))
          : currentModel.maintenance.rebuild.defaultMaxBoundaries,
      ));
      const includeHiddenMessages = hiddenInput ? Boolean(hiddenInput.checked) : ui.rebuildForm.includeHiddenMessages !== false;
      ui.rebuildForm = { mode, startMessageId, lastMessages, maxBoundaries, includeHiddenMessages };
      if (typeof onMaintenanceAction === 'function') {
        await onMaintenanceAction('rebuild', { rebuild: { ...ui.rebuildForm } });
      }
      refresh();
      return;
    }

    const tab = closest(event.target, '[data-wsa-tab]');
    if (tab) {
      const nextTab = clean(tab.dataset?.wsaTab, 20);
      if (WORLD_STATE_UI_TABS.includes(nextTab)) {
        ui.activeTab = nextTab;
        ui.menuOpen = false;
        ui.mobileMoreOpen = false;
        ui.detailOpen = false;
        ui.spatialDetailOpen = false;
        ui.spatialEditing = false;
        refresh();
      }
      return;
    }

    const record = closest(event.target, '[data-wsa-record-index]');
    if (record) {
      const index = Number(record.dataset?.wsaRecordIndex);
      const currentModel = model();
      const rows = selectedRecordRows(currentModel);
      if (Number.isInteger(index) && index >= 0 && rows[index]?.key) {
        const same = ui.selectedRecordId === rows[index].key;
        ui.selectedRecordId = rows[index].key;
        ui.detailOpen = same ? !ui.detailOpen : true;
        refresh();
      }
      return;
    }

    const recordAction = closest(event.target, '[data-wsa-record-action]');
    if (recordAction && typeof onRecordAction === 'function') {
      const action = clean(recordAction.dataset?.wsaRecordAction, 24);
      if (!['resolve', 'supersede'].includes(action)) return;
      const currentModel = model();
      const currentRecord = currentModel.detail;
      if (!currentRecord || currentRecord.status !== 'active') return;
      await onRecordAction(action, {
        record: {
          key: currentRecord.key,
          kind: currentRecord.kind,
          status: currentRecord.status,
          summary: currentRecord.summary,
          createdAtMessage: currentRecord.createdAtMessage,
          lastChangedMessage: currentRecord.lastChangedMessage,
        },
      });
      refresh();
      return;
    }

    const spatialBtn = closest(event.target, '[data-wsa-spatial-key]');
    if (spatialBtn) {
      const key = spatialBtn.dataset?.wsaSpatialKey;
      if (key) {
        if (key !== ui.selectedSpatialKey) ui.spatialEditing = false;
        ui.selectedSpatialKey = key;
        ui.spatialDetailOpen = true;
        refresh();
      }
      return;
    }

    const spatialAction = closest(event.target, '[data-wsa-spatial-action]');
    if (spatialAction && typeof onSpatialAction === 'function') {
      const action = clean(spatialAction.dataset?.wsaSpatialAction, 40);
      const currentModel = model();

      if (action === 'save_profile' || action === 'reset_profile') {
        const profileForm = root.querySelector?.('.wsa-spatial-profile-form');
        const profileValue = field => profileForm?.querySelector?.('[data-wsa-profile-field="' + field + '"]')?.value;
        const optionalNumber = field => {
          const raw = profileValue(field);
          if (raw === undefined || raw === '') return null;
          return Number(raw);
        };
        const trueNorthInput = profileForm?.querySelector?.('[data-wsa-profile-field="trueNorthLocked"]');
        const xMin = optionalNumber('xMin');
        const xMax = optionalNumber('xMax');
        const yMin = optionalNumber('yMin');
        const yMax = optionalNumber('yMax');
        const anyBounds = [xMin, xMax, yMin, yMax].some(value => value !== null);
        const profileData = action === 'save_profile' ? {
          system: 'cartesian2d',
          northAxis: profileValue('northAxis') || '+y',
          eastAxis: profileValue('eastAxis') || '+x',
          unitKm: optionalNumber('unitKm'),
          decimalStep: optionalNumber('decimalStep'),
          bounds: anyBounds ? { xMin, xMax, yMin, yMax } : null,
          trueNorthLocked: Boolean(trueNorthInput?.checked),
        } : null;

        await onSpatialAction(action, {
          profileData,
          spatialModel: currentModel.spatial,
        });
        refresh();
        return;
      }

      const currentLoc = currentModel.spatial.detail;
      const form = root.querySelector?.('.wsa-spatial-form');
      const getVal = field => form?.querySelector?.('[data-wsa-field="' + field + '"]')?.value;
      const lockedInput = form?.querySelector?.('[data-wsa-field="locked"]');
      const formData = {
        name: getVal('name') || currentLoc?.name || '',
        type: getVal('type') || currentLoc?.type || '',
        x: getVal('x') !== undefined && getVal('x') !== '' ? Number(getVal('x')) : null,
        y: getVal('y') !== undefined && getVal('y') !== '' ? Number(getVal('y')) : null,
        authority: getVal('authority') || currentLoc?.authority || 'manual',
        locked: Boolean(lockedInput?.checked),
        context: getVal('context') !== undefined ? getVal('context') : (currentLoc?.context || ''),
        routeRefs: (getVal('routeRefs') || '').split(',').map(s => s.trim()).filter(Boolean),
        notes: getVal('notes') !== undefined ? getVal('notes') : (currentLoc?.notes || ''),
        relativeAnchor: getVal('relativeAnchor') || '',
        direction: getVal('direction') || '',
        distanceKm: getVal('distanceKm') !== undefined && getVal('distanceKm') !== '' ? Number(getVal('distanceKm')) : null,
        distanceMode: getVal('distanceMode') || 'unspecified',
        relationId: currentLoc?.primaryRelation?.id || '',
      };

      await onSpatialAction(action, {
        location: currentLoc,
        formData,
        mergeSuggestions: action === 'merge_location' ? [...(currentLoc?.duplicateNames || [])] : [],
        spatialModel: currentModel.spatial,
      });
      if (['save_location', 'archive_location', 'merge_location', 'delete_location'].includes(action)) ui.spatialEditing = false;
      refresh();
      return;
    }

    const action = closest(event.target, '[data-wsa-action]');
    if (action && typeof onMaintenanceAction === 'function') {
      const actionId = clean(action.dataset?.wsaAction, 32);
      if (!WORLD_STATE_UI_MAINTENANCE_ACTIONS.some(item => item.id === actionId)) return;
      const currentModel = model();
      await onMaintenanceAction(actionId, {
        counts: { ...currentModel.counts },
        recoveryAttention: currentModel.maintenance.recoveryAttention,
        lastCaptureMessage: currentModel.maintenance.lastCaptureMessage,
      });
      refresh();
    }
  }

  function input(event) {
    const search = closest(event.target, '[data-wsa-search]');
    if (search) {
      ui.query = clean(search.value, 500);
      if (ui.query && ui.activeTab !== 'search') {
        ui.activeTab = 'search';
        ui.detailOpen = false;
      } else if (!ui.query && ui.activeTab === 'search') {
        ui.activeTab = 'current';
        ui.detailOpen = false;
      }
      refresh({ restoreSearchFocus: true });
      return;
    }

    const spatialSearch = closest(event.target, '[data-wsa-spatial-search]');
    if (spatialSearch) {
      ui.spatialSearch = clean(spatialSearch.value, 120);
      refresh({ restoreSpatialFocus: true });
      return;
    }

    const northAxis = closest(event.target, '[data-wsa-profile-field="northAxis"]');
    if (northAxis) {
      const eastAxis = root.querySelector?.('[data-wsa-profile-field="eastAxis"]');
      if (eastAxis) {
        const perpendicular = {
          '+y': new Set(['+x', '-x']),
          '-y': new Set(['+x', '-x']),
          '+x': new Set(['+y', '-y']),
          '-x': new Set(['+y', '-y']),
        };
        const fallback = { '+y': '+x', '-y': '-x', '+x': '-y', '-x': '+y' };
        if (!perpendicular[northAxis.value]?.has(eastAxis.value)) {
          eastAxis.value = fallback[northAxis.value] || '+x';
        }
      }
      return;
    }

    const mode = closest(event.target, '[data-wsa-rebuild-mode]');
    if (mode) {
      ui.rebuildForm.mode = ['full', 'last', 'from'].includes(mode.value) ? mode.value : 'full';
      return;
    }

    const startInput = closest(event.target, '[data-wsa-rebuild-start]');
    if (startInput) {
      ui.rebuildForm.startMessageId = Math.max(0, Math.trunc(Number(startInput.value) || 0));
      return;
    }
    const lastInput = closest(event.target, '[data-wsa-rebuild-last]');
    if (lastInput) {
      ui.rebuildForm.lastMessages = Math.max(1, Math.trunc(Number(lastInput.value) || 1));
      return;
    }
    const maxInput = closest(event.target, '[data-wsa-rebuild-max]');
    if (maxInput) {
      ui.rebuildForm.maxBoundaries = Math.max(1, Math.trunc(Number(maxInput.value) || 1));
      return;
    }

    const hiddenInput = closest(event.target, '[data-wsa-rebuild-hidden]');
    if (hiddenInput) {
      ui.rebuildForm.includeHiddenMessages = Boolean(hiddenInput.checked);
    }
  }

  root.addEventListener('click', click);
  root.addEventListener('input', input);
  refresh();

  return Object.freeze({
    refresh,
    getUiState() {
      return {
        activeTab: ui.activeTab,
        query: ui.query,
        spatialSearch: ui.spatialSearch,
        hasSelection: Boolean(ui.selectedRecordId),
        hasSpatialSelection: Boolean(ui.selectedSpatialKey),
        detailOpen: ui.detailOpen,
        spatialDetailOpen: ui.spatialDetailOpen,
        spatialEditing: ui.spatialEditing,
        spatialDuplicatesOnly: ui.spatialDuplicatesOnly,
        mapSettingsOpen: ui.mapSettingsOpen,
        menuOpen: ui.menuOpen,
        mobileMoreOpen: ui.mobileMoreOpen,
        rebuildOpen: ui.rebuildOpen,
        dismissedRebuildOperationId: ui.dismissedRebuildOperationId,
        rebuildForm: { ...ui.rebuildForm },
        destroyed: ui.destroyed,
      };
    },
    destroy() {
      if (ui.destroyed) return;
      ui.destroyed = true;
      root.removeEventListener('click', click);
      root.removeEventListener('input', input);
      if (typeof root.replaceChildren === 'function') root.replaceChildren();
      else root.innerHTML = '';
    },
  });
}
