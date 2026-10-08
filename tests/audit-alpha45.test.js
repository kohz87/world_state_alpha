// alpha.45: the high-priority findings A01-A08 of the external alpha.44 audit, each reproduced against 0.9.0-alpha.44 first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { chatLineage, commitMutationBoundary, reconcileBranch, seedRootCheckpoint } from '../branch.js';
import { detectElapsedHintFromExchange } from '../elapsed.js';
import { prepareWorldStateContinuity } from '../evolution.js';
import { runManualRebuild } from '../rebuild.js';
import { buildRelevanceIndex } from '../relevance.js';
import { reduceSpatialMutations, normalizeSpatialState } from '../spatial-core.js';
import { applySpatialManualMutation } from '../spatial-manual.js';
import { createState, normalizeState, reduceMutations } from '../state-core.js';
import { exportBundle, importBundle } from '../transfer.js';

const elapsed = content => detectElapsedHintFromExchange([{ messageId: 3, role: 'assistant', lineageKey: 'k3', content }]);

test('A08/A18: quoted or planned time never becomes elapsed evidence, and a short skip never masks a meaningful one', () => {
  // Before: after rejecting "Two weeks later", the next match lost its opening quote and was accepted.
  assert.equal(elapsed('The guide says, "Two weeks later or after three months, we return."'), null);
  assert.equal(elapsed('We plan to leave two weeks later or after three months.'), null);
  assert.equal(elapsed("The guide says, 'Two weeks later we return.' Nothing else changes."), null);
  // Before: the first accepted match won even when it was not meaningful.
  const masked = elapsed('Two hours later, I wait here. Five weeks later, I return to the reactor.');
  assert.equal(masked?.raw, 'Five weeks later');
  assert.equal(masked?.meaningful, true);
  assert.match(masked.context, /reactor/);
  // Still found: a real skip after a quoted mention or a plan, and a lone short skip.
  assert.equal(elapsed('"Two weeks later is too late," she said. Two weeks later, the gate opened.')?.raw, 'Two weeks later');
  assert.equal(elapsed('They planned to leave two weeks later. Three weeks later, the caravan reached the pass.')?.raw, 'Three weeks later');
  assert.equal(elapsed('Two hours later, the rain stops.')?.meaningful, false);
});

test('A01/A02: the past-chat rename writes the server state with its own revision; conflicts never reinstall the discarded index', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const rename = source.slice(source.indexOf('async function handleCharacterRenamedInPastChat'), source.indexOf('async function handleCharacterDeleted('));
  // Before: `if (!currentState) currentState = recovered.payload.state;` kept a stale cache with the newer revision.
  assert.doesNotMatch(rename, /if \(!currentState\) currentState = recovered\.payload\.state;/);
  assert.match(rename, /actualPointer = recovered\.pointer;[\s\S]{0,300}currentState = recovered\.payload\.state;/);
  // Before: both handlers rebuilt the index from the discarded `before` state after a conflict.
  assert.doesNotMatch(source, /resetRelevanceIndex\(chatKey, before\)/);
  assert.match(source, /function resetIndexesFromCache\(chatKey\) \{\s*const current = stateCache\.get\(chatKey\) \|\| null;/);
  const capture = source.slice(source.indexOf('async function handleAssistantMessage('), source.indexOf('async function handleUserMessage('));
  // Capture never touches the shared index before saving, and a conflict already re-hydrated it.
  assert.match(capture, /if \(persisted\.stale\) return;/);
  // Evolution's background cursor moved: any unsaved outcome rebuilds the index from the cached state.
  const continuity = source.slice(source.indexOf('async function handleUserMessage('), source.indexOf('async function handleBranchChange('));
  assert.equal((continuity.match(/resetIndexesFromCache\(chatKey\);/g) || []).length, 5);
});

