// alpha.57: deep-pass items 37-48 (Places capture) and 52-60 (host lifecycle and settings).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { processCaptureResponse } from '../capture.js';
import { createDiagnosticStore } from '../diagnostics.js';
import { dispatchWorldStateRequest, worldStateHostRouteKey } from '../provider-routing.js';
import { parseBaseMap } from '../spatial-base-map.js';
import { processSpatialCapture } from '../spatial-capture.js';
import { canonicalSpatialDirection, normalizeSpatialState, reduceSpatialMutations, resolveEffectiveLocations } from '../spatial-core.js';
import { validateSpatialEnvelope } from '../spatial-wire.js';
import { createState } from '../state-core.js';

const source = fs.readFileSync('index.js', 'utf8');
const exchange = text => [{ messageId: 2, is_user: false, is_system: false, mes: text, content: text, lineageKey: 'ln_2' }];
function spatialCapture(text, rawSpatialMutations, spatial, { baseMap = null } = {}) {
  return processSpatialCapture({
    rawSpatialMutations, spatial, exchange: exchange(text),
    visibleLocations: resolveEffectiveLocations(spatial, baseMap).filter(item => (item.status || 'active') === 'active'),
    baseMap, profile: spatial.profile, chatKey: 'a57', sourceMessageId: 2, sourceLineageKey: 'ln_2', operation: 'capture',
  });
}
const unknown = { x: null, y: null, authority: 'unknown', locked: false };
const place = (id, name, coordinate = unknown, extra = {}) => ({ id, name, type: 'landmark', status: 'active', coordinate, ...extra });
const location = (name, claim, extra = {}) => ({ action: 'upsert_location', name, type: 'landmark', admissionReason: 'persistent_feature', evidence: [{ sourceMessageId: 2, claim }], ...extra });
const relation = (claim, extra = {}) => ({ action: 'upsert_relation', fromId: 'mill', toId: 'oak', evidence: [{ sourceMessageId: 2, claim }], ...extra });
const profile = { system: 'cartesian2d', northAxis: '+y', eastAxis: '+x', unitKm: 1, trueNorthLocked: true };
const twoPlaces = (extra = {}) => normalizeSpatialState({ locations: [place('mill', 'Millbrook'), place('oak', 'Oakvale')], ...extra });

test('37: a direction or distance counts only where the relation is stated', () => {
  const wind = spatialCapture('The north wind howls over the hills. Oakvale stands near Millbrook.', [relation('Oakvale stands near Millbrook', { direction: 'north' })], twoPlaces());
  // Before: "north wind" elsewhere in the message grounded the direction.
  assert.equal(wind.spatial.relations.length, 0);
  const stated = spatialCapture('Oakvale lies north of Millbrook.', [relation('Oakvale lies north of Millbrook', { direction: 'north' })], twoPlaces());
  assert.equal(stated.spatial.relations[0]?.direction, 'north');
  const gate = spatialCapture('Oakvale is beside Millbrook, past the north gate.', [relation('Oakvale is beside Millbrook, past the north gate', { direction: 'north' })], twoPlaces());
  assert.equal(gate.spatial.relations.length, 0);
  const far = spatialCapture('The road is 30 km long. Oakvale lies near Millbrook.', [relation('Oakvale lies near Millbrook', { distanceKm: 30 })], twoPlaces());
  assert.equal(far.spatial.relations.length, 0);
});

test('38: a coordinate spoken across lines or in „…“ quotes is not narrative-explicit', () => {
  const wrapped = spatialCapture('Oakvale is a quiet village. "You will find Oakvale\nat [12, 4]," the scout says.', [location('Oakvale', 'Oakvale is a quiet village', { coordinate: { x: 12, y: 4 } })], normalizeSpatialState({}));
  assert.equal(wrapped.spatial.locations[0].coordinate.x, null);
  const low = spatialCapture('Oakvale is a quiet village. „Oakvale sits at [12, 4],“ the scout says.', [location('Oakvale', 'Oakvale is a quiet village', { coordinate: { x: 12, y: 4 } })], normalizeSpatialState({}));
  assert.equal(low.spatial.locations[0].coordinate.x, null);
});

