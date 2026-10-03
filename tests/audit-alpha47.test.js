// alpha.47: external audit A13-A17 (admission) and A22-A26 (Places grounding), each reproduced against
// 0.9.0-alpha.46 first.
import test from 'node:test';
import assert from 'node:assert/strict';

import { processCaptureResponse } from '../capture.js';
import { validateCaptureEnvelope } from '../capture-wire.js';
import { consolidateCreateCandidate, distinctSubjects } from '../duplicate.js';
import { normalizeSpatialState, reduceSpatialMutations } from '../spatial-core.js';
import { processSpatialCapture } from '../spatial-capture.js';
import { createSpatialState } from '../spatial-core.js';
import { createState, reduceMutations } from '../state-core.js';

const exchangeWith = text => [
  { messageId: 1, is_user: true, is_system: false, mes: 'I listen.', lineageKey: 'ln_1' },
  { messageId: 2, is_user: false, is_system: false, mes: text, lineageKey: 'ln_2' },
];
const capture = (state, text, mutations, options = {}) => processCaptureResponse({
  text: JSON.stringify({ mutations, ...options.extra }), state, exchange: exchangeWith(text), visibleRecords: state.records,
  chatKey: 'a47', sourceMessageId: 2, sourceLineageKey: 'ln_2', spatialEnabled: Boolean(options.spatialEnabled),
});
function seeded(summary, anchors, kind = 'fact') {
  return reduceMutations(createState('a47'), {
    chatKey: 'a47', messageId: 0, lineageKey: 'ln_0', operation: 'capture',
    mutations: [{ action: 'create', kind, summary, anchors, evidence: [{ sourceMessageId: 0, claim: summary }] }],
  }).state;
}

test('A13: malformed anchor fields never clear a record\'s anchors', () => {
  for (const anchors of ['Southport', null, 7, [null]]) {
    const wire = validateCaptureEnvelope({ mutations: [{ action: 'update', recordId: 'r1', summary: 'The gate is sealed.', anchors, evidence: [{ sourceMessageId: 1, claim: 'the gate is sealed' }] }] });
    // Before: each shape became [] and erased the anchors.
    assert.equal(Object.hasOwn(wire.mutations[0], 'anchors'), false, JSON.stringify(anchors));
  }
  assert.deepEqual(validateCaptureEnvelope({ mutations: [{ action: 'update', recordId: 'r1', anchors: [], evidence: [{ sourceMessageId: 1, claim: 'x y z' }] }] }).mutations[0].anchors, []);
  assert.deepEqual(validateCaptureEnvelope({ mutations: [{ action: 'update', recordId: 'r1', anchors: ['gate', null], evidence: [{ sourceMessageId: 1, claim: 'x y z' }] }] }).mutations[0].anchors, ['gate']);
});

test('A14: a malformed spatialMutations container fails the boundary instead of reading as "no places"', () => {
  for (const spatialMutations of [{}, 'none', null]) {
    // Before: coerced to [] and the boundary (and a whole rebuild) completed without places.
    assert.throws(() => capture(createState('a47'), 'Nothing changes.', [], { spatialEnabled: true, extra: { spatialMutations } }), /spatialMutations must be an array/);
  }
  assert.equal(capture(createState('a47'), 'Nothing changes.', [], { spatialEnabled: true }).applied.length, 0);
});

test('A15: attribution follows the claim, both for wrapped quotations and for unrelated reporting clauses', () => {
  // A full quotation cited with its speaker frame is still hearsay.
  const quote = 'A trader says, "Kesselpass is closed by an avalanche. The eastern road is impassable."';
  const promoted = capture(createState('a47'), quote, [{ action: 'create', kind: 'fact', summary: 'Kesselpass is closed by an avalanche', anchors: ['Kesselpass'], evidence: [{ sourceMessageId: 2, claim: quote }] }]);
  assert.equal(promoted.state.records.length, 0);
  // A narrated event in a sentence with an unrelated reporting clause is still narrated.
  const narrated = 'The bridge collapses into the river while a trader said prices would rise.';
  const fact = capture(createState('a47'), narrated, [{ action: 'create', kind: 'fact', summary: 'The bridge has collapsed into the river', anchors: ['bridge'], evidence: [{ sourceMessageId: 2, claim: 'The bridge collapses into the river' }] }]);
  assert.equal(fact.state.records.length, 1);
  // Reported speech still is reported: in the same clause, before it, or as a short trailing tag.
  for (const text of ['A trader says the bridge collapses into the river.', 'The bridge collapses into the river, the trader said.']) {
    const claim = text.includes('says') ? 'A trader says the bridge collapses into the river' : 'The bridge collapses into the river, the trader said';
    const out = capture(createState('a47'), text, [{ action: 'create', kind: 'fact', summary: 'The bridge has collapsed into the river', anchors: ['bridge'], evidence: [{ sourceMessageId: 2, claim }] }]);
    assert.equal(out.state.records.length, 0, text);
  }
});

