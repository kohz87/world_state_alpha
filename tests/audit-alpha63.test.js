// alpha.63: deep-pass items 49-69 (Places) and contract items 105, 106 and 112.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { estimateInjectionTokens, fitLine } from '../injection.js';
import { parseBaseMap } from '../spatial-base-map.js';
import { processSpatialCapture } from '../spatial-capture.js';
import { normalizeSpatialState, reduceSpatialMutations, resolveEffectiveLocations } from '../spatial-core.js';
import { buildSpatialRelevanceIndex, selectRelevantLocations } from '../spatial-relevance.js';
import { validateSpatialEnvelope } from '../spatial-wire.js';

const exchange = text => [{ messageId: 2, is_user: false, is_system: false, mes: text, content: text, lineageKey: 'ln_2' }];
function spatialCapture(text, rawSpatialMutations, spatial, { baseMap = null } = {}) {
  return processSpatialCapture({
    rawSpatialMutations, spatial, exchange: exchange(text),
    visibleLocations: resolveEffectiveLocations(spatial, baseMap).filter(item => (item.status || 'active') === 'active'),
    baseMap, profile: spatial.profile, chatKey: 'a63', sourceMessageId: 2, sourceLineageKey: 'ln_2', operation: 'capture',
  });
}
const manual = (spatial, mutations, baseMap = null, options = { allowBaseScan: true }) => reduceSpatialMutations(spatial, {
  chatKey: 'a63', messageId: 1, lineageKey: 'l1', operation: 'manual', mutations,
}, baseMap, options);
const unknown = { x: null, y: null, authority: 'unknown', locked: false };
const at = (x, y) => ({ x, y, authority: 'manual', locked: false });
const place = (id, name, coordinate = unknown, extra = {}) => ({ id, name, type: 'landmark', status: 'active', coordinate, ...extra });
const location = (name, claim, extra = {}) => ({ action: 'upsert_location', name, type: 'landmark', admissionReason: 'persistent_feature', evidence: [{ sourceMessageId: 2, claim }], ...extra });
const relation = (claim, extra = {}) => ({ action: 'upsert_relation', fromId: 'mill', toId: 'oak', evidence: [{ sourceMessageId: 2, claim }], ...extra });
const profile = { system: 'cartesian2d', northAxis: '+y', eastAxis: '+x', unitKm: 1, trueNorthLocked: true };
const twoPlaces = (extra = {}) => normalizeSpatialState({ locations: [place('mill', 'Millbrook'), place('oak', 'Oakvale')], ...extra });

test('49 and 105: naming a base route by its id never replaces it', () => {
  const baseMap = parseBaseMap({ id: 'realm', locations: [], routes: [{ id: 'r_king', name: 'Kings Road' }] });
  const out = spatialCapture('Travellers crowd the Kings Road to Karsk.', [{ action: 'upsert_route', routeId: 'r_king', name: 'Kings Road', evidence: [{ sourceMessageId: 2, claim: 'Travellers crowd the Kings Road to Karsk' }] }], normalizeSpatialState({ baseMapRef: { id: 'realm' } }), { baseMap });
  assert.equal(out.spatial.routes.length, 0);
  assert.ok(out.rejected.some(item => /read-only base-map route/.test(item.reason)));
});

test('50: an unknown direction such as "constructor" is rejected, never a crash', () => {
  let out;
  assert.doesNotThrow(() => { out = spatialCapture('Oakvale lies beside Millbrook.', [relation('Oakvale lies beside Millbrook', { direction: 'constructor' })], twoPlaces()); });
  assert.equal(out.spatial.relations.length, 0);
});

test('51 and 106: a free-text relation between positioned places survives a locked True North', () => {
  const spatial = normalizeSpatialState({ profile, locations: [place('mill', 'Millbrook', at(0, 0)), place('oak', 'Oakvale', at(0, 10))] });
  const out = manual(spatial, [{ action: 'upsert_relation', fromId: 'mill', toId: 'oak', direction: 'upriver' }]);
  assert.deepEqual(out.rejected, []);
  assert.equal(out.spatial.relations[0].direction, 'upriver');
});

test('52 and 112: an archived campaign place is not re-created by narration', () => {
  const spatial = normalizeSpatialState({ locations: [place('mill', 'Millbrook', unknown, { status: 'archived' })] });
  const out = spatialCapture('Millbrook stands silent by the river.', [location('Millbrook', 'Millbrook stands silent by the river')], spatial);
  assert.equal(out.spatial.locations.length, 1);
  assert.ok(out.rejected.some(item => /archived/.test(item.reason)));
});

