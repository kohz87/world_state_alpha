import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WORLD_STATE_INJECTION_DEFAULTS,
  WORLD_STATE_NAMESPACE,
  WORLD_STATE_PRIVATE_HEADER,
  WORLD_STATE_PROMPT_KEY,
  buildWorldStateInjection,
  estimateInjectionTokens,
  renderWorldStateInjection,
} from '../injection.js';

function record(id, summary, {
  kind = 'fact',
  status = 'active',
  trend = null,
  anchors = [],
} = {}) {
  return {
    id,
    kind,
    summary,
    status,
    trend,
    anchors,
    createdAtMessage: 1,
    lastChangedMessage: 1,
    lastEvaluatedMessage: 1,
    timeAnchor: '',
    evidenceIds: ['wse_hidden'],
    causedBy: [],
    affects: [],
  };
}

test('Phase 3 prompt namespace and key do not collide with NPC State Delta', () => {
  assert.equal(WORLD_STATE_NAMESPACE, 'world_state_alpha');
  assert.equal(WORLD_STATE_PROMPT_KEY, 'world_state_alpha_private_continuity');
  assert.notEqual(WORLD_STATE_PROMPT_KEY, 'npc_state_delta_live_dossier');
  assert.equal(WORLD_STATE_INJECTION_DEFAULTS.placement, 'IN_CHAT');
  assert.equal(WORLD_STATE_INJECTION_DEFAULTS.role, 'SYSTEM');
  assert.equal(WORLD_STATE_INJECTION_DEFAULTS.depth, 1);
});

test('private continuity header explicitly blocks automatic PC knowledge and story-driving inheritance', () => {
  assert.match(WORLD_STATE_PRIVATE_HEADER, /private narrator continuity/i);
  assert.match(WORLD_STATE_PRIVATE_HEADER, /not automatic player-character knowledge/i);
  assert.match(WORLD_STATE_PRIVATE_HEADER, /plausible information path/i);
  assert.match(WORLD_STATE_PRIVATE_HEADER, /Do not use them as instructions to create world motion/i);
});

test('relevant current fact is rendered while unrelated state is omitted', () => {
  const state = {
    records: [
      record('bridge', 'The Northglass bridge is destroyed.', { anchors: ['Northglass bridge'] }),
      record('south', 'The southern marina remains closed.', { anchors: ['southern marina'] }),
    ],
    links: [],
  };
  const result = buildWorldStateInjection(state, {
    recentText: 'Lucien reaches the Northglass bridge.',
    currentMessageId: 20,
  });
  assert.match(result.text, /Northglass bridge is destroyed/);
  assert.doesNotMatch(result.text, /southern marina/);
  assert.equal(result.included.length, 1);
});

test('no relevant records means no injected header or prompt payload', () => {
  const state = {
    records: [record('remote', 'A remote ferry is suspended.', { anchors: ['remote ferry'] })],
    links: [],
  };
  const result = buildWorldStateInjection(state, {
    recentText: 'The class begins in East Dormitory.',
  });
  assert.equal(result.text, '');
  assert.equal(result.descriptor.text, '');
  assert.equal(result.included.length, 0);
});

test('injection surface contains current summaries only, not record IDs, anchors, or evidence', () => {
  const state = {
    records: [record('secret-id-9182', 'Kesselpass traffic is congested.', {
      kind: 'development',
      trend: 'rising',
      anchors: ['Kesselpass', 'secret-anchor-4421'],
    })],
    evidence: {
      wse_hidden: { claim: 'SECRET_EVIDENCE_7721' },
    },
    links: [],
  };
  const result = buildWorldStateInjection(state, {
    recentText: 'They enter Kesselpass.',
  });
  assert.match(result.text, /Kesselpass traffic is congested/);
  assert.match(result.text, /trend: rising/);
  assert.doesNotMatch(result.text, /secret-id-9182|secret-anchor-4421|SECRET_EVIDENCE_7721/);
});

