import test from 'node:test';
import assert from 'node:assert/strict';

import { chatLineage, commitMutationBoundary, reconcileBranch, seedRootCheckpoint } from '../branch.js';
import { createState, reduceMutations } from '../state-core.js';

// SillyTavern's /hide (also used by Memory Books auto-hide) sets only
// `is_system: true` on the processed rows. That changes each hidden row's
// fingerprint and every later chained lineage key, but not the story.

const narrator = mes => ({ name: 'Sera', is_user: false, is_system: false, mes });
const player = mes => ({ name: 'You', is_user: true, is_system: false, mes });

function baseChat() {
  return [
    narrator('Rain falls on Farwick.'),
    player('I walk to the mill.'),
    narrator('The Mill burns through the night.'),
    player('I run for the bridge.'),
    narrator('The Bridge collapses into the river.'),
    player('I head to the harbor.'),
    narrator('The Harbor is closed by the Wardens.'),
  ];
}

// Journaled captures at every assistant boundary after the greeting, exactly
// as the host commits them (reducer mutation + lastCaptureMessage + journal).
function capturedState(chat) {
  let state = seedRootCheckpoint(createState('chat:test:visibility'));
  for (const messageId of [2, 4, 6]) {
    const prefix = chat.slice(0, messageId + 1);
    state = reconcileBranch(state, prefix).state;
    const lineageKey = chatLineage(prefix)[messageId].lineageKey;
    const summary = prefix[messageId].mes;
    const reduced = reduceMutations(state, {
      chatKey: state.chatKey,
      messageId,
      lineageKey,
      mutations: [{ action: 'create', kind: 'fact', summary, anchors: [summary.split(' ')[1]] }],
    }).state;
    reduced.lastCaptureMessage = messageId;
    state = commitMutationBoundary(state, reduced, prefix, messageId, 'capture', { lineage: state.lineage });
  }
  return state;
}

const hide = (chat, ids, hidden = true) =>
  chat.map((message, index) => (ids.includes(index) ? { ...message, is_system: hidden } : message));
const activeSummaries = state => state.records
  .filter(record => record.status === 'active')
  .map(record => record.summary)
  .sort();
const liveKeys = chat => chatLineage(chat).map(entry => entry.lineageKey);

// C10 for a real change: never rebased; either exact rollback removes the
// abandoned captures, or (when the boundary is unprovable) the state fails
// closed with recoveryRequired so nothing is injected from it.
function assertNoGhostState(result, abandoned) {
  assert.notEqual(result.action, 'semantic-lineage-rebase');
  if (result.failClosed) {
    assert.ok(result.state.recoveryRequired, 'fail-closed state must be marked for recovery');
    return;
  }
  assert.equal(result.state.recoveryRequired, null);
  for (const summary of abandoned) assert.ok(!activeSummaries(result.state).includes(summary), summary + ' must not survive');
}

const ALL_THREE = ['The Bridge collapses into the river.', 'The Harbor is closed by the Wardens.', 'The Mill burns through the night.'];

test('hiding a range of user and assistant rows rebases and keeps every record active', () => {
  const chat = baseChat();
  const state = capturedState(chat);
  const hidden = hide(chat, [0, 1, 2, 3, 4]);

  const result = reconcileBranch(state, hidden);
  assert.equal(result.action, 'semantic-lineage-rebase');
  assert.equal(result.failClosed, false);
  assert.equal(result.state.recoveryRequired, null);
  assert.equal(result.state.records.length, 3);
  assert.deepEqual(activeSummaries(result.state), ALL_THREE);
  assert.equal(result.state.lastCaptureMessage, 6);
  assert.deepEqual(result.state.lineage.map(entry => entry.lineageKey), liveKeys(hidden));
});

test('hiding a single user row rebases', () => {
  const chat = baseChat();
  const state = capturedState(chat);
  const hidden = hide(chat, [3]);

  const result = reconcileBranch(state, hidden);
  assert.equal(result.action, 'semantic-lineage-rebase');
  assert.equal(result.failClosed, false);
  assert.equal(result.state.recoveryRequired, null);
  assert.deepEqual(activeSummaries(result.state), ALL_THREE);
  assert.deepEqual(result.state.lineage.map(entry => entry.lineageKey), liveKeys(hidden));
});

test('unhiding after a hide rebases back (Memory Books unhide/rehide)', () => {
  const chat = baseChat();
  const state = capturedState(chat);
  const hidden = reconcileBranch(state, hide(chat, [1, 2, 3]));
  assert.equal(hidden.action, 'semantic-lineage-rebase');

  const unhidden = reconcileBranch(hidden.state, chat);
  assert.equal(unhidden.action, 'semantic-lineage-rebase');
  assert.equal(unhidden.failClosed, false);
  assert.equal(unhidden.state.recoveryRequired, null);
  assert.deepEqual(activeSummaries(unhidden.state), ALL_THREE);
  assert.deepEqual(unhidden.state.lineage.map(entry => entry.lineageKey), liveKeys(chat));

  const rehidden = reconcileBranch(unhidden.state, hide(chat, [1, 2, 3]));
  assert.equal(rehidden.action, 'semantic-lineage-rebase');
  assert.deepEqual(activeSummaries(rehidden.state), ALL_THREE);
});

test('a hide plus a real user content edit does not rebase', () => {
  const chat = baseChat();
  const state = capturedState(chat);
  const edited = hide(chat, [1]).map((message, index) => (index === 3 ? { ...message, mes: 'I run for the ferry.' } : message));

  // Captures owned by the edited turn and after it are abandoned.
  assertNoGhostState(reconcileBranch(state, edited), [
    'The Bridge collapses into the river.',
    'The Harbor is closed by the Wardens.',
  ]);
});

test('a hidden row whose content also changed does not rebase', () => {
  const chat = baseChat();
  const state = capturedState(chat);
  const edited = chat.map((message, index) => (index === 1 ? { ...message, is_system: true, mes: 'I walk to the chapel.' } : message));

  assertNoGhostState(reconcileBranch(state, edited), ALL_THREE);
});

test('a state already stuck with recoveryRequired from the old behavior heals on the next reconcile', () => {
  const chat = baseChat();
  // The old code failed closed at the first hidden user row and kept the
  // stale pre-hide lineage with recoveryRequired set; every later boundary
  // then hit the same mismatch.
  const stuck = capturedState(chat);
  stuck.recoveryRequired = { reason: 'exact-boundary-unavailable', divergence: 1, targetMessageId: 0 };

  // The next assistant boundary arrives on the hidden chat.
  const live = [...hide(chat, [0, 1, 2, 3, 4]), player('I rest at the inn.'), narrator('The Inn is full of pilgrims.')];
  const result = reconcileBranch(stuck, live);
  assert.equal(result.action, 'semantic-lineage-rebase');
  assert.equal(result.failClosed, false);
  assert.equal(result.state.recoveryRequired, null);
  assert.deepEqual(activeSummaries(result.state), ALL_THREE);
  assert.equal(result.state.lineage.length, live.length);
  assert.deepEqual(result.state.lineage.map(entry => entry.lineageKey), liveKeys(live));
});