test('A16: an unconfirmed report cannot resolve an established condition', () => {
  const state = seeded('The Southport dock strike is active', ['Southport', 'dock strike'], 'development');
  const text = 'A traveler claims the Southport dock strike ended. Nobody confirms the account.';
  const out = capture(state, text, [{ action: 'resolve', recordId: state.records[0].id, summary: 'A traveler reports that the Southport dock strike ended', evidence: [{ sourceMessageId: 2, claim: 'A traveler claims the Southport dock strike ended' }] }]);
  // Before: accepted, and the objective strike left active injection.
  assert.equal(out.state.records[0].status, 'active');
});

test('A17: conditions about differently named subjects are never merged', () => {
  const state = seeded('Southport north gate is sealed after damage', ['Southport', 'gate']);
  const candidate = { action: 'create', kind: 'fact', summary: 'Southport south gate is sealed', anchors: ['Southport', 'gate'], evidence: [{ sourceMessageId: 2, claim: 'the south gate is sealed' }] };
  // Before: similarity 0.9 turned the create into an update of the north gate.
  assert.equal(consolidateCreateCandidate(candidate, state.records).mutation.action, 'create');
  assert.equal(distinctSubjects('The Iron Watch blockades the Brindle bridge', 'The Iron Watch tightens the Brindle bridge blockade'), false);
  assert.equal(distinctSubjects('The 1st Battalion holds the ford', 'The 2nd Battalion holds the ford'), true);
});

const spatialExchange = text => [{ messageId: 2, is_user: false, is_system: false, mes: text, content: text, lineageKey: 'ln_2' }];
const spatialCapture = (text, rawSpatialMutations, spatial = createSpatialState()) => processSpatialCapture({
  rawSpatialMutations, spatial, exchange: spatialExchange(text), visibleLocations: spatial.locations, baseMap: null,
  profile: spatial.profile, chatKey: 'a47', sourceMessageId: 2, sourceLineageKey: 'ln_2', operation: 'capture',
});

test('A22/A23: coordinates are bound to their own place, and hypothetical geography is not current', () => {
  const text = 'Ironwatch Fortress stands at [15, 30]. Falcon Peak rises in the distance.';
  const borrowed = spatialCapture(text, [{ action: 'upsert_location', name: 'Falcon Peak', type: 'mountain', admissionReason: 'persistent_feature', coordinate: { x: 15, y: 30 }, evidence: [{ sourceMessageId: 2, claim: 'Falcon Peak rises in the distance' }] }]);
  const peak = borrowed.spatial.locations.find(item => item.name === 'Falcon Peak');
  // Before: Falcon Peak got [15, 30] as narrative_explicit.
  assert.equal(peak.coordinate.x, null);
  const own = spatialCapture(text, [{ action: 'upsert_location', name: 'Ironwatch Fortress', type: 'fortress', admissionReason: 'explicit_coordinate', coordinate: { x: 15, y: 30 }, evidence: [{ sourceMessageId: 2, claim: 'Ironwatch Fortress stands at [15, 30]' }] }]);
  assert.equal(own.spatial.locations[0].coordinate.authority, 'narrative_explicit');
  const pronoun = spatialCapture('The Old Mill stands by the river. It sits at [12, 4].', [{ action: 'upsert_location', name: 'Old Mill', type: 'mill', admissionReason: 'explicit_coordinate', coordinate: { x: 12, y: 4 }, evidence: [{ sourceMessageId: 2, claim: 'The Old Mill stands by the river' }] }]);
  assert.equal(pronoun.spatial.locations[0].coordinate.x, 12);

  const hypothetical = 'The cartographer says, "If we built Moonspire Tower at [15, 30], it would overlook the road."';
  const proposed = spatialCapture(hypothetical, [{ action: 'upsert_location', name: 'Moonspire Tower', type: 'tower', admissionReason: 'explicit_coordinate', coordinate: { x: 15, y: 30 }, evidence: [{ sourceMessageId: 2, claim: 'If we built Moonspire Tower at [15, 30], it would overlook the road' }] }]);
  // Before: admitted at exact narrative_explicit coordinates.
  assert.equal(proposed.spatial.locations.length, 0);
});

