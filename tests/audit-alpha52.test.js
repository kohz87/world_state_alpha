// alpha.52: deep-pass items 27-39 (Places accuracy), each reproduced against 0.9.0-alpha.51 first.
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBaseMap } from '../spatial-base-map.js';
import { processSpatialCapture } from '../spatial-capture.js';
import { normalizeSpatialState, reduceSpatialMutations, resolveEffectiveLocations } from '../spatial-core.js';
import { buildSpatialInjection } from '../spatial-injection.js';
import { applySpatialManualMutation } from '../spatial-manual.js';
import { buildSpatialRelevanceIndex, selectRelevantLocations } from '../spatial-relevance.js';
import { createState } from '../state-core.js';

const exchange = text => [{ messageId: 2, is_user: false, is_system: false, mes: text, content: text, lineageKey: 'ln_2' }];
function spatialCapture(text, rawSpatialMutations, spatial, { baseMap = null, visible = null } = {}) {
  return processSpatialCapture({
    rawSpatialMutations, spatial, exchange: exchange(text),
    visibleLocations: visible || resolveEffectiveLocations(spatial, baseMap),
    baseMap, profile: spatial.profile, chatKey: 'a52', sourceMessageId: 2, sourceLineageKey: 'ln_2', operation: 'capture',
  });
}
const unknown = { x: null, y: null, authority: 'unknown', locked: false };
const place = (id, name, coordinate = unknown, extra = {}) => ({ id, name, type: 'landmark', status: 'active', coordinate, ...extra });
const location = (name, claim, extra = {}) => ({ action: 'upsert_location', name, type: 'landmark', admissionReason: 'persistent_feature', evidence: [{ sourceMessageId: 2, claim }], ...extra });
const profile = { system: 'cartesian2d', northAxis: '+y', eastAxis: '+x', unitKm: 1, trueNorthLocked: true };

test('27: a header that repeats a locked coordinate still updates the place', () => {
  const spatial = normalizeSpatialState({ locations: [place('culvert', 'Applecross Culvert', { x: 31.4, y: 163.6, authority: 'manual', locked: true }, { context: 'old' })] });
  const text = '<World_State>\nLoc: Applecross Culvert | flooded to the brim | [31.4, 163.6]\n</World_State>\nThe water runs high.';
  const out = spatialCapture(text, [], spatial);
  const culvert = out.spatial.locations[0];
  // Before: rejected as 'cannot overwrite locked coordinate', so the context stayed 'old' every turn.
  assert.equal(culvert.context, 'flooded to the brim');
  assert.deepEqual([culvert.coordinate.authority, culvert.coordinate.locked], ['manual', true]);
  assert.ok(!out.rejected.some(item => /locked/.test(item.reason)), JSON.stringify(out.rejected));
  // A different position for a locked place is still refused.
  const moved = spatialCapture(text.replace('[31.4, 163.6]', '[40, 2]'), [], spatial);
  assert.deepEqual([moved.spatial.locations[0].coordinate.x, moved.spatial.locations[0].coordinate.y], [31.4, 163.6]);
});

test('28: a position-less campaign override can receive a narrated position', () => {
  const baseMap = { locations: [{ id: 'b1', name: 'Elsewhere' }] };
  const spatial = normalizeSpatialState({ locations: [place('ov1', 'Elsewhere', { x: null, y: null, authority: 'campaign_override', locked: false }, { baseRefId: 'b1' })] });
  const out = spatialCapture('Elsewhere lies at [40, 2].', [location('Elsewhere', 'Elsewhere lies at [40, 2]', { locationId: 'b1', admissionReason: 'explicit_coordinate', coordinate: { x: 40, y: 2 } })], spatial, { baseMap });
  // Before: rejected as 'narrative_explicit < campaign_override'.
  assert.deepEqual([out.spatial.locations[0].coordinate.x, out.spatial.locations[0].coordinate.y], [40, 2]);
});

test('29: coordinates written beside the header name are not part of the name', () => {
  for (const loc of ['Old Mill [12, 4]', 'Old Mill (12, 4)', 'Old Mill — [12, 4]', 'Old Mill @ x=12, y=4']) {
    const out = spatialCapture(`<World_State>\nLoc: ${loc}\n</World_State>\nThe wheel turns.`, [], normalizeSpatialState({}));
    // Before: a place named 'Old Mill [12, 4]' (and another for every new position).
    assert.deepEqual(out.spatial.locations.map(item => [item.name, item.coordinate.x, item.coordinate.y]), [['Old Mill', 12, 4]], loc);
  }
});

