import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createState } from '../state-core.js';
import {
  WORLD_STATE_UI_LIMITS,
  WORLD_STATE_UI_MAINTENANCE_ACTIONS,
  WORLD_STATE_UI_NAMESPACE,
  buildWorldStateUiModel,
  renderWorldStatePanel,
} from '../ui.js';

function record(id, {
  kind = 'fact',
  summary = 'World fact',
  status = 'active',
  trend = null,
  anchors = [],
  created = 1,
  changed = 1,
  evaluated = 1,
  evidenceIds = [],
  causedBy = [],
  affects = [],
  timeAnchor = '',
} = {}) {
  return {
    id,
    kind,
    summary,
    status,
    trend,
    anchors,
    createdAtMessage: created,
    lastChangedMessage: changed,
    lastEvaluatedMessage: evaluated,
    timeAnchor,
    evidenceIds,
    causedBy,
    affects,
  };
}

function fixtureState() {
  const state = createState('phase6-ui');
  state.records = [
    record('wsr_hidden_bridge', {
      summary: 'Northglass bridge is destroyed.',
      anchors: ['Northglass', 'bridge'],
      changed: 8,
      evidenceIds: ['wse_hidden_bridge'],
    }),
    record('wsr_hidden_strike', {
      kind: 'development',
      summary: 'Southport dock strike remains active.',
      trend: 'rising',
      anchors: ['Southport', 'dock strike'],
      created: 2,
      changed: 11,
      evaluated: 11,
      evidenceIds: ['wse_hidden_strike'],
      affects: ['wsr_hidden_bridge'],
      timeAnchor: 'Late autumn',
    }),
    record('wsr_hidden_resolved', {
      kind: 'development',
      summary: 'Old university fee protest ended after an agreement.',
      status: 'resolved',
      trend: 'falling',
      anchors: ['university', 'fee protest'],
      created: 3,
      changed: 15,
      evaluated: 15,
      evidenceIds: ['wse_hidden_resolved'],
    }),
    record('wsr_hidden_superseded', {
      summary: 'Old freight office arrangement was replaced.',
      status: 'superseded',
      anchors: ['freight office'],
      created: 1,
      changed: 6,
      evaluated: 6,
    }),
  ];
  state.evidence = {
    wse_hidden_bridge: {
      id: 'wse_hidden_bridge',
      sourceMessageId: 8,
      lineageKey: 'ln_secret_bridge',
      sourceClass: 'assistant_narration',
      claim: 'The bridge collapses into the river.',
      timeAnchor: '',
      recordIds: ['wsr_hidden_bridge'],
    },
    wse_hidden_strike: {
      id: 'wse_hidden_strike',
      sourceMessageId: 11,
      lineageKey: 'ln_secret_strike',
      sourceClass: 'manual',
      claim: 'Operator correction: the dock strike is still active.',
      timeAnchor: 'Late autumn',
      recordIds: ['wsr_hidden_strike'],
    },
    wse_hidden_resolved: {
      id: 'wse_hidden_resolved',
      sourceMessageId: 15,
      lineageKey: 'ln_secret_resolved',
      sourceClass: 'rebuild',
      claim: 'The protest ends after an agreement.',
      timeAnchor: '',
      recordIds: ['wsr_hidden_resolved'],
    },
  };
  state.links = [{
    id: 'wsl_hidden_relation',
    from: 'wsr_hidden_strike',
    to: 'wsr_hidden_bridge',
    type: 'related',
    sourceMessageId: 11,
  }];
  state.rollbackJournal = [
    { seq: 1, messageId: 8, reason: 'capture' },
    { seq: 2, messageId: 11, reason: 'manual' },
    { seq: 3, messageId: 15, reason: 'rebuild' },
  ];
  state.lastCaptureMessage = 8;
  return state;
}

test('Phase 6 projection provides Current, Recent, Resolved, Search and detail without changing canonical state', () => {
  const state = fixtureState();
  const model = buildWorldStateUiModel(state, { query: 'dock strike', selectedRecordId: 'wsr_hidden_strike' });

  assert.equal(WORLD_STATE_UI_NAMESPACE, 'world_state_alpha_ui');
  assert.equal(model.counts.current, 2);
  assert.equal(model.counts.resolved, 1);
  assert.equal(model.counts.superseded, 1);

  assert.deepEqual(model.views.current.map(item => item.summary), [
    'Southport dock strike remains active.',
    'Northglass bridge is destroyed.',
  ]);
  assert.deepEqual(model.views.recent.map(item => item.summary), [
    'Old university fee protest ended after an agreement.',
    'Southport dock strike remains active.',
    'Northglass bridge is destroyed.',
    'Old freight office arrangement was replaced.',
  ]);
  assert.equal(model.views.resolved.length, 2);
  assert.equal(model.views.search.length, 1);
  assert.equal(model.views.search[0].summary, 'Southport dock strike remains active.');

  assert.equal(model.detail.changeReason, 'Manual correction');
  assert.equal(model.detail.evidence[0].source, 'Manual correction');
  assert.equal(model.detail.relations.some(item => item.summary === 'Northglass bridge is destroyed.'), true);

  model.detail.summary = 'mutated projection';
  model.detail.evidence[0].claim = 'mutated evidence';
  assert.equal(state.records[1].summary, 'Southport dock strike remains active.');
  assert.equal(state.evidence.wse_hidden_strike.claim, 'Operator correction: the dock strike is still active.');
});