test('39 and 40: an archived override and a merged-away duplicate are not re-created', () => {
  const baseMap = parseBaseMap({ id: 'realm', locations: [{ id: 'b_keep', name: 'Greywatch Keep', coord: [1, 1] }] });
  const archived = normalizeSpatialState({ baseMapRef: { id: 'realm' }, locations: [place('ov_keep', 'Greywatch Keep', unknown, { baseRefId: 'b_keep', status: 'archived' })] });
  const out = spatialCapture('Greywatch Keep looms over the pass.', [location('Greywatch Keep', 'Greywatch Keep looms over the pass')], archived, { baseMap });
  // Before: a new campaign place "Greywatch Keep" was created beside the retired one.
  assert.equal(out.spatial.locations.length, 1);
  assert.ok(out.rejected.some(item => /archived/.test(item.reason)), JSON.stringify(out.rejected));

  let spatial = normalizeSpatialState({ locations: [place('a', 'Kings Rest'), place('b', 'Kingsrest Inn')] });
  spatial = reduceSpatialMutations(spatial, { chatKey: 'a57', messageId: 1, lineageKey: 'l1', operation: 'manual', mutations: [{ action: 'merge_locations', sourceId: 'b', targetId: 'a' }] }, null, { allowBaseScan: true }).spatial;
  const merged = spatialCapture('The Kingsrest Inn is busy tonight.', [location('Kingsrest Inn', 'The Kingsrest Inn is busy tonight')], spatial);
  // Before: the merged-away name was created again.
  assert.deepEqual(merged.spatial.locations.filter(item => item.status === 'active').map(item => item.name), ['Kings Rest']);
});

test('41 and 42: route names must be narrated, and a base route is never replaced', () => {
  const refs = spatialCapture('Oakvale is a quiet village.', [location('Oakvale', 'Oakvale is a quiet village', { routeRefs: ['Kings Road'] })], normalizeSpatialState({}));
  assert.deepEqual(refs.spatial.locations[0].routeRefs, []);
  const onRoad = spatialCapture('Oakvale sits on the Kings Road.', [location('Oakvale', 'Oakvale sits on the Kings Road', { routeRefs: ['Kings Road'] })], normalizeSpatialState({}));
  assert.deepEqual(onRoad.spatial.locations[0].routeRefs, ['Kings Road']);
  const baseMap = parseBaseMap({ id: 'realm', locations: [{ id: 'a', name: 'Ashford', coord: [0, 0] }, { id: 'b', name: 'Brant', coord: [5, 0] }], routes: [{ id: 'old_road', name: 'Old Road', type: 'road', endpoints: ['a', 'b'] }] });
  const route = spatialCapture('We follow the Old Road east.', [{ action: 'upsert_route', name: 'Old Road', evidence: [{ sourceMessageId: 2, claim: 'We follow the Old Road east' }] }], normalizeSpatialState({ baseMapRef: { id: 'realm' } }), { baseMap });
  assert.equal(route.spatial.routes.length, 0);
});

test('43: Places rows past the cap are rejected one by one, never the response', () => {
  const rows = Array.from({ length: 9 }, (_, index) => location('Place ' + index, 'Place ' + index));
  const wire = validateSpatialEnvelope(rows);
  assert.equal(wire.mutations.length, 8);
  assert.deepEqual(wire.rejected.map(item => item.index), [8]);
  const text = 'The north bridge collapses into the river.';
  const out = processCaptureResponse({
    text: JSON.stringify({ mutations: [{ action: 'create', kind: 'fact', summary: 'The north bridge has collapsed into the river', anchors: ['north bridge'], evidence: [{ sourceMessageId: 2, claim: text }] }], spatialMutations: rows }),
    state: createState('a57'), exchange: exchange(text), visibleRecords: [], chatKey: 'a57', sourceMessageId: 2, sourceLineageKey: 'ln_2', spatialEnabled: true,
  });
  // Before: the ninth row failed the whole response, the Reality record included.
  assert.equal(out.state.records.length, 1);
});

test('44 and 46: a place moved and related in one reply is judged where it now is; reducer rejections keep their row', () => {
  const spatial = normalizeSpatialState({ profile, locations: [place('mill', 'Millbrook', { x: 0, y: 0, authority: 'manual', locked: false }), place('oak', 'Oakvale', { x: 0, y: -10, authority: 'narrative_explicit', locked: false })] });
  const text = 'Oakvale now stands at [0, 10]. Oakvale lies north of Millbrook.';
  const out = spatialCapture(text, [
    { action: 'upsert_location', locationId: 'oak', name: 'Oakvale', coordinate: { x: 0, y: 10 }, admissionReason: 'explicit_coordinate', evidence: [{ sourceMessageId: 2, claim: 'Oakvale now stands at [0, 10]' }] },
    relation('Oakvale lies north of Millbrook', { direction: 'north' }),
  ], spatial);
  // Before: judged against the old position (south) and rejected.
  assert.equal(out.spatial.relations[0]?.direction, 'north', JSON.stringify(out.rejected));
  const contradicted = spatialCapture('Oakvale lies north of Millbrook.', [relation('Oakvale lies north of Millbrook', { direction: 'north' })], spatial);
  const row = contradicted.rejected.find(item => item.stage === 'spatial-reducer');
  assert.equal(row?.index, 0, JSON.stringify(contradicted.rejected));
});

