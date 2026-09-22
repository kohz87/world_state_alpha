import { sanitizeCaptureDiagnostic } from './diagnostics.js';
import { inspectWorldStateRecord, queryWorldState } from './manual.js';
import { clone, normalizeState } from './state-core.js';
import { resolveEffectiveLocations, resolveEffectiveRoutes } from './spatial-core.js';

export const WORLD_STATE_UI_NAMESPACE = 'world_state_alpha_ui';

export const WORLD_STATE_UI_LIMITS = Object.freeze({
  currentRecords: 120,
  recentRecords: 40,
  resolvedRecords: 80,
  searchRecords: 100,
  spatialLocations: 200,
  diagnostics: 40,
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
  Object.freeze({ id: 'reset', label: 'Reset World State', tone: 'danger' }),
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
        at: item.at,
        label: clean(item.label, 48),
        sourceMessageId: item.sourceMessageId,
        outcome: clean(item.outcome, 48) || 'unknown',
        code: clean(item.code, 80),
        detail: clean(item.detail, 320),
        route: clean(item.route, 24),
        providerCalls: item.providerCalls,
        proposed: item.proposed,
        accepted: item.accepted,
        applied: item.applied,
        rejected: item.rejected,
        aliasRepairs: item.aliasRepairs,
        processedBoundaries: item.processedBoundaries,
        totalBoundaries: item.totalBoundaries,
        candidateRecords: item.candidateRecords,
        promptChars: item.promptChars,
        responseChars: item.responseChars,
        durationMs: item.durationMs,
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
      .filter(item => item.id !== loc.id)
      .slice(0, WORLD_STATE_UI_LIMITS.spatialLocations)
      .map(item => ({ id: clean(item.id, 120), name: clean(item.name, 120) })),
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
  const effectiveLocations = resolveEffectiveLocations(normalized.spatial, baseMap);
  const spatialKeyByLocId = new Map(effectiveLocations.map((loc, index) => [loc.id, 'sloc-' + index]));
  const locBySpatialKey = new Map(effectiveLocations.map((loc, index) => ['sloc-' + index, loc]));

  const spatialNeedle = clean(spatialSearch, 120).toLowerCase();
  const allSpatialProjected = effectiveLocations.map((loc, index) =>
    projectSpatialLocation(loc, 'sloc-' + index),
  );

  const filteredSpatial = spatialNeedle
    ? allSpatialProjected.filter(l => l.name.toLowerCase().includes(spatialNeedle)
      || l.type.toLowerCase().includes(spatialNeedle)
      || l.context.toLowerCase().includes(spatialNeedle))
    : allSpatialProjected;

  const boundedSpatial = filteredSpatial.slice(0, WORLD_STATE_UI_LIMITS.spatialLocations);

  const activeSpatialKey = selectedSpatialKey && locBySpatialKey.has(selectedSpatialKey)
    ? selectedSpatialKey
    : boundedSpatial[0]?.key || '';

  const selectedLoc = activeSpatialKey ? locBySpatialKey.get(activeSpatialKey) : null;
  const spatialDetail = selectedLoc ? projectSpatialDetail(normalized.spatial, selectedLoc, baseMap, activeSpatialKey) : null;

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
    spatial: {
      locations: boundedSpatial,
      totalCount: effectiveLocations.length,
      filteredCount: filteredSpatial.length,
      search: spatialSearch,
      selectedKey: activeSpatialKey,
      detail: spatialDetail,
      baseMapName: baseMap?.name || normalized.spatial.baseMapRef?.name || 'None',
      baseMapVersion: baseMap?.version || normalized.spatial.baseMapRef?.version || '',
      hasBaseMap: Boolean(baseMap || normalized.spatial.baseMapRef),
      profile: normalized.spatial.profile,
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
      recoveryAttention: Boolean(normalized.recoveryRequired),
      recoveryMessage: normalized.recoveryRequired
        ? 'Branch recovery needs attention. Review the current chat branch before choosing rebuild.'
        : 'Branch continuity is healthy.',
      lastCaptureMessage: integer(normalized.lastCaptureMessage),
      actions: WORLD_STATE_UI_MAINTENANCE_ACTIONS.map(item => ({ ...item })),
    },
  };
}

