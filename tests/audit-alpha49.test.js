// alpha.49: external audit A30 and the batch 5 performance items, each reproduced against 0.9.0-alpha.48
// first with an operation count or an identity check (never a wall-clock threshold).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { chatLineage, commitMutationBoundary, seedRootCheckpoint } from '../branch.js';
import { normalizeSpatialState, reduceSpatialMutations, resolveEffectiveLocations } from '../spatial-core.js';
import { createState, reduceMutations } from '../state-core.js';

const source = fs.readFileSync('index.js', 'utf8');
const rebuildSource = fs.readFileSync('rebuild.js', 'utf8');

function countedBaseMap(size) {
  const counter = { reads: 0 };
  const items = [];
  for (let i = 0; i < size; i += 1) items.push({ id: 'b' + i, name: 'Base ' + i, coordinate: { x: i, y: 0 } });
  const locations = new Proxy(items, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) counter.reads += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  return { baseMap: { locations }, counter };
}

test('A30: an empty Places capture never walks the base map; a one-place change does not clone it', () => {
  const { baseMap, counter } = countedBaseMap(1000);
  const spatial = normalizeSpatialState({});
  const batch = mutations => ({ chatKey: 'a49', messageId: 3, lineageKey: 'ln3', operation: 'capture', mutations });
  reduceSpatialMutations(spatial, batch([]), baseMap, { visibleLocations: [] });
  reduceSpatialMutations(spatial, batch([]), baseMap, { visibleLocations: [] });
  // Before: each empty reduce resolved (and cloned) every base place: 2,000 reads for two calls.
  assert.equal(counter.reads, 0);

  // A change to one overridden base place reads the map at most once (its id index is cached).
  const override = { action: 'upsert_location', locationId: 'b7', name: 'Base 7', createOverride: true, notes: 'Repaired', evidence: [{ sourceMessageId: 3, claim: 'Repaired', sourceClass: 'manual' }] };
  const manual = batch([override]);
  manual.operation = 'manual';
  // As in capture, the place is visible because relevance selected it.
  const visible = () => [{ id: 'b7', name: 'Base 7', isBase: true, coordinate: { x: 7, y: 0, authority: 'base_canonical', locked: true } }];
  const first = reduceSpatialMutations(spatial, manual, baseMap, { visibleLocations: visible() });
  assert.deepEqual(first.rejected, []);
  reduceSpatialMutations(first.spatial, manual, baseMap, { visibleLocations: visible() });
  assert.ok(counter.reads <= 1000, 'reads ' + counter.reads);
  assert.equal(first.indexDelta.upsertedLocations[0]?.id, 'b7');
  assert.equal(first.indexDelta.upsertedLocations[0]?.notes, 'Repaired');
});

test('A30: resolving only some ids gives exactly the full resolution for those ids', () => {
  const baseMap = { locations: [{ id: 'b1', name: 'Mill', coordinate: { x: 1, y: 1 } }, { id: 'b2', name: 'Ford', coordinate: { x: 2, y: 2 } }] };
  const spatial = normalizeSpatialState({
    locations: [
      { id: 'o1', name: 'Mill', baseRefId: 'b1', status: 'active', coordinate: { x: 5, y: 5, authority: 'manual', locked: true }, notes: 'Override' },
      { id: 'c1', name: 'Camp', status: 'active', coordinate: { x: 9, y: 9, authority: 'manual', locked: false } },
      { id: 'o9', name: 'Lost', baseRefId: 'missing', status: 'active' },
    ],
  });
  const full = new Map(resolveEffectiveLocations(spatial, baseMap).map(loc => [loc.id, loc]));
  for (const id of ['b1', 'b2', 'c1', 'o9']) {
    const [only] = resolveEffectiveLocations(spatial, baseMap, { onlyIds: new Set([id]) });
    assert.deepEqual(only, full.get(id), id);
  }
  assert.deepEqual(resolveEffectiveLocations(spatial, baseMap, { onlyIds: new Set(['nope']) }), []);
});