test('53: a relative position is never derived from an anchor the same reply moves', () => {
  const spatial = normalizeSpatialState({ profile, locations: [place('mill', 'Millbrook', { x: 0, y: 0, authority: 'narrative_explicit', locked: false })] });
  const text = 'Millbrook now sits at [50, 50]. Oakvale lies 10 km north of Millbrook in a straight line.';
  const out = spatialCapture(text, [
    location('Millbrook', 'Millbrook now sits at [50, 50]', { locationId: 'mill', coordinate: { x: 50, y: 50 } }),
    location('Oakvale', 'Oakvale lies 10 km north of Millbrook in a straight line', { relative: { toLocationId: 'mill', direction: 'north', distanceKm: 10, distanceMode: 'straight_line' } }),
  ], spatial);
  const oak = out.spatial.locations.find(item => item.name === 'Oakvale');
  // Before: derived as [0, 10] from Millbrook's old position.
  assert.notDeepEqual([oak.coordinate.x, oak.coordinate.y], [0, 10]);
});

test('54: a relation stated the other way round is stored the way the narration states it', () => {
  // The relation reads "Oakvale lies <direction> of Millbrook"; the narration says Millbrook lies north of Oakvale.
  const out = spatialCapture('Millbrook lies north of Oakvale.', [relation('Millbrook lies north of Oakvale', { direction: 'north' })], twoPlaces());
  assert.equal(out.spatial.relations[0].direction, 'south');
  const right = spatialCapture('Oakvale lies north of Millbrook.', [relation('Oakvale lies north of Millbrook', { direction: 'north' })], twoPlaces());
  assert.equal(right.spatial.relations[0].direction, 'north');
});

test('55: the True North check reads where an override is now, not the projection from before the reply', () => {
  const baseMap = parseBaseMap({ id: 'realm', profile, locations: [{ id: 'b_keep', name: 'Greywatch Keep', coord: [0, -10] }] });
  const spatial = normalizeSpatialState({ baseMapRef: { id: 'realm' }, profile, locations: [
    place('camp', 'Camp', at(0, 0)),
    place('ov_keep', 'Greywatch Keep', { x: 0, y: 10, authority: 'campaign_override', locked: false }, { baseRefId: 'b_keep' }),
  ] });
  const stale = [{ id: 'b_keep', name: 'Greywatch Keep', isBase: true, coordinate: { x: 0, y: -10, authority: 'base_canonical', locked: true } }, spatial.locations[0]];
  const out = reduceSpatialMutations(spatial, { chatKey: 'a63', messageId: 1, lineageKey: 'l1', operation: 'manual', mutations: [
    { action: 'upsert_relation', fromId: 'camp', toId: 'b_keep', direction: 'north' },
  ] }, baseMap, { visibleLocations: stale });
  assert.deepEqual(out.rejected, []);
});

test('56: an empty relative placeholder fails nothing', () => {
  const wire = validateSpatialEnvelope([{ action: 'upsert_location', name: 'Oakvale', admissionReason: 'named', relative: {}, coordinate: {}, evidence: [{ sourceMessageId: 2, claim: 'Oakvale is quiet tonight' }] }]);
  assert.deepEqual(wire.rejected, []);
  assert.equal(wire.mutations[0].relative, null);
});

test('57: one word of a longer name does not select a place', () => {
  const spatial = normalizeSpatialState({ locations: [place('mill', 'Old Mill')] });
  const ids = text => selectRelevantLocations(spatial, { recentText: text }).selected.map(item => item.location?.id || item.id);
  assert.deepEqual(ids('An old man waves from the doorway.'), []);
  assert.deepEqual(ids('We reach the Old Mill at dusk.'), ['mill']);
});

test('58: route names fold like place names', () => {
  const spatial = normalizeSpatialState({ routes: [{ id: 'rt', name: 'North Road', type: 'road', endpoints: [], waypoints: [] }] });
  const out = manual(spatial, [{ action: 'upsert_route', name: 'North-Road', context: 'paved' }]);
  assert.equal(out.spatial.routes.length, 1);
});

test('59: a plain upsert at a base id is rejected instead of shadowing the base place', () => {
  const baseMap = parseBaseMap({ id: 'realm', locations: [{ id: 'b_keep', name: 'Greywatch Keep', coord: [1, 1] }] });
  const spatial = normalizeSpatialState({ baseMapRef: { id: 'realm' } });
  const out = manual(spatial, [{ action: 'upsert_location', locationId: 'b_keep', name: 'Greywatch Keep', notes: 'x' }], baseMap);
  assert.equal(out.spatial.locations.length, 0);
  assert.ok(out.rejected.some(item => /override/.test(item.reason)));
});

