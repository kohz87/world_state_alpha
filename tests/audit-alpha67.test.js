// alpha.67: Astra Pro audit on ec4973c, findings A06-A09, A14, A16 and A17 (Places geometry, operator intent
// and provenance).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { chatLineage } from '../branch.js';
import { buildEvolutionContext, planLazyEvolution, runLazyEvolution } from '../evolution.js';
import { processSpatialCapture } from '../spatial-capture.js';
import { normalizeSpatialState, reduceSpatialMutations, resolveEffectiveLocations } from '../spatial-core.js';
import { createState, normalizeState, reduceMutations } from '../state-core.js';

const rebuild = fs.readFileSync('rebuild.js', 'utf8');

const exchange = text => [{ messageId: 2, is_user: false, is_system: false, mes: text, content: text, lineageKey: 'ln_2' }];
function spatialCapture(text, rawSpatialMutations, spatial) {
  return processSpatialCapture({
    rawSpatialMutations, spatial, exchange: exchange(text),
    visibleLocations: resolveEffectiveLocations(spatial, null).filter(item => (item.status || 'active') === 'active'),
    baseMap: null, profile: spatial.profile, chatKey: 'a67', sourceMessageId: 2, sourceLineageKey: 'ln_2', operation: 'capture',
  });
}
const manual = (spatial, mutations) => reduceSpatialMutations(spatial, { chatKey: 'a67', messageId: 1, lineageKey: 'l1', operation: 'manual', mutations }, null, { allowBaseScan: true });
const unknown = { x: null, y: null, authority: 'unknown', locked: false };
const at = (x, y) => ({ x, y, authority: 'narrative_explicit', locked: false });
const place = (id, name, coordinate = unknown, extra = {}) => ({ id, name, type: 'landmark', status: 'active', coordinate, ...extra });
const location = (name, claim, extra = {}) => ({ action: 'upsert_location', name, type: 'landmark', admissionReason: 'persistent_feature', evidence: [{ sourceMessageId: 2, claim }], ...extra });
const profile = { system: 'cartesian2d', northAxis: '+y', eastAxis: '+x', unitKm: 1, trueNorthLocked: true };

test('A06: a position is never derived from an anchor the same reply moves by name', () => {
  const spatial = normalizeSpatialState({ profile, locations: [place('anchor', 'Greywatch', at(0, 0))] });
  const text = 'Greywatch now stands at [10, 0]. Oakvale lies 1 km north of Greywatch in a straight line.';
  const out = spatialCapture(text, [
    // A name-only move: no locationId.
    location('Greywatch', 'Greywatch now stands at [10, 0]', { coordinate: { x: 10, y: 0 } }),
    location('Oakvale', 'Oakvale lies 1 km north of Greywatch in a straight line', { relative: { toLocationId: 'anchor', direction: 'north', distanceKm: 1, distanceMode: 'straight_line' } }),
  ], spatial);
  const oak = out.spatial.locations.find(item => item.name === 'Oakvale');
  // Before: derived as [0, 1] from Greywatch's old position.
  assert.notDeepEqual([oak?.coordinate.x, oak?.coordinate.y], [0, 1]);
  assert.deepEqual([out.spatial.locations.find(item => item.id === 'anchor').coordinate.x], [10]);
});

test('A07: a coordinate given for another place in the same sentence is never borrowed', () => {
  const spatial = normalizeSpatialState({ locations: [] });
  const text = 'Northford stands at [1, 2], while Southford stands at [5, 6].';
  const wrong = spatialCapture(text, [location('Northford', text, { coordinate: { x: 5, y: 6 } })], spatial);
  const north = wrong.spatial.locations.find(item => item.name === 'Northford');
  assert.equal(north.coordinate.x, null);
  const right = spatialCapture(text, [location('Northford', text, { coordinate: { x: 1, y: 2 } })], spatial);
  assert.deepEqual([right.spatial.locations[0].coordinate.x, right.spatial.locations[0].coordinate.y], [1, 2]);
  // One pair in a sentence still belongs to the place it names, wherever it stands.
  const single = spatialCapture('Northford, a river town, stands at [1, 2].', [location('Northford', 'Northford, a river town, stands at [1, 2]', { coordinate: { x: 1, y: 2 } })], spatial);
  assert.equal(single.spatial.locations[0].coordinate.x, 1);
});

