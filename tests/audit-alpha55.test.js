// alpha.55: data-loss items from the alpha.54 deep pass (pure modules), each reproduced against
// 0.9.0-alpha.54 first. The host-lifecycle items are in audit-alpha55-host.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { chatLineage, commitMutationBoundary, reconcileBranch, seedRootCheckpoint } from '../branch.js';
import { createDiagnosticStore } from '../diagnostics.js';
import { consolidateCreateCandidate, distinctSubjects } from '../duplicate.js';
import { loadBaseMapSource, storeBaseMapSource } from '../host-base-map.js';
import { runManualRebuild } from '../rebuild.js';
import { parseBaseMap } from '../spatial-base-map.js';
import { normalizeSpatialState, reduceSpatialMutations, resolveEffectiveLocations } from '../spatial-core.js';
import { applySpatialManualMutation } from '../spatial-manual.js';
import { createState } from '../state-core.js';

const source = fs.readFileSync('index.js', 'utf8');
const record = (id, summary, anchors, extra = {}) => ({ id, kind: 'development', status: 'active', summary, anchors, trend: null, evidenceIds: [], ...extra });

test('4: a rebuild with Places on keeps operator places at the boundary where they appeared', async () => {
  const chat = [
    { name: 'You', is_user: true, is_system: false, mes: 'I walk north.' },
    { name: 'Narrator', is_user: false, is_system: false, mes: 'The road bends past fields.' },
    { name: 'You', is_user: true, is_system: false, mes: 'I climb the hill.' },
    { name: 'Narrator', is_user: false, is_system: false, mes: 'The hill is windy.' },
  ];
  let state = seedRootCheckpoint(createState('a55'));
  state = reconcileBranch(state, chat).state;
  // The operator adds a place with a locked position while message 3 is the head.
  const added = applySpatialManualMutation({ state, chat, chatKey: 'a55', messageId: 3, note: 'Added', mutation: { action: 'upsert_location', name: 'Greywatch Keep', type: 'keep', coordinate: { x: 5, y: 6 } } });
  assert.equal(added.outcome, 'applied');
  const dispatcher = async () => ({ text: '{"mutations":[],"spatialMutations":[]}', receipt: { route: 'test', dispatched: true } });
  const full = await runManualRebuild({ ctx: {}, state: added.state, chat, chatKey: 'a55', isCurrent: () => true, dispatcher, spatialEnabled: true });
  assert.equal(full.outcome, 'completed');
  // Before: a Places-on rebuild started from empty Places and the operator's keep was gone.
  const keep = full.state.spatial.locations.find(loc => loc.name === 'Greywatch Keep');
  assert.ok(keep, JSON.stringify(full.state.spatial.locations));
  assert.deepEqual([keep.coordinate.x, keep.coordinate.y, keep.coordinate.locked, keep.operatorOwned], [5, 6, true, true]);
  // It still belongs to the boundary where it appeared: deleting that reply rolls it back.
  const rolled = reconcileBranch(full.state, chat.slice(0, 2));
  assert.equal(rolled.failClosed, false);
  assert.equal(rolled.state.spatial.locations.length, 0);
});

test('5: a new episode never overwrites an unrelated active record through a shared anchor', () => {
  const plague = record('plague', 'A plague spread through the lower city slums', ['lower city', 'plague'], { status: 'resolved' });
  const riots = record('riots', 'Food riots continue in the lower city', ['lower city', 'food riots']);
  const out = consolidateCreateCandidate({ action: 'create', kind: 'development', summary: 'The plague has returned to the lower city', anchors: ['lower city', 'plague'], newEpisodeOfRecordId: 'plague', evidence: [] }, [plague, riots]);
  // Before: turned into an update of the riots record (summary replaced).
  assert.equal(out.mutation.action, 'create');
});

test('6: a number after a shared noun names a different subject', () => {
  assert.equal(distinctSubjects('Squad 12 guards the river ford', 'Squad 14 guards the river ford'), true);
  assert.equal(distinctSubjects('Gate 3 is barred', 'Gate 5 is barred'), true);
  // A changing quantity is still one subject.
  assert.equal(distinctSubjects('The siege of Karth has lasted 3 days', 'The siege of Karth has lasted 4 days'), false);
  const squad = record('s12', 'Squad 12 guards the river ford', ['river ford']);
  const out = consolidateCreateCandidate({ action: 'create', kind: 'development', summary: 'Squad 14 guards the river ford', anchors: ['river ford'], evidence: [] }, [squad]);
  assert.equal(out.mutation.action, 'create');
});

