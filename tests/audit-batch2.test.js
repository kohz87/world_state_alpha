// Audit batch 2 (capture and injection quality): each case was reproduced against 0.9.0-alpha.42 first.
import test from 'node:test';
import assert from 'node:assert/strict';

import { CAPTURE_LIMITS, assistantBoundaryExchange, extractWorldStateCompletenessHints, normalizeCaptureExchange, processCaptureResponse } from '../capture.js';
import { validateCaptureEnvelope } from '../capture-wire.js';
import { detectElapsedHintFromExchange } from '../elapsed.js';
import { buildEvolutionContext, planLazyEvolution, processEvolutionResponse } from '../evolution.js';
import { parseEvolutionJson } from '../evolution-wire.js';
import { planChronologicalRebuild } from '../rebuild.js';
import { processSpatialCapture } from '../spatial-capture.js';
import { createSpatialState } from '../spatial-core.js';
import { buildSpatialInjection } from '../spatial-injection.js';
import { createState, reduceMutations } from '../state-core.js';

function blockade({ trend = 'rising' } = {}) {
  return reduceMutations(createState('b2'), {
    messageId: 0, lineageKey: 'ln_0', operation: 'capture',
    mutations: [{ action: 'create', kind: 'development', trend, summary: 'The Iron Watch blockades the Brindle river crossing', anchors: ['Iron Watch', 'Brindle crossing'], evidence: [{ sourceMessageId: 0, claim: 'The Iron Watch blockades the Brindle river crossing' }] }],
  }).state;
}
const exchangeWith = text => [
  { messageId: 1, is_user: true, is_system: false, mes: 'I ask about the crossing.', lineageKey: 'ln_1' },
  { messageId: 2, is_user: false, is_system: false, mes: text, lineageKey: 'ln_2' },
];
const capture = (state, text, mutations, visibleRecords = state.records) => processCaptureResponse({
  text: JSON.stringify({ mutations }), state, exchange: exchangeWith(text), visibleRecords, chatKey: 'b2', sourceMessageId: 2, sourceLineageKey: 'ln_2',
});

test('updates never erase a record\'s anchors or trend by accident', () => {
  const state = blockade();
  const record = state.records[0];
  // Every proposed anchor unsupported: the record keeps its anchors.
  const text = 'The Iron Watch blockade of the Brindle river crossing has tightened; now they search every cart.';
  const unsupported = capture(state, text, [{ action: 'update', recordId: record.id, summary: 'The Iron Watch blockade of the Brindle river crossing has tightened; they search every cart', anchors: ['cart searches'], evidence: [{ sourceMessageId: 2, claim: 'The Iron Watch blockade of the Brindle river crossing has tightened' }] }]);
  assert.deepEqual(unsupported.state.records[0].anchors, ['Iron Watch', 'Brindle crossing']);
  // A redundant create converted to an update by the duplicate gate keeps the trend.
  const redundant = capture(state, 'The Iron Watch still blockades the Brindle river crossing.', [{ action: 'create', kind: 'development', summary: 'The Iron Watch blockades the Brindle river crossing', anchors: ['Iron Watch', 'Brindle crossing'], evidence: [{ sourceMessageId: 2, claim: 'The Iron Watch still blockades the Brindle river crossing' }] }]);
  assert.equal(redundant.state.records.length, 1);
  assert.equal(redundant.state.records[0].trend, 'rising');
  // An unknown trend string is ignored; an explicit null still clears.
  assert.equal(Object.hasOwn(validateCaptureEnvelope({ mutations: [{ action: 'update', recordId: 'r1', trend: 'worsening', evidence: [{ sourceMessageId: 1, claim: 'x y z' }] }] }).mutations[0], 'trend'), false);
  assert.equal(validateCaptureEnvelope({ mutations: [{ action: 'update', recordId: 'r1', trend: null, evidence: [{ sourceMessageId: 1, claim: 'x y z' }] }] }).mutations[0].trend, null);
});

