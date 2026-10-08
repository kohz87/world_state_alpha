// alpha.51: deep-pass items 18-26 (capture accuracy), each reproduced against 0.9.0-alpha.50 first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { processCaptureResponse } from '../capture.js';
import { detectElapsedHintFromExchange, normalizeElapsedHint } from '../elapsed.js';
import { planLazyEvolution } from '../evolution.js';
import { sanitizeAssistantNarration } from '../narrative-sanitizer.js';
import { evidenceClaimGrounded } from '../source-firewall.js';
import { createState, reduceMutations } from '../state-core.js';

const source = fs.readFileSync('index.js', 'utf8');

const exchangeWith = text => [
  { messageId: 1, is_user: true, is_system: false, mes: 'I listen.', lineageKey: 'ln_1' },
  { messageId: 2, is_user: false, is_system: false, mes: text, lineageKey: 'ln_2' },
];
const capture = (state, text, mutations, options = {}) => processCaptureResponse({
  text: JSON.stringify({ mutations }), state, exchange: exchangeWith(text), visibleRecords: state.records,
  chatKey: 'a51', sourceMessageId: 2, sourceLineageKey: 'ln_2', ...options,
});
function seeded(summary, anchors, kind = 'fact') {
  return reduceMutations(createState('a51'), {
    chatKey: 'a51', messageId: 0, lineageKey: 'ln_0', operation: 'capture',
    mutations: [{ action: 'create', kind, summary, anchors, evidence: [{ sourceMessageId: 0, claim: summary }] }],
  }).state;
}
const create = (summary, claim, anchors = ['volcano']) => [{ action: 'create', kind: 'fact', summary, anchors, evidence: [{ sourceMessageId: 2, claim }] }];

test('18: a quoted excerpt must start and end on word boundaries', () => {
  // Before: each matched inside a longer word, dropping a negating prefix.
  assert.equal(evidenceClaimGrounded('active volcano rumbles over the valley', 'The inactive volcano rumbles over the valley.'), false);
  assert.equal(evidenceClaimGrounded('armed guards hold the gate', 'Two unarmed guards hold the gate.'), false);
  assert.equal(evidenceClaimGrounded('king is dead', 'The old viking is dead.'), false);
  const out = capture(createState('a51'), 'The inactive volcano rumbles over the valley.', create('The active volcano rumbles over the valley', 'active volcano rumbles over the valley'));
  assert.equal(out.state.records.length, 0);
  // Whole words still ground, and so does text in scripts written without spaces.
  assert.equal(evidenceClaimGrounded('inactive volcano rumbles', 'The inactive volcano rumbles over the valley.'), true);
  assert.equal(evidenceClaimGrounded('雁门关已经被军队封闭', '今天雁门关已经被军队封闭了。'), true);
});

test('19: an excerpt that spans two sentences is judged sentence by sentence', () => {
  const state = seeded('The siege of Karsk continues', ['Karsk', 'siege'], 'development');
  const text = 'The tavern is loud. A drunk trader says the siege of Karsk is over. Nobody believes him.';
  const claim = 'The tavern is loud. A drunk trader says the siege of Karsk is over';
  const out = capture(state, text, [{ action: 'resolve', recordId: state.records[0].id, summary: 'The siege of Karsk is over', evidence: [{ sourceMessageId: 2, claim }] }]);
  // Before: the cross-sentence excerpt was treated as narration and resolved the siege.
  assert.equal(out.state.records[0].status, 'active');
  const herald = capture(createState('a51'), 'The herald says the king is dead. Nobody moves.', create('The king is dead', 'The herald says the king is dead. Nobody moves', ['king']));
  assert.equal(herald.state.records.length, 0);
  // A narrated sentence beside an unrelated rumour is still narration.
  const bridge = capture(createState('a51'), 'The bridge collapses into the river. A trader says the war is over.', create('The bridge has collapsed into the river', 'The bridge collapses into the river. A trader says the war is over', ['bridge']));
  assert.equal(bridge.state.records.length, 1);
});

test('20: dialogue stays dialogue across paragraphs and after an inch mark', () => {
  // Multi-paragraph speech: the first paragraph's quotation is left open.
  const paragraphs = 'The herald climbs the steps.\n"The north gate has fallen.\n"The king is dead." The crowd gasps.';
  const out = capture(createState('a51'), paragraphs, create('The king is dead', 'The king is dead', ['king']));
  // Before: the pairing shifted and 'The king is dead.' was read as narration.
  assert.equal(out.state.records.length, 0);
  const inch = capture(createState('a51'), 'A 6\'2" guard shouts, "The king is dead." The crowd gasps.', create('The king is dead', 'The king is dead', ['king']));
  assert.equal(inch.state.records.length, 0);
  // Narration after a closed quotation is still narration.
  const narrated = capture(createState('a51'), '"Stand back," he says. The bridge collapses into the river.', create('The bridge has collapsed into the river', 'The bridge collapses into the river', ['bridge']));
  assert.equal(narrated.state.records.length, 1);
});