test('default injection budget is 800 local token units and render never exceeds it', () => {
  const entries = Array.from({ length: 12 }, (_, index) => ({
    record: record(`r${index}`, `Kesselpass condition ${index}: ${'very long current-state detail '.repeat(18)}`, {
      kind: 'development',
      trend: 'stable',
      anchors: ['Kesselpass'],
    }),
    score: 10 - index / 10,
    source: 'seed',
  }));
  const result = renderWorldStateInjection(entries);
  assert.equal(result.budgetTokens, 800);
  assert.ok(result.estimatedTokens <= 800);
  assert.ok(estimateInjectionTokens(result.text) <= 800);
  assert.ok(result.included.length < entries.length);
});

test('small custom budget is honored strictly instead of silently expanding', () => {
  const entry = {
    record: record('long', `The reactor condition is ${'complicated and carefully documented '.repeat(20)}`, {
      anchors: ['reactor'],
    }),
    score: 8,
    source: 'seed',
  };
  const result = renderWorldStateInjection([entry], { budgetTokens: 120 });
  assert.ok(result.estimatedTokens <= 120);
  assert.ok(estimateInjectionTokens(result.text) <= 120);
});

test('low-level renderer also refuses resolved or superseded records', () => {
  const resolved = {
    record: record('resolved-direct', 'The old strike is resolved.', {
      kind: 'development',
      status: 'resolved',
      anchors: ['old strike'],
    }),
    score: 10,
    source: 'seed',
  };
  const result = renderWorldStateInjection([resolved]);
  assert.equal(result.text, '');
  assert.equal(result.included.length, 0);
});

test('budget that fits only the header plus a meaningless fragment produces no injection', () => {
  const entry = {
    record: record('fragment', 'A very long current state summary that cannot meaningfully fit in the remaining budget.', {
      anchors: ['fragment'],
    }),
    score: 10,
    source: 'seed',
  };
  const headerTokens = estimateInjectionTokens(WORLD_STATE_PRIVATE_HEADER);
  const result = renderWorldStateInjection([entry], { budgetTokens: headerTokens + 2 });
  assert.equal(result.text, '');
  assert.equal(result.included.length, 0);
});

test('budget too small for the mandatory privacy header produces no injection', () => {
  const entry = {
    record: record('r', 'The reactor is offline.', { anchors: ['reactor'] }),
    score: 10,
    source: 'seed',
  };
  const result = renderWorldStateInjection([entry], { budgetTokens: 10 });
  assert.equal(result.text, '');
  assert.equal(result.included.length, 0);
  assert.equal(result.estimatedTokens, 0);
});

test('500-record backend still renders only the tiny retrieved subset', () => {
  const records = Array.from({ length: 500 }, (_, index) => record(
    `r${index}`,
    `Unrelated record ${index} is active.`,
    { anchors: [`topic-${index}`] },
  ));
  records[231] = record('reactor', 'Reactor output is limited to emergency levels.', {
    kind: 'development',
    trend: 'falling',
    anchors: ['reactor output', 'reactor'],
  });
  const result = buildWorldStateInjection({ records, links: [] }, {
    recentText: 'The engineer checks the reactor output display.',
    currentMessageId: 600,
  });
  assert.equal(result.retrievalMetrics.scannedRecords, 500);
  assert.equal(result.included.length, 1);
  assert.match(result.text, /Reactor output is limited/);
  assert.doesNotMatch(result.text, /Unrelated record/);
});

test('descriptor is host-neutral and ready for later setExtensionPrompt wiring', () => {
  const state = {
    records: [record('dorm', 'East Dormitory is inaccessible.', { anchors: ['East Dormitory'] })],
    links: [],
  };
  const result = buildWorldStateInjection(state, {
    recentText: 'She walks toward East Dormitory.',
    depth: 3,
  });
  assert.deepEqual(
    {
      namespace: result.descriptor.namespace,
      key: result.descriptor.key,
      placement: result.descriptor.placement,
      role: result.descriptor.role,
      depth: result.descriptor.depth,
      scan: result.descriptor.scan,
    },
    {
      namespace: 'world_state_alpha',
      key: 'world_state_alpha_private_continuity',
      placement: 'IN_CHAT',
      role: 'SYSTEM',
      depth: 3,
      scan: false,
    },
  );
  assert.equal(result.descriptor.text, result.text);
});