test('empty search does not dump records while populated search uses bounded manual query semantics', () => {
  const state = fixtureState();
  const empty = buildWorldStateUiModel(state);
  assert.equal(empty.views.search.length, 0);
  assert.equal(empty.search.totalMatched, 0);

  const found = buildWorldStateUiModel(state, { query: 'Northglass bridge' });
  assert.equal(found.views.search.length, 1);
  assert.equal(found.views.search[0].summary, 'Northglass bridge is destroyed.');
});

test('active view owns selection and does not show detail from another tab', () => {
  const state = fixtureState();

  const resolved = buildWorldStateUiModel(state, {
    selectedRecordId: 'wsr_hidden_strike',
    activeView: 'resolved',
  });
  assert.equal(resolved.detail.summary, 'Old university fee protest ended after an agreement.');
  assert.equal(resolved.views.resolved.some(item => item.key === resolved.selectedRecordId), true);

  const emptySearch = buildWorldStateUiModel(state, {
    selectedRecordId: 'wsr_hidden_strike',
    activeView: 'search',
    query: '',
  });
  assert.equal(emptySearch.selectedRecordId, '');
  assert.equal(emptySearch.detail, null);

  const searched = buildWorldStateUiModel(state, {
    activeView: 'search',
    query: 'Northglass bridge',
  });
  assert.equal(searched.detail.summary, 'Northglass bridge is destroyed.');
  assert.equal(searched.views.search[0].key, searched.selectedRecordId);
});

test('expanded active records expose manual history actions without exposing them on historical records', () => {
  const state = fixtureState();
  const active = buildWorldStateUiModel(state, {
    selectedRecordId: 'wsr_hidden_strike',
    activeView: 'current',
  });
  const activeHtml = renderWorldStatePanel(active, {
    activeTab: 'current',
    detailOpen: true,
  });
  assert.match(activeHtml, /Manual lifecycle/);
  assert.match(activeHtml, /data-wsa-record-action="resolve"/);
  assert.match(activeHtml, /data-wsa-record-action="supersede"/);
  assert.match(activeHtml, /Mark resolved/);
  assert.match(activeHtml, /Mark superseded/);

  const historical = buildWorldStateUiModel(state, {
    selectedRecordId: 'wsr_hidden_resolved',
    activeView: 'resolved',
  });
  const historicalHtml = renderWorldStatePanel(historical, {
    activeTab: 'resolved',
    detailOpen: true,
  });
  assert.doesNotMatch(historicalHtml, /data-wsa-record-action=/);
  assert.doesNotMatch(historicalHtml, /Manual lifecycle/);
});

test('detail evidence and relations are bounded', () => {
  const state = createState('bounded-detail');
  const evidenceIds = [];
  for (let index = 0; index < 40; index += 1) {
    const id = 'wse_private_' + index;
    evidenceIds.push(id);
    state.evidence[id] = {
      id,
      sourceMessageId: index,
      lineageKey: 'ln_private_' + index,
      sourceClass: 'assistant_narration',
      claim: 'Evidence claim ' + index,
      timeAnchor: '',
      recordIds: ['wsr_private_root'],
    };
  }

  const affects = [];
  state.records.push(record('wsr_private_root', {
    kind: 'development',
    summary: 'A bounded development.',
    evidenceIds,
    affects,
    changed: 99,
  }));

  for (let index = 0; index < 30; index += 1) {
    const id = 'wsr_private_related_' + index;
    affects.push(id);
    state.records.push(record(id, { summary: 'Related condition ' + index }));
    state.links.push({
      id: 'wsl_private_' + index,
      from: 'wsr_private_root',
      to: id,
      type: 'related',
      sourceMessageId: 99,
    });
  }

  const model = buildWorldStateUiModel(state, { selectedRecordId: 'wsr_private_root' });
  assert.equal(model.detail.evidence.length, WORLD_STATE_UI_LIMITS.evidence);
  assert.equal(model.detail.relations.length, WORLD_STATE_UI_LIMITS.relations);
});