test('21: a narrated demand, order, threat or promise is reported, not established', () => {
  for (const text of [
    "The duke's men demand that every vendor pay a doubled levy before dusk.",
    'The captain orders that every vendor pay a doubled levy before dusk.',
    'The bandits threaten that every vendor pay a doubled levy before dusk.',
  ]) {
    const out = capture(createState('a51'), text, create('Every vendor pays a doubled levy', 'every vendor pay a doubled levy', ['levy']));
    // Before: accepted as fact.
    assert.equal(out.state.records.length, 0, text);
  }
  // "In order to" is not an order.
  const purpose = capture(createState('a51'), 'In order to cross, the caravan pays a doubled levy at the bridge.', create('The caravan pays a doubled levy at the bridge', 'the caravan pays a doubled levy at the bridge', ['levy']));
  assert.equal(purpose.state.records.length, 1);
});

test('22: a self-closing planning tag never swallows the reply', () => {
  // Before: everything after the tag was stripped.
  assert.equal(sanitizeAssistantNarration('<writer_state mode="brief" />The bridge collapses into the river.'), 'The bridge collapses into the river.');
  assert.equal(sanitizeAssistantNarration('<CYOA />The gate opens.'), 'The gate opens.');
  assert.equal(sanitizeAssistantNarration('Before.<writer_state>plan</writer_state>After.'), 'Before.After.');
});

test('23: travel times, schedules and durations are not narrated time passing', () => {
  for (const text of [
    'The pass is a week on foot from here.',
    'The city lies three days on horseback to the north.',
    'The ferry only leaves after two weeks of waiting.',
    'The poison kills after three days.',
  ]) {
    // Before: each produced a meaningful elapsed hint.
    assert.equal(detectElapsedHintFromExchange([{ messageId: 1, role: 'assistant', content: text }]), null, text);
  }
  for (const text of ['Two days on, the caravan reached the coast.', 'After three days, the caravan arrived.', 'We rested, and after three days we left.', 'Three weeks later, the snow melted.']) {
    assert.ok(detectElapsedHintFromExchange([{ messageId: 1, role: 'assistant', content: text }])?.meaningful, text);
  }
});

test('24: an unknown elapsed amount stays unknown', () => {
  const once = normalizeElapsedHint('Two weeks later');
  // Before: the second normalization turned amount null into 0.
  assert.equal(normalizeElapsedHint(once).amount, null);
  assert.equal(normalizeElapsedHint({ raw: 'later', amount: '' }).amount, null);
  assert.equal(normalizeElapsedHint({ raw: 'three days later', amount: 3, unit: 'day' }).amount, 3);
});

test('25: a failed background catch-up is retried on a later turn', () => {
  const block = source.slice(source.indexOf('if (stateChanged(before, prepared.state)) {'), source.indexOf('async function handleBranchChange('));
  // Before: an evolution that failed while current left the index's advanced catch-up boundary in place.
  assert.match(block, /\} else if \(prepared\.evolution\?\.outcome !== 'skipped'\) \{[\s\S]{0,300}?resetIndexesFromCache\(chatKey\);\s*\}/);
});

test('26: evolution never plans more targets than the wire accepts; merged rebuild evidence keeps its class', () => {
  const records = [];
  for (let i = 0; i < 8; i += 1) records.push({ id: 'd' + i, kind: 'development', status: 'active', summary: 'Development ' + i + ' holds', anchors: ['d' + i], lastEvaluatedMessage: 0, lastChangedMessage: 0 });
  const plan = planLazyEvolution({ ...createState('a51'), records }, {
    selectedEntries: records.map(record => ({ record })), elapsedHint: { raw: 'Three weeks later', amount: 3, unit: 'week', meaningful: true },
    sourceMessageId: 5, sourceLineageKey: 'ln5', maxTargets: 8,
  });
  // Before: up to 8 targets, so the reply (at most 6 evaluations) always failed after a paid call.
  assert.ok(plan.targets.length <= 6, String(plan.targets.length));

  const text = 'The bandits now control the old mill road, and the bandits control the old mill road toll.';
  const out = capture(createState('a51'), text, [
    { action: 'create', kind: 'development', summary: 'Bandits control the old mill road', anchors: ['old mill road'], evidence: [{ sourceMessageId: 2, claim: 'The bandits now control the old mill road' }] },
    { action: 'create', kind: 'development', summary: 'Bandits control the old mill road', anchors: ['old mill road'], evidence: [{ sourceMessageId: 2, claim: 'the bandits control the old mill road toll' }] },
  ], { evidenceSourceClass: 'rebuild' });
  const classes = Object.values(out.state.evidence).map(item => item.sourceClass);
  // Before: the merged evidence kept its live narration class.
  assert.ok(classes.length >= 2);
  assert.deepEqual([...new Set(classes)], ['rebuild']);
});