test('7: rolling back a deleted place puts it back where it was', () => {
  const chat = [
    { name: 'You', is_user: true, is_system: false, mes: 'Look.' },
    { name: 'Narrator', is_user: false, is_system: false, mes: 'Three places.' },
    { name: 'You', is_user: true, is_system: false, mes: 'Again.' },
    { name: 'Narrator', is_user: false, is_system: false, mes: 'Still there.' },
  ];
  let state = seedRootCheckpoint(createState('a55'));
  state = reconcileBranch(state, chat.slice(0, 2)).state;
  const places = normalizeSpatialState({ locations: ['a', 'b', 'c'].map(id => ({ id, name: 'Place ' + id, status: 'active' })) });
  state = commitMutationBoundary(state, { ...state, spatial: places }, chat.slice(0, 2), 1, 'capture');
  state = reconcileBranch(state, chat).state;
  const deleted = reduceSpatialMutations(state.spatial, { chatKey: 'a55', messageId: 3, lineageKey: chatLineage(chat)[3].lineageKey, operation: 'manual', mutations: [{ action: 'delete_location', locationId: 'b' }] }, null, { allowBaseScan: true });
  state = commitMutationBoundary(state, { ...state, spatial: deleted.spatial }, chat, 3, 'spatial-manual');
  const rolled = reconcileBranch(state, chat.slice(0, 3));
  // Before: restored as [a, c, b], so the state no longer matched its checkpoint.
  assert.deepEqual(rolled.state.spatial.locations.map(loc => loc.id), ['a', 'b', 'c']);
  assert.equal(reconcileBranch(rolled.state, chat.slice(0, 1)).failClosed, false);
});

test('12: a base map whose name was cut right after a space reloads', async () => {
  const files = new Map();
  const adapter = {
    uploadJsonFile: async (name, value) => { files.set(name, JSON.parse(JSON.stringify(value))); return { path: name }; },
    fetchJsonFile: async name => JSON.parse(JSON.stringify(files.get(name))),
  };
  const stored = await storeBaseMapSource(adapter, { id: 'realm', name: 'abcd '.repeat(26), version: 'v'.repeat(39) + ' x', locations: [{ name: 'Hill', coord: [1, 1] }] });
  // Before: re-parsing trimmed the cut name again, the digest differed and the map never loaded.
  const loaded = await loadBaseMapSource(adapter, stored.pointer);
  assert.ok(loaded);
  assert.equal(loaded.locations[0].name, 'Hill');
});

test('13: overrides of two same-named base places and same-named base routes keep separate ids', () => {
  const baseMap = parseBaseMap({ id: 'shire', locations: [{ id: 'n1', name: 'Newton', coord: [1, 1] }, { id: 'n2', name: 'Newton', coord: [2, 2] }] });
  let spatial = normalizeSpatialState({});
  for (const id of ['n1', 'n2']) {
    spatial = reduceSpatialMutations(spatial, { chatKey: 'a55', messageId: 1, lineageKey: 'l1', operation: 'manual', mutations: [{ action: 'upsert_location', locationId: id, name: 'Newton', createOverride: true, evidence: [{ sourceMessageId: 1, claim: 'Override', sourceClass: 'manual' }] }] }, baseMap, { allowBaseScan: true }).spatial;
  }
  // Before: both overrides got one id and the second was dropped.
  assert.deepEqual(spatial.locations.map(loc => loc.baseRefId).sort(), ['n1', 'n2']);
  assert.equal(resolveEffectiveLocations(spatial, baseMap).filter(loc => loc.isOverridden).length, 2);
  // Before: the second route with the same name failed the whole import.
  const routes = parseBaseMap({ id: 'shire', locations: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], routes: [{ name: 'Old Road', endpoints: ['a', 'b'] }, { name: 'Old Road', endpoints: ['b', 'c'] }] });
  assert.equal(new Set(routes.routes.map(route => route.id)).size, 2);
});

test('51: injection-only settings do not cancel provider work', () => {
  const list = source.slice(source.indexOf('if (['), source.indexOf('invalidateChatOperations();', source.indexOf('if ([')));
  // Before: toggling either injection setting aborted a running rebuild and in-flight captures.
  assert.doesNotMatch(list, /'world_state_alpha_spatial_inject'/);
  assert.doesNotMatch(list, /'world_state_alpha_inject'/);
  assert.match(list, /'world_state_alpha_spatial_enabled'/);
});

test('54: the Operations log saves every kept row, pinned old failures included', () => {
  const store = createDiagnosticStore({ limit: 80 });
  for (let i = 0; i < 90; i += 1) store.record('chat', { operationId: 'capture:' + (2 * i + 1) + ':1:' + i, label: 'capture', sourceMessageId: 2 * i + 1, lineageKey: 'ln' + i, outcome: 'invalid-response', at: i + 1 });
  // Before: only the newest 80 rows were handed to persistence, so messages 1-19 lost their missed captures.
  assert.equal(store.allRecords('chat').length, 90);
  assert.equal(store.records('chat').length, 80);
  for (const call of ['const rows = snapshot || diagnosticStore.allRecords(chatKey);', 'void saveOperationLog(chatKey, diagnosticStore.allRecords(chatKey));']) {
    assert.ok(source.includes(call), call);
  }
  assert.doesNotMatch(source.slice(0, source.indexOf('function scheduleServerFreshnessRefresh')), /OPERATION_LOG_LIMIT\), diagnosticStore\.records\(chatKey\)/);
});