test('A24: a World_State header confirms a place without erasing its metadata', () => {
  const spatial = normalizeSpatialState({ locations: [{ id: 'wsloc_culvert', name: 'Applecross Culvert', type: 'culvert', status: 'active', context: 'A stone culvert', notes: 'Flooded in spring', coordinate: { x: null, y: null, authority: 'unknown', locked: false } }] });
  const text = '<World_State>\nLocation: Applecross Culvert | [31.4, 163.6]\n</World_State>\nThe water runs high.';
  const out = spatialCapture(text, [], spatial);
  const place = out.spatial.locations[0];
  // Before: the header supplement set type landmark and cleared context and notes.
  assert.deepEqual([place.type, place.context, place.notes], ['culvert', 'A stone culvert', 'Flooded in spring']);
});

test('A25/A26: a moved place drops a contradicted direction; a merged override moves its relations', () => {
  const spatial = normalizeSpatialState({
    profile: { system: 'cartesian2d', northAxis: '+y', eastAxis: '+x', unitKm: 1, trueNorthLocked: true },
    locations: [
      { id: 'tower', name: 'Tower', status: 'active', coordinate: { x: 0, y: 10, authority: 'manual', locked: false } },
      { id: 'anchor', name: 'Anchor', status: 'active', coordinate: { x: 0, y: 0, authority: 'manual', locked: true } },
    ],
    relations: [{ id: 'rel1', fromId: 'tower', toId: 'anchor', direction: 'south', distanceKm: 10, distanceMode: 'straight' }],
  });
  // Sanity: the stored direction agrees with the coordinates before the move.
  const moved = reduceSpatialMutations(spatial, {
    chatKey: 'a47', messageId: 3, lineageKey: 'ln3', operation: 'manual',
    mutations: [{ action: 'upsert_location', locationId: 'tower', name: 'Tower', coordinate: { x: 10, y: 0, authority: 'manual', locked: true }, evidence: [{ sourceMessageId: 3, claim: 'Resurveyed', sourceClass: 'manual' }] }],
  }, null, { allowBaseScan: true });
  const rel = moved.spatial.relations.find(item => item.id === 'rel1');
  // Before: the north/south relation stayed while the coordinates said east.
  assert.equal(rel.direction, null);
  assert.equal(rel.distanceKm, 10);

  const baseMap = { locations: [{ id: 'base_keep', name: 'Old Keep', coordinate: { x: 5, y: 5 } }] };
  const withOverride = normalizeSpatialState({
    locations: [
      { id: 'ovr_keep', baseRefId: 'base_keep', name: 'Old Keep', status: 'active', coordinate: { x: 5, y: 5, authority: 'campaign_override', locked: false } },
      { id: 'gen_keep', name: 'Keep Ruins', status: 'active', coordinate: { x: null, y: null, authority: 'unknown', locked: false } },
      { id: 'mill', name: 'Mill', status: 'active', coordinate: { x: null, y: null, authority: 'unknown', locked: false } },
    ],
    relations: [{ id: 'rel2', fromId: 'base_keep', toId: 'mill', direction: 'north', distanceKm: 2, distanceMode: 'route' }],
  });
  const merged = reduceSpatialMutations(withOverride, {
    chatKey: 'a47', messageId: 4, lineageKey: 'ln4', operation: 'manual',
    mutations: [{ action: 'merge_locations', sourceId: 'ovr_keep', targetId: 'gen_keep' }],
  }, baseMap, { allowBaseScan: true });
  // Before: the relation stayed on the base id and the target gained nothing.
  assert.equal(merged.spatial.relations.find(item => item.id === 'rel2').fromId, 'gen_keep');
});