function pill(label, className) {
  if (!label) return '';
  return '<span class="wsa-pill ' + escapeHtml(className || '') + '">' + escapeHtml(label) + '</span>';
}

function recordCard(record, selected, index) {
  const meta = [
    pill(record.kindLabel, 'wsa-kind'),
    pill(record.statusLabel, 'wsa-status-' + record.status),
    record.trendLabel ? pill(record.trendLabel, 'wsa-trend') : '',
  ].filter(Boolean).join('');
  const changed = record.lastChangedMessage === null
    ? ''
    : '<small>Changed at message ' + record.lastChangedMessage + '</small>';
  return '<button type="button" class="wsa-record' + (selected ? ' is-selected' : '') +
    '" data-wsa-record-index="' + index + '" aria-pressed="' + (selected ? 'true' : 'false') + '">' +
    '<span class="wsa-record-meta">' + meta + '</span>' +
    '<strong>' + escapeHtml(record.summary || 'Untitled world state') + '</strong>' +
    changed +
    '</button>';
}

function spatialCard(loc, selected, key) {
  const sourcePill = loc.isBase
    ? (loc.isOverridden ? pill('Override', 'wsa-source-override') : pill('Base', 'wsa-source-base'))
    : pill('Campaign', 'wsa-source-campaign');

  const meta = [
    pill(loc.type, 'wsa-kind'),
    sourcePill,
    pill(loc.authorityLabel, 'wsa-auth'),
  ].join('');

  return '<button type="button" class="wsa-record' + (selected ? ' is-selected' : '') +
    '" data-wsa-spatial-key="' + escapeHtml(key) + '" aria-pressed="' + (selected ? 'true' : 'false') + '">' +
    '<span class="wsa-record-meta">' + meta + '</span>' +
    '<strong>' + escapeHtml(loc.name) + '</strong>' +
    '<small>' + escapeHtml(loc.coordText) + (loc.context ? ' · ' + escapeHtml(loc.context.slice(0, 80)) : '') + '</small>' +
    '</button>';
}

function emptyState(title, body) {
  return '<div class="wsa-empty"><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(body) + '</p></div>';
}

function recordsPane(records, model, emptyTitle, emptyBody, truncated) {
  const rows = records.length
    ? records.map((record, index) => recordCard(record, record.key === model.selectedRecordId, index)).join('')
    : emptyState(emptyTitle, emptyBody);
  const note = truncated > 0
    ? '<p class="wsa-list-note">' + truncated + ' additional records are hidden from this bounded view. Use Search to narrow the list.</p>'
    : '';
  return '<div class="wsa-record-list" role="list">' + rows + note + '</div>';
}

function messageValue(value) {
  return value === null || value === undefined ? 'Not recorded' : 'Message ' + value;
}

