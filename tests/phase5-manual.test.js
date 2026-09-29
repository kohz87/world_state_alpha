import test from 'node:test';
import assert from 'node:assert/strict';

import { chatLineage, reconcileBranch } from '../branch.js';
import {
  MANUAL_LIMITS,
  applyManualLifecycleBatch,
  applyManualMutation,
  applyWorldStateImport,
  applyWorldStateReset,
  inspectWorldStateRecord,
  prepareWorldStateExport,
  previewWorldStateImport,
  previewWorldStateReset,
  queryWorldState,
} from '../manual.js';
import { createState, reduceMutations } from '../state-core.js';

function seedState(chatKey, chat, mutation) {
  const lineage = chatLineage(chat);
  return reduceMutations(createState(chatKey), {
    chatKey,
    messageId: 0,
    lineageKey: lineage[0].lineageKey,
    mutations: Array.isArray(mutation) ? mutation : [mutation],
  }).state;
}

test('manual query and inspect are deterministic read-only projections', () => {
  const chat = [{ role: 'assistant', content: 'The bridge collapses.' }];
  const state = seedState('manual-query', chat, [{
    action: 'create',
    kind: 'fact',
    summary: 'The Northglass bridge is destroyed.',
    anchors: ['Northglass', 'bridge'],
    evidence: [{
      sourceMessageId: 0,
      sourceClass: 'assistant_narration',
      claim: 'The bridge collapses.',
    }],
  }, {
    action: 'create',
    kind: 'fact',
    summary: 'The university library is closed.',
    anchors: ['university', 'library'],
  }]);

  const query = queryWorldState(state, { text: 'northglass bridge', statuses: ['active'] });
  assert.equal(query.totalMatched, 1);
  assert.equal(query.records.length, 1);
  assert.equal(query.records[0].summary, 'The Northglass bridge is destroyed.');
  assert.equal(queryWorldState(state, { text: 'library' }).totalMatched, 1);
  assert.equal(queryWorldState(state, { text: 'reactor' }).totalMatched, 0);

  const detail = inspectWorldStateRecord(state, query.records[0].id);
  assert.equal(detail.record.id, query.records[0].id);
  assert.equal(detail.evidence.length, 1);

  query.records[0].summary = 'mutated projection';
  assert.equal(state.records[0].summary, 'The Northglass bridge is destroyed.');
});

test('targeted manual update is anchored, journaled, and tagged manual without changing capture cadence', () => {
  const chat = [
    { role: 'assistant', content: 'The bridge collapses.' },
    { role: 'user', content: 'I inspect the ruins.' },
  ];
  const state = seedState('manual-update', chat.slice(0, 1), {
    action: 'create',
    kind: 'fact',
    summary: 'The bridge is destroyed.',
    anchors: ['bridge'],
  });
  state.lastCaptureMessage = 0;
  const id = state.records[0].id;

  const result = applyManualMutation({
    state,
    chat,
    chatKey: 'manual-update',
    messageId: 1,
    note: 'Operator correction: the eastern span is the destroyed section.',
    mutation: {
      action: 'update',
      recordId: id,
      summary: 'The eastern bridge span is destroyed.',
      anchors: ['bridge', 'eastern span'],
    },
  });

  assert.equal(result.outcome, 'applied');
  assert.equal(result.state.records[0].summary, 'The eastern bridge span is destroyed.');
  assert.equal(result.state.records[0].lastChangedMessage, 1);
  assert.equal(result.state.lastCaptureMessage, 0);
  const evidence = Object.values(result.state.evidence).find(item => item.sourceClass === 'manual');
  assert.ok(evidence);
  assert.equal(evidence.sourceMessageId, 1);
  assert.equal(result.state.rollbackHead.messageId, 1);

  const rolled = reconcileBranch(result.state, chat.slice(0, 1));
  assert.equal(rolled.failClosed, false);
  assert.equal(rolled.state.records[0].summary, 'The bridge is destroyed.');
});