function capturedState(records) {
  const chat = [];
  let state = seedRootCheckpoint(createState('a49'));
  for (let i = 0; i < records; i += 1) {
    chat.push({ name: 'You', is_user: true, is_system: false, mes: 'Go ' + i + '.' });
    chat.push({ name: 'N', is_user: false, is_system: false, mes: 'The Tower ' + i + ' stands.' });
    const m = chat.length - 1;
    const lineage = chatLineage(chat);
    const reduced = reduceMutations(state, { chatKey: 'a49', messageId: m, lineageKey: lineage[m].lineageKey, mutations: [{ action: 'create', kind: 'fact', summary: 'Tower ' + i + ' stands', anchors: ['Tower ' + i], evidence: [{ sourceMessageId: m, claim: 'The Tower ' + i + ' stands.' }] }] }).state;
    reduced.lastCaptureMessage = m;
    state = commitMutationBoundary(state, reduced, chat, m, 'capture', { lineage });
  }
  return { state, chat };
}

test('batch 5: a capture shares the journal and checkpoints instead of deep-copying them', () => {
  const { state, chat } = capturedState(6);
  assert.ok(state.checkpoints.length > 2 && state.rollbackJournal.length > 2);
  chat.push({ name: 'You', is_user: true, is_system: false, mes: 'Go on.' });
  chat.push({ name: 'N', is_user: false, is_system: false, mes: 'The Bridge is out.' });
  const m = chat.length - 1;
  const lineage = chatLineage(chat);
  const reduced = reduceMutations(state, { chatKey: 'a49', messageId: m, lineageKey: lineage[m].lineageKey, mutations: [{ action: 'create', kind: 'fact', summary: 'The Bridge is out', anchors: ['Bridge'], evidence: [{ sourceMessageId: m, claim: 'The Bridge is out.' }] }] }).state;
  // Before: every reduce and commit deep-copied every checkpoint snapshot and undo patch (most of a capture's
  // cost at a few hundred records).
  assert.equal(reduced.checkpoints[1], state.checkpoints[1]);
  assert.equal(reduced.rollbackJournal[0], state.rollbackJournal[0]);
  const committed = commitMutationBoundary(state, reduced, chat, m, 'capture', { lineage });
  assert.equal(committed.checkpoints[1], state.checkpoints[1]);
  assert.equal(committed.rollbackJournal[0], state.rollbackJournal[0]);
  // Records are still private copies.
  assert.notEqual(committed.records[0], state.records[0]);
});

test('batch 5: shared journal entries are replaced, never edited, when the journal is trimmed', () => {
  const { state, chat } = capturedState(4);
  const before = JSON.stringify(state.rollbackJournal);
  chat.push({ name: 'You', is_user: true, is_system: false, mes: 'Go on.' });
  chat.push({ name: 'N', is_user: false, is_system: false, mes: 'The Gate is shut.' });
  const m = chat.length - 1;
  const lineage = chatLineage(chat);
  const reduced = reduceMutations(state, { chatKey: 'a49', messageId: m, lineageKey: lineage[m].lineageKey, mutations: [{ action: 'create', kind: 'fact', summary: 'The Gate is shut', anchors: ['Gate'], evidence: [{ sourceMessageId: m, claim: 'The Gate is shut.' }] }] }).state;
  const trimmed = commitMutationBoundary(state, reduced, chat, m, 'capture', { lineage, maxJournalEntries: 2 });
  assert.equal(trimmed.rollbackJournal.length, 2);
  assert.equal(trimmed.rollbackJournal[0].prevSeq, 0);
  // The earlier state's own journal is untouched.
  assert.equal(JSON.stringify(state.rollbackJournal), before);
  assert.match(rebuildSource, /candidate\.rollbackJournal\[0\] = \{ \.\.\.first, prevSeq: 0, beforeMessageId: Math\.max\(first\.beforeMessageId, cutoff\) \};/);
});

