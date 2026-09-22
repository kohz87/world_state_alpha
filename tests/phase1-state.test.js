import test from 'node:test';
import assert from 'node:assert/strict';

import { chatLineage } from '../branch.js';
import {
  createState,
  normalizeState,
  reduceMutations,
} from '../state-core.js';

function createAt(state, chatKey, chat, mutation) {
  const messageId = chat.length - 1;
  const lineageKey = chatLineage(chat)[messageId].lineageKey;
  return reduceMutations(state, { chatKey, messageId, lineageKey, mutations: [mutation] });
}

test('one universal schema supports fantasy, sci-fi, and small social records without scope', () => {
  const fixtures = [
    { summary: 'Freight inspections are delaying ore trade.', anchors: ['Hadrik', 'ore trade'] },
    { summary: 'Reactor output is limited to 60%.', anchors: ['reactor', 'station power'] },
    { summary: 'East Dormitory is inaccessible.', anchors: ['East Dormitory', 'university'] },
  ];
  const chat = [{ role: 'assistant', content: 'world changed' }];

  for (const [index, fixture] of fixtures.entries()) {
    const result = createAt(createState(`fixture-${index}`), `fixture-${index}`, chat, {
      action: 'create',
      kind: index === 1 ? 'fact' : 'development',
      summary: fixture.summary,
      anchors: fixture.anchors,
      evidence: [{ claim: fixture.summary, sourceClass: 'assistant_narration' }],
    });
    assert.equal(result.rejected.length, 0);
    assert.equal(result.state.records.length, 1);
    assert.equal(Object.hasOwn(result.state.records[0], 'scope'), false);
    assert.equal(result.state.records[0].summary, fixture.summary);
  }
});

test('record IDs are deterministic from immutable boundary context, not summary text', () => {
  const chat = [{ role: 'assistant', content: 'The bridge collapsed.' }];
  const mutation = {
    action: 'create',
    kind: 'fact',
    summary: 'The bridge is destroyed.',
    anchors: ['bridge'],
  };
  const a = createAt(createState('same-chat'), 'same-chat', chat, mutation);
  const b = createAt(createState('same-chat'), 'same-chat', chat, { ...mutation, summary: 'Bridge destruction is established.' });
  assert.equal(a.state.records[0].id, b.state.records[0].id);
  assert.notEqual(a.state.records[0].summary, b.state.records[0].summary);
});

test('update omission preserves accepted fields and lifecycle changes are explicit', () => {
  const chat0 = [{ role: 'assistant', content: 'A strike starts.' }];
  let result = createAt(createState('lifecycle'), 'lifecycle', chat0, {
    action: 'create',
    kind: 'development',
    summary: 'The labor strike is active.',
    trend: 'emerging',
    anchors: ['labor strike', 'factory'],
  });
  let state = result.state;
  const id = state.records[0].id;

  const chat1 = [...chat0, { role: 'assistant', content: 'Negotiations stall.' }];
  result = createAt(state, 'lifecycle', chat1, {
    action: 'update',
    recordId: id,
    summary: 'The labor strike remains active; negotiations are stalled.',
    trend: 'stable',
  });
  state = result.state;
  assert.deepEqual(state.records[0].anchors, ['labor strike', 'factory']);
  assert.equal(state.records[0].trend, 'stable');

  const chat2 = [...chat1, { role: 'assistant', content: 'The strike ends.' }];
  result = createAt(state, 'lifecycle', chat2, { action: 'resolve', recordId: id });
  assert.equal(result.state.records[0].status, 'resolved');

  const chat3 = [...chat2, { role: 'assistant', content: 'A later arrangement supersedes the old condition.' }];
  result = createAt(result.state, 'lifecycle', chat3, { action: 'supersede', recordId: id });
  assert.equal(result.state.records[0].status, 'superseded');
});

test('canonical mutation requires raw-message ownership', () => {
  const result = reduceMutations(createState('owned'), {
    chatKey: 'owned',
    mutations: [{ action: 'create', kind: 'fact', summary: 'Unsupported boundary.' }],
  });
  assert.equal(result.state.records.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /messageId and lineageKey/);
});