test('an evolution update with empty optional fields keeps anchors and trend; new anchors are added, not swapped', () => {
  const state = reduceMutations(createState('c'), { chatKey: 'c', messageId: 1, lineageKey: 'k1', operation: 'capture', mutations: [
    { action: 'create', kind: 'development', summary: 'A blockade holds Kestrel harbor.', trend: 'rising', anchors: ['Kestrel harbor', 'blockade'], evidence: [{ sourceMessageId: 1, claim: 'the blockade holds Kestrel harbor', sourceClass: 'assistant_narration' }] }] }).state;
  const record = state.records[0];
  const hint = { raw: 'Two weeks later', amount: 2, unit: 'week', meaningful: true, sourceMessageId: 5, lineageKey: 'k5', source: 'detected', context: 'Two weeks later, the fleet waits.' };
  const plan = planLazyEvolution(state, { selectedEntries: [record], elapsedHint: hint, sourceMessageId: 6, sourceLineageKey: 'k6' });
  const context = buildEvolutionContext(state, plan, {});
  const run = evaluation => processEvolutionResponse({ text: JSON.stringify({ evaluations: [{ recordId: record.id, outcome: 'update', reason: 'two weeks passed with supplies short', supportIds: context.targetSupportIds[record.id], ...evaluation }] }), state, context, chatKey: 'c', sourceMessageId: 6, sourceLineageKey: 'k6' }).state.records[0];
  const blank = run({ summary: 'The blockade of Kestrel harbor is thinning.', trend: '', anchors: [] });
  assert.deepEqual([blank.anchors, blank.trend], [['Kestrel harbor', 'blockade'], 'rising']);
  const added = run({ summary: 'The blockade of Kestrel harbor is thinning.', anchors: ['harbor patrols'] });
  assert.deepEqual(added.anchors, ['Kestrel harbor', 'blockade', 'harbor patrols']);
  // A fenced reply parses like capture's; prose around it is still rejected.
  assert.deepEqual(parseEvolutionJson('```json\n{"evaluations":[]}\n```').evaluations, []);
  assert.throws(() => parseEvolutionJson('Here you go: {"evaluations":[]}'));
});

test('one response cannot resolve a record and then rewrite it, nor create the same condition twice', () => {
  const state = blockade();
  const record = state.records[0];
  const evidence = [{ sourceMessageId: 2, claim: 'The Iron Watch blockade of the Brindle river crossing is broken' }];
  const ended = capture(state, 'The Iron Watch blockade of the Brindle river crossing is broken; the soldiers flee the crossing.', [
    { action: 'resolve', recordId: record.id, summary: 'The Iron Watch blockade of the Brindle river crossing was broken', evidence },
    { action: 'update', recordId: record.id, summary: 'The Iron Watch blockade of the Brindle river crossing still holds firm', evidence },
  ]);
  assert.equal(ended.state.records[0].status, 'resolved');
  assert.equal(ended.state.records[0].summary, 'The Iron Watch blockade of the Brindle river crossing was broken');

  const create = summary => ({ action: 'create', kind: 'development', summary, anchors: ['Iron Watch', 'Brindle bridge'], evidence: [{ sourceMessageId: 2, claim: 'Soldiers of the Iron Watch now blockade the Brindle bridge' }] });
  const twice = capture(createState('b2'), 'Soldiers of the Iron Watch now blockade the Brindle bridge, turning back every cart.', [create('The Iron Watch blockades the Brindle bridge'), create('The Iron Watch is blockading the Brindle bridge')], []);
  assert.deepEqual(twice.state.records.map(item => item.summary), ['The Iron Watch blockades the Brindle bridge']);
});

test('a narrated time skip is found even after the same phrase in dialogue', () => {
  const hint = detectElapsedHintFromExchange([{ messageId: 4, role: 'assistant', lineageKey: 'k4', content: '"Two weeks later is too late," Mara snapped. Two weeks later, the caravan finally reached the pass.' }]);
  assert.equal(hint?.raw, 'Two weeks later');
  assert.equal(detectElapsedHintFromExchange([{ messageId: 4, role: 'assistant', lineageKey: 'k4', content: '"Two weeks later is too late," Mara snapped.' }]), null);
});

