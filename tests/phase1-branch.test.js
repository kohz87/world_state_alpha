import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chatLineage,
  commitMutationBoundary,
  reconcileBranch,
  seedRootCheckpoint,
} from '../branch.js';
import { createState, reduceMutations } from '../state-core.js';

function apply(state, chat, mutation, options = {}) {
  const messageId = chat.length - 1;
  const lineageKey = chatLineage(chat)[messageId].lineageKey;
  const reduced = reduceMutations(state, {
    chatKey: state.chatKey,
    messageId,
    lineageKey,
    mutations: [mutation],
  });
  return commitMutationBoundary(state, reduced.state, chat, messageId, mutation.action, options);
}

test('tail delete restores the exact surviving boundary', () => {
  let state = seedRootCheckpoint(createState('tail'));
  const c0 = [{ role: 'assistant', content: 'Bridge collapses.' }];
  state = apply(state, c0, { action: 'create', kind: 'fact', summary: 'The bridge is destroyed.', anchors: ['bridge'] });
  const id = state.records[0].id;

  const c1 = [...c0, { role: 'assistant', content: 'A temporary ferry opens.' }];
  state = apply(state, c1, { action: 'update', recordId: id, summary: 'The bridge is destroyed; a temporary ferry is operating.' });
  const expected = state.records[0].summary;

  const c2 = [...c1, { role: 'assistant', content: 'The ferry closes.' }];
  state = apply(state, c2, { action: 'update', recordId: id, summary: 'The bridge is destroyed and the temporary ferry is closed.' });

  const reconciled = reconcileBranch(state, c1);
  assert.equal(reconciled.failClosed, false);
  assert.equal(reconciled.exactRestored, true);
  assert.equal(reconciled.state.records[0].summary, expected);
  assert.equal(reconciled.state.lineage.length, c1.length);
});

test('swipe/branch replacement removes ghost state from the abandoned suffix', () => {
  let state = seedRootCheckpoint(createState('swipe'));
  const c0 = [{ role: 'assistant', content: 'The ruler is alive.' }];
  state = apply(state, c0, { action: 'create', kind: 'fact', summary: 'King Aldren rules Valenne.', anchors: ['Aldren', 'Valenne'] });
  const id = state.records[0].id;

  const dead = [...c0, { role: 'assistant', content: 'King Aldren dies.' }];
  state = apply(state, dead, { action: 'update', recordId: id, summary: 'King Aldren is deceased.' });
  assert.match(state.records[0].summary, /deceased/);

  const swiped = [...c0, { role: 'assistant', content: 'King Aldren survives the illness.' }];
  const reconciled = reconcileBranch(state, swiped);
  assert.equal(reconciled.failClosed, false);
  assert.equal(reconciled.state.records[0].summary, 'King Aldren rules Valenne.');
});

test('multiple writes on one raw message coalesce to earliest-before undo', () => {
  let state = seedRootCheckpoint(createState('coalesce'));
  const chat = [{ role: 'assistant', content: 'A reactor incident establishes several facts.' }];
  state = apply(state, chat, { action: 'create', kind: 'development', summary: 'Reactor output is degraded.', anchors: ['reactor'] });
  const id = state.records[0].id;
  state = apply(state, chat, { action: 'update', recordId: id, summary: 'Reactor output is degraded to 60%.', trend: 'falling' });

  assert.equal(state.rollbackJournal.length, 1);
  const reconciled = reconcileBranch(state, []);
  assert.equal(reconciled.failClosed, false);
  assert.equal(reconciled.state.records.length, 0);
});

test('same-message coalescing keeps one boundary undo even when only capture metadata differs', () => {
  let state = seedRootCheckpoint(createState('net-zero'));
  const c0 = [{ role: 'assistant', content: 'Baseline condition.' }];
  state = apply(state, c0, { action: 'create', kind: 'fact', summary: 'Condition A.' });
  const id = state.records[0].id;

  const c1 = [...c0, { role: 'assistant', content: 'A temporary contradictory beat occurs.' }];
  state = apply(state, c1, { action: 'update', recordId: id, summary: 'Condition B.' });
  state = apply(state, c1, { action: 'update', recordId: id, summary: 'Condition A.' });

  assert.equal(state.records[0].summary, 'Condition A.');
  assert.equal(state.rollbackJournal.length, 2);
  const sameBoundaryEntries = state.rollbackJournal.filter(entry => entry.messageId === 1);
  assert.equal(sameBoundaryEntries.length, 1);
  assert.equal(sameBoundaryEntries[0].undo.records.length, 1);
  assert.equal(sameBoundaryEntries[0].undo.records[0].before.summary, 'Condition A.');
  assert.equal(sameBoundaryEntries[0].undo.records[0].before.lastEvaluatedMessage, 0);
  assert.equal(sameBoundaryEntries[0].undo.lastCaptureMessageBefore, 0);

  const reconciled = reconcileBranch(state, c0);
  assert.equal(reconciled.failClosed, false);
  assert.equal(reconciled.state.records[0].summary, 'Condition A.');
  assert.equal(reconciled.state.lastCaptureMessage, 0);
});

test('deep destructive history change fails closed when exact boundary aged out', () => {
  let state = seedRootCheckpoint(createState('deep'));
  let chat = [];
  let id = null;
  for (let i = 0; i < 6; i += 1) {
    chat = [...chat, { role: 'assistant', content: `turn-${i}` }];
    if (i === 0) {
      state = apply(state, chat, { action: 'create', kind: 'development', summary: 'Condition 0.' }, {
        maxJournalEntries: 2,
        maxCheckpoints: 1,
      });
      id = state.records[0].id;
    } else {
      state = apply(state, chat, { action: 'update', recordId: id, summary: `Condition ${i}.` }, {
        maxJournalEntries: 2,
        maxCheckpoints: 1,
      });
    }
  }

  const currentSummary = state.records[0].summary;
  const reconciled = reconcileBranch(state, chat.slice(0, 1), {
    maxJournalEntries: 2,
    maxCheckpoints: 1,
  });
  assert.equal(reconciled.failClosed, true);
  assert.equal(reconciled.exactRestored, false);
  assert.equal(reconciled.state.records[0].summary, currentSummary);
  assert.equal(reconciled.state.recoveryRequired.reason, 'exact-boundary-unavailable');
});
