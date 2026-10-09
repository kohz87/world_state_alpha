// alpha.50: deep-pass items 1-9 and 12-16 (data loss and host lifecycle), each reproduced against
// 0.9.0-alpha.49 first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { reconcileBranch, seedRootCheckpoint } from '../branch.js';
import { consolidateCreateCandidate } from '../duplicate.js';
import { runManualRebuild } from '../rebuild.js';
import { normalizeSpatialState, reduceSpatialMutations } from '../spatial-core.js';
import { applySpatialManualMutation } from '../spatial-manual.js';
import { createState, normalizeState } from '../state-core.js';

const source = fs.readFileSync('index.js', 'utf8');

test('1: a new episode of one subject never overwrites an active record about another', () => {
  const prior = { id: 'north-old', kind: 'development', status: 'resolved', summary: 'The north gate was barricaded by the militia', anchors: ['city gate', 'barricade'] };
  const south = { id: 'south', kind: 'development', status: 'active', summary: 'The south gate is barricaded by the militia', anchors: ['city gate', 'barricade'] };
  const mutation = { action: 'create', kind: 'development', summary: 'The north gate is barricaded by the militia again', status: 'active', anchors: ['city gate', 'barricade'], newEpisodeOfRecordId: 'north-old', evidence: [{ sourceMessageId: 3, claim: 'x' }] };
  const out = consolidateCreateCandidate(mutation, [prior, south]);
  // Before: the create became an update of the south-gate record.
  assert.equal(out.ok, true);
  assert.equal(out.mutation.action, 'create');
  assert.ok(out.mutation.relatedRecordIds.includes('north-old'));
  // A genuine active duplicate of the same subject is still merged.
  const sameGate = { ...south, id: 'north-now', summary: 'The north gate is barricaded by the militia' };
  assert.equal(consolidateCreateCandidate(mutation, [prior, sameGate]).mutation.recordId, 'north-now');
});

test('2: a Reality-only rebuild with no assistant boundary keeps the places journaled in its range', async () => {
  const chat = [
    { name: 'N', is_user: false, is_system: false, mes: 'Welcome to the valley.' },
    { name: 'You', is_user: true, is_system: false, mes: 'I walk to the mill.' },
    { name: 'N', is_user: false, is_system: false, mes: 'You reach a quiet road.' },
    { name: 'You', is_user: true, is_system: false, mes: 'I mark the old mill on my map.' },
  ];
  let state = seedRootCheckpoint(createState('c1'));
  state = reconcileBranch(state, chat).state;
  const edited = applySpatialManualMutation({ state, chat, chatKey: 'c1', messageId: 3, note: 'Operator added the mill',
    mutation: { action: 'upsert_location', name: 'Old Mill', type: 'mill', context: 'by the road' } });
  assert.equal(edited.outcome, 'applied');
  const result = await runManualRebuild({ state: edited.state, chat, chatKey: 'c1', startMessageId: 3, spatialEnabled: false,
    isCurrent: () => true, dispatcher: async () => ({ text: '{"mutations":[]}', receipt: {} }) });
  assert.equal(result.outcome, 'completed');
  assert.equal(result.plan.assistantBoundaries, 0);
  // Before: the place was dropped.
  assert.deepEqual(result.state.spatial.locations.map(loc => loc.name), ['Old Mill']);
  // It is journaled, so rolling its message back still removes it.
  const rolled = reconcileBranch(result.state, chat.slice(0, 3));
  assert.deepEqual(rolled.state.spatial.locations.map(loc => loc.name), []);
});

function brackenford() {
  return normalizeSpatialState({
    baseMapRef: null,
    locations: [
      { id: 'ov1', name: 'Brackenford', baseRefId: 'base_brack', status: 'active', coordinate: { x: 1, y: 1, authority: 'campaign_override', locked: false }, context: 'quiet market town' },
      { id: 'x1', name: 'Brackenford Town', status: 'active', coordinate: { x: null, y: null, authority: 'unknown', locked: false } },
      { id: 'mill', name: 'Old Mill', status: 'active', coordinate: { x: null, y: null, authority: 'unknown', locked: false } },
    ],
    relations: [
      { id: 'r1', fromId: 'x1', toId: 'mill', direction: 'north', distanceKm: null },
      { id: 'r2', fromId: 'mill', toId: 'ov1', direction: 'east', distanceKm: null },
    ],
  });
}

