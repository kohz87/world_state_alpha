import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chatLineage,
  commitMutationBoundary,
  fingerprintAssistantNarration,
  rebaseLineageMetadata,
  reconcileBranch,
  seedRootCheckpoint,
} from '../branch.js';
import { createState, reduceMutations } from '../state-core.js';
import { buildWorldStateInjection, continuityInjectionBlocked } from '../injection.js';

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
  assert.equal(continuityInjectionBlocked(reconciled.state, { branchDirty: true }), true);
  const injection = buildWorldStateInjection(reconciled.state, {
    recentText: currentSummary,
    currentMessageId: chat.length,
  });
  assert.equal(injection.text, '');
  assert.equal(injection.retrievalMetrics.blockedByRecovery, true);
});


test('passive rewrite of the latest captured assistant boundary can be rebased without wiping canonical state', () => {
  let chat = [
    { role: 'user', content: 'I wait by the road.' },
    {
      role: 'assistant',
      content: 'The bridge is closed. <writer_state>private planning that the host later strips</writer_state>',
    },
  ];
  let state = seedRootCheckpoint(createState('passive-tail-rewrite'));
  state = apply(state, chat, {
    action: 'create',
    kind: 'fact',
    summary: 'The bridge is closed.',
    anchors: ['bridge'],
  });
  assert.equal(state.records.length, 1);
  assert.equal(state.lastCaptureMessage, 1);
  const capturedNarrationFingerprint = fingerprintAssistantNarration(chat[1]);

  chat = [...chat, { role: 'user', content: 'I take the east road instead.' }];
  const extended = reconcileBranch(state, chat);
  assert.equal(extended.action, 'forward-extension');
  state = extended.state;

  // Simulate SillyTavern/Regex/Reasoning normalizing the just-captured
  // assistant message after capture, without a user branch edit event.
  chat[1] = { role: 'assistant', content: 'The bridge is closed.' };
  chat = [...chat, { role: 'assistant', content: 'Rain starts over the east road.' }];

  const destructive = reconcileBranch(state, chat);
  assert.equal(destructive.action, 'rollback-journal');
  assert.equal(destructive.state.records.length, 0, 'baseline proves the current wipe failure');

  const rebased = reconcileBranch(state, chat, {
    passiveCaptureMessageId: 1,
    passiveCaptureNarrationFingerprint: capturedNarrationFingerprint,
  });
  assert.equal(rebased.failClosed, false);
  assert.equal(rebased.action, 'passive-capture-rebase');
  assert.equal(rebased.divergence, 1);
  assert.equal(rebased.state.records.length, 1);
  assert.equal(rebased.state.records[0].summary, 'The bridge is closed.');
  assert.equal(rebased.state.lineage.length, chat.length);
  assert.equal(rebased.state.rollbackHead.messageId, 1);
  assert.equal(rebased.state.rollbackHead.lineageKey, rebased.state.lineage[1].lineageKey);
});

test('passive capture rebase refuses to mask a second changed owned message', () => {
  let chat = [
    { role: 'assistant', content: 'The bridge is closed. <writer_state>private planning</writer_state>' },
  ];
  let state = seedRootCheckpoint(createState('passive-tail-safety'));
  state = apply(state, chat, {
    action: 'create',
    kind: 'fact',
    summary: 'The bridge is closed.',
  });

  chat = [...chat, { role: 'user', content: 'I head east.' }];
  state = reconcileBranch(state, chat).state;

  const changed = [
    { role: 'assistant', content: 'The bridge is closed.' },
    { role: 'user', content: 'I head west instead.' },
    { role: 'assistant', content: 'Rain begins.' },
  ];
  const reconciled = reconcileBranch(state, changed, {
    passiveCaptureMessageId: 0,
    passiveCaptureNarrationFingerprint: fingerprintAssistantNarration(chat[0]),
  });
  assert.notEqual(reconciled.action, 'passive-capture-rebase');
  assert.equal(reconciled.state.records.length, 0);
});

test('passive capture rebase refuses a silent semantic rewrite of the captured assistant boundary', () => {
  let chat = [{ role: 'assistant', content: 'The bridge is closed. <writer_state>private planning</writer_state>' }];
  let state = seedRootCheckpoint(createState('passive-semantic-rewrite'));
  state = apply(state, chat, {
    action: 'create',
    kind: 'fact',
    summary: 'The bridge is closed.',
    anchors: ['bridge'],
  });
  const capturedNarrationFingerprint = fingerprintAssistantNarration(chat[0]);

  chat = [{ role: 'assistant', content: 'The bridge is open.' }];
  const reconciled = reconcileBranch(state, chat, {
    passiveCaptureMessageId: 0,
    passiveCaptureNarrationFingerprint: capturedNarrationFingerprint,
  });
  assert.notEqual(reconciled.action, 'passive-capture-rebase');
  assert.equal(reconciled.state.records.length, 0);
});

test('cosmetic character-name rewrite can rebase branch ownership without rolling back world state', () => {
  const oldChat = [{
    name: 'Old Character Name',
    is_user: false,
    is_system: false,
    mes: 'The East Gate has collapsed.',
  }];
  let state = seedRootCheckpoint(createState('rename-lineage'));
  state = apply(state, oldChat, {
    action: 'create',
    kind: 'fact',
    summary: 'The East Gate is collapsed.',
    anchors: ['East Gate'],
  });
  assert.equal(state.records.length, 1);

  const newChat = [{
    name: 'New Character Name',
    is_user: false,
    is_system: false,
    mes: 'The East Gate has collapsed.',
  }];
  const previousLineage = chatLineage(oldChat);
  const nextLineage = chatLineage(newChat);
  assert.notEqual(previousLineage[0].lineageKey, nextLineage[0].lineageKey);

  const rebased = rebaseLineageMetadata(state, previousLineage, nextLineage);
  assert.equal(rebased.lineage[0].lineageKey, nextLineage[0].lineageKey);
  assert.equal(rebased.rollbackHead.lineageKey, nextLineage[0].lineageKey);
  assert.equal(rebased.records.length, 1);

  const reconciled = reconcileBranch(rebased, newChat);
  assert.equal(reconciled.failClosed, false);
  assert.equal(reconciled.action, 'same');
  assert.equal(reconciled.state.records.length, 1);
  assert.equal(reconciled.state.records[0].summary, 'The East Gate is collapsed.');
});