test('A08: a manual archive or merge of model places is operator intent that rebuild keeps', () => {
  const spatial = normalizeSpatialState({ locations: [place('mill', 'Millbrook'), place('mill2', 'Mill Brook'), place('oak', 'Oakvale')] });
  const archived = manual(spatial, [{ action: 'archive_location', locationId: 'oak', evidence: [{ sourceClass: 'manual', claim: 'Retired by the operator' }] }]);
  const oak = archived.spatial.locations.find(item => item.id === 'oak');
  assert.equal(oak.status, 'archived');
  assert.equal(oak.operatorOwned, true);
  const merged = manual(spatial, [{ action: 'merge_locations', sourceId: 'mill2', targetId: 'mill', evidence: [{ sourceClass: 'manual', claim: 'Same place' }] }]);
  assert.equal(merged.spatial.locations.find(item => item.id === 'mill2').operatorOwned, true);
  // The surviving place stays the model's, so narration keeps updating it.
  assert.notEqual(merged.spatial.locations.find(item => item.id === 'mill').operatorOwned, true);
  // A rebuild that re-extracts Places retires the model's copy of an archived or merged-away name and points
  // its relations at the archived place or the merge target.
  assert.match(rebuild, /if \(!operatorId && loc\.status === 'active' && retired\.has\(key\)\) \{\s*const target = retiredTarget\(retired\.get\(key\)\);\s*if \(target !== loc\.id\) moved\.set\(loc\.id, target\);\s*return false;/);
});

test('A14: route waypoints are checked like endpoints', () => {
  const spatial = normalizeSpatialState({ locations: [place('mill', 'Millbrook'), place('oak', 'Oakvale')] });
  const text = 'The Mill Road runs from Millbrook to Oakvale.';
  const out = spatialCapture(text, [{ action: 'upsert_route', name: 'Mill Road', type: 'road', endpoints: ['mill', 'oak'], waypoints: ['invented_id', 'oak'], evidence: [{ sourceMessageId: 2, claim: text }] }], spatial);
  assert.deepEqual(out.spatial.routes[0].waypoints, ['oak']);
  assert.ok(out.rejected.some(item => /unknown route waypoints were not applied/.test(item.reason)));
  // An existing route keeps its own waypoints rather than a partial list.
  const existing = normalizeSpatialState({ locations: [place('mill', 'Millbrook'), place('oak', 'Oakvale'), place('ford', 'Ford')], routes: [{ id: 'rt', name: 'Mill Road', type: 'road', endpoints: ['mill', 'oak'], waypoints: ['ford', 'oak'] }] });
  const kept = spatialCapture(text, [{ action: 'upsert_route', name: 'Mill Road', type: 'road', endpoints: ['mill', 'oak'], waypoints: ['ford', 'invented_id'], evidence: [{ sourceMessageId: 2, claim: text }] }], existing);
  assert.deepEqual(kept.spatial.routes[0].waypoints, ['ford', 'oak']);
});

test('A16: repeating a relationship on later messages keeps one link', () => {
  let state = reduceMutations(createState('a67'), {
    chatKey: 'a67', messageId: 0, lineageKey: 'l0', operation: 'capture',
    mutations: [
      { action: 'create', kind: 'development', summary: 'The Mill burns', anchors: ['mill'], evidence: [{ sourceMessageId: 0, claim: 'The Mill burns' }] },
      { action: 'create', kind: 'development', summary: 'Bread prices rise', anchors: ['bread'], evidence: [{ sourceMessageId: 0, claim: 'Bread prices rise' }] },
    ],
  }).state;
  const [mill, bread] = state.records;
  for (let messageId = 1; messageId <= 5; messageId += 1) {
    state = reduceMutations(state, {
      chatKey: 'a67', messageId, lineageKey: 'l' + messageId, operation: 'capture',
      mutations: [{ action: 'update', recordId: bread.id, summary: 'Bread prices keep rising', relatedRecordIds: [mill.id], evidence: [{ sourceMessageId: messageId, claim: 'Bread prices keep rising' }] }],
    }).state;
  }
  assert.equal(state.links.filter(link => link.type === 'related').length, 1);
  // Links saved by an older version are loaded as they are (checkpoints recorded them that way).
  const duplicated = { ...state, links: [...state.links, { ...state.links[0], id: 'wsl_dup', from: state.links[0].to, to: state.links[0].from }] };
  assert.equal(normalizeState(duplicated).links.length, 2);
});

test('A17: a merge that collapses two relations keeps both relations\' evidence', () => {
  const spatial = normalizeSpatialState({
    locations: [place('mill', 'Millbrook'), place('mill2', 'Mill Brook'), place('oak', 'Oakvale')],
    relations: [
      { id: 'r1', fromId: 'oak', toId: 'mill', direction: 'north', evidenceIds: ['e1'] },
      { id: 'r2', fromId: 'oak', toId: 'mill2', direction: 'north', evidenceIds: ['e2'] },
    ],
    evidence: {
      e1: { id: 'e1', sourceMessageId: 1, sourceClass: 'assistant_narration', claim: 'Millbrook lies north of Oakvale' },
      e2: { id: 'e2', sourceMessageId: 2, sourceClass: 'assistant_narration', claim: 'Mill Brook lies north of Oakvale' },
    },
  });
  const merged = manual(spatial, [{ action: 'merge_locations', sourceId: 'mill2', targetId: 'mill', evidence: [{ sourceClass: 'manual', claim: 'Same place' }] }]);
  assert.equal(merged.spatial.relations.length, 1);
  assert.deepEqual(new Set(merged.spatial.relations[0].evidenceIds), new Set(['e1', 'e2']));
  assert.ok(merged.spatial.evidence.e2);
});

test('A09: a derived development keeps the historical evidence it was derived from', async () => {
  const chat = [{ role: 'assistant', content: 'The established developments are described here.' }];
  const lineage = chatLineage(chat);
  const seeded = reduceMutations(createState('a67-derived'), {
    chatKey: 'a67-derived', messageId: 0, lineageKey: lineage[0].lineageKey,
    mutations: [
      { action: 'create', kind: 'development', summary: 'Trade restrictions are limiting food shipments.', trend: 'stable', anchors: ['trade restrictions', 'food shipments'], evidence: [{ sourceMessageId: 0, lineageKey: lineage[0].lineageKey, sourceClass: 'assistant_narration', claim: 'Trade restrictions are limiting food shipments into the district.' }] },
      { action: 'create', kind: 'development', summary: 'Food shortages are worsening.', trend: 'stable', anchors: ['food shortages'], evidence: [{ sourceMessageId: 0, lineageKey: lineage[0].lineageKey, sourceClass: 'assistant_narration', claim: 'Food shortages are worsening as legal supplies remain constrained.' }] },
    ],
  }).state;
  const [trade, shortage] = seeded.records;
  const fullChat = [...chat, { role: 'user', content: 'Five weeks later, I return to the food market.' }];
  const fullLineage = chatLineage(fullChat);
  const exchange = fullChat.map((message, messageId) => ({ ...message, messageId, lineageKey: fullLineage[messageId].lineageKey }));
  const response = JSON.stringify({
    evaluations: [
      { recordId: trade.id, outcome: 'stable', reason: 'No direct change.', supportIds: ['t0'] },
      { recordId: shortage.id, outcome: 'stable', reason: 'No direct change.', supportIds: ['t0'] },
    ],
    derived: [{
      summary: 'An illicit food trade is becoming established around constrained legal supply.',
      trend: 'emerging',
      anchors: ['illicit food trade', 'food supply'],
      causeRecordIds: [trade.id, shortage.id],
      reason: 'Sustained restrictions and worsening shortage support an illicit supply channel.',
      supportIds: ['t0', 'h0', 'h1'],
    }],
  });
  const result = await runLazyEvolution({
    ctx: { extensionSettings: { world_state_alpha: {}, disabledExtensions: [] }, async generateRaw() { return response; } },
    state: seeded,
    selectedEntries: seeded.records.map(record => ({ record, score: 10, source: 'seed', reasons: ['recent-anchor'] })),
    exchange,
    chatKey: 'a67-derived',
    isCurrent: () => true,
    sourceMessageId: 1,
    sourceLineageKey: fullLineage[1].lineageKey,
  });
  const derived = result.state.records.find(item => ![trade.id, shortage.id].includes(item.id));
  const classes = derived.evidenceIds.map(id => result.state.evidence[id]?.sourceClass);
  assert.ok(classes.includes('assistant_narration'), 'the causes\' historical claims are kept with their original class');
  assert.ok(classes.includes('elapsed_hint'));
  // The next elapsed-time evaluation of the derived record has historical support to cite.
  const plan = planLazyEvolution(result.state, {
    selectedEntries: [{ record: derived, score: 10, source: 'seed', reasons: ['recent-anchor'] }],
    elapsedHint: { raw: 'two weeks later', amount: 2, unit: 'week', meaningful: true, sourceMessageId: 5, lineageKey: 'l5' },
    sourceMessageId: 5,
  });
  const context = buildEvolutionContext(result.state, plan);
  assert.ok(Object.values(context.supportCatalog).some(item => item.type === 'historical' && item.recordIds.includes(derived.id)));
});

test('review: a coordinate stays with its place in lists, appositions and names with "and"', () => {
  const spatial = normalizeSpatialState({ locations: [] });
  const coordOf = (text, name, coordinate) => spatialCapture(text, [location(name, text, { coordinate })], spatial).spatial.locations.find(item => item.name === name)?.coordinate;
  assert.equal(coordOf('Northford: [1, 2]; Southford: [5, 6].', 'Northford', { x: 1, y: 2 }).x, 1);
  assert.equal(coordOf('Northford, a mill town, lies at [1, 2], while Southford lies at [5, 6].', 'Northford', { x: 1, y: 2 }).x, 1);
  assert.equal(coordOf('Salt and Iron Keep stands at [1, 2] and Southford at [5, 6].', 'Salt and Iron Keep', { x: 1, y: 2 }).x, 1);
  assert.equal(coordOf('Northford, a mill town, lies at [1, 2], while Southford lies at [5, 6].', 'Northford', { x: 5, y: 6 }).x, null);
});

test('review: a sentence referring back gives its subject only the pair it opens with', () => {
  const spatial = normalizeSpatialState({ locations: [] });
  const text = 'The Old Mill stands by the river. It sits at [12, 4], while Southford sits at [5, 6].';
  const wrong = spatialCapture(text, [location('Old Mill', text, { coordinate: { x: 5, y: 6 } })], spatial);
  assert.equal(wrong.spatial.locations.find(item => item.name === 'Old Mill').coordinate.x, null);
  const right = spatialCapture(text, [location('Old Mill', text, { coordinate: { x: 12, y: 4 } })], spatial);
  assert.equal(right.spatial.locations.find(item => item.name === 'Old Mill').coordinate.x, 12);
});

test('review: a move by a merged-away name counts as moving its merge target', () => {
  const spatial = normalizeSpatialState({ profile, locations: [
    place('river', 'Riverford', at(0, 0)),
    place('oldford', 'Old Ford', unknown, { status: 'archived', mergedInto: 'river' }),
  ] });
  const text = 'Old Ford now stands at [10, 0]. Oakvale lies 1 km north of Riverford in a straight line.';
  const out = spatialCapture(text, [
    location('Old Ford', 'Old Ford now stands at [10, 0]', { coordinate: { x: 10, y: 0 } }),
    location('Oakvale', 'Oakvale lies 1 km north of Riverford in a straight line', { relative: { toLocationId: 'river', direction: 'north', distanceKm: 1, distanceMode: 'straight_line' } }),
  ], spatial);
  const oak = out.spatial.locations.find(item => item.name === 'Oakvale');
  assert.notDeepEqual([oak?.coordinate.x, oak?.coordinate.y], [0, 1]);
});

test('review: historical and current support citing one claim become one evidence entry', () => {
  const evolution = fs.readFileSync('evolution.js', 'utf8');
  assert.match(evolution, /const key = `evidence\|\$\{support\.sourceMessageId\}\|\$\{support\.claim\}`;/);
  assert.match(evolution, /const key = `\$\{support\.type === 'current' \? 'evidence' : support\.type\}\|/);
});