test('replaying the same create boundary cannot mint a second record id', () => {
  const chat = [{ role: 'assistant', content: 'A bridge collapses.' }];
  const first = createAt(createState('replay'), 'replay', chat, {
    action: 'create',
    kind: 'fact',
    summary: 'The bridge is destroyed.',
    evidence: [{ claim: 'The bridge collapses.', sourceClass: 'assistant_narration' }],
  });
  const replay = createAt(first.state, 'replay', chat, {
    action: 'create',
    kind: 'fact',
    summary: 'The bridge is destroyed.',
    evidence: [{ claim: 'The bridge collapses.', sourceClass: 'assistant_narration' }],
  });
  assert.equal(replay.state.records.length, 1);
  assert.equal(replay.rejected.length, 1);
  assert.equal(replay.state.records[0].id, first.state.records[0].id);
});

test('replaying identical evidence on the same boundary reuses the deterministic evidence id', () => {
  const chat0 = [{ role: 'assistant', content: 'A strike begins.' }];
  const created = createAt(createState('evidence-replay'), 'evidence-replay', chat0, {
    action: 'create',
    kind: 'development',
    summary: 'The strike is active.',
  });
  const id = created.state.records[0].id;
  const chat1 = [...chat0, { role: 'assistant', content: 'Negotiations stall.' }];
  const update = {
    action: 'update',
    recordId: id,
    summary: 'The strike is active and negotiations are stalled.',
    evidence: [{ claim: 'Negotiations stall.', sourceClass: 'assistant_narration' }],
  };
  const first = createAt(created.state, 'evidence-replay', chat1, update);
  const replay = createAt(first.state, 'evidence-replay', chat1, update);
  assert.equal(Object.keys(replay.state.evidence).length, 1);
  assert.equal(replay.state.records[0].evidenceIds.length, 1);
});

test('rejected lifecycle smuggling is atomic and cannot partially rewrite a record', () => {
  const chat0 = [{ role: 'assistant', content: 'A protest begins.' }];
  const created = createAt(createState('atomic-reject'), 'atomic-reject', chat0, {
    action: 'create',
    kind: 'development',
    summary: 'The protest is active.',
  });
  const id = created.state.records[0].id;
  const chat1 = [...chat0, { role: 'assistant', content: 'A malformed proposal tries to resolve it through update.' }];
  const rejected = createAt(created.state, 'atomic-reject', chat1, {
    action: 'update',
    recordId: id,
    summary: 'This summary must not leak.',
    status: 'resolved',
    timeAnchor: 'This time anchor must not leak either.',
  });
  assert.equal(rejected.rejected.length, 1);
  assert.equal(rejected.state.records[0].status, 'active');
  assert.equal(rejected.state.records[0].summary, 'The protest is active.');
  assert.equal(rejected.state.records[0].timeAnchor, '');
});

test('generic related links do not invent causal causedBy semantics', () => {
  const chat0 = [{ role: 'assistant', content: 'Two conditions exist.' }];
  const first = createAt(createState('related-only'), 'related-only', chat0, {
    action: 'create',
    kind: 'fact',
    summary: 'The warehouse is closed.',
  });
  const firstId = first.state.records[0].id;
  const chat1 = [...chat0, { role: 'assistant', content: 'A second condition is associated with the first.' }];
  const second = createAt(first.state, 'related-only', chat1, {
    action: 'create',
    kind: 'development',
    summary: 'Deliveries are rerouting.',
    relatedRecordIds: [firstId],
  });
  const created = second.state.records.find(record => record.id !== firstId);
  assert.deepEqual(created.causedBy, []);
  assert.equal(second.state.links.length, 1);
  assert.equal(second.state.links[0].type, 'related');
});

test('normalization never imports a mandatory scope field', () => {
  const raw = createState('scope-test');
  raw.scope = 'north';
  raw.records.push({
    id: 'wsr_manual',
    kind: 'fact',
    summary: 'A door is closed.',
    status: 'active',
    scope: 'building',
  });
  const normalized = normalizeState(raw);
  assert.equal(Object.hasOwn(normalized, 'scope'), false);
  assert.equal(Object.hasOwn(normalized.records[0], 'scope'), false);
});