test('30: a travel distance is never an exact straight-line coordinate without straight-line wording', () => {
  const spatial = normalizeSpatialState({ profile, locations: [place('oak', 'Oakvale', { x: 0, y: 0, authority: 'manual', locked: true })] });
  const relative = { toLocationId: 'oak', direction: 'north', distanceKm: 12, distanceMode: 'straight_line' };
  const ride = 'From Oakvale it is a 12 km ride north to Millbrook, winding through the hills.';
  const out = spatialCapture(ride, [location('Millbrook', ride, { relative })], spatial);
  const millbrook = out.spatial.locations.find(item => item.name === 'Millbrook');
  // Before: Millbrook derived at exactly (0, 12) with a straight_line relation.
  assert.equal(millbrook.coordinate.x, null);
  assert.notEqual(out.spatial.relations[0].distanceMode, 'straight_line');
  const crow = 'Millbrook lies 12 km north of Oakvale as the crow flies.';
  const derived = spatialCapture(crow, [location('Millbrook', crow, { relative })], spatial);
  assert.deepEqual([derived.spatial.locations.find(item => item.name === 'Millbrook').coordinate.y, derived.spatial.relations[0].distanceMode], [12, 'straight_line']);
});

test('31: a near-match coordinate is stored as narrated', () => {
  const spatial = normalizeSpatialState({ profile: { ...profile, decimalStep: 5 } });
  const out = spatialCapture('The Old Mill sits at [10, 20].', [location('Old Mill', 'The Old Mill sits at [10, 20]', { admissionReason: 'explicit_coordinate', coordinate: { x: 14.6, y: 15.2 } })], spatial);
  // Before: (14.6, 15.2) labelled narrative_explicit.
  assert.deepEqual([out.spatial.locations[0].coordinate.x, out.spatial.locations[0].coordinate.y], [10, 20]);
});

test('32: a short invented name must appear as a whole word', () => {
  const out = spatialCapture('Her cloak was soaked through.', [location('Oak', 'Her cloak was soaked through')], normalizeSpatialState({}));
  // Before: a place called 'Oak' was created from 'cloak'.
  assert.equal(out.spatial.locations.length, 0);
  assert.equal(spatialCapture('They rest under the Oak.', [location('Oak', 'They rest under the Oak')], normalizeSpatialState({})).spatial.locations.length, 1);
});

test('33: a relation to a same-name place outside the visible set is kept', () => {
  const spatial = normalizeSpatialState({ locations: [place('oak', 'Oakvale'), place('mill', 'Millbrook')] });
  const text = 'Millbrook lies east of Oakvale.';
  const out = spatialCapture(text, [location('Millbrook', text, { relative: { toLocationId: 'oak', direction: 'east' } })], spatial, { visible: [spatial.locations[0]] });
  // Before: applied as update_location with no relation and no rejection.
  assert.equal(out.spatial.locations.length, 2);
  assert.deepEqual(out.spatial.relations.map(rel => [rel.fromId, rel.toId, rel.direction]), [['oak', 'mill', 'east']]);
});

test('34: locking and unlocking an override keeps its override protection', () => {
  const baseMap = { locations: [{ id: 'b1', name: 'Keep', coordinate: { x: 1, y: 1 } }] };
  let state = createState('a52');
  state.spatial = normalizeSpatialState({ locations: [place('ov1', 'Keep', { x: 5, y: 5, authority: 'campaign_override', locked: false }, { baseRefId: 'b1' })] });
  for (const locked of [true, false]) {
    const coordinate = state.spatial.locations[0].coordinate;
    const res = applySpatialManualMutation({ state, chatKey: 'a52', baseMap, note: locked ? 'Locked coordinates' : 'Unlocked coordinates', mutation: { action: 'upsert_location', locationId: 'ov1', name: 'Keep', coordinate: { ...coordinate, locked } } });
    assert.equal(res.outcome, 'applied');
    state = res.state;
  }
  const narrated = reduceSpatialMutations(state.spatial, {
    chatKey: 'a52', messageId: 3, lineageKey: 'ln3', operation: 'capture',
    mutations: [{ action: 'upsert_location', locationId: 'ov1', name: 'Keep', coordinate: { x: 9, y: 9, authority: 'narrative_explicit' }, evidence: [{ sourceMessageId: 3, claim: 'The Keep stands at [9, 9]' }] }],
  }, baseMap, { visibleLocations: resolveEffectiveLocations(state.spatial, baseMap) });
  // Before: after Lock then Unlock it was an unlocked 'manual' coordinate, and narration moved it.
  assert.deepEqual([narrated.spatial.locations[0].coordinate.x, narrated.spatial.locations[0].coordinate.y], [5, 5]);
});