test('manual lifecycle actions move active records to history with operator evidence', () => {
  const chat = [
    { role: 'assistant', content: 'The orchard sounder remains active.' },
    { role: 'user', content: 'I review the tracker and correct it.' },
  ];
  const state = seedState('manual-history', chat.slice(0, 1), {
    action: 'create',
    kind: 'development',
    summary: 'The orchard sounder remains active.',
    anchors: ['orchard', 'sounder'],
  });
  const id = state.records[0].id;

  const resolved = applyManualMutation({
    state,
    chat,
    chatKey: 'manual-history',
    messageId: 1,
    note: 'Operator correction: the sounder was eliminated in the prior scene.',
    mutation: {
      action: 'resolve',
      recordId: id,
      summary: 'The orchard sounder remains active.',
    },
  });

  assert.equal(resolved.outcome, 'applied');
  assert.equal(resolved.state.records[0].status, 'resolved');
  assert.equal(resolved.state.records[0].summary, 'The orchard sounder remains active.');
  assert.equal(resolved.state.records[0].lastChangedMessage, 1);
  assert.equal(
    Object.values(resolved.state.evidence).some(item =>
      item.sourceClass === 'manual'
      && /sounder was eliminated/i.test(item.claim)),
    true,
  );

  const supersedeState = seedState('manual-history-supersede', chat.slice(0, 1), {
    action: 'create',
    kind: 'fact',
    summary: 'The old freight office handles permits.',
    anchors: ['freight office'],
  });
  const superseded = applyManualMutation({
    state: supersedeState,
    chat,
    chatKey: 'manual-history-supersede',
    messageId: 1,
    note: 'Operator correction: a newer office arrangement replaced this one.',
    mutation: {
      action: 'supersede',
      recordId: supersedeState.records[0].id,
      summary: 'The old freight office handles permits.',
    },
  });

  assert.equal(superseded.outcome, 'applied');
  assert.equal(superseded.state.records[0].status, 'superseded');
});

test('manual create uses duplicate admission rather than proliferating an active thread', () => {
  const chat = [
    { role: 'assistant', content: 'A dock strike begins.' },
    { role: 'user', content: 'I review the situation.' },
  ];
  const state = seedState('manual-dup', chat.slice(0, 1), {
    action: 'create',
    kind: 'development',
    summary: 'The dock labor strike is active.',
    anchors: ['dock', 'labor strike'],
  });
  const existingId = state.records[0].id;

  const result = applyManualMutation({
    state,
    chat,
    chatKey: 'manual-dup',
    messageId: 1,
    note: 'Operator correction: consolidate the dock strike wording.',
    mutation: {
      action: 'create',
      kind: 'development',
      summary: 'The dock labor strike remains active.',
      trend: 'stable',
      anchors: ['dock', 'labor strike'],
    },
  });

  assert.equal(result.outcome, 'applied');
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].id, existingId);
  assert.equal(result.state.records[0].summary, 'The dock labor strike remains active.');
});

test('manual mutation is restricted to the current chat head on the same lineage', () => {
  const chat = [
    { role: 'assistant', content: 'The square is closed.' },
    { role: 'user', content: 'I inspect the square.' },
  ];
  const state = seedState('manual-head', chat.slice(0, 1), {
    action: 'create',
    kind: 'fact',
    summary: 'The square is closed.',
  });
  const id = state.records[0].id;

  assert.throws(() => applyManualMutation({
    state,
    chat,
    chatKey: 'manual-head',
    messageId: 0,
    note: 'Operator correction.',
    mutation: { action: 'update', recordId: id, summary: 'The square is partly open.' },
  }), error => error?.code === 'WORLD_STATE_MANUAL_HEAD_REQUIRED');

  const foreignLineage = chatLineage([
    { role: 'assistant', content: 'A different branch.' },
    { role: 'user', content: 'I inspect the square.' },
  ]);
  state.lineage = foreignLineage;
  assert.throws(() => applyManualMutation({
    state,
    chat,
    chatKey: 'manual-head',
    messageId: 1,
    note: 'Operator correction.',
    mutation: { action: 'update', recordId: id, summary: 'The square is partly open.' },
  }), error => error?.code === 'WORLD_STATE_MANUAL_BRANCH_MISMATCH');
});