test('batch 5: ordinary boundaries read the sidecar once; a send extends the lineage instead of re-hashing the chat', () => {
  // Before: every boundary check of a chat with no sidecar ran the startup retry schedule (3 reads, 360 ms).
  assert.match(source, /async function refreshChatStateFromServer\(chatKey = currentChatKey\(\), \{\s*reason = 'boundary',\s*retryDeterministicMiss = false,/);
  assert.match(source, /refreshChatStateFromServer\(chatKey, \{ reason: 'chat-activation', retryDeterministicMiss: true \}\)/);
  assert.match(source, /refreshChatStateFromServer\(chatKey, \{\s*reason: 'write-conflict',\s*retryDeterministicMiss: true,/);
  // Before: a stored lineage one message short fell back to chatLineage(whole chat) on every send.
  const bounded = source.slice(source.indexOf('function boundedExchange('), source.indexOf('function recentText('));
  assert.match(bounded, /const appended = extendChatLineage\(knownLineage, rows\.slice\(0, endMessageId \+ 1\)\);/);
});

test('batch 5: rebuild reuses the plan lineage and checks its range exactly only where it matters', () => {
  // Before: each step re-hashed the chat prefix (quadratic), and every currentness check hashed the whole chat.
  assert.equal((rebuildSource.match(/\{ lineage: plan\.lineage\.slice\(0, window\.messageId \+ 1\) \}/g) || []).length, 2);
  const rebuild = source.slice(source.indexOf("if (actionId === 'rebuild')"), source.indexOf('async function applySpatialAction('));
  assert.match(rebuild, /if \(options\?\.exact !== true && now - rangeProof\.at < 1000\) return rangeProof\.current;/);
  assert.match(rebuild, /const live = chatLineage\(liveChat\.slice\(0, startLineage\.length\)\);/);
  // The host's own checks before saving and reporting stay exact.
  assert.doesNotMatch(rebuild.slice(rebuild.indexOf('const isCurrentExact')), /[^.\w]isCurrent\(\)/);
});

test('batch 5: scrolling the panel never copies the state', async () => {
  const { createWorldStateUiController } = await import('../ui.js');
  const listeners = {};
  const root = {
    innerHTML: '',
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  let reads = 0;
  const state = createState('chat:a49');
  const ctl = createWorldStateUiController({ root, getState: () => { reads += 1; return state; }, getChatKey: () => 'chat:a49' });
  const before = reads;
  for (let i = 0; i < 50; i += 1) listeners.scroll({ target: { matches: selector => selector === '.wsa-view', scrollTop: i * 10 } });
  // Before: each scroll event read (and the host deep-copied) the whole state just for its chat key.
  assert.equal(reads, before);
  ctl.destroy();
  // The host hands the panel its cached state and chat key; the panel builds its model from a private copy.
  assert.match(source, /getChatKey: \(\) => chatKey,/);
});

test('batch 5: an identical sidecar text is verified once; every caller still gets its own copy and the owner check', async () => {
  const { decodeSidecar, encodeSidecar } = await import('../storage.js');
  const { state } = capturedState(3);
  const body = encodeSidecar({ chatKey: 'a49', state, revision: 4 });
  const first = decodeSidecar(body, { expectedChatKey: 'a49' });
  const second = decodeSidecar(body, { expectedChatKey: 'a49' });
  assert.deepEqual(second, first);
  first.state.records[0].summary = 'changed by a caller';
  assert.notEqual(decodeSidecar(body).state.records[0].summary, 'changed by a caller');
  assert.throws(() => decodeSidecar(body, { expectedChatKey: 'other' }), /different chat/);
  // A tampered text is a different text and is fully verified.
  assert.throws(() => decodeSidecar(body.replace('"revision":4', '"revision":5')), /checksum/);
  assert.match(fs.readFileSync('storage.js', 'utf8'), /const known = VERIFIED_SIDECARS\.find\(item => item\.text === source\);/);
});