test('45 and 47: thousands separators and prototype names', () => {
  const far = spatialCapture('Oakvale lies 1,200 km from Millbrook.', [relation('Oakvale lies 1,200 km from Millbrook', { distanceKm: 1200 })], twoPlaces());
  assert.equal(far.spatial.relations[0]?.distanceKm, 1200);
  const wrong = spatialCapture('Oakvale lies 1,200 km from Millbrook.', [relation('Oakvale lies 1,200 km from Millbrook', { distanceKm: 200 })], twoPlaces());
  assert.equal(wrong.spatial.relations.length, 0);
  assert.equal(canonicalSpatialDirection('constructor'), 'constructor');
  assert.equal(typeof canonicalSpatialDirection('toString'), 'string');
});

test('48: a coordinate counts only in a cited sentence', () => {
  const out = spatialCapture('Oakvale stands near the river. Oakvale lies at [12, 4].', [location('Oakvale', 'Oakvale stands near the river', { coordinate: { x: 12, y: 4 } })], normalizeSpatialState({}));
  assert.equal(out.spatial.locations[0].coordinate.x, null);
  const cited = spatialCapture('Oakvale stands near the river. Oakvale lies at [12, 4].', [location('Oakvale', 'Oakvale lies at [12, 4]', { coordinate: { x: 12, y: 4 } })], normalizeSpatialState({}));
  assert.equal(cited.spatial.locations[0].coordinate.x, 12);
});

test('53 and 56: a rebuild is pinned to the host model, and a profile error keeps its text', async () => {
  const host = { mainApi: 'textgenerationwebui', onlineStatus: 'model-a', extensionSettings: {}, generateRaw: async () => '{}' };
  const hostKey = worldStateHostRouteKey(host);
  assert.ok(hostKey);
  assert.equal((await dispatchWorldStateRequest(host, { prompt: 'x' }, { route: { hostKey } })).text, '{}');
  host.onlineStatus = 'model-b';
  await assert.rejects(dispatchWorldStateRequest(host, { prompt: 'x' }, { route: { hostKey } }), error => error.code === 'WORLD_STATE_PROFILE_CHANGED');
  const profiles = [{ id: 'p1', name: 'Capture', api: 'openai', model: 'm' }];
  const ctx = {
    extensionSettings: { connectionManager: { profiles } },
    ConnectionManagerRequestService: { getProfile: id => profiles.find(item => item.id === id), sendRequest: async () => { throw new Error('429 Too Many Requests'); } },
  };
  await assert.rejects(dispatchWorldStateRequest(ctx, { prompt: 'x' }, { route: { profileId: 'p1' } }), error => /429 Too Many Requests/.test(error.message));
});

test('55: renamed messages keep their missed captures', () => {
  const store = createDiagnosticStore();
  store.record('chat', { operationId: 'capture:3:1:1', label: 'capture', sourceMessageId: 3, lineageKey: 'old-l', contentLineageKey: 'old-c', outcome: 'invalid-response' });
  assert.equal(store.relink('chat', new Map([['old-l', 'new-l'], ['old-c', 'new-c']])), 1);
  assert.deepEqual([store.allRecords('chat')[0].lineageKey, store.allRecords('chat')[0].contentLineageKey], ['new-l', 'new-c']);
  assert.match(source, /if \(diagnosticStore\.relink\(chatKey, keyMap\)\) scheduleOperationLogSave\(chatKey, \{ now: true \}\);/);
});