test('render escapes canonical/evidence/diagnostic text and exposes no raw backend identifiers', () => {
  const state = createState('escape-ui');
  state.records = [record('wsr_secret_identifier', {
    summary: '<img src=x onerror="steal()"> World state',
    anchors: ['<script>alert(1)</script>'],
    evidenceIds: ['wse_secret_identifier'],
  })];
  state.evidence = {
    wse_secret_identifier: {
      id: 'wse_secret_identifier',
      sourceMessageId: 1,
      lineageKey: 'ln_secret_identifier',
      sourceClass: 'assistant_narration',
      claim: '<b onclick="steal()">Evidence</b>',
      timeAnchor: '',
      recordIds: ['wsr_secret_identifier'],
    },
  };

  const model = buildWorldStateUiModel(state, {
    selectedRecordId: 'wsr_secret_identifier',
    diagnostics: [{
      outcome: '<svg onload="steal()">',
      code: '<bad-code>',
      route: '<route>',
      prompt: 'SECRET PROMPT',
      story: 'SECRET STORY',
      credential: 'SECRET CREDENTIAL',
    }],
  });

  const html = renderWorldStatePanel(model, { activeTab: 'current', detailOpen: true }) +
    renderWorldStatePanel(model, { activeTab: 'diagnostics' });
  const projected = JSON.stringify(model);

  for (const forbidden of ['wsr_secret_identifier', 'wse_secret_identifier', 'ln_secret_identifier']) {
    assert.equal(projected.includes(forbidden), false, forbidden + ' must not survive into the public UI model');
  }

  assert.match(html, /&lt;img src=x onerror=&quot;steal\(\)&quot;&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;b onclick=&quot;steal\(\)&quot;&gt;Evidence&lt;\/b&gt;/);
  assert.match(html, /&lt;svg onload=&quot;steal\(\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img|<script|<svg[^>]+onload=|onclick="|onerror="/);

  for (const forbidden of [
    'wsr_secret_identifier',
    'wse_secret_identifier',
    'ln_secret_identifier',
    'SECRET PROMPT',
    'SECRET STORY',
    'SECRET CREDENTIAL',
  ]) assert.equal(html.includes(forbidden), false, forbidden + ' must not reach rendered UI');
});

test('diagnostic projection is allowlisted and drops private unexpected fields', () => {
  const model = buildWorldStateUiModel(fixtureState(), {
    diagnostics: [{
      operationId: 'op',
      label: 'rebuild',
      outcome: 'rebuild-failed',
      code: 'WORLD_STATE_REBUILD_REALITY_WIRE_INVALID',
      detail: 'rebuild rejected structurally invalid Reality mutation row 0: create mutation requires kind=fact|development',
      sourceMessageId: 8,
      providerCalls: 1,
      applied: 2,
      rejected: 1,
      aliasRepairs: 2,
      completenessHints: 4,
      processedBoundaries: 3,
      totalBoundaries: 5,
      prompt: 'raw prompt',
      response: 'raw transport response',
      responseJson: '{"mutations":[{"action":"create","kind":"fact","summary":"safe model JSON"}]}',
      rejectionsJson: '[{"stage":"wire","reason":"bad field"}]',
      storyTranscript: 'story',
      reasoning_content: 'private reasoning',
      headers: { authorization: 'secret' },
      apiKey: 'credential',
    }],
  });
  assert.equal(model.diagnostics.length, 1);
  const row = model.diagnostics[0];
  assert.equal(row.outcome, 'rebuild-failed');
  assert.equal(row.label, 'rebuild');
  assert.match(row.detail, /structurally invalid Reality mutation row/);
  assert.equal(row.aliasRepairs, 2);
  assert.equal(row.completenessHints, 4);
  assert.equal(row.processedBoundaries, 3);
  assert.equal(row.totalBoundaries, 5);
  const html = renderWorldStatePanel(model, { activeTab: 'diagnostics' });
  assert.match(html, /WORLD_STATE_REBUILD_REALITY_WIRE_INVALID/);
  assert.match(html, /Progress/);
  assert.match(html, /3\/5/);
  assert.match(html, /Alias repairs/);
  assert.match(html, /State checklist/);
  assert.match(html, />4</);
  assert.equal(Object.hasOwn(row, 'prompt'), false);
  assert.equal(Object.hasOwn(row, 'response'), false);
  assert.equal(Object.hasOwn(row, 'storyTranscript'), false);
  assert.equal(Object.hasOwn(row, 'reasoning_content'), false);
  assert.equal(Object.hasOwn(row, 'headers'), false);
  assert.equal(Object.hasOwn(row, 'apiKey'), false);
  assert.match(row.responseJson, /safe model JSON/);
  assert.match(row.rejectionsJson, /bad field/);
  assert.match(html, /Model response JSON/);
  assert.match(html, /Rejected mutations \/ reasons/);
  assert.match(html, /safe model JSON/);
  assert.doesNotMatch(html, /private reasoning|authorization|raw transport response/);
});

test('maintenance surface contains explicit intent descriptors only', () => {
  assert.deepEqual(WORLD_STATE_UI_MAINTENANCE_ACTIONS.map(item => item.id), [
    'export',
    'import',
    'rebuild',
    'reset',
  ]);
  const source = fs.readFileSync('ui.js', 'utf8');
  for (const forbidden of [
    'reduceMutations',
    'applyManualMutation',
    'applyWorldStateImport',
    'applyWorldStateReset',
    'runManualRebuild',
    'writeSidecar',
    'dispatchWorldStateRequest',
    'generateRaw',
    'provider-routing',
    "from 'node:",
  ]) assert.equal(source.includes(forbidden), false, 'ui.js must not contain ' + forbidden);
  assert.match(source, /onMaintenanceAction/);
  assert.match(source, /onRecordAction/);
  assert.match(source, /data-wsa-record-action="resolve"/);
  assert.match(source, /data-wsa-record-action="supersede"/);
});

test('1000-record UI fixture remains bounded', () => {
  const state = createState('large-ui');
  state.records = Array.from({ length: 1000 }, (_, index) => record('wsr_large_' + index, {
    summary: index % 10 === 0 ? 'Kesselpass freight record ' + index : 'Unrelated record ' + index,
    status: index % 9 === 0 ? 'resolved' : 'active',
    changed: index,
    anchors: index % 10 === 0 ? ['Kesselpass', 'freight'] : ['topic-' + index],
  }));

  const model = buildWorldStateUiModel(state, { query: 'Kesselpass freight' });
  assert.equal(model.views.current.length, WORLD_STATE_UI_LIMITS.currentRecords);
  assert.equal(model.views.recent.length, WORLD_STATE_UI_LIMITS.recentRecords);
  assert.equal(model.views.resolved.length <= WORLD_STATE_UI_LIMITS.resolvedRecords, true);
  assert.equal(model.views.search.length <= WORLD_STATE_UI_LIMITS.searchRecords, true);
  assert.equal(model.views.search.length, 100);
  assert.equal(model.truncation.current > 0, true);
});

test('Phase 6 CSS has desktop, tablet, and mobile adaptive boundaries', () => {
  const css = fs.readFileSync('ui.css', 'utf8');
  assert.match(css, /width:\s*min\(1180px,\s*calc\(100vw - 32px\)\)/);
  assert.match(css, /@media \(max-width:\s*1099px\) and \(min-width:\s*768px\)/);
  assert.match(css, /@media \(max-width:\s*767px\)/);
  assert.match(css, /@media \(max-width:\s*599px\)/);
  assert.match(css, /\.wsa-mobile-nav\s*\{/);
  assert.match(css, /\.wsa-rebuild-sheet\s*\{/);
  assert.match(css, /\.wsa-operation\s*\{/);
  assert.match(css, /width:\s*100vw/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /focus-visible/);
});

test('Spatial Coordinate Profile UI distinguishes manual and base-map authority', () => {
  const state = fixtureState();
  state.spatial.profile = {
    system: 'cartesian2d',
    northAxis: '+y',
    eastAxis: '+x',
    unitKm: 5,
    bounds: { xMin: -100, xMax: 100, yMin: -200, yMax: 200 },
    decimalStep: 0.1,
    trueNorthLocked: true,
  };
  state.spatial.locations = [{
    id: 'wsloc_derived_ui',
    name: 'Derived Watch',
    type: 'watchtower',
    status: 'active',
    baseRefId: null,
    coordinate: { x: 5, y: 6, authority: 'derived', locked: false },
    context: '',
    routeRefs: [],
    notes: '',
    createdAtMessage: 1,
    lastChangedMessage: 1,
    evidenceIds: [],
  }];

  const manual = buildWorldStateUiModel(state);
  assert.equal(manual.spatial.profileSource, 'manual');
  assert.equal(manual.spatial.profileEditable, true);
  assert.equal(manual.spatial.derivedCoordinateCount, 1);
  const manualHtml = renderWorldStatePanel(manual, { activeTab: 'spatial' });
  assert.match(manualHtml, /Coordinate Profile/);
  assert.match(manualHtml, /data-wsa-spatial-action="save_profile"/);
  assert.match(manualHtml, /data-wsa-spatial-action="reset_profile"/);
  assert.match(manualHtml, /will clear 1 derived coordinate/);

  const baseMap = {
    id: 'base-profile-test',
    name: 'Base Profile Test',
    version: '2',
    profile: {
      system: 'cartesian2d',
      northAxis: '+x',
      eastAxis: '-y',
      unitKm: 2,
      bounds: null,
      decimalStep: 0.5,
      trueNorthLocked: true,
    },
    locations: [],
    routes: [],
  };
  state.spatial.baseMapRef = {
    id: baseMap.id,
    name: baseMap.name,
    version: baseMap.version,
    digest: 'digest',
    path: '/base.json',
  };
  const locked = buildWorldStateUiModel(state, { baseMap });
  assert.equal(locked.spatial.profileSource, 'base_map');
  assert.equal(locked.spatial.profileEditable, false);
  assert.equal(locked.spatial.profile.northAxis, '+x');
  assert.equal(locked.spatial.profile.unitKm, 2);
  const lockedHtml = renderWorldStatePanel(locked, { activeTab: 'spatial' });
  assert.match(lockedHtml, /Defined by the attached base map/);
  assert.doesNotMatch(lockedHtml, /data-wsa-spatial-action="save_profile"/);
  assert.match(lockedHtml, /Base Profile Test/);
});

test('cross-session recovery UI never presents a missing durable baseline as an ordinary empty state', () => {
  const state = fixtureState();
  const model = buildWorldStateUiModel(state, {
    runtimeInfo: {
      chatMessages: 120,
      assistantBoundaries: 58,
      defaultRebuildBoundaries: 1024,
      maxRebuildBoundaries: 4096,
      spatialEnabled: true,
      hostHydrationReady: true,
      hydrationSource: 'fresh-confirmed',
      bootstrapRequired: true,
    },
  });

  assert.equal(model.maintenance.recoveryAttention, true);
  assert.equal(model.maintenance.bootstrapRequired, true);
  assert.equal(model.maintenance.hydrationSource, 'fresh-confirmed');
  assert.equal(model.maintenance.rebuild.bootstrapRequired, true);

  const html = renderWorldStatePanel(model, {
    activeTab: 'current',
    rebuildOpen: true,
    rebuildForm: {
      mode: 'from',
      startMessageId: 80,
      lastMessages: 20,
      maxBoundaries: 1024,
      includeHiddenMessages: true,
    },
  });

  assert.match(html, /Durable World State not found/);
  assert.match(html, /Automatic continuity is paused/);
  assert.match(html, /Hydration source: fresh-confirmed/);
  assert.match(html, /Full rebuild required/);
  assert.match(html, /value="full" data-wsa-rebuild-mode checked/);
  assert.match(html, /value="last" data-wsa-rebuild-mode disabled/);
  assert.match(html, /value="from" data-wsa-rebuild-mode disabled/);
  assert.match(html, /data-wsa-open-rebuild>Full rebuild/);

  const dataHtml = renderWorldStatePanel(model, { activeTab: 'maintenance' });
  assert.match(dataHtml, /Durable World State was not found for this established chat/);
  assert.match(dataHtml, /Hydration source: fresh-confirmed/);
});

test('responsive renderer exposes Operations, Places, mobile navigation, atomic rebuild sheet, and danger zone', () => {
  const idleModel = buildWorldStateUiModel(fixtureState(), {
    runtimeInfo: {
      chatMessages: 42,
      assistantBoundaries: 18,
      defaultRebuildBoundaries: 1024,
      maxRebuildBoundaries: 4096,
      spatialEnabled: true,
    },
  });
  const html = renderWorldStatePanel(idleModel, {
    activeTab: 'current',
    rebuildOpen: true,
    rebuildForm: { mode: 'from', startMessageId: 10, lastMessages: 20, maxBoundaries: 2048, includeHiddenMessages: true },
  });
  assert.match(html, />Operations</);
  assert.match(html, />Places</);
  assert.match(html, /wsa-mobile-nav/);
  assert.match(html, /Rebuild from Chat/);
  assert.match(html, /Full chat/);
  assert.match(html, /Last N messages/);
  assert.match(html, /Start message/);
  assert.match(html, /Include hidden chat messages/);
  assert.match(html, /data-wsa-rebuild-hidden checked/);
  assert.match(html, /without changing chat visibility or lineage/);
  assert.match(html, /Maximum assistant boundaries/);
  assert.match(html, /Atomic replacement/);

  const runningModel = buildWorldStateUiModel(fixtureState(), {
    runtimeInfo: {
      chatMessages: 42,
      assistantBoundaries: 18,
      defaultRebuildBoundaries: 1024,
      maxRebuildBoundaries: 4096,
      spatialEnabled: true,
      rebuildStatus: {
        phase: 'running',
        operationId: 'rebuild:41:2:0',
        processedBoundaries: 7,
        totalBoundaries: 18,
        providerCalls: 7,
        applied: 9,
        rejected: 1,
        currentRecords: 5,
        places: 4,
        hiddenMessagesIncluded: 3,
        hiddenAssistantBoundaries: 1,
        detail: 'Processed message 15.',
      },
    },
  });
  const runningHtml = renderWorldStatePanel(runningModel, { activeTab: 'current', rebuildOpen: true });
  assert.match(runningHtml, /7\/18 boundaries/);
  assert.match(runningHtml, /3 hidden included/);
  assert.match(runningHtml, /Cancel/);
  assert.doesNotMatch(runningHtml, /Start Rebuild/);

  const committingModel = buildWorldStateUiModel(fixtureState(), {
    runtimeInfo: {
      chatMessages: 42,
      assistantBoundaries: 18,
      defaultRebuildBoundaries: 1024,
      maxRebuildBoundaries: 4096,
      spatialEnabled: true,
      rebuildStatus: {
        phase: 'committing',
        operationId: 'rebuild:41:2:0',
        processedBoundaries: 18,
        totalBoundaries: 18,
        providerCalls: 18,
        applied: 20,
        rejected: 0,
        currentRecords: 6,
        places: 4,
        detail: 'Extraction completed; persisting the rebuilt candidate atomically.',
      },
    },
  });
  const committingHtml = renderWorldStatePanel(committingModel, { activeTab: 'current', rebuildOpen: true });
  assert.match(committingHtml, /Saving rebuilt state/);
  assert.doesNotMatch(committingHtml, /data-wsa-cancel-rebuild/);
  assert.doesNotMatch(committingHtml, /Start Rebuild/);

  const dataHtml = renderWorldStatePanel(idleModel, { activeTab: 'maintenance' });
  assert.match(dataHtml, /Danger zone/);
  assert.match(dataHtml, /Rebuild does not require Clear/);
});

test('Alpha.12 flat UI exposes inline record disclosures, expandable Operations, icon branding, and dismissible rebuild status', () => {
  const model = buildWorldStateUiModel(fixtureState(), {
    selectedRecordId: 'wsr_hidden_strike',
    diagnostics: [{
      operationId: 'rebuild:15:1:0',
      label: 'rebuild',
      outcome: 'applied',
      sourceMessageId: 15,
      applied: 2,
      rejected: 0,
      responseJson: '{"mutations":[{"action":"update"}]}',
      rejectionsJson: '[]',
    }],
    runtimeInfo: {
      chatMessages: 20,
      assistantBoundaries: 8,
      defaultRebuildBoundaries: 1024,
      maxRebuildBoundaries: 4096,
      spatialEnabled: true,
      rebuildStatus: {
        phase: 'completed',
        operationId: 'rebuild:15:1:0',
        processedBoundaries: 8,
        totalBoundaries: 8,
        providerCalls: 8,
        currentRecords: 2,
        places: 3,
        detail: 'Rebuild completed and persisted.',
      },
    },
  });

  const current = renderWorldStatePanel(model, { activeTab: 'current', detailOpen: true });
  assert.match(current, /wsa-brand-icon/);
  assert.match(current, /<h1>World continuity<\/h1>/);
  assert.doesNotMatch(current, />World State Alpha</);
  assert.match(current, /wsa-record-disclosure is-expanded/);
  assert.match(current, /<details[^>]+open/);
  assert.match(current, /Anchors/);
  assert.match(current, /Evidence/);
  assert.match(current, /data-wsa-dismiss-rebuild/);
  assert.match(current, /wsa-rebuild-toast/);

  const dismissed = renderWorldStatePanel(model, {
    activeTab: 'current',
    detailOpen: true,
    dismissedRebuildOperationId: 'rebuild:15:1:0',
  });
  assert.doesNotMatch(dismissed, /wsa-rebuild-toast/);

  const operations = renderWorldStatePanel(model, { activeTab: 'diagnostics' });
  assert.match(operations, /<details class="wsa-operation/);
  assert.match(operations, /Model response JSON/);
  assert.match(operations, /data-wsa-copy-json="response"/);
});

test('Alpha.12 flat CSS suppresses scrollbar arrows and removes nested-card depth from record/operation rows', () => {
  const css = fs.readFileSync('ui.css', 'utf8');
  assert.match(css, /webkit-scrollbar-button/);
  assert.match(css, /display:\s*none\s*!important/);
  assert.match(css, /\.wsa-record-disclosure/);
  assert.match(css, /\.wsa-record-expanded-grid/);
  assert.match(css, /\.wsa-rebuild-toast/);
  assert.match(css, /\.wsa-brand-icon/);
  assert.match(css, /\.wsa-operation\s*\{[\s\S]*?border:\s*0;/);
});

test('Phase 6 UI namespace is isolated from NPC State and host/bootstrap code', () => {
  const source = fs.readFileSync('ui.js', 'utf8');
  const css = fs.readFileSync('ui.css', 'utf8');
  assert.equal(source.includes('npc_state_delta'), false);
  assert.equal(css.includes('npc-state-delta'), false);
  assert.equal(source.includes('eventSource'), false);
  assert.equal(source.includes('event_types'), false);
  assert.equal(source.includes('SillyTavern'), false);
  assert.equal(source.includes('executeSlashCommands'), false);
});

function spatialLocation(id, name, { x = null, y = null, type = 'landmark', context = '' } = {}) {
  return {
    id,
    name,
    type,
    status: 'active',
    baseRefId: null,
    coordinate: { x, y, authority: x === null ? 'unknown' : 'narrative_explicit', locked: false },
    context,
    routeRefs: [],
    notes: '',
    createdAtMessage: 1,
    lastChangedMessage: 1,
    evidenceIds: [],
  };
}

test('redesigned World view groups active records and keeps rows free of raw identifiers', () => {
  const state = fixtureState();
  state.records.push(record('wsr_hidden_old_fact', {
    summary: 'Southport harbour charter predates the strike.',
    anchors: ['Southport'],
    changed: 1,
  }));
  state.spatial.locations = [spatialLocation('wsloc_southport', 'Southport')];
  const model = buildWorldStateUiModel(state, { runtimeInfo: { chatMessages: 16 } });
  assert.equal(model.latestMessage, 15);

  const html = renderWorldStatePanel(model, { activeTab: 'current' });
  assert.match(html, /wsa-group-head"><span>Changed recently/);
  assert.match(html, /wsa-group-head"><span>Facts/);
  assert.match(html, /wsa-rec-rising/);
  assert.match(html, /<b>Rising<\/b> · 4 messages ago/);
  assert.match(html, /class="wsa-tag is-place">[\s\S]*?Southport<\/span>/);
  assert.match(html, /data-wsa-tab="recent"/);
  assert.match(html, /data-wsa-tab="resolved"/);
  assert.match(html, /data-wsa-search/);
  assert.match(html, /class="wsa-menu" role="menu" aria-label="More World State actions" hidden/);
  assert.match(html, /data-wsa-menu-toggle/);
  assert.match(html, /Private continuity context — not character knowledge/);
  assert.equal(html.includes('wsr_hidden'), false);

  const menuHtml = renderWorldStatePanel(model, { activeTab: 'current', menuOpen: true });
  assert.doesNotMatch(menuHtml, /aria-label="More World State actions" hidden/);
  assert.match(menuHtml, /data-wsa-open-map-settings/);
});

test('Places projection nests sub-places, flags possible duplicates, and lists mentioning records without persisting either', () => {
  const state = fixtureState();
  state.records.push(record('wsr_hidden_farwick', {
    summary: 'Beasts were cleared from the center of Farwick.',
    anchors: ['Noc'],
    changed: 12,
  }));
  state.spatial.locations = [
    spatialLocation('wsloc_farwick', 'Farwick', { x: -198.12, y: 188.15, type: 'settlement' }),
    spatialLocation('wsloc_gate', 'Farwick North Gate', { x: -198.1, y: 188.3 }),
    spatialLocation('wsloc_ditch_a', 'Southern Drainage Ditch', { x: -198.1, y: 188.1 }),
    spatialLocation('wsloc_ditch_b', 'Drainage Ditch South of Farwick', { x: -198.1, y: 188.1 }),
    spatialLocation('wsloc_other', 'Northglass', { x: 5, y: 5 }),
  ];
  state.spatial.relations = [{
    id: 'wsrel_ditch', fromId: 'wsloc_farwick', toId: 'wsloc_ditch_a',
    direction: 'south', distanceKm: 3, distanceMode: 'straight_line', notes: '', evidenceIds: [],
  }];
  const before = JSON.stringify(state.spatial);
  const model = buildWorldStateUiModel(state);
  assert.equal(JSON.stringify(state.spatial), before);

  const rows = model.spatial.locations;
  assert.deepEqual(rows.map(row => [row.displayName, row.depth]), [
    ['Farwick', 0],
    ['North Gate', 1],
    ['Southern Drainage Ditch', 0],
    ['Drainage Ditch South of Farwick', 0],
    ['Northglass', 0],
  ]);
  assert.equal(model.spatial.duplicateCount, 2);
  assert.deepEqual(rows.filter(row => row.possibleDuplicate).map(row => row.name), [
    'Southern Drainage Ditch',
    'Drainage Ditch South of Farwick',
  ]);
  assert.equal(model.spatial.detail.name, 'Farwick');
  assert.equal(model.spatial.detail.childCount, 1);
  assert.equal(model.spatial.detail.mentions.total, 1);
  assert.equal(model.spatial.detail.mentions.rows[0].summary, 'Beasts were cleared from the center of Farwick.');
  assert.match(model.spatial.detail.mentions.rows[0].key, /^row-\d+$/);

  const html = renderWorldStatePanel(model, { activeTab: 'spatial' });
  assert.match(html, /2 possible duplicates/);
  assert.match(html, /data-wsa-open-record="row-\d+"/);
  assert.match(html, /Southern Drainage Ditch<\/span><small>south · 3 km straight-line/);
  assert.match(html, /data-wsa-spatial-edit/);
  assert.equal(html.includes('wsloc_'), false);

  const duplicatesOnly = buildWorldStateUiModel(state, { spatialDuplicatesOnly: true });
  assert.equal(duplicatesOnly.spatial.locations.length, 2);
});

test('merged or archived places leave the Places list, duplicate flags, and counts', async () => {
  const { applySpatialManualMutation } = await import('../spatial-manual.js');
  const state = fixtureState();
  state.spatial.locations = [
    spatialLocation('wsloc_ditch_a', 'Southern Drainage Ditch', { x: -198.1, y: 188.1 }),
    spatialLocation('wsloc_ditch_b', 'Drainage Ditch South of Farwick', { x: -198.1, y: 188.1 }),
    spatialLocation('wsloc_other', 'Northglass', { x: 5, y: 5 }),
  ];

  const initial = buildWorldStateUiModel(state);
  const keyOf = (model, name) => model.spatial.locations.find(loc => loc.name === name)?.key;
  const northglassKey = keyOf(initial, 'Northglass');
  const before = buildWorldStateUiModel(state, { selectedSpatialKey: keyOf(initial, 'Drainage Ditch South of Farwick') });
  assert.equal(before.spatial.duplicateCount, 2);
  assert.deepEqual(before.spatial.detail.duplicateNames, ['Southern Drainage Ditch']);
  assert.deepEqual(before.spatial.detail.mergeSuggestions, [{ id: 'wsloc_ditch_a', name: 'Southern Drainage Ditch' }]);
  assert.match(renderWorldStatePanel(before, { activeTab: 'spatial' }), /May duplicate “Southern Drainage Ditch”/);

  const merged = applySpatialManualMutation({
    state,
    chatKey: state.chatKey,
    mutation: { action: 'merge_locations', sourceId: 'wsloc_ditch_b', targetId: 'wsloc_ditch_a' },
    note: 'Merged accidental duplicate',
  });
  assert.equal(merged.outcome, 'applied');
  assert.equal(merged.state.spatial.locations.find(loc => loc.id === 'wsloc_ditch_b').status, 'archived');

  const after = buildWorldStateUiModel(merged.state);
  assert.deepEqual(after.spatial.locations.map(loc => loc.name), ['Southern Drainage Ditch', 'Northglass']);
  assert.equal(after.spatial.duplicateCount, 0);
  assert.equal(after.spatial.archivedCount, 1);
  assert.equal(after.counts.spatialLocations, 2);
  assert.equal(after.spatial.detail.locationOptions.some(item => item.name === 'Drainage Ditch South of Farwick'), false);
  assert.equal(after.counts.spatialCampaign, 2);
  // Keys follow the location, not list position, so a kept selection survives the merge.
  assert.equal(keyOf(after, 'Northglass'), northglassKey);
  assert.equal(buildWorldStateUiModel(merged.state, { selectedSpatialKey: northglassKey }).spatial.detail.name, 'Northglass');
  const html = renderWorldStatePanel(after, { activeTab: 'spatial' });
  assert.doesNotMatch(html, /Drainage Ditch South of Farwick/);
  assert.match(html, /1 archived or merged place is not listed/);
});

test('an archived campaign override stays reachable so the base-map place can be restored', () => {
  const state = fixtureState();
  const baseMap = {
    id: 'base-archive-test',
    name: 'Archive Test Map',
    version: '1',
    profile: null,
    locations: [
      { id: 'base_mill', name: 'Farwick Mill', type: 'mill', coordinate: { x: 1, y: 2 } },
      { id: 'base_bridge', name: 'Old Bridge', type: 'bridge', coordinate: { x: 3, y: 4 } },
    ],
    routes: [],
  };
  state.spatial.baseMapRef = { id: baseMap.id, name: baseMap.name, version: '1', digest: 'd', path: '/base.json' };
  state.spatial.locations = [{
    ...spatialLocation('wsloc_mill_override', 'Farwick Mill', { x: 1, y: 2 }),
    baseRefId: 'base_mill',
    status: 'archived',
  }];
  const model = buildWorldStateUiModel(state, { baseMap });
  const mill = model.spatial.locations.find(loc => loc.name === 'Farwick Mill');
  assert.ok(mill, 'archived override remains listed');
  assert.equal(mill.archived, true);
  assert.equal(model.spatial.duplicateCount, 0);
  const selected = buildWorldStateUiModel(state, { baseMap, selectedSpatialKey: mill.key });
  assert.match(renderWorldStatePanel(selected, { activeTab: 'spatial' }), /wsa-archived">Archived/);
  assert.match(renderWorldStatePanel(selected, { activeTab: 'spatial', spatialEditing: true }), /data-wsa-spatial-action="delete_location"/);
});