function detailHtml(detail) {
  if (!detail) return emptyState('No record selected', 'Choose a record to inspect its current state and evidence.');

  const anchors = detail.anchors.length
    ? '<div class="wsa-chip-row">' + detail.anchors.map(anchor => '<span class="wsa-chip">' + escapeHtml(anchor) + '</span>').join('') + '</div>'
    : '<p class="wsa-muted">No anchors recorded.</p>';

  const evidence = detail.evidence.length
    ? '<div class="wsa-evidence-list">' + detail.evidence.map(item => {
      const sourceMessage = item.sourceMessageId === null ? 'No local message' : 'Message ' + item.sourceMessageId;
      const time = item.timeAnchor ? '<small>Time: ' + escapeHtml(item.timeAnchor) + '</small>' : '';
      return '<article class="wsa-evidence">' +
        '<div class="wsa-evidence-head"><strong>' + escapeHtml(item.source) + '</strong><span>' + sourceMessage + '</span></div>' +
        '<p>' + escapeHtml(item.claim || 'Evidence claim not retained.') + '</p>' +
        time +
        '</article>';
    }).join('') + '</div>'
    : '<p class="wsa-muted">No bounded evidence is attached to this record.</p>';

  const relations = detail.relations.length
    ? '<ul class="wsa-relations">' + detail.relations.map(item => {
      const status = item.statusLabel ? '<small>' + escapeHtml(item.statusLabel) + '</small>' : '';
      return '<li><b>' + escapeHtml(item.relation) + '</b><span>' + escapeHtml(item.summary) + '</span>' + status + '</li>';
    }).join('') + '</ul>'
    : '<p class="wsa-muted">No causal or related records are attached.</p>';

  return '<article class="wsa-detail-card">' +
    '<div class="wsa-detail-head">' +
    '<div class="wsa-record-meta">' +
    pill(detail.kindLabel, 'wsa-kind') +
    pill(detail.statusLabel, 'wsa-status-' + detail.status) +
    (detail.trendLabel ? pill(detail.trendLabel, 'wsa-trend') : '') +
    '</div>' +
    '<h2>' + escapeHtml(detail.summary) + '</h2>' +
    (detail.changeReason ? '<p class="wsa-change-reason">' + escapeHtml(detail.changeReason) + '</p>' : '') +
    '</div>' +
    '<section><h3>Anchors</h3>' + anchors + '</section>' +
    '<section><h3>Timeline</h3><dl class="wsa-timeline">' +
    '<div><dt>Created</dt><dd>' + messageValue(detail.createdAtMessage) + '</dd></div>' +
    '<div><dt>Changed</dt><dd>' + messageValue(detail.lastChangedMessage) + '</dd></div>' +
    '<div><dt>Evaluated</dt><dd>' + messageValue(detail.lastEvaluatedMessage) + '</dd></div>' +
    (detail.timeAnchor ? '<div><dt>World time</dt><dd>' + escapeHtml(detail.timeAnchor) + '</dd></div>' : '') +
    '</dl></section>' +
    '<section><h3>Evidence</h3>' + evidence + '</section>' +
    '<section><h3>Connections</h3>' + relations + '</section>' +
    '</article>';
}