test('3: after the base map is detached, a former override is addressed by its own id', () => {
  // The base map is detached: there is no base place 'base_brack' any more.
  const merged = reduceSpatialMutations(brackenford(), {
    chatKey: 'c', messageId: 4, lineageKey: 'L4', operation: 'manual',
    mutations: [{ action: 'merge_locations', sourceId: 'x1', targetId: 'ov1' }],
  }, null, { allowBaseScan: true });
  const ends = merged.spatial.relations.flatMap(rel => [rel.fromId, rel.toId]);
  // Before: both relations were moved onto 'base_brack', which no place answers to.
  assert.ok(!ends.includes('base_brack'), JSON.stringify(merged.spatial.relations));
  assert.ok(ends.includes('ov1'));

  const updated = reduceSpatialMutations(brackenford(), {
    chatKey: 'c', messageId: 5, lineageKey: 'L5', operation: 'capture',
    mutations: [{ action: 'upsert_location', locationId: 'ov1', name: 'Brackenford', context: 'under siege', evidence: [{ sourceMessageId: 5, claim: 'Brackenford is under siege' }] }],
  }, null, { visibleLocations: [{ id: 'ov1', name: 'Brackenford', isBase: false, coordinate: { x: 1, y: 1 } }] });
  // Before: the index delta named 'base_brack' and removed it, so injection kept the stale place.
  assert.deepEqual(updated.indexDelta.changedLocationIds, ['ov1']);
  assert.equal(updated.indexDelta.upsertedLocations[0]?.context, 'under siege');

  // With the base map still attached (known or unavailable), the override keeps the base id.
  const attached = normalizeSpatialState({ ...brackenford(), baseMapRef: { id: 'map1', name: 'Map' } });
  const viaBase = reduceSpatialMutations(attached, {
    chatKey: 'c', messageId: 4, lineageKey: 'L4', operation: 'manual',
    mutations: [{ action: 'merge_locations', sourceId: 'x1', targetId: 'ov1' }],
  }, null, { allowBaseScan: true });
  assert.ok(viaBase.spatial.relations.some(rel => rel.fromId === 'base_brack' || rel.toId === 'base_brack'));
});

test('4: re-adding a name at the same chat head creates a new active place', () => {
  const chat = [{ is_user: true, mes: 'hello' }, { is_user: false, mes: 'world' }];
  const add = (state, mutation, note) => applySpatialManualMutation({ state, chat, chatKey: 'chatA', messageId: 1, mutation, note });
  let res = add(createState('chatA'), { action: 'upsert_location', name: 'Foo', type: 'inn' }, 'add');
  const first = res.state.spatial.locations[0].id;
  res = add(res.state, { action: 'archive_location', locationId: first }, 'archive');
  res = add(res.state, { action: 'upsert_location', name: 'Foo', type: 'tavern' }, 'add again');
  const strict = normalizeState(res.state, { strictSchema: true, chatKey: 'chatA' });
  // Before: the new place reused the archived id and was dropped, so no active Foo existed.
  assert.deepEqual(strict.spatial.locations.map(loc => loc.status + ':' + loc.type).sort(), ['active:tavern', 'archived:inn']);
});