test('hidden messages: a hidden reply ends its exchange, and an excluded-hidden rebuild never sends hidden turns', () => {
  const ai = (mes, hidden = false) => ({ name: 'Narrator', is_user: false, is_system: hidden, mes, swipes: [mes], swipe_id: 0, extra: { api: 'openai', model: 'm' } });
  const chat = [
    ai('Opening scene.'),
    { name: 'U', is_user: true, is_system: false, mes: 'I bribe the harbor master with ten gold.' },
    ai('The harbor master pockets the gold and waves you through.', true),
    { name: 'U', is_user: true, is_system: false, mes: 'I walk to the market.' },
    ai('The market is quiet today.'),
  ];
  const ids = exchange => normalizeCaptureExchange(exchange).map(item => item.messageId + ':' + item.role).join(' ');
  assert.equal(ids(assistantBoundaryExchange(chat, 4)), '3:user 4:assistant');
  assert.equal(ids(planChronologicalRebuild(chat).windows.find(item => item.messageId === 4).exchange), '3:user 4:assistant');

  const ooc = [
    { name: 'N', is_user: false, is_system: false, mes: 'Opening scene.' },
    { name: 'U', is_user: true, is_system: false, mes: 'I bribe the harbor master with ten gold.' },
    { name: 'N', is_user: false, is_system: true, mes: 'OOC: sorry, out of character reply.' },
    { name: 'U', is_user: true, is_system: true, mes: 'OOC: no worries.' },
    { name: 'U', is_user: true, is_system: false, mes: 'I walk to the market.' },
    { name: 'N', is_user: false, is_system: false, mes: 'The market is quiet today.' },
  ];
  const excluded = planChronologicalRebuild(ooc, { includeHiddenMessages: false }).windows.find(item => item.messageId === 5);
  assert.doesNotMatch(ids(excluded.exchange), /\b3:/);
});

test('the completeness checklist keeps colon bullets and the exchange stays within its character budget', () => {
  const hints = extractWorldStateCompletenessHints([{ messageId: 5, is_user: false, is_system: false, mes: 'Story.\n<World_State>\nOff-Screen:\n- The Iron Watch: still blockading the river crossing\n- Bandits continue raiding the eastern farms\nUnresolved Threads:\n- Who poisoned the well remains unknown\n</World_State>' }]);
  assert.deepEqual(hints.map(item => item.section + '|' + item.text), [
    'off_screen|The Iron Watch: still blockading the river crossing',
    'off_screen|Bandits continue raiding the eastern farms',
    'unresolved_threads|Who poisoned the well remains unknown',
  ]);
  const big = n => Array.from({ length: n }, (_, i) => 'word' + (i % 97)).join(' ');
  const out = normalizeCaptureExchange([
    { messageId: 1, is_user: false, is_system: false, mes: big(3000) },
    { messageId: 2, is_user: true, is_system: false, mes: big(3000) },
    { messageId: 3, is_user: false, is_system: false, mes: big(3000) },
  ]);
  assert.ok(out.reduce((sum, item) => sum + item.content.length, 0) <= CAPTURE_LIMITS.exchangeChars);
});

test('Places: no placeholder names in injection, no ungrounded renames, and an invented coordinate never costs the place', () => {
  const mk = (id, name, status = 'active') => ({ id, name, type: 'village', status, baseRefId: null, coordinate: { x: null, y: null, authority: 'unknown', locked: false }, context: 'coast', routeRefs: [], createdAtMessage: 1, lastChangedMessage: 1, evidenceIds: [], notes: '' });
  let spatial = createSpatialState();
  spatial.locations.push(mk('a', 'Applecross'), mk('m', 'Old Mill', 'archived'));
  spatial.relations.push({ id: 'r1', fromId: 'a', toId: 'm', direction: 'north', distanceKm: 5, distanceMode: 'route', notes: '', evidenceIds: [] });
  const text = buildSpatialInjection(spatial, { recentText: 'We rest in Applecross tonight.' }).text;
  assert.match(text, /Applecross/);
  assert.doesNotMatch(text, /\btarget\b|known anchor/);

  spatial = createSpatialState();
  spatial.locations.push(mk('a', 'Applecross'));
  const back = [{ messageId: 7, role: 'assistant', lineageKey: 'k7', content: 'Back in Applecross, the tide is out.' }];
  const renamed = processSpatialCapture({ rawSpatialMutations: [{ action: 'upsert_location', locationId: 'a', name: 'Port Seagrave', type: 'village', context: 'coast', admissionReason: 'revisited', evidence: [{ sourceMessageId: 7, claim: 'Back in Applecross, the tide is out' }] }], spatial, exchange: back, visibleLocations: spatial.locations, chatKey: 'c', sourceMessageId: 7, sourceLineageKey: 'k7' });
  assert.equal(renamed.spatial.locations[0].name, 'Applecross');

  spatial = createSpatialState();
  spatial.profile = { system: 'cartesian2d', northAxis: '+y', eastAxis: '+x', unitKm: 1, bounds: { xMin: 0, xMax: 100, yMin: 0, yMax: 100 }, decimalStep: 0.1, trueNorthLocked: true };
  const camp = [{ messageId: 9, role: 'assistant', lineageKey: 'k9', content: 'They camp at Harrow Ford tonight.' }];
  const placed = processSpatialCapture({ rawSpatialMutations: [{ action: 'upsert_location', name: 'Harrow Ford', type: 'ford', admissionReason: 'named', coordinate: { x: 250, y: 300 }, evidence: [{ sourceMessageId: 9, claim: 'They camp at Harrow Ford tonight' }] }], spatial, exchange: camp, visibleLocations: [], chatKey: 'c', sourceMessageId: 9, sourceLineageKey: 'k9' });
  assert.equal(placed.spatial.locations.length, 1);
  assert.equal(placed.spatial.locations[0].coordinate.x, null);
});