function spatialDetailHtml(detail) {
  if (!detail) return emptyState('No location selected', 'Choose a location from the list or add a new place.');

  const sourcePill = detail.isBase
    ? (detail.isOverridden ? pill('Campaign Override', 'wsa-source-override') : pill('Base Canonical (Read-only)', 'wsa-source-base'))
    : pill('Campaign Location', 'wsa-source-campaign');

  const routeChips = detail.routeRefs.length
    ? '<div class="wsa-chip-row">' + detail.routeRefs.map(r => '<span class="wsa-chip">' + escapeHtml(r) + '</span>').join('') + '</div>'
    : '<p class="wsa-muted">No route associations.</p>';

  const evidence = detail.evidence.length
    ? '<div class="wsa-evidence-list">' + detail.evidence.map(item => {
      const sourceMessage = item.sourceMessageId === null ? 'No local message' : 'Message ' + item.sourceMessageId;
      return '<article class="wsa-evidence">' +
        '<div class="wsa-evidence-head"><strong>' + escapeHtml(item.source) + '</strong><span>' + sourceMessage + '</span></div>' +
        '<p>' + escapeHtml(item.claim || 'Evidence excerpt.') + '</p>' +
        '</article>';
    }).join('') + '</div>'
    : '<p class="wsa-muted">No evidence attached.</p>';

  const relations = detail.relations.length
    ? '<ul class="wsa-relations">' + detail.relations.map(item =>
      '<li><b>Connection</b><span>' + escapeHtml(item.summary) + '</span></li>'
    ).join('') + '</ul>'
    : '<p class="wsa-muted">No spatial relations recorded.</p>';

  let actionButtons = '';
  if (detail.isBase && !detail.isOverridden) {
    actionButtons = '<button type="button" class="wsa-btn wsa-btn-accent" data-wsa-spatial-action="create_override">Create Campaign Override</button>';
  } else {
    actionButtons = [
      '<button type="button" class="wsa-btn wsa-btn-primary" data-wsa-spatial-action="save_location">Save</button>',
      '<button type="button" class="wsa-btn" data-wsa-spatial-action="toggle_lock">' + (detail.locked ? 'Unlock Coord' : 'Lock Coord') + '</button>',
      '<button type="button" class="wsa-btn" data-wsa-spatial-action="archive_location">Archive</button>',
      '<button type="button" class="wsa-btn" data-wsa-spatial-action="merge_location">Merge Duplicate</button>',
      '<button type="button" class="wsa-btn wsa-btn-danger" data-wsa-spatial-action="delete_location">Delete</button>',
    ].join(' ');
  }

  const isEditable = !detail.isBase || detail.isOverridden;
  const readonlyAttr = isEditable ? '' : ' readonly';
  const disabledAttr = isEditable ? '' : ' disabled';
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

  return '<article class="wsa-detail-card">' +
    '<div class="wsa-detail-head">' +
    '<div class="wsa-record-meta">' +
    pill(detail.type, 'wsa-kind') +
    sourcePill +
    pill(detail.authorityLabel, 'wsa-auth') +
    '</div>' +
    '<h2>' + escapeHtml(detail.name) + '</h2>' +
    '<p class="wsa-change-reason">Coordinates: ' + escapeHtml(detail.coordText) + '</p>' +
    '</div>' +
    '<form class="wsa-spatial-form" onsubmit="return false;">' +
    '<section><h3>Location Details</h3>' +
    '<div class="wsa-form-grid">' +
    '<label><span>Name</span><input type="text" data-wsa-field="name" value="' + escapeHtml(detail.name) + '"' + readonlyAttr + '></label>' +
    '<label><span>Type</span><input type="text" data-wsa-field="type" value="' + escapeHtml(detail.type) + '"' + readonlyAttr + '></label>' +
    '<label><span>Coord X</span><input type="number" step="0.1" data-wsa-field="x" value="' + escapeHtml(detail.x) + '"' + readonlyAttr + '></label>' +
    '<label><span>Coord Y</span><input type="number" step="0.1" data-wsa-field="y" value="' + escapeHtml(detail.y) + '"' + readonlyAttr + '></label>' +
    '<label><span>Authority</span><select data-wsa-field="authority"' + disabledAttr + '>' + authorityOptions + '</select></label>' +
    '<label><span>Coordinate locked</span><input type="checkbox" data-wsa-field="locked"' + (detail.locked ? ' checked' : '') + disabledAttr + '></label>' +
    '</div>' +
    '<label class="wsa-form-full"><span>Region / Context</span><textarea data-wsa-field="context" rows="2"' + readonlyAttr + '>' + escapeHtml(detail.context) + '</textarea></label>' +
    '<label class="wsa-form-full"><span>Route Associations (comma-separated)</span><input type="text" data-wsa-field="routeRefs" value="' + escapeHtml(detail.routeRefs.join(', ')) + '"' + readonlyAttr + '></label>' +
    '<label class="wsa-form-full"><span>Notes / Operator provenance</span><input type="text" data-wsa-field="notes" value="' + escapeHtml(detail.notes) + '"' + readonlyAttr + '></label>' +
    '<h3>Relative Position</h3>' +
    '<datalist id="wsa-spatial-location-options">' + locationOptions + '</datalist>' +
    '<div class="wsa-form-grid">' +
    '<label><span>Relative anchor</span><input type="text" list="wsa-spatial-location-options" data-wsa-field="relativeAnchor" value="' + escapeHtml(detail.primaryRelation.anchorName) + '"' + readonlyAttr + '></label>' +
    '<label><span>Direction / bearing</span><select data-wsa-field="direction"' + disabledAttr + '>' + directionOptions + '</select></label>' +
    '<label><span>Distance (km)</span><input type="number" min="0" step="0.1" data-wsa-field="distanceKm" value="' + escapeHtml(detail.primaryRelation.distanceKm ?? '') + '"' + readonlyAttr + '></label>' +
    '<label><span>Distance meaning</span><select data-wsa-field="distanceMode"' + disabledAttr + '>' + distanceOptions + '</select></label>' +
    '</div>' +
    '<div class="wsa-form-actions">' + actionButtons + '</div>' +
    '</section>' +
    '</form>' +
    '<section><h3>Associated Routes</h3>' + routeChips + '</section>' +
    '<section><h3>Connections &amp; Relations</h3>' + relations + '</section>' +
    '<section><h3>Provenance &amp; Evidence</h3>' + evidence + '</section>' +
    '</article>';
}