test('52, 57-60: host lifecycle and settings', () => {
  // 52: the Places index is rebuilt from the state cached after the base map loads.
  assert.match(source, /const current = stateCache\.get\(chatKey\);\n\s*if \(baseMap && currentChatKey\(\) === chatKey && current\?\.spatial\?\.baseMapRef\?\.id === state\.spatial\.baseMapRef\.id\) \{\n\s*resetSpatialRelevanceIndex\(chatKey, current\.spatial, baseMap\);/);
  // 57: a rebuild that cannot start says so.
  assert.match(source, /The rebuild did not start: the chat or World State changed while the base map loaded/);
  // 58: leaving a chat discards its resume point.
  assert.match(source, /cancelWorldStateRequests\(\{ chatKey: previousKey \}\);\n\s*\/\/ Leaving the chat discards[^\n]*\n\s*rebuildResumes\.delete\(previousKey\);/);
  // 59: the base-map registry changes only after the attach is saved.
  const attach = source.slice(source.indexOf("  if (actionId === 'import_base_map') {\n    const startEpoch"), source.indexOf("  if (actionId === 'detach_base_map') {"));
  assert.ok(attach.indexOf('settings.spatialBaseMaps[sourceKey]') > attach.indexOf('if (await persistSpatialState(res.state'));
  assert.ok(attach.indexOf('settings.spatialBaseMaps[sourceKey]') > attach.indexOf('window.confirm('));
  // 60: detach reports success only after the save.
  assert.match(source, /if \(await persistSpatialState\(res\.state\)\) notify\('info', 'Base map detached\./);
});

// Code review hardening.

test('review: a base place whose override was merged away maps to the merge target', () => {
  const baseMap = parseBaseMap({ id: 'realm', locations: [{ id: 'b_keep', name: 'Greywatch Keep', coord: [1, 1] }] });
  let spatial = normalizeSpatialState({ baseMapRef: { id: 'realm' }, locations: [place('ov_keep', 'Greywatch Keep', unknown, { baseRefId: 'b_keep' }), place('fort', 'Greywatch Fortress')] });
  spatial = reduceSpatialMutations(spatial, { chatKey: 'a57', messageId: 1, lineageKey: 'l1', operation: 'manual', mutations: [{ action: 'merge_locations', sourceId: 'ov_keep', targetId: 'fort' }] }, baseMap, { allowBaseScan: true }).spatial;
  const out = spatialCapture('Greywatch Keep looms over the pass.', [location('Greywatch Keep', 'Greywatch Keep looms over the pass')], spatial, { baseMap });
  assert.ok(!out.rejected.some(item => /archived/.test(item.reason)), JSON.stringify(out.rejected));
  assert.deepEqual(out.spatial.locations.filter(item => item.status === 'active').map(item => item.name), ['Greywatch Fortress']);
});

test('review: sharing words is not citing; directions before a clause or conjunction count, gate names do not', () => {
  const borrowed = spatialCapture('Millbrook lies by the river. Oakvale sits by the river 12 km north of Millbrook.', [relation('Millbrook lies by the river', { direction: 'north', distanceKm: 12 })], twoPlaces());
  assert.equal(borrowed.spatial.relations.length, 0);
  const clause = spatialCapture('From Millbrook, Oakvale lies to the north, where the river bends.', [relation('From Millbrook, Oakvale lies to the north, where the river bends', { direction: 'north' })], twoPlaces());
  assert.equal(clause.spatial.relations[0]?.direction, 'north');
  const conjunction = spatialCapture('Oakvale lies north while Millbrook sleeps.', [relation('Oakvale lies north while Millbrook sleeps', { direction: 'north' })], twoPlaces());
  assert.equal(conjunction.spatial.relations[0]?.direction, 'north');
  const gates = spatialCapture('Between the north and south gates, Oakvale meets Millbrook.', [relation('Between the north and south gates, Oakvale meets Millbrook', { direction: 'north' })], twoPlaces());
  assert.equal(gates.spatial.relations.length, 0);
});

test('review: a relative relation is judged after a same-reply anchor move and its rejection keeps its row', () => {
  const spatial = normalizeSpatialState({ profile, locations: [place('mill', 'Millbrook', { x: 0, y: 0, authority: 'narrative_explicit', locked: false })] });
  const text = 'Millbrook now stands at [0, 20]. Oakvale stands at [0, 10], north of Millbrook.';
  const out = spatialCapture(text, [
    { action: 'upsert_location', locationId: 'mill', name: 'Millbrook', coordinate: { x: 0, y: 20 }, admissionReason: 'explicit_coordinate', evidence: [{ sourceMessageId: 2, claim: 'Millbrook now stands at [0, 20]' }] },
    location('Oakvale', 'Oakvale stands at [0, 10], north of Millbrook', { coordinate: { x: 0, y: 10 }, relative: { toLocationId: 'mill', direction: 'north' } }),
  ], spatial);
  assert.ok(out.spatial.locations.some(item => item.name === 'Oakvale'));
  const row = out.rejected.find(item => item.stage === 'spatial-reducer');
  assert.equal(row?.index, 1, JSON.stringify(out.rejected));
});

test('review: the rebuild pin comes from the route snapshot; relinked rows survive merges', async () => {
  const { worldStateRouteFingerprint } = await import('../provider-routing.js');
  const host = { mainApi: 'textgenerationwebui', onlineStatus: 'model-a', extensionSettings: {} };
  assert.equal(worldStateRouteFingerprint(host, {}).hostKey, worldStateHostRouteKey(host));
  assert.match(source, /: pinnedHostRoute\(routeFingerprint\),/);
  const { mergeOperationRows } = await import('../diagnostics.js');
  const base = { operationId: 'capture:3:1:1', label: 'capture', at: 5, sourceMessageId: 3, outcome: 'invalid-response' };
  const stale = { ...base, lineageKey: 'old-l' };
  const moved = { ...base, lineageKey: 'new-l', relinkedAt: 9 };
  assert.equal(mergeOperationRows([moved], [stale])[0].lineageKey, 'new-l');
  assert.equal(mergeOperationRows([stale], [moved])[0].lineageKey, 'new-l');
});