test('review hardening: header bullets close the checklist section; function-word names and newest phrases are still found', async () => {
  const hints = extractWorldStateCompletenessHints([{ messageId: 6, is_user: false, is_system: false, mes: '<World_State>\n- **📡 Off-Screen:** Orson harassing traders\n- **🌱 Planted Seeds:** brush-thieves targeting wheels\n- **🎯 Arc Phase:** Setup phase begins now\n</World_State>' }]);
  assert.deepEqual(hints.map(item => item.text), ['Orson harassing traders']);

  const { buildRelevanceIndex, selectRelevantRecords } = await import('../relevance.js');
  const rec = (id, summary, anchors) => ({ id, kind: 'fact', summary, status: 'active', trend: null, anchors, createdAtMessage: 1, lastChangedMessage: null, lastEvaluatedMessage: null, timeAnchor: '', evidenceIds: [], causedBy: [], affects: [] });
  const filler = n => Array.from({ length: n }, (_, i) => 'filler' + i).join(' ');
  const named = { records: [rec('will', 'Will keeps the ferry at the river.', ['Will'])], links: [] };
  const text = filler(80) + ' I go see will.';
  assert.deepEqual(selectRelevantRecords(named, { index: buildRelevanceIndex(named), recentText: text }).selected.map(item => item.record.id), ['will']);

  // A long older window full of another record's words must not crowd out a multi-word anchor in the newest
  // message: the bounded phrase scan starts from the newest end.
  const words = Array.from({ length: 80 }, (_, i) => 'alpha' + i);
  const crowded = { records: [rec('older', words.join(' '), ['old harbor district']), rec('watch', 'The Iron Watch holds the bridge.', ['Iron Watch'])], links: [] };
  const window = words.join(' ') + ' ' + words.join(' ') + ' Then the Iron Watch arrives.';
  const picked = selectRelevantRecords(crowded, { index: buildRelevanceIndex(crowded), recentText: window, candidateCap: 1 });
  assert.ok(picked.selected.some(item => item.record.id === 'watch'));
});

test('review hardening: a later real time skip survives an earlier rejected one; a dropped place is never named; merged duplicates keep anchors', () => {
  assert.equal(detectElapsedHintFromExchange([{ messageId: 4, role: 'assistant', lineageKey: 'k4', content: 'They planned to leave two weeks later. Three weeks later, the caravan reached the pass.' }])?.raw, 'Three weeks later');

  const mk = (id, name, context) => ({ id, name, type: 'village', status: 'active', baseRefId: null, coordinate: { x: null, y: null, authority: 'unknown', locked: false }, context, routeRefs: [], createdAtMessage: 1, lastChangedMessage: 1, evidenceIds: [], notes: '' });
  const spatial = createSpatialState();
  spatial.locations.push(mk('a', 'Applecross', 'coast'), mk('m', 'Old Mill', 'x'.repeat(500)));
  spatial.relations.push({ id: 'r1', fromId: 'a', toId: 'm', direction: 'north', distanceKm: 5, distanceMode: 'route', notes: '', evidenceIds: [] });
  const tight = buildSpatialInjection(spatial, { recentText: 'Applecross and the Old Mill', budgetTokens: 70 });
  const shown = new Set(tight.included.map(item => item.name));
  if (!shown.has('Old Mill')) assert.doesNotMatch(tight.text, /Old Mill is/);

  const create = (summary, anchors) => ({ action: 'create', kind: 'development', summary, anchors, evidence: [{ sourceMessageId: 2, claim: 'Soldiers of the Iron Watch now blockade the Brindle bridge' }] });
  const merged = capture(createState('b2'), 'Soldiers of the Iron Watch now blockade the Brindle bridge, turning back every cart.', [create('The Iron Watch blockades the Brindle bridge', ['Iron Watch']), create('The Iron Watch blockades the Brindle bridge.', ['Iron Watch', 'Brindle bridge'])], []);
  assert.equal(merged.state.records.length, 1);
  assert.deepEqual(merged.state.records[0].anchors, ['Iron Watch', 'Brindle bridge']);
});