function spatialViewHtml(model) {
  const sp = model.spatial;
  const listRows = sp.locations.length
    ? sp.locations.map(loc => spatialCard(loc, loc.key === sp.selectedKey, loc.key)).join('')
    : emptyState('No locations found', 'No spatial locations match the search criteria.');

  const truncated = model.truncation.spatial > 0
    ? '<p class="wsa-list-note">' + model.truncation.spatial + ' additional locations hidden. Narrow search to view.</p>'
    : '';

  const baseMapStatus = sp.hasBaseMap
    ? '<div class="wsa-spatial-banner"><span>Base map: <strong>' + escapeHtml(sp.baseMapName) + '</strong> (v' + escapeHtml(sp.baseMapVersion) + ')</span>' +
      '<button type="button" class="wsa-btn wsa-btn-sm" data-wsa-spatial-action="detach_base_map">Detach</button></div>'
    : '<div class="wsa-spatial-banner"><span>No base map attached.</span><button type="button" class="wsa-btn wsa-btn-sm wsa-btn-accent" data-wsa-spatial-action="import_base_map">Import Base Map</button></div>';

  return '<section class="wsa-view" aria-label="Spatial continuity">' +
    baseMapStatus +
    '<div class="wsa-spatial-toolbar">' +
    '<label class="wsa-search"><span>Search locations</span><input type="search" data-wsa-spatial-search value="' +
    escapeHtml(sp.search) + '" autocomplete="off" spellcheck="false" placeholder="e.g. Brackenford, Halmere"></label>' +
    '<button type="button" class="wsa-btn wsa-btn-primary" data-wsa-spatial-action="add_location_modal">+ Add Location</button>' +
    '</div>' +
    '<div class="wsa-two-pane">' +
    '<aside class="wsa-list-pane"><h2>Locations (' + sp.filteredCount + ')</h2>' +
    '<div class="wsa-record-list" role="list">' + listRows + truncated + '</div>' +
    '</aside>' +
    '<div class="wsa-detail-pane">' + spatialDetailHtml(sp.detail) + '</div>' +
    '</div></section>';
}

function recordsViewHtml(model, tab) {
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

  const search = tab === 'search'
    ? '<label class="wsa-search"><span>Search summaries and anchors</span><input type="search" data-wsa-search value="' +
      escapeHtml(model.search.query) + '" autocomplete="off" spellcheck="false" placeholder="e.g. Northglass bridge"></label>'
    : '';

  return '<section class="wsa-view" aria-label="' + escapeHtml(title) + '">' +
    search +
    '<div class="wsa-two-pane">' +
    '<aside class="wsa-list-pane"><h2>' + escapeHtml(title) + '</h2>' +
    recordsPane(records, model, emptyTitle, emptyBody, truncated) +
    '</aside>' +
    '<div class="wsa-detail-pane">' + detailHtml(model.detail) + '</div>' +
    '</div></section>';
}

function diagnosticsHtml(model) {
  const rows = model.diagnostics.length
    ? model.diagnostics.map(item => {
      const code = item.code ? '<span>' + escapeHtml(item.code) + '</span>' : '';
      const label = item.label ? '<span>' + escapeHtml(item.label) + '</span>' : '';
      const detail = item.detail ? '<p class="wsa-diagnostic-detail">' + escapeHtml(item.detail) + '</p>' : '';
      const message = item.sourceMessageId === null ? 'n/a' : item.sourceMessageId;
      const progress = item.totalBoundaries > 0
        ? '<div><dt>Progress</dt><dd>' + item.processedBoundaries + '/' + item.totalBoundaries + '</dd></div>'
        : '';
      const repairs = item.aliasRepairs > 0
        ? '<div><dt>Alias repairs</dt><dd>' + item.aliasRepairs + '</dd></div>'
        : '';
      return '<article class="wsa-diagnostic">' +
        '<div><strong>' + escapeHtml(item.outcome) + '</strong>' + label + code + '</div>' +
        detail +
        '<dl>' +
        '<div><dt>Message</dt><dd>' + message + '</dd></div>' +
        '<div><dt>Route</dt><dd>' + escapeHtml(item.route || 'local/default') + '</dd></div>' +
        '<div><dt>Calls</dt><dd>' + item.providerCalls + '</dd></div>' +
        '<div><dt>Applied</dt><dd>' + item.applied + '</dd></div>' +
        '<div><dt>Rejected</dt><dd>' + item.rejected + '</dd></div>' +
        repairs +
        progress +
        '<div><dt>Duration</dt><dd>' + item.durationMs + ' ms</dd></div>' +
        '</dl></article>';
    }).join('')
    : emptyState('No diagnostics yet', 'Bounded operation telemetry will appear here when supplied by the runtime.');

  return '<section class="wsa-view wsa-single-pane" aria-label="Diagnostics">' +
    '<div class="wsa-section-head"><div><h2>Diagnostics</h2>' +
    '<p>Bounded operational telemetry only. Rebuild failures include a safe structural reason and boundary progress; story text, prompts, credentials, and provider payloads are not shown.</p></div></div>' +
    '<div class="wsa-diagnostics">' + rows + '</div></section>';
}

