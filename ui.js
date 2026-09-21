import { sanitizeCaptureDiagnostic } from './diagnostics.js';
import { inspectWorldStateRecord, queryWorldState } from './manual.js';
import { clone, normalizeState } from './state-core.js';

export const WORLD_STATE_UI_NAMESPACE = 'world_state_alpha_ui';

export const WORLD_STATE_UI_LIMITS = Object.freeze({
  currentRecords: 120,
  recentRecords: 40,
  resolvedRecords: 80,
  searchRecords: 100,
  diagnostics: 40,
  evidence: 32,
  relations: 24,
});

export const WORLD_STATE_UI_TABS = Object.freeze([
  'current',
  'recent',
  'resolved',
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
        sourceMessageId: item.sourceMessageId,
        outcome: clean(item.outcome, 48) || 'unknown',
        code: clean(item.code, 80),
        route: clean(item.route, 24),
        providerCalls: item.providerCalls,
        proposed: item.proposed,
        accepted: item.accepted,
        applied: item.applied,
        rejected: item.rejected,
        candidateRecords: item.candidateRecords,
        promptChars: item.promptChars,
        responseChars: item.responseChars,
        durationMs: item.durationMs,
      };
    });
}

export function buildWorldStateUiModel(state, {
  diagnostics = [],
  query = '',
  selectedRecordId = '',
  activeView = 'current',
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

  return {
    namespace: WORLD_STATE_UI_NAMESPACE,
    counts: {
      total: projected.length,
      current: currentAll.length,
      resolved: resolvedAll.filter(record => record.status === 'resolved').length,
      superseded: resolvedAll.filter(record => record.status === 'superseded').length,
      evidence: Object.keys(normalized.evidence).length,
      links: normalized.links.length,
    },
    views: { current, recent, resolved, search: searched },
    truncation: {
      current: Math.max(0, currentAll.length - current.length),
      recent: Math.max(0, recentAll.length - recent.length),
      resolved: Math.max(0, resolvedAll.length - resolved.length),
      search: Math.max(0, searchResult.totalMatched - searched.length),
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
      const message = item.sourceMessageId === null ? 'n/a' : item.sourceMessageId;
      return '<article class="wsa-diagnostic">' +
        '<div><strong>' + escapeHtml(item.outcome) + '</strong>' + code + '</div>' +
        '<dl>' +
        '<div><dt>Message</dt><dd>' + message + '</dd></div>' +
        '<div><dt>Route</dt><dd>' + escapeHtml(item.route || 'local/default') + '</dd></div>' +
        '<div><dt>Calls</dt><dd>' + item.providerCalls + '</dd></div>' +
        '<div><dt>Applied</dt><dd>' + item.applied + '</dd></div>' +
        '<div><dt>Rejected</dt><dd>' + item.rejected + '</dd></div>' +
        '<div><dt>Duration</dt><dd>' + item.durationMs + ' ms</dd></div>' +
        '</dl></article>';
    }).join('')
    : emptyState('No diagnostics yet', 'Bounded operation telemetry will appear here when supplied by the runtime.');

  return '<section class="wsa-view wsa-single-pane" aria-label="Diagnostics">' +
    '<div class="wsa-section-head"><div><h2>Diagnostics</h2>' +
    '<p>Bounded operational telemetry only. Story text, prompts, credentials, and provider payloads are not shown.</p></div></div>' +
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
    '<div><b>' + model.counts.resolved + '</b><span>Resolved</span></div>' +
    '<div><b>' + model.counts.evidence + '</b><span>Evidence items</span></div>' +
    '</div>' +
    '<div class="wsa-maintenance-grid">' + actions + '</div>' +
    '</section>';
}

function tabLabel(tab) {
  if (tab === 'current') return 'Current';
  if (tab === 'recent') return 'Recent';
  if (tab === 'resolved') return 'Resolved';
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
  if (tab === 'diagnostics') body = diagnosticsHtml(model);
  else if (tab === 'maintenance') body = maintenanceHtml(model);
  else body = recordsViewHtml(model, tab);

  return '<div class="wsa-shell" data-world-state-alpha-ui>' +
    '<div class="wsa-backdrop" data-wsa-close aria-hidden="true"></div>' +
    '<section class="wsa-panel" role="dialog" aria-modal="true" aria-label="World State">' +
    '<header class="wsa-header"><div>' +
    '<p class="wsa-eyebrow">World State Alpha</p><h1>World continuity</h1>' +
    '<span>' + model.counts.current + ' current · ' + (model.counts.resolved + model.counts.superseded) + ' historical</span>' +
    '</div><button type="button" class="wsa-close" data-wsa-close aria-label="Close World State">×</button></header>' +
    '<nav class="wsa-tabs" role="tablist" aria-label="World State views">' + tabs + '</nav>' +
    '<main class="wsa-body">' + body + '</main>' +
    '</section></div>';
}

export function createWorldStateUiController({
  root,
  getState,
  getDiagnostics = () => [],
  onMaintenanceAction = null,
  onClose = null,
  initialTab = 'current',
} = {}) {
  if (!root || typeof root.addEventListener !== 'function') throw new Error('UI root element is required');
  if (typeof getState !== 'function') throw new Error('getState function is required');

  const ui = {
    activeTab: WORLD_STATE_UI_TABS.includes(initialTab) ? initialTab : 'current',
    query: '',
    selectedRecordId: '',
    destroyed: false,
  };

  function model() {
    return buildWorldStateUiModel(getState(), {
      diagnostics: getDiagnostics(),
      query: ui.query,
      selectedRecordId: ui.selectedRecordId,
      activeView: ui.activeTab,
    });
  }

  function refresh({ restoreSearchFocus = false } = {}) {
    if (ui.destroyed) return null;
    const next = model();
    ui.selectedRecordId = next.selectedRecordId;
    root.innerHTML = renderWorldStatePanel(next, { activeTab: ui.activeTab });
    if (restoreSearchFocus && ui.activeTab === 'search') {
      const input = root.querySelector?.('[data-wsa-search]');
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
    if (!search) return;
    ui.query = clean(search.value, 500);
    refresh({ restoreSearchFocus: true });
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
        hasSelection: Boolean(ui.selectedRecordId),
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