test('5: a capture that fails before it starts is recorded as a missed capture', () => {
  assert.match(source, /try \{\s*outcome = await captureAssistantBoundary\(chatKey, messageId, \(\) => \{ captureStarted = true; \}\);\s*\} catch \(error\) \{\s*if \(!captureStarted\) \{[\s\S]{0,160}else recordCaptureStartFailure\(chatKey, messageId, startFingerprint, error\);/);
  const record = source.slice(source.indexOf('function recordCaptureStartFailure('), source.indexOf('async function captureAssistantBoundary('));
  assert.match(record, /label: 'capture',[\s\S]*outcome: 'not-started',/);
  assert.match(source, /markStarted\(\);\s*const result = await runCaptureOperation\(\{/);
});

test('6: a dropped connection during a save is retried, and a save that already landed is recognized', async () => {
  const { createSillyTavernWorldStateStorageAdapter } = await import('../host-storage.js');
  const { writeSidecar } = await import('../storage.js');
  const run = async landed => {
    const files = new Map();
    let uploads = 0;
    const fetchFn = async (url, init = {}) => {
      if (init.method === 'GET') {
        const name = String(url).split('/').pop();
        return files.has(name)
          ? { ok: true, status: 200, async text() { return files.get(name); } }
          : { ok: false, status: 404, async text() { return ''; } };
      }
      uploads += 1;
      const body = JSON.parse(init.body);
      if (uploads === 1) {
        if (landed) files.set(body.name, Buffer.from(body.data, 'base64').toString('utf8'));
        throw new TypeError('Failed to fetch');
      }
      files.set(body.name, Buffer.from(body.data, 'base64').toString('utf8'));
      return { ok: true, status: 200, async json() { return { path: '/user/files/' + body.name }; } };
    };
    const adapter = createSillyTavernWorldStateStorageAdapter({ fetchFn, headers: {} });
    const result = await writeSidecar({ adapter, chatKey: 'chat:a.png:x', state: createState('chat:a.png:x'), sleep: async () => {} });
    return { result, uploads };
  };
  // Before: both threw on the first attempt (the error was not marked retryable).
  const landed = await run(true);
  assert.equal(landed.result.revision, 1);
  assert.equal(landed.uploads, 1);
  const lost = await run(false);
  assert.equal(lost.result.revision, 1);
  assert.equal(lost.uploads, 2);
});

test('7: a renamed chat does not warn that its continuity is missing before the rename is migrated', () => {
  const activate = source.slice(source.indexOf('async function activateCurrentChat('), source.indexOf('function connectionProfileUiContext('));
  // Before: the warning was shown at once, while SillyTavern reloads a renamed chat before announcing the rename.
  assert.doesNotMatch(activate, /notifyBootstrapRequiredOnce\(chatKey\);/);
  assert.match(activate, /scheduleBootstrapNotice\(chatKey\);/);
  assert.match(source, /function scheduleBootstrapNotice\(chatKey\) \{[\s\S]{0,400}renameTargets\.has\(chatKey\)/);
  assert.match(source, /renameTargets\.set\(newKey, \(renameTargets\.get\(newKey\) \|\| 0\) \+ 1\);/);
});

test('8: the place editor closes when its place disappears instead of editing another place', async () => {
  const { createWorldStateUiController } = await import('../ui.js');
  const listeners = {};
  const root = { innerHTML: '', addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
  const state = createState('chat:a50');
  const place = (id, name) => ({ id, name, type: 'landmark', status: 'active', baseRefId: null, coordinate: { x: null, y: null, authority: 'unknown', locked: false }, context: '', routeRefs: [], notes: '', createdAtMessage: 1, lastChangedMessage: 1, evidenceIds: [] });
  state.spatial.locations = [place('a', 'Applecross'), place('b', 'Brightwater')];
  const ctl = createWorldStateUiController({ root, getState: () => state, initialTab: 'spatial' });
  const click = (selector, dataset = {}) => listeners.click({ target: { closest: wanted => (wanted === selector ? { dataset } : null) }, preventDefault() {} });
  const key = ctl.refresh().spatial.locations.find(item => item.name === 'Brightwater').key;
  await click('[data-wsa-spatial-key]', { wsaSpatialKey: key });
  await click('[data-wsa-spatial-edit]');
  assert.equal(ctl.getUiState().spatialEditing, true);
  // Another device archives Brightwater.
  state.spatial.locations[1].status = 'archived';
  ctl.refresh();
  // Before: the open form silently switched to Applecross.
  assert.equal(ctl.getUiState().spatialEditing, false);
  ctl.destroy();
});

test('9: a swipe, edit or delete during a running rebuild does not wait for it', () => {
  const branch = source.slice(source.indexOf('async function handleBranchChange('), source.indexOf('const BRANCH_CAPTURE_REASONS'));
  // Before: the host's awaited branch event waited on the writer queue, behind the whole rebuild.
  assert.match(branch, /if \(rebuildAbortControllers\.has\(chatKey\)\) \{\s*updatePrivateInjection\(\);\s*void work;\s*return;/);
  assert.match(branch, /const work = queueChatWork\(chatKey, async \(\) => \{/);
});

test('12: comparing states shares history by identity instead of stringifying it', () => {
  const compare = source.slice(source.indexOf('function stateChanged('), source.indexOf('function pointerFor('));
  // Before: both whole states, every checkpoint snapshot and undo patch included, were stringified each turn.
  assert.doesNotMatch(compare, /stableStringify\(normalizeState\(left\)\) !== stableStringify\(normalizeState\(right\)\)/);
  assert.match(compare, /sameHistoryEntries\(/);
});

test('13: activation does not read the sidecar again right after hydrating it', () => {
  const activate = source.slice(source.indexOf('async function activateCurrentChat('), source.indexOf('function connectionProfileUiContext('));
  assert.match(activate, /const hydratedNow = !loadedChats\.has\(chatKey\);/);
  assert.match(activate, /if \(!hydratedNow\) await refreshChatStateFromServer\(chatKey, \{ reason: 'chat-activation', retryDeterministicMiss: true \}\);/);
});

test('14: host chat events are counted before any handler waits', () => {
  const register = source.slice(source.indexOf('function registerEvents('), source.indexOf('function ensureEventRegistration('));
  // Before: the counter was registered last, after handlers that can wait behind a rebuild.
  assert.ok(register.indexOf('noteChatEvent()') < register.indexOf('handleAssistantMessage(messageId)'));
});

test('15: rejected base-map and override actions say why', () => {
  const spatial = source.slice(source.indexOf('async function applySpatialActionNow('), source.indexOf('export async function openWorldStatePanel('));
  assert.match(spatial, /'Campaign override was not created: '/);
  assert.match(spatial, /'Base map was not attached: '/);
  assert.match(spatial, /'Base map was not detached: '/);
});

test('16: a provider rejection that is not an Error keeps its message and receipt', async () => {
  const { dispatchWorldStateRequest } = await import('../provider-routing.js');
  for (const thrown of ['Bad request', null, 42]) {
    const ctx = { generateRaw: async () => { throw thrown; }, extensionSettings: {} };
    // Before: assigning error.receipt to a primitive threw a TypeError that hid the provider's answer.
    await assert.rejects(dispatchWorldStateRequest(ctx, { prompt: 'x' }), error => error instanceof Error
      && error.receipt?.outcome === 'failure' && error.message.includes(String(thrown)));
  }
});

test('review hardening: base-map changes re-key override endpoints; a merge target never splits its relations', () => {
  const place = (id, name, extra = {}) => ({ id, name, status: 'active', coordinate: { x: null, y: null, authority: 'unknown', locked: false }, ...extra });
  const attached = () => normalizeSpatialState({
    baseMapRef: { id: 'map1', name: 'Map' },
    locations: [place('o1', 'Brackenford', { baseRefId: 'b1' }), place('p', 'Pine')],
    relations: [{ id: 'r1', fromId: 'b1', toId: 'p', direction: 'north', distanceKm: null }],
    routes: [{ id: 'rt', name: 'Kings Road', endpoints: ['b1', 'p'], waypoints: [] }],
  });
  const base = { id: 'map1', locations: [{ id: 'b1', name: 'Brackenford', coordinate: { x: 0, y: 0 } }] };
  const batch = mutations => ({ chatKey: 'c', messageId: 4, lineageKey: 'L4', operation: 'manual', mutations });
  // Detaching: the override is its own place now, so its relations and routes follow it.
  const detached = reduceSpatialMutations(attached(), batch([{ action: 'set_base_map_ref', baseMapRef: null }]), base, { allowBaseScan: true });
  assert.deepEqual([detached.spatial.relations[0].fromId, detached.spatial.relations[0].toId], ['o1', 'p']);
  assert.deepEqual(detached.spatial.routes[0].endpoints, ['o1', 'p']);
  // Attaching it again: back to the base id it shadows.
  const again = reduceSpatialMutations(detached.spatial, batch([{ action: 'set_base_map_ref', baseMapRef: { id: 'map1', name: 'Map' } }]), base, { allowBaseScan: true });
  assert.equal(again.spatial.relations[0].fromId, 'b1');
  // An attach without the map at hand changes nothing.
  const blind = reduceSpatialMutations(detached.spatial, batch([{ action: 'set_base_map_ref', baseMapRef: { id: 'map1', name: 'Map' } }]), null, { allowBaseScan: true });
  assert.equal(blind.spatial.relations[0].fromId, 'o1');
  // Merging into a former override whose own relation still uses the old base id keeps them together.
  const stale = normalizeSpatialState({ baseMapRef: null, locations: [place('o1', 'Brackenford', { baseRefId: 'b1' }), place('c1', 'Brackenford Town'), place('p', 'Pine'), place('q', 'Quarry')],
    relations: [{ id: 'r1', fromId: 'b1', toId: 'p', direction: 'north', distanceKm: null }, { id: 'r2', fromId: 'c1', toId: 'q', direction: 'east', distanceKm: null }] });
  const merged = reduceSpatialMutations(stale, batch([{ action: 'merge_locations', sourceId: 'c1', targetId: 'o1' }]), null, { allowBaseScan: true });
  assert.deepEqual(merged.spatial.relations.map(rel => rel.fromId).sort(), ['o1', 'o1']);
  // The host passes the new map when attaching one.
  assert.match(source, /const res = applySequence\(state, steps, stored\.baseMap\);/);
});

test('review hardening: a start failure is not recorded for a version swiped away meanwhile; a circular rejection keeps its receipt', async () => {
  const record = source.slice(source.indexOf('function recordCaptureStartFailure('), source.indexOf('async function captureAssistantBoundary('));
  assert.match(record, /if \(storyFingerprintOf\(chat\[messageId\]\) !== startFingerprint\) return;/);
  const { dispatchWorldStateRequest } = await import('../provider-routing.js');
  const circular = { code: 0 };
  circular.self = circular;
  await assert.rejects(dispatchWorldStateRequest({ generateRaw: async () => { throw circular; }, extensionSettings: {} }, { prompt: 'x' }),
    error => error.receipt?.outcome === 'failure' && /Provider request failed/.test(error.message));
});