function maintenanceDescription(id) {
  if (id === 'export') return 'Create a portable World State bundle.';
  if (id === 'import') return 'Review an import before applying it.';
  if (id === 'rebuild') return 'Explicitly reconstruct state from chronological chat evidence.';
  return 'Review and confirm a full reset.';
}

function maintenanceHtml(model) {
  const actions = model.maintenance.actions.map(action =>
    '<button type="button" class="wsa-maintenance-action wsa-tone-' + escapeHtml(action.tone) +
    '" data-wsa-action="' + escapeHtml(action.id) + '">' +
    '<strong>' + escapeHtml(action.label) + '</strong>' +
    '<span>' + escapeHtml(maintenanceDescription(action.id)) + '</span>' +
    '</button>'
  ).join('');

  const healthClass = model.maintenance.recoveryAttention ? ' needs-attention' : '';
  const healthTitle = model.maintenance.recoveryAttention ? 'Recovery attention needed' : 'Continuity healthy';
  const lastCapture = model.maintenance.lastCaptureMessage === null
    ? 'none'
    : 'message ' + model.maintenance.lastCaptureMessage;

  return '<section class="wsa-view wsa-single-pane" aria-label="Data and maintenance">' +
    '<div class="wsa-section-head"><div><h2>Data &amp; maintenance</h2>' +
    '<p>Maintenance actions are explicit. This panel emits action requests; it does not silently mutate canonical state.</p></div></div>' +
    '<div class="wsa-health' + healthClass + '"><strong>' + healthTitle + '</strong>' +
    '<p>' + escapeHtml(model.maintenance.recoveryMessage) + '</p>' +
    '<small>Last automatic capture: ' + lastCapture + '</small></div>' +
    '<div class="wsa-stat-grid">' +
    '<div><b>' + model.counts.total + '</b><span>Total records</span></div>' +
    '<div><b>' + model.counts.current + '</b><span>Current</span></div>' +
    '<div><b>' + model.counts.spatialLocations + '</b><span>Places</span></div>' +
    '<div><b>' + model.counts.evidence + '</b><span>Evidence items</span></div>' +
    '</div>' +
    '<div class="wsa-maintenance-grid">' + actions + '</div>' +
    '</section>';
}

function tabLabel(tab) {
  if (tab === 'current') return 'Current';
  if (tab === 'recent') return 'Recent';
  if (tab === 'resolved') return 'Resolved';
  if (tab === 'spatial') return 'Spatial';
  if (tab === 'search') return 'Search';
  if (tab === 'diagnostics') return 'Diagnostics';
  return 'Data';
}