test('35: a base-map place outside the visible set is not duplicated', () => {
  const baseMap = { locations: [{ id: 'base_brack', name: 'Brackenford', coordinate: { x: 3, y: 3 } }] };
  const text = 'The caravan reaches Brackenford at dusk.';
  const out = spatialCapture(text, [location('Brackenford', text)], normalizeSpatialState({}), { baseMap, visible: [] });
  // Before: a campaign 'Brackenford' beside the base place.
  assert.equal(out.spatial.locations.length, 0);
});

test('36: a relation stated in reverse updates the existing one', () => {
  const spatial = normalizeSpatialState({
    locations: [place('oak', 'Oakvale'), place('mb', 'Millbrook')],
    relations: [{ id: 'r1', fromId: 'oak', toId: 'mb', direction: 'east', distanceKm: null, distanceMode: 'unspecified' }],
  });
  const text = 'Oakvale lies 8 km west of Millbrook.';
  const out = spatialCapture(text, [{ action: 'upsert_relation', fromId: 'mb', toId: 'oak', direction: 'west', distanceKm: 8, evidence: [{ sourceMessageId: 2, claim: text }] }], spatial);
  // Before: oak->mb east and mb->oak west were both stored.
  assert.deepEqual(out.spatial.relations.map(rel => [rel.fromId, rel.toId, rel.direction, rel.distanceKm]), [['oak', 'mb', 'east', 8]]);
});

test('37: archived neighbours do not crowd out an active one', () => {
  const spatial = normalizeSpatialState({
    locations: [
      place('kp', 'Kesselpass'),
      place('r1', 'First Ruin', unknown, { status: 'archived' }),
      place('r2', 'Second Ruin', unknown, { status: 'archived' }),
      place('r3', 'Third Ruin', unknown, { status: 'archived' }),
      place('bw', 'Brightwater'),
    ],
    relations: ['r1', 'r2', 'r3', 'bw'].map(id => ({ id: 'rel_' + id, fromId: 'kp', toId: id, direction: 'north' })),
  });
  const result = selectRelevantLocations(spatial, { index: buildSpatialRelevanceIndex(spatial), recentText: 'We climb toward Kesselpass.' });
  // Before: the three archived relations took every slot and Brightwater was never linked.
  assert.ok(result.selected.some(item => item.location.id === 'bw'), JSON.stringify(result.selected.map(item => item.location.id)));
  assert.ok(result.relations.some(rel => rel.toId === 'bw'));
});

test('38: base-map import keeps unknown positions unknown and tolerates repeated names', () => {
  const map = parseBaseMap({ name: 'Shire', locations: [
    { name: 'Newton', coord: [null, null] },
    { name: 'Newton', coord: ['', ''] },
    { name: 'Hill', coord: [2, 3] },
  ] });
  // Before: Number(null) made a locked origin point, and the repeated name failed the whole import.
  assert.deepEqual(map.locations.map(item => [item.name, item.coordinate.x, item.coordinate.locked]), [['Newton', null, false], ['Newton', null, false], ['Hill', 2, true]]);
  assert.equal(new Set(map.locations.map(item => item.id)).size, 3);
  // A base place without coordinates is not shown as a locked base-canonical position.
  const effective = resolveEffectiveLocations(normalizeSpatialState({}), map);
  assert.deepEqual(effective.map(item => [item.coordinate.authority, item.coordinate.locked]), [['unknown', false], ['unknown', false], ['base_canonical', true]]);
});

test('39: routes reach the prompt, and rejections keep the model row number', () => {
  const spatial = normalizeSpatialState({
    locations: [place('kp', 'Kesselpass', unknown, { routeRefs: ["King's Road"] })],
    routes: [{ id: 'rt1', name: "King's Road", type: 'road', endpoints: ['kp'], context: 'paved imperial highway' }],
  });
  const injected = buildSpatialInjection(spatial, { index: buildSpatialRelevanceIndex(spatial), recentText: 'We ride to Kesselpass.' });
  // Before: only the route name inside the place's line; the route itself was never shown.
  assert.match(injected.text, /King's Road \(road\).*paved imperial highway/);

  const out = spatialCapture('Her cloak was soaked through.', [{ action: 'upsert_location', name: 'Nowhere' }, location('Oak', 'Her cloak was soaked through')], normalizeSpatialState({}));
  // Before: the second row's rejection was logged as row 0.
  assert.deepEqual(out.rejected.map(item => item.index), [0, 1]);
});