test('A05: evolution leaves the shared index alone until the host has saved its state', async () => {
  const chat = [
    { role: 'user', content: 'I check the pass.' },
    { role: 'assistant', content: 'Kesselpass freight traffic is congested by diverted caravans.' },
  ];
  const lineage = chatLineage(chat);
  const seeded = reduceMutations(createState('a05'), {
    chatKey: 'a05', messageId: 1, lineageKey: lineage[1].lineageKey,
    mutations: [{ action: 'create', kind: 'development', summary: 'Kesselpass freight traffic is congested', trend: 'rising', anchors: ['Kesselpass', 'freight traffic'], evidence: [{ sourceMessageId: 1, claim: 'Kesselpass freight traffic is congested by diverted caravans.' }] }],
  }).state;
  const record = seeded.records[0];
  const turn = [...chat, { role: 'user', content: 'Five weeks later, Lucien returns to Kesselpass.' }];
  const exchange = turn.map((message, messageId) => ({ ...message, messageId, lineageKey: chatLineage(turn)[messageId].lineageKey }));
  const response = JSON.stringify({
    evaluations: [{ recordId: record.id, outcome: 'update', summary: 'Kesselpass freight congestion has stopped worsening.', trend: 'stable', reason: 'The congestion persisted without further escalation.', supportIds: ['t0', 'h0'] }],
    derived: [],
  });
  const index = buildRelevanceIndex(seeded);
  const before = JSON.stringify(index.byId.get(record.id));
  const prepared = await prepareWorldStateContinuity({
    ctx: { extensionSettings: { world_state_alpha: {}, disabledExtensions: [] }, async generateRaw() { return response; } },
    state: seeded,
    index,
    recentText: 'Five weeks later, Lucien returns to Kesselpass.',
    exchange,
    currentMessageId: 2,
    chatKey: 'a05',
    sourceMessageId: 2,
    sourceLineageKey: exchange[2].lineageKey,
    isCurrent: () => true,
    publishIndex: false,
  });
  assert.equal(prepared.evolution.outcome, 'evolved');
  assert.match(prepared.state.records[0].summary, /stopped worsening/);
  // Before: the shared index already carried the unsaved update, which the next prompt read.
  assert.equal(JSON.stringify(index.byId.get(record.id)), before);
  assert.equal(prepared.injection, null);
  assert.ok(prepared.evolution.indexDelta);
  const source = fs.readFileSync('index.js', 'utf8');
  assert.match(source, /publishIndex: false,/);
  assert.match(source, /setCachedState\(chatKey, committed, indexDelta\s*\? \{ indexMode: 'delta', indexDelta/);
});

const placeChat = [
  { name: 'You', is_user: true, is_system: false, mes: 'I walk north.' },
  { name: 'Narrator', is_user: false, is_system: false, mes: 'The road bends past fields.' },
  { name: 'You', is_user: true, is_system: false, mes: 'I climb the hill.' },
  { name: 'Narrator', is_user: false, is_system: false, mes: 'The Old Watchtower stands on the hill.' },
];
const dispatcher = async () => ({ text: '{"mutations":[]}', receipt: { route: 'test', dispatched: true } });

// A state whose place was captured from reply 3, with that change journaled at message 3.
function stateWithCapturedPlace() {
  const lineage = chatLineage(placeChat);
  let state = seedRootCheckpoint(createState('a03'));
  state = reconcileBranch(state, placeChat.slice(0, 2)).state;
  state = commitMutationBoundary(state, { ...state, lastCaptureMessage: 1 }, placeChat.slice(0, 2), 1, 'capture');
  state = reconcileBranch(state, placeChat).state;
  const reduced = reduceSpatialMutations(state.spatial, {
    chatKey: 'a03', messageId: 3, lineageKey: lineage[3].lineageKey, operation: 'capture',
    mutations: [{ action: 'upsert_location', name: 'Old Watchtower', type: 'tower', evidence: [{ sourceMessageId: 3, claim: 'The Old Watchtower stands on the hill.' }] }],
  });
  assert.equal(reduced.spatial.locations.length, 1);
  return commitMutationBoundary(state, { ...state, spatial: reduced.spatial, lastCaptureMessage: 3 }, placeChat, 3, 'capture');
}

test('A03/A04: a Reality-only rebuild keeps places changed in its range and still rolls them back with their reply', async () => {
  const original = stateWithCapturedPlace();
  // Before: a partial rebuild from message 2 restored places from the prefix only and lost Old Watchtower.
  const partial = await runManualRebuild({ ctx: {}, state: original, chat: placeChat, chatKey: 'a03', startMessageId: 2, isCurrent: () => true, dispatcher });
  assert.equal(partial.outcome, 'completed');
  assert.deepEqual(partial.state.spatial.locations.map(item => item.name), ['Old Watchtower']);

  // Before: after a full Reality-only rebuild, swiping reply 3 kept the place (ghost of the left branch).
  const full = await runManualRebuild({ ctx: {}, state: original, chat: placeChat, chatKey: 'a03', isCurrent: () => true, dispatcher });
  assert.equal(full.outcome, 'completed');
  assert.deepEqual(full.state.spatial.locations.map(item => item.name), ['Old Watchtower']);
  const swiped = placeChat.map((message, index) => index === 3 ? { ...message, mes: 'The hill is bare.' } : message);
  const rolled = reconcileBranch(full.state, swiped);
  assert.equal(rolled.failClosed, false);
  assert.deepEqual(rolled.state.spatial.locations, []);
  // The original state rolls back the same way.
  assert.deepEqual(reconcileBranch(original, swiped).state.spatial.locations, []);

  // Hiding an earlier message is not a branch change: the place is still replayed and owned by its reply.
  const hidden = placeChat.map((message, index) => index === 0 ? { ...message, is_system: true } : message);
  const afterHide = await runManualRebuild({ ctx: {}, state: original, chat: hidden, chatKey: 'a03', isCurrent: () => true, dispatcher });
  assert.deepEqual(afterHide.state.spatial.locations.map(item => item.name), ['Old Watchtower']);
  assert.deepEqual(afterHide.warnings, []);

  // A chat that changed below the oldest saved change while places exist cannot be told apart: Reality is
  // still rebuilt, the places held at the floor are kept, and the operator is told to review them.
  const trimmed = normalizeState({ ...original, rollbackJournal: [], rollbackHead: null, rollbackJournalFloorMessageId: 3 });
  const diverged = placeChat.map((message, index) => index === 1 ? { ...message, mes: 'The road ends at a river.' } : message);
  const unverified = await runManualRebuild({ ctx: {}, state: trimmed, chat: diverged, chatKey: 'a03', isCurrent: () => true, dispatcher });
  assert.equal(unverified.outcome, 'completed');
  assert.deepEqual(unverified.warnings.map(item => item.code), ['WORLD_STATE_REBUILD_SPATIAL_HISTORY_UNVERIFIED']);
  assert.deepEqual(unverified.state.spatial.locations.map(item => item.name), ['Old Watchtower']);
  // Places held before the floor bound the rebuilt journal to it: a rollback below it fails closed.
  assert.ok(unverified.state.rollbackJournalFloorMessageId >= 3);
  assert.equal(reconcileBranch(unverified.state, diverged.slice(0, 2)).failClosed, true);
});

function manualPlace() {
  const chat = placeChat;
  let state = reconcileBranch(seedRootCheckpoint(createState('a06')), chat).state;
  state = applySpatialManualMutation({
    state, chat, chatKey: 'a06', messageId: 3, note: 'Surveyed by the party',
    mutation: { action: 'upsert_location', name: 'Old Watchtower', type: 'ruin', context: 'Collapsed signal tower', notes: 'Operator note' },
  }).state;
  return state;
}

test('A06: operator-authored place metadata stays protected after its evidence is trimmed or imported', () => {
  const state = manualPlace();
  const place = state.spatial.locations[0];
  assert.equal(place.operatorOwned, true);
  // Trim every manual evidence entry, as 32 later confirmations would.
  const trimmed = normalizeSpatialState({ ...state.spatial, evidence: {}, locations: [{ ...place, evidenceIds: [] }] });
  const overwrite = reduceSpatialMutations(trimmed, {
    chatKey: 'a06', messageId: 5, lineageKey: 'ln5', operation: 'capture',
    mutations: [{ action: 'upsert_location', name: 'Old Watchtower', type: 'landmark', context: 'A tower', notes: 'Model note' }],
  });
  // Before: with no manual evidence left the capture rewrote type/context/notes.
  assert.deepEqual([overwrite.spatial.locations[0].type, overwrite.spatial.locations[0].context, overwrite.spatial.locations[0].notes], ['ruin', 'Collapsed signal tower', 'Operator note']);

  // Before: a foreign import relabelled manual evidence and dropped the protection.
  const imported = importBundle(exportBundle(state), { targetChatKey: 'other-chat' });
  assert.ok(Object.values(imported.spatial.evidence).every(item => item.sourceClass === 'foreign_import'));
  const importedPlace = imported.spatial.locations[0];
  assert.equal(importedPlace.operatorOwned, true);
  const afterImport = reduceSpatialMutations(imported.spatial, {
    chatKey: 'other-chat', messageId: 1, lineageKey: 'ln1', operation: 'capture',
    mutations: [{ action: 'upsert_location', name: 'Old Watchtower', type: 'landmark', notes: 'Model note' }],
  });
  assert.equal(afterImport.spatial.locations[0].type, 'ruin');
  // A state saved before the flag existed derives it from its manual evidence.
  const legacy = normalizeSpatialState({ ...state.spatial, locations: [{ ...place, operatorOwned: undefined }] });
  assert.equal(legacy.locations[0].operatorOwned, true);
});

test('A07: confirming the same coordinates never downgrades campaign authority', () => {
  const spatial = normalizeSpatialState({
    locations: [{ id: 'wsloc_tower', name: 'Old Watchtower', type: 'tower', status: 'active', coordinate: { x: 10, y: 20, authority: 'campaign_override', locked: false } }],
  });
  const confirm = reduceSpatialMutations(spatial, {
    chatKey: 'a07', messageId: 3, lineageKey: 'ln3', operation: 'capture',
    mutations: [{ action: 'upsert_location', name: 'Old Watchtower', coordinate: { x: 10, y: 20, authority: 'narrative_explicit' } }],
  });
  // Before: the confirmation replaced campaign_override with narrative_explicit.
  assert.equal(confirm.spatial.locations[0].coordinate.authority, 'campaign_override');
  const move = reduceSpatialMutations(confirm.spatial, {
    chatKey: 'a07', messageId: 5, lineageKey: 'ln5', operation: 'capture',
    mutations: [{ action: 'upsert_location', name: 'Old Watchtower', coordinate: { x: 99, y: 88, authority: 'narrative_explicit' } }],
  });
  assert.deepEqual([move.spatial.locations[0].coordinate.x, move.spatial.locations[0].coordinate.y], [10, 20]);
  assert.equal(move.rejected.length, 1);
});

test('review hardening: long or contracted dialogue, newest-message precedence, merged ownership, and the first entry after the floor', async () => {
  // A speech longer than 600 characters never shifts quote pairing onto the narration after it.
  assert.equal(elapsed('"' + 'x'.repeat(650) + '" Two weeks later, the camp emptied. "Fine," she said.')?.raw, 'Two weeks later');
  // Single-quoted dialogue with a contraction is still dialogue, and "we'll" is a plan.
  assert.equal(elapsed("'Two weeks later, we'll be gone,' she said."), null);
  assert.equal(elapsed("Two weeks later, we'll be gone."), null);
  // The newest message with a time phrase decides; an older meaningful skip never re-fires over it.
  const exchange = [
    { messageId: 10, role: 'assistant', lineageKey: 'a', content: 'Three weeks later the snow melted.' },
    { messageId: 11, role: 'user', lineageKey: 'b', content: 'I wait.' },
    { messageId: 12, role: 'assistant', lineageKey: 'c', content: 'An hour later the fire died.' },
  ];
  assert.equal(detectElapsedHintFromExchange(exchange)?.raw, 'An hour later');

  // Merging an operator-owned place keeps that authority on the surviving place.
  const owned = manualPlace();
  const withDuplicate = reduceSpatialMutations(owned.spatial, {
    chatKey: 'a06', messageId: 4, lineageKey: 'ln4', operation: 'capture',
    mutations: [{ action: 'upsert_location', name: 'Watchtower Ruin', type: 'landmark', evidence: [{ sourceMessageId: 4, claim: 'A ruin.' }] }],
  }).spatial;
  const sourceId = withDuplicate.locations.find(item => item.name === 'Old Watchtower').id;
  const targetId = withDuplicate.locations.find(item => item.name === 'Watchtower Ruin').id;
  const merged = reduceSpatialMutations(withDuplicate, {
    chatKey: 'a06', messageId: 5, lineageKey: 'ln5', operation: 'manual',
    mutations: [{ action: 'merge_locations', sourceId, targetId }],
  }).spatial;
  assert.equal(merged.locations.find(item => item.id === targetId).operatorOwned, true);

  // Bounding the rebuilt journal to the floor keeps the first entry after it, so that reply still rolls back.
  const original = stateWithCapturedPlace();
  const trimmed = normalizeState({ ...original, rollbackJournal: [], rollbackHead: null, rollbackJournalFloorMessageId: 1 });
  const rebuilt = await runManualRebuild({ ctx: {}, state: trimmed, chat: placeChat, chatKey: 'a03', isCurrent: () => true, dispatcher });
  assert.equal(rebuilt.outcome, 'completed');
  assert.equal(rebuilt.state.rollbackJournalFloorMessageId, 1);
  assert.ok(rebuilt.state.rollbackJournal.some(entry => entry.messageId === 3));
  const swiped = placeChat.map((message, index) => index === 3 ? { ...message, mes: 'The hill is bare.' } : message);
  assert.equal(reconcileBranch(rebuilt.state, swiped).failClosed, false);
});