export function renderWorldStatePanel(model, { activeTab = 'current' } = {}) {
  const tab = WORLD_STATE_UI_TABS.includes(activeTab) ? activeTab : 'current';
  const tabs = WORLD_STATE_UI_TABS.map(item =>
    '<button type="button" class="wsa-tab' + (item === tab ? ' is-active' : '') +
    '" data-wsa-tab="' + item + '" role="tab" aria-selected="' + (item === tab ? 'true' : 'false') + '">' +
    tabLabel(item) + '</button>'
  ).join('');

  let body;
  if (tab === 'spatial') body = spatialViewHtml(model);
  else if (tab === 'diagnostics') body = diagnosticsHtml(model);
  else if (tab === 'maintenance') body = maintenanceHtml(model);
  else body = recordsViewHtml(model, tab);

  return '<div class="wsa-shell" data-world-state-alpha-ui>' +
    '<div class="wsa-backdrop" data-wsa-close aria-hidden="true"></div>' +
    '<section class="wsa-panel" role="dialog" aria-modal="true" aria-label="World State">' +
    '<header class="wsa-header"><div>' +
    '<p class="wsa-eyebrow">World State Alpha</p><h1>World continuity</h1>' +
    '<span>' + model.counts.current + ' current · ' + (model.counts.resolved + model.counts.superseded) + ' historical · ' + model.counts.spatialLocations + ' places</span>' +
    '</div><button type="button" class="wsa-close" data-wsa-close aria-label="Close World State">×</button></header>' +
    '<nav class="wsa-tabs" role="tablist" aria-label="World State views">' + tabs + '</nav>' +
    '<main class="wsa-body">' + body + '</main>' +
    '</section></div>';
}

export function createWorldStateUiController({
  root,
  getState,
  getBaseMap = () => null,
  getDiagnostics = () => [],
  onMaintenanceAction = null,
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
    });
  }

  function refresh({ restoreSearchFocus = false, restoreSpatialFocus = false } = {}) {
    if (ui.destroyed) return null;
    const next = model();
    ui.selectedRecordId = next.selectedRecordId;
    ui.selectedSpatialKey = next.spatial.selectedKey;
    root.innerHTML = renderWorldStatePanel(next, { activeTab: ui.activeTab });

    if (restoreSearchFocus && ui.activeTab === 'search') {
      const input = root.querySelector?.('[data-wsa-search]');
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

  async function click(event) {
    if (closest(event.target, '[data-wsa-close]')) {
      if (typeof onClose === 'function') onClose();
      return;
    }

    const tab = closest(event.target, '[data-wsa-tab]');
    if (tab) {
      const nextTab = clean(tab.dataset?.wsaTab, 20);
      if (WORLD_STATE_UI_TABS.includes(nextTab)) {
        ui.activeTab = nextTab;
        refresh();
      }
      return;
    }

    const record = closest(event.target, '[data-wsa-record-index]');
    if (record) {
      const index = Number(record.dataset?.wsaRecordIndex);
      const currentModel = model();
      const rows = ui.activeTab === 'recent'
        ? currentModel.views.recent
        : ui.activeTab === 'resolved'
          ? currentModel.views.resolved
          : ui.activeTab === 'search'
            ? currentModel.views.search
            : currentModel.views.current;
      if (Number.isInteger(index) && index >= 0 && rows[index]?.key) {
        ui.selectedRecordId = rows[index].key;
        refresh();
      }
      return;
    }

    const spatialBtn = closest(event.target, '[data-wsa-spatial-key]');
    if (spatialBtn) {
      const key = spatialBtn.dataset?.wsaSpatialKey;
      if (key) {
        ui.selectedSpatialKey = key;
        refresh();
      }
      return;
    }

    const spatialAction = closest(event.target, '[data-wsa-spatial-action]');
    if (spatialAction && typeof onSpatialAction === 'function') {
      const action = clean(spatialAction.dataset?.wsaSpatialAction, 40);
      const currentModel = model();
      const currentLoc = currentModel.spatial.detail;

      // Extract form fields if available
      const form = root.querySelector?.('.wsa-spatial-form');
      const getVal = field => form?.querySelector?.(`[data-wsa-field="${field}"]`)?.value;
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
        spatialModel: currentModel.spatial,
      });
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
      refresh({ restoreSearchFocus: true });
      return;
    }

    const spatialSearch = closest(event.target, '[data-wsa-spatial-search]');
    if (spatialSearch) {
      ui.spatialSearch = clean(spatialSearch.value, 120);
      refresh({ restoreSpatialFocus: true });
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