test('manual mutation requires an existing boundary and an operator note', () => {
  const chat = [{ role: 'assistant', content: 'The square is closed.' }];
  const state = seedState('manual-guard', chat, {
    action: 'create',
    kind: 'fact',
    summary: 'The square is closed.',
  });
  const id = state.records[0].id;

  assert.throws(() => applyManualMutation({
    state,
    chat,
    chatKey: 'manual-guard',
    messageId: 4,
    note: 'Correction.',
    mutation: { action: 'update', recordId: id, summary: 'The square is open.' },
  }), error => error?.code === 'WORLD_STATE_MANUAL_BOUNDARY_REQUIRED');

  assert.throws(() => applyManualMutation({
    state,
    chat,
    chatKey: 'manual-guard',
    messageId: 0,
    note: '',
    mutation: { action: 'update', recordId: id, summary: 'The square is open.' },
  }), error => error?.code === 'WORLD_STATE_MANUAL_NOTE_REQUIRED');
});

test('export/import UX is preview-then-confirm and foreign import clears local chronology', () => {
  const chat = [{ role: 'assistant', content: 'The bridge collapses.' }];
  const source = seedState('source-chat', chat, {
    action: 'create',
    kind: 'fact',
    summary: 'The bridge is destroyed.',
    anchors: ['bridge'],
    evidence: [{
      sourceMessageId: 0,
      sourceClass: 'assistant_narration',
      claim: 'The bridge collapses.',
    }],
  });
  source.lineage = chatLineage(chat);

  const exported = prepareWorldStateExport(source, { exportedAt: '2026-09-21T00:00:00Z' });
  assert.equal(exported.kind, 'world_state_alpha_export');
  assert.equal(exported.summary.records, 1);

  const preview = previewWorldStateImport(exported.text, { targetChatKey: 'target-chat' });
  assert.equal(preview.kind, 'world_state_alpha_import_preview');
  assert.equal(preview.summary.records, 1);
  assert.equal(preview.branchChronologyCleared, true);
  assert.equal(preview.messageProvenanceCleared, true);
  assert.equal(preview.candidate.records[0].createdAtMessage, null);
  assert.equal(Object.values(preview.candidate.evidence)[0].sourceMessageId, null);
  assert.equal(Object.values(preview.candidate.evidence)[0].sourceClass, 'foreign_import');

  assert.throws(
    () => applyWorldStateImport(preview),
    error => error?.code === 'WORLD_STATE_IMPORT_CONFIRMATION_REQUIRED',
  );
  const applied = applyWorldStateImport(preview, { confirmed: true });
  assert.equal(applied.chatKey, 'target-chat');
  assert.equal(applied.records[0].summary, 'The bridge is destroyed.');
  assert.deepEqual(applied.lineage, []);
});

test('reset UX requires explicit confirmation and creates pristine state', () => {
  const chat = [{ role: 'assistant', content: 'The bridge collapses.' }];
  const state = seedState('reset-manual', chat, {
    action: 'create',
    kind: 'fact',
    summary: 'The bridge is destroyed.',
  });

  const preview = previewWorldStateReset(state);
  assert.equal(preview.current.records, 1);
  assert.throws(
    () => applyWorldStateReset(preview),
    error => error?.code === 'WORLD_STATE_RESET_CONFIRMATION_REQUIRED',
  );
  const reset = applyWorldStateReset(preview, { confirmed: true });
  assert.equal(reset.chatKey, 'reset-manual');
  assert.deepEqual(reset.records, []);
  assert.deepEqual(reset.evidence, {});
});

