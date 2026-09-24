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
  const effectiveLocations = resolveEffectiveLocations(normalized.spatial, baseMap);
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
      hasBaseMap,
      profile: displaySpatialProfile,
      profileConfigured: Boolean(activeSpatialProfile),
      profileSource: hasBaseMap ? 'base_map' : 'manual',
      profileEditable: !hasBaseMap,
      derivedCoordinateCount,
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
      rebuild: {
        chatMessages: integer(runtimeInfo?.chatMessages) ?? 0,
        assistantBoundaries: integer(runtimeInfo?.assistantBoundaries) ?? 0,
        defaultMaxBoundaries: integer(runtimeInfo?.defaultRebuildBoundaries) ?? 1024,
        maxAllowedBoundaries: integer(runtimeInfo?.maxRebuildBoundaries) ?? 4096,
        spatialEnabled: Boolean(runtimeInfo?.spatialEnabled),
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

function pill(label, className) {
  if (!label) return '';
  return '<span class="wsa-pill ' + escapeHtml(className || '') + '">' + escapeHtml(label) + '</span>';
}

function recordDisclosure(record, expanded, index, detail = null) {
  const meta = [
    pill(record.kindLabel, 'wsa-kind'),
    pill(record.statusLabel, 'wsa-status-' + record.status),
    record.trendLabel ? pill(record.trendLabel, 'wsa-trend') : '',
  ].filter(Boolean).join('');
  const changed = record.lastChangedMessage === null
    ? ''
    : '<small>Changed at message ' + record.lastChangedMessage + '</small>';
  return '<details class="wsa-record-disclosure' + (expanded ? ' is-expanded' : '') + '"' + (expanded ? ' open' : '') + '>' +
    '<summary data-wsa-record-index="' + index + '">' +
    '<span class="wsa-record-summary-main"><span class="wsa-record-meta">' + meta + '</span>' +
    '<strong>' + escapeHtml(record.summary || 'Untitled world state') + '</strong>' + changed + '</span>' +
    '<span class="wsa-disclosure-icon" aria-hidden="true">›</span>' +
    '</summary>' +
    (expanded && detail ? '<div class="wsa-record-expanded">' + recordExpandedHtml(detail) + '</div>' : '') +
    '</details>';
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

function recordsPane(records, model, emptyTitle, emptyBody, truncated, expanded = false) {
  const rows = records.length
    ? records.map((record, index) => {
      const isExpanded = expanded && record.key === model.selectedRecordId;
      return recordDisclosure(record, isExpanded, index, isExpanded ? model.detail : null);
    }).join('')
    : emptyState(emptyTitle, emptyBody);
  const note = truncated > 0
    ? '<p class="wsa-list-note">' + truncated + ' additional records are hidden from this bounded view. Use Search to narrow the list.</p>'
    : '';
  return '<div class="wsa-record-list wsa-flat-records" role="list">' + rows + note + '</div>';
}

function messageValue(value) {
  return value === null || value === undefined ? 'Not recorded' : 'Message ' + value;
}

function recordExpandedHtml(detail) {
  if (!detail) return '';

  const lifecycleActions = detail.status === 'active'
    ? '<section class="wsa-record-expanded-wide wsa-manual-lifecycle"><h3>Manual lifecycle</h3>' +
      '<p>Use this only when you need to override automatic lifecycle detection. The record stays in history with manual evidence.</p>' +
      '<div class="wsa-record-action-row">' +
      '<button type="button" class="wsa-btn" data-wsa-record-action="resolve">Mark resolved</button>' +
      '<button type="button" class="wsa-btn" data-wsa-record-action="supersede">Mark superseded</button>' +
      '</div></section>'
    : '';

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

  return '<div class="wsa-record-expanded-grid">' +
    '<section><h3>Anchors</h3>' + anchors + '</section>' +
    '<section><h3>Timeline</h3><dl class="wsa-timeline">' +
    '<div><dt>Created</dt><dd>' + messageValue(detail.createdAtMessage) + '</dd></div>' +
    '<div><dt>Changed</dt><dd>' + messageValue(detail.lastChangedMessage) + '</dd></div>' +
    '<div><dt>Evaluated</dt><dd>' + messageValue(detail.lastEvaluatedMessage) + '</dd></div>' +
    (detail.timeAnchor ? '<div><dt>World time</dt><dd>' + escapeHtml(detail.timeAnchor) + '</dd></div>' : '') +
    '</dl></section>' +
    '<section class="wsa-record-expanded-wide"><h3>Evidence</h3>' + evidence + '</section>' +
    '<section class="wsa-record-expanded-wide"><h3>Connections</h3>' + relations + '</section>' +
    lifecycleActions +
    (detail.changeReason ? '<p class="wsa-change-reason wsa-record-expanded-wide">' + escapeHtml(detail.changeReason) + '</p>' : '') +
    '</div>';
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

function mobileBackButton(label = 'Back') {
  return '<button type="button" class="wsa-mobile-back" data-wsa-back-list>‹ ' + escapeHtml(label) + '</button>';
}

function coordinateAxisLabel(value) {
  return String(value || '').toUpperCase();
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
  const configured = sp.profileConfigured ? 'Configured' : 'Not configured';
  const scale = Number.isFinite(profile.unitKm) ? profile.unitKm + ' km/unit' : 'no scale';
  const warning = sp.derivedCoordinateCount > 0 && sp.profileEditable
    ? '<p class="wsa-profile-warning">Changing orientation, scale, bounds, or precision will clear ' +
      sp.derivedCoordinateCount + ' derived coordinate' + (sp.derivedCoordinateCount === 1 ? '' : 's') +
      ' so stale geometry cannot survive the profile change.</p>'
    : '';
  const lockNote = sp.profileEditable
    ? '<p class="wsa-muted">Manual campaign profile. Cartesian 2D is the only supported math system in this release.</p>'
    : '<p class="wsa-muted">🔒 Defined by the attached base map. Detach the map before changing this profile.</p>';
  const actions = sp.profileEditable
    ? '<div class="wsa-form-actions"><button type="button" class="wsa-btn wsa-btn-primary" data-wsa-spatial-action="save_profile">Save profile</button>' +
      '<button type="button" class="wsa-btn" data-wsa-spatial-action="reset_profile">Reset profile</button></div>'
    : '';

  return '<details class="wsa-spatial-profile-card">' +
    '<summary><strong>Coordinate Profile</strong><span>' + escapeHtml(sourceLabel) + ' · ' +
    escapeHtml(configured) + ' · ' + escapeHtml(coordinateAxisLabel(profile.northAxis)) + ' North / ' +
    escapeHtml(coordinateAxisLabel(profile.eastAxis)) + ' East · ' + escapeHtml(scale) + '</span></summary>' +
    '<form class="wsa-spatial-profile-form" onsubmit="return false;">' +
    lockNote + warning +
    '<div class="wsa-form-grid">' +
    '<label><span>System</span><select data-wsa-profile-field="system" disabled><option value="cartesian2d" selected>Cartesian 2D</option></select></label>' +
    '<label><span>Profile source</span><input type="text" value="' + escapeHtml(sourceLabel) + '" readonly></label>' +
    '<label><span>North axis</span><select data-wsa-profile-field="northAxis"' + disabled + '>' + axisOptions(profile.northAxis) + '</select></label>' +
    '<label><span>East axis</span><select data-wsa-profile-field="eastAxis"' + disabled + '>' + axisOptions(profile.eastAxis) + '</select></label>' +
    '<label><span>km per coordinate unit</span><input type="number" min="0" step="any" data-wsa-profile-field="unitKm" value="' +
      escapeHtml(Number.isFinite(profile.unitKm) ? profile.unitKm : '') + '"' + disabled + '></label>' +
    '<label><span>Coordinate precision</span><input type="number" min="0" step="any" data-wsa-profile-field="decimalStep" value="' +
      escapeHtml(Number.isFinite(profile.decimalStep) ? profile.decimalStep : 0.1) + '"' + disabled + '></label>' +
    '<label><span>X min</span><input type="number" step="any" data-wsa-profile-field="xMin" value="' + escapeHtml(Number.isFinite(bounds.xMin) ? bounds.xMin : '') + '"' + disabled + '></label>' +
    '<label><span>X max</span><input type="number" step="any" data-wsa-profile-field="xMax" value="' + escapeHtml(Number.isFinite(bounds.xMax) ? bounds.xMax : '') + '"' + disabled + '></label>' +
    '<label><span>Y min</span><input type="number" step="any" data-wsa-profile-field="yMin" value="' + escapeHtml(Number.isFinite(bounds.yMin) ? bounds.yMin : '') + '"' + disabled + '></label>' +
    '<label><span>Y max</span><input type="number" step="any" data-wsa-profile-field="yMax" value="' + escapeHtml(Number.isFinite(bounds.yMax) ? bounds.yMax : '') + '"' + disabled + '></label>' +
    '<label class="wsa-profile-check"><span>Lock True North</span><input type="checkbox" data-wsa-profile-field="trueNorthLocked"' + checked + disabled + '></label>' +
    '</div>' + actions +
    '</form></details>';
}

function spatialViewHtml(model, { detailOpen = false } = {}) {
  const sp = model.spatial;
  const listRows = sp.locations.length
    ? sp.locations.map(loc => spatialCard(loc, loc.key === sp.selectedKey, loc.key)).join('')
    : emptyState('No locations found', 'No spatial locations match the search criteria.');

  const truncated = model.truncation.spatial > 0
    ? '<p class="wsa-list-note">' + model.truncation.spatial + ' additional locations hidden. Narrow search to view.</p>'
    : '';

  const baseMapVersion = sp.baseMapVersion ? ' (v' + escapeHtml(sp.baseMapVersion) + ')' : '';
  const baseMapStatus = sp.hasBaseMap
    ? '<div class="wsa-spatial-banner"><span>Base map: <strong>' + escapeHtml(sp.baseMapName) + '</strong>' + baseMapVersion + '</span>' +
      '<button type="button" class="wsa-btn wsa-btn-sm" data-wsa-spatial-action="detach_base_map">Detach</button></div>'
    : '<div class="wsa-spatial-banner"><span>No base map attached.</span><button type="button" class="wsa-btn wsa-btn-sm wsa-btn-accent" data-wsa-spatial-action="import_base_map">Import Base Map</button></div>';

  return '<section class="wsa-view" aria-label="Places">' +
    baseMapStatus +
    coordinateProfileHtml(sp) +
    '<div class="wsa-spatial-toolbar">' +
    '<label class="wsa-search"><span>Search places</span><input type="search" data-wsa-spatial-search value="' +
    escapeHtml(sp.search) + '" autocomplete="off" spellcheck="false" placeholder="e.g. Brackenford, Halmere"></label>' +
    '<button type="button" class="wsa-btn wsa-btn-primary" data-wsa-spatial-action="add_location_modal">+ Add Place</button>' +
    '</div>' +
    '<div class="wsa-two-pane wsa-adaptive-pane' + (detailOpen ? ' is-detail-open' : '') + '">' +
    '<aside class="wsa-list-pane"><div class="wsa-pane-title"><h2>Places (' + sp.filteredCount + ')</h2></div>' +
    '<div class="wsa-record-list" role="list">' + listRows + truncated + '</div>' +
    '</aside>' +
    '<div class="wsa-detail-pane"><div class="wsa-mobile-detail-head">' + mobileBackButton('Places') + '</div>' +
    spatialDetailHtml(sp.detail) + '</div>' +
    '</div></section>';
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

  const search = tab === 'search'
    ? '<label class="wsa-search"><span>Search summaries and anchors</span><input type="search" data-wsa-search value="' +
      escapeHtml(model.search.query) + '" autocomplete="off" spellcheck="false" placeholder="e.g. Northglass bridge"></label>'
    : '';

  return '<section class="wsa-view wsa-records-view" aria-label="' + escapeHtml(title) + '">' +
    search +
    '<div class="wsa-pane-title"><h2>' + escapeHtml(title) + '</h2>' +
    (tab === 'current' ? '<button type="button" class="wsa-btn wsa-btn-sm wsa-btn-accent" data-wsa-open-rebuild>Rebuild</button>' : '') +
    '</div>' +
    recordsPane(records, model, emptyTitle, emptyBody, truncated, detailOpen) +
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
    '<small>Last automatic capture: ' + lastCapture + '</small></div>' +
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
    '<div class="wsa-rebuild-toast-icon" aria-hidden="true">' + (tone === 'success' ? '✓' : tone === 'error' ? '!' : '↻') + '</div>' +
    '<div class="wsa-rebuild-toast-content"><div class="wsa-rebuild-toast-head"><strong>' + escapeHtml(stateLabel) + '</strong>' +
    (dismissible ? '<button type="button" class="wsa-icon-btn" data-wsa-dismiss-rebuild aria-label="Dismiss rebuild status">×</button>' : '') +
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
  const mode = ['full', 'last', 'from'].includes(form.mode) ? form.mode : 'full';
  const startMessageId = Number.isInteger(form.startMessageId) ? form.startMessageId : 0;
  const lastMessages = Number.isInteger(form.lastMessages) ? form.lastMessages : Math.min(20, Math.max(1, rebuild.chatMessages));
  const maxBoundaries = Number.isInteger(form.maxBoundaries) ? form.maxBoundaries : rebuild.defaultMaxBoundaries;
  const includeHiddenMessages = form.includeHiddenMessages !== false;

  const body = active
    ? '<div class="wsa-rebuild-running">' + rebuildStatusHtml(status, { dismissible: false }) +
      '<p class="wsa-muted">The existing canonical state remains authoritative until the entire candidate rebuild succeeds and is persisted.</p></div>'
    : '<form class="wsa-rebuild-form" onsubmit="return false;">' +
      '<fieldset><legend>Rebuild source</legend>' +
      '<label class="wsa-radio"><input type="radio" name="wsa-rebuild-mode" value="full" data-wsa-rebuild-mode' + (mode === 'full' ? ' checked' : '') + '><span><strong>Full chat</strong><small>Messages 0 → ' + Math.max(0, rebuild.chatMessages - 1) + '</small></span></label>' +
      '<label class="wsa-radio"><input type="radio" name="wsa-rebuild-mode" value="last" data-wsa-rebuild-mode' + (mode === 'last' ? ' checked' : '') + '><span><strong>Last messages</strong><small>Requires exact canonical history before the calculated start.</small></span></label>' +
      '<label class="wsa-inline-field"><span>Last N messages</span><input type="number" min="1" max="' + Math.max(1, rebuild.chatMessages) + '" value="' + lastMessages + '" data-wsa-rebuild-last></label>' +
      '<label class="wsa-radio"><input type="radio" name="wsa-rebuild-mode" value="from" data-wsa-rebuild-mode' + (mode === 'from' ? ' checked' : '') + '><span><strong>From message</strong><small>Fails closed if the exact prior canonical boundary is unavailable.</small></span></label>' +
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
    '<button type="button" class="wsa-close" data-wsa-close-rebuild aria-label="Close rebuild settings">×</button></header>' +
    body + '</section></div>';
}

function mobileNavigation(activeTab, moreOpen) {
  const primary = [
    ['current', 'Current'],
    ['spatial', 'Places'],
    ['diagnostics', 'Ops'],
  ];
  const buttons = primary.map(([id, label]) =>
    '<button type="button" class="wsa-mobile-nav-btn' + (activeTab === id ? ' is-active' : '') +
    '" data-wsa-tab="' + id + '"><span>' + label + '</span></button>'
  ).join('');
  const more = '<button type="button" class="wsa-mobile-nav-btn' + (moreOpen ? ' is-active' : '') +
    '" data-wsa-mobile-more><span>More</span></button>';
  const menu = moreOpen
    ? '<div class="wsa-mobile-more-menu">' +
      ['recent', 'resolved', 'search', 'maintenance'].map(id =>
        '<button type="button" data-wsa-tab="' + id + '">' + tabLabel(id) + '</button>'
      ).join('') + '</div>'
    : '';
  return '<nav class="wsa-mobile-nav" aria-label="World State mobile navigation">' + buttons + more + menu + '</nav>';
}

function continuityIconHtml() {
  return '<span class="wsa-brand-icon" aria-hidden="true">' +
    '<svg viewBox="0 0 48 48" focusable="false"><circle cx="24" cy="24" r="15"></circle>' +
    '<path d="M12 19l8-7 11 3 6 9-5 10-12 2-9-8z"></path>' +
    '<circle cx="20" cy="12" r="2.5"></circle><circle cx="31" cy="15" r="2.5"></circle>' +
    '<circle cx="37" cy="24" r="2.5"></circle><circle cx="32" cy="34" r="2.5"></circle>' +
    '<circle cx="20" cy="36" r="2.5"></circle><circle cx="11" cy="28" r="2.5"></circle></svg></span>';
}

export function renderWorldStatePanel(model, {
  activeTab = 'current',
  detailOpen = false,
  spatialDetailOpen = false,
  mobileMoreOpen = false,
  rebuildOpen = false,
  rebuildForm = {},
  dismissedRebuildOperationId = '',
} = {}) {
  const tab = WORLD_STATE_UI_TABS.includes(activeTab) ? activeTab : 'current';
  const tabs = WORLD_STATE_UI_TABS.map(item =>
    '<button type="button" class="wsa-tab' + (item === tab ? ' is-active' : '') +
    '" data-wsa-tab="' + item + '" role="tab" aria-selected="' + (item === tab ? 'true' : 'false') + '">' +
    tabLabel(item) + '</button>'
  ).join('');

  let body;
  if (tab === 'spatial') body = spatialViewHtml(model, { detailOpen: spatialDetailOpen });
  else if (tab === 'diagnostics') body = diagnosticsHtml(model);
  else if (tab === 'maintenance') body = maintenanceHtml(model);
  else body = recordsViewHtml(model, tab, { detailOpen });

  const rebuildStatus = model.maintenance.rebuild.status;
  const showStatus = rebuildStatus && rebuildStatus.operationId !== dismissedRebuildOperationId;
  return '<div class="wsa-shell" data-world-state-alpha-ui>' +
    '<div class="wsa-backdrop" data-wsa-close aria-hidden="true"></div>' +
    '<section class="wsa-panel" role="dialog" aria-modal="true" aria-label="World State">' +
    '<header class="wsa-header"><div class="wsa-brand">' + continuityIconHtml() + '<div class="wsa-brand-copy"><h1>World continuity</h1>' +
    '<span>' + model.counts.current + ' current · ' + (model.counts.resolved + model.counts.superseded) + ' historical · ' + model.counts.spatialLocations + ' places</span></div></div>' +
    '<div class="wsa-header-actions"><button type="button" class="wsa-btn wsa-btn-accent wsa-header-rebuild" data-wsa-open-rebuild><span aria-hidden="true">↻</span> Rebuild</button>' +
    '<button type="button" class="wsa-close" data-wsa-close aria-label="Close World State">×</button></div></header>' +
    (showStatus ? rebuildStatusHtml(rebuildStatus) : '') +
    '<nav class="wsa-tabs" role="tablist" aria-label="World State views">' + tabs + '</nav>' +
    '<main class="wsa-body">' + body + '</main>' +
    mobileNavigation(tab, mobileMoreOpen) +
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
      mobileMoreOpen: ui.mobileMoreOpen,
      rebuildOpen: ui.rebuildOpen,
      rebuildForm: ui.rebuildForm,
      dismissedRebuildOperationId: ui.dismissedRebuildOperationId,
    });

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
      ui.mobileMoreOpen = false;
      refresh();
      return;
    }

    if (closest(event.target, '[data-wsa-mobile-more]')) {
      ui.mobileMoreOpen = !ui.mobileMoreOpen;
      refresh();
      return;
    }

    if (closest(event.target, '[data-wsa-back-list]')) {
      if (ui.activeTab === 'spatial') ui.spatialDetailOpen = false;
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
        ui.mobileMoreOpen = false;
        ui.detailOpen = false;
        ui.spatialDetailOpen = false;
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