test('60: a relation id names that relation only between its own places', () => {
  const spatial = normalizeSpatialState({ locations: [place('a', 'A'), place('b', 'B'), place('c', 'C'), place('d', 'D')], relations: [{ id: 'rel1', fromId: 'a', toId: 'b', direction: 'north' }] });
  const out = manual(spatial, [{ action: 'upsert_relation', relationId: 'rel1', fromId: 'c', toId: 'd', direction: 'east' }]);
  assert.equal(out.spatial.relations.find(item => item.id === 'rel1').fromId, 'a');
  assert.ok(out.rejected.some(item => /other places/.test(item.reason)));
});

test('61 and 65: a long header line still grounds, and a date pair is no position', () => {
  const header = '<World_State>\n**Loc:** Greywatch Keep | ' + 'the old watchtower above the misty pass and its long ruined wall '.repeat(9) + '\n</World_State>\nThe wind howls.';
  const long = spatialCapture(header, [], normalizeSpatialState({}));
  assert.equal(long.spatial.locations[0]?.name, 'Greywatch Keep');
  const dated = spatialCapture('<World_State>\nLoc: Greywatch Keep | Date: (3, 12)\n</World_State>\nThe wind howls.', [], normalizeSpatialState({}));
  assert.equal(dated.spatial.locations[0]?.coordinate.x, null);
  const placed = spatialCapture('<World_State>\nLoc: Greywatch Keep | Pos: (3, 12)\n</World_State>\nThe wind howls.', [], normalizeSpatialState({}));
  assert.equal(placed.spatial.locations[0]?.coordinate.x, 3);
});

test('62: a dropped deferred relative relation keeps its row', () => {
  const source = fs.readFileSync('spatial-capture.js', 'utf8');
  assert.match(source, /rejected\.push\(\{ stage: 'spatial-relative', \.\.\.rowOf\(deferred\), reason: 'relative relation dropped: its place was not saved' \}\)/);
});

test('63: narrating a plain base place logs no reducer rejection', () => {
  const baseMap = parseBaseMap({ id: 'realm', locations: [{ id: 'b_keep', name: 'Greywatch Keep', coord: [1, 1] }] });
  const out = spatialCapture('Greywatch Keep looms over the pass.', [location('Greywatch Keep', 'Greywatch Keep looms over the pass')], normalizeSpatialState({ baseMapRef: { id: 'realm' } }), { baseMap });
  assert.deepEqual(out.rejected, []);
  assert.equal(out.spatial.locations.length, 0);
});

test('64: an update must be named by its evidence', () => {
  const out = spatialCapture('The tavern is loud tonight.', [location('Millbrook', 'The tavern is loud tonight', { locationId: 'mill', context: 'loud' })], twoPlaces());
  assert.equal(out.spatial.locations.find(item => item.id === 'mill').context, '');
  assert.ok(out.rejected.some(item => /does not name the place/.test(item.reason)));
});

test('66: a line cut to the budget never ends inside a number or a coordinate pair', () => {
  const line = '- Greywatch Keep at [123.45, 678.9] stands over the pass';
  for (let budget = 1; budget < 40; budget += 1) {
    const cut = fitLine(line, 'header', estimateInjectionTokens('header') + budget);
    if (!cut || cut === line) continue;
    assert.doesNotMatch(cut, /\d…$|[[(][^\])]*…$/u, cut);
  }
});

test('67: merging into an archived place is refused', () => {
  const spatial = normalizeSpatialState({ locations: [place('a', 'Kings Rest'), place('b', 'Kingsrest Inn', unknown, { status: 'archived' })] });
  const out = manual(spatial, [{ action: 'merge_locations', sourceId: 'a', targetId: 'b' }]);
  assert.equal(out.spatial.locations.find(item => item.id === 'a').status, 'active');
  assert.ok(out.rejected.some(item => /archived/.test(item.reason)));
});

test('68: base-map numeric strings count in object coordinates too', () => {
  const map = parseBaseMap({ id: 'realm', locations: [{ id: 'a', name: 'A', coordinate: { x: '12', y: '4' } }, { id: 'b', name: 'B', coord: ['5', '6'] }] });
  assert.deepEqual([map.locations[0].coordinate.x, map.locations[0].coordinate.y], [12, 4]);
  assert.deepEqual([map.locations[1].coordinate.x, map.locations[1].coordinate.y], [5, 6]);
});

test('69: the Places corpus counts active places after a build as after an update', () => {
  const spatial = normalizeSpatialState({ locations: [place('a', 'A'), place('b', 'B', unknown, { status: 'archived' })] });
  assert.equal(buildSpatialRelevanceIndex(spatial).corpusCount, 1);
});