test('bulk lifecycle action resolves or supersedes many active records in one boundary', () => {
  const chat = [
    { role: 'assistant', content: 'Three threads are open.' },
    { role: 'user', content: 'I clean up the tracker.' },
  ];
  const state = seedState('manual-bulk', chat.slice(0, 1), [
    { action: 'create', kind: 'development', summary: 'The dock strike is active.', anchors: ['dock'] },
    { action: 'create', kind: 'development', summary: 'The tollhouse blockade is active.', anchors: ['tollhouse'] },
    { action: 'create', kind: 'fact', summary: 'The orchard gate is locked.', anchors: ['orchard'] },
  ]);
  const ids = state.records.map(record => record.id);
  const journalBefore = state.rollbackJournal.length;

  const resolved = applyManualLifecycleBatch({
    state,
    chat,
    chatKey: 'manual-bulk',
    messageId: 1,
    action: 'resolve',
    recordIds: ids.slice(0, 2),
    note: 'Operator cleanup: both episodes ended off-screen.',
  });
  assert.equal(resolved.outcome, 'applied');
  assert.deepEqual(resolved.state.records.map(record => record.status), ['resolved', 'resolved', 'active']);
  assert.deepEqual(
    resolved.state.records.map(record => record.summary),
    state.records.map(record => record.summary),
  );
  assert.equal(resolved.state.records[0].lastChangedMessage, 1);
  assert.equal(resolved.state.rollbackJournal.length, journalBefore + 1);
  assert.equal(
    Object.values(resolved.state.evidence).filter(item =>
      item.sourceClass === 'manual' && /both episodes ended/.test(item.claim)).length >= 2,
    true,
  );
  assert.equal(state.records.every(record => record.status === 'active'), true);

  const superseded = applyManualLifecycleBatch({
    state,
    chat,
    chatKey: 'manual-bulk',
    messageId: 1,
    action: 'supersede',
    recordIds: ids,
    note: 'Operator cleanup: replaced by the new arrangement.',
  });
  assert.equal(superseded.outcome, 'applied');
  assert.equal(superseded.state.records.every(record => record.status === 'superseded'), true);
});

test('bulk lifecycle action is all-or-nothing and bounded', () => {
  const chat = [
    { role: 'assistant', content: 'Two threads are open.' },
    { role: 'user', content: 'I clean up the tracker.' },
  ];
  const state = seedState('manual-bulk-guard', chat.slice(0, 1), [
    { action: 'create', kind: 'development', summary: 'The dock strike is active.', anchors: ['dock'] },
    { action: 'create', kind: 'development', summary: 'The tollhouse blockade is active.', anchors: ['tollhouse'] },
  ]);
  const [first, second] = state.records.map(record => record.id);
  const base = { state, chat, chatKey: 'manual-bulk-guard', messageId: 1, action: 'resolve', note: 'Operator cleanup.' };

  const missing = applyManualLifecycleBatch({ ...base, recordIds: [first, 'ghost'] });
  assert.equal(missing.outcome, 'rejected');
  assert.equal(missing.state.records.every(record => record.status === 'active'), true);

  const already = applyManualLifecycleBatch({ ...base, recordIds: [first] });
  const again = applyManualLifecycleBatch({ ...base, state: already.state, recordIds: [first, second] });
  assert.equal(again.outcome, 'rejected');
  assert.equal(again.rejected[0].recordId, first);
  assert.equal(again.state.records.find(record => record.id === second).status, 'active');

  assert.throws(() => applyManualLifecycleBatch({ ...base, recordIds: [] }), /at least one record/);
  assert.throws(() => applyManualLifecycleBatch({ ...base, action: 'update', recordIds: [first] }), /resolve or supersede/);
  assert.throws(() => applyManualLifecycleBatch({ ...base, note: '  ', recordIds: [first] }), /operator note/);
  assert.throws(
    () => applyManualLifecycleBatch({
      ...base,
      recordIds: Array.from({ length: MANUAL_LIMITS.bulkRecords + 1 }, (_, index) => 'r' + index),
    }),
    /limited to/,
  );
  assert.throws(() => applyManualLifecycleBatch({ ...base, messageId: 0, recordIds: [first] }), /current raw-message head/);
});
