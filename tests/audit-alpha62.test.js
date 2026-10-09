// alpha.62: deep-pass items 24-48 (capture firewall, wire and elapsed time).
import test from 'node:test';
import assert from 'node:assert/strict';

import { assistantBoundaryExchange, buildCapturePrompt, extractWorldStateCompletenessHints, processCaptureResponse } from '../capture.js';
import { validateCaptureEnvelope } from '../capture-wire.js';
import { detectAccumulatedDayStepHint, detectElapsedHintFromExchange, extractElapsedHint, normalizeElapsedHint } from '../elapsed.js';
import { sanitizeAssistantNarration, sanitizeExchangeMessage } from '../narrative-sanitizer.js';
import { sentencesOf, sourceWithoutQuotedDialogue } from '../source-firewall.js';
import { chatLineage } from '../branch.js';
import { createState, reduceMutations } from '../state-core.js';

const exchangeWith = text => [
  { messageId: 1, is_user: true, is_system: false, mes: 'I listen.', lineageKey: 'ln_1' },
  { messageId: 2, is_user: false, is_system: false, mes: text, lineageKey: 'ln_2' },
];
const capture = (state, text, mutations) => processCaptureResponse({
  text: JSON.stringify({ mutations }), state, exchange: exchangeWith(text), visibleRecords: state.records,
  chatKey: 'a62', sourceMessageId: 2, sourceLineageKey: 'ln_2',
});
function seeded(summary, anchors, kind = 'development') {
  return reduceMutations(createState('a62'), {
    chatKey: 'a62', messageId: 0, lineageKey: 'ln_0', operation: 'capture',
    mutations: [{ action: 'create', kind, summary, anchors, evidence: [{ sourceMessageId: 0, claim: summary }] }],
  }).state;
}
const create = (summary, claim, anchors) => [{ action: 'create', kind: 'fact', summary, anchors, evidence: [{ sourceMessageId: 2, claim }] }];
const created = (text, summary, claim, anchors) => capture(createState('a62'), text, create(summary, claim, anchors)).state.records.length;
const elapsed = text => extractElapsedHint(text);

test('24: a threat or promise cited with its verb is not a done deed', () => {
  assert.equal(created('The bandits threatened to burn the granary at dusk.', 'The granary is burned', 'threatened to burn the granary at dusk', ['granary']), 0);
  assert.equal(created('The captain ordered the guards to seal the east gate.', 'The east gate is sealed', 'ordered the guards to seal the east gate', ['east gate']), 0);
  // The act itself may be recorded, and a coordinated narrated act is narration.
  assert.equal(created('The bandits threatened to burn the granary at dusk.', 'The bandits have threatened to burn the granary', 'threatened to burn the granary at dusk', ['granary']), 1);
  assert.equal(created('The bandits threatened the miller and then burned the granary.', 'The granary is burned', 'threatened the miller and then burned the granary', ['granary']), 1);
});

test('25: dialogue with a shouted, yelled or cried action beat stays dialogue', () => {
  for (const verb of ['shouted', 'yelled', 'cried', 'screamed']) {
    assert.equal(created(`The gate is sealed, the sentry ${verb} from the north wall.`, 'The gate is sealed', `The gate is sealed, the sentry ${verb}`, ['gate']), 0, verb);
  }
});

test('26: a plural possessive closes no single quote, and an elided word opens none', () => {
  const kept = sourceWithoutQuotedDialogue("'The soldiers' horses are gone,' the groom said. The stable burned.");
  assert.doesNotMatch(kept, /horses are gone/);
  assert.match(kept, /The stable burned/);
  // 'em is an elision, so the narration after it is not dialogue.
  assert.match(sourceWithoutQuotedDialogue("We drove 'em off. The north bridge collapsed into the river, she noted."), /north bridge collapsed/);
});

test('27: a name or a state word does not keep a summary prospective or reported', () => {
  assert.equal(created('"Will plans to seize the mill," the miller says.', 'Will holds the mill', 'Will plans to seize the mill', ['mill']), 0);
  assert.equal(created('"The bridge is out," the scout says.', 'The bridge is out and the ferry refuses passengers', 'The bridge is out', ['bridge']), 0);
  // Lower-case plan words still keep a plan prospective.
  assert.equal(created('The duke plans to march on Karsk.', 'The duke plans to march on Karsk', 'The duke plans to march on Karsk', ['Karsk']), 1);
});

test('28: a sentence ends after a closing quote', () => {
  assert.deepEqual(sentencesOf('"The gate is sealed." The bridge burned.'), ['"The gate is sealed."', 'The bridge burned.']);
  assert.equal(created('The herald said, "The fort has fallen." The north bridge collapsed into the river.', 'The north bridge has collapsed into the river', 'The north bridge collapsed into the river', ['north bridge']), 1);
});

test('29: "that" after a reporting word is a complementizer only when it introduces the report', () => {
  assert.equal(created('The scout said nothing, but that night the river flooded the lower fields.', 'The lower fields are flooded', 'that night the river flooded the lower fields', ['lower fields']), 1);
  assert.equal(created('The scout reported that the river flooded the lower fields.', 'The lower fields are flooded', 'the river flooded the lower fields', ['lower fields']), 0);
});

test('30: narration repeated in a report or a condition is still narration', () => {
  assert.equal(created('The north bridge collapsed. A trader claims the north bridge collapsed.', 'The north bridge has collapsed', 'the north bridge collapsed', ['north bridge']), 1);
  assert.equal(created('The dam broke. If the dam broke, the valley floods.', 'The dam broke', 'the dam broke', ['dam']), 1);
});

test('31: going to a place is travel, not a plan', () => {
  assert.equal(created('The caravan is going to the capital with the grain.', 'The grain caravan travels to the capital', 'The caravan is going to the capital with the grain', ['caravan']), 1);
  // "going to" before a verb is still a plan.
  assert.equal(created('The caravan is going to burn the grain.', 'The grain is burned', 'The caravan is going to burn the grain', ['grain']), 0);
});

test('32: a clause reporting something of its own does not attribute the next clause', () => {
  assert.equal(created('The captain announced the curfew, soldiers barred the market gates.', 'Soldiers barred the market gates', 'soldiers barred the market gates', ['market gates']), 1);
  assert.equal(created('The guard said nothing and the north gate stayed shut.', 'The north gate is shut', 'the north gate stayed shut', ['north gate']), 1);
  // A frame still attributes.
  assert.equal(created('According to the scouts, the north gate has fallen.', 'The north gate has fallen', 'the north gate has fallen', ['north gate']), 0);
});

test('33: a repeated summary word counts once', () => {
  assert.equal(created('The mill stands idle.', 'Mill mill', 'The mill stands idle', []), 0);
});

test('34: a supersede and its replacement create in one response both apply', () => {
  const state = seeded('The toll on the Karsk bridge is five silver', ['Karsk bridge', 'toll'], 'fact');
  const text = 'The old toll on the Karsk bridge is gone. The toll on the Karsk bridge is ten silver now.';
  const result = capture(state, text, [
    { action: 'supersede', recordId: state.records[0].id, summary: 'The five silver toll on the Karsk bridge is gone', evidence: [{ sourceMessageId: 2, claim: 'The old toll on the Karsk bridge is gone' }] },
    { action: 'create', kind: 'fact', summary: 'The toll on the Karsk bridge is ten silver', anchors: ['Karsk bridge', 'toll'], evidence: [{ sourceMessageId: 2, claim: 'The toll on the Karsk bridge is ten silver now' }] },
  ]);
  assert.equal(result.state.records.find(record => record.id === state.records[0].id).status, 'superseded');
  // Before, the create became an update of the record being superseded and was lost with it.
  assert.ok(result.state.records.some(record => record.status === 'active' && /ten silver/.test(record.summary)));
});

test('35: rows past the cap of 8 are rejected one by one, and the prompt states the cap', () => {
  const text = 'The north bridge collapsed into the river.';
  const row = { action: 'create', kind: 'fact', summary: 'The north bridge has collapsed into the river', anchors: ['north bridge'], evidence: [{ sourceMessageId: 2, claim: 'The north bridge collapsed into the river' }] };
  const result = capture(createState('a62'), text, [row, ...Array.from({ length: 9 }, () => ({ action: 'noop' }))]);
  assert.equal(result.state.records.length, 1);
  assert.equal(result.rejected.filter(item => item.stage === 'wire-limit').length, 2);
  const prompt = buildCapturePrompt({ exchange: exchangeWith(text), visibleRecords: [] });
  assert.match(prompt.prompt, /At most 8 mutations per response/);
});

test('36: an update carrying only related records or a status is valid', () => {
  const wire = validateCaptureEnvelope({ mutations: [
    { action: 'update', recordId: 'r1', relatedRecordIds: ['r2'], evidence: [{ sourceMessageId: 2, claim: 'the north bridge collapsed' }] },
    { action: 'update', recordId: 'r1', status: 'active', evidence: [{ sourceMessageId: 2, claim: 'the north bridge collapsed' }] },
  ] });
  assert.deepEqual(wire.rejected, []);
  assert.equal(wire.mutations.length, 2);
});

test('37-39: planning bullets, a stray closing think tag and a spaced World_State closing tag', () => {
  const planted = sanitizeAssistantNarration('<World_State>\n- **Planted Seeds:**\n▪ Seed: a dragon wakes\n‣ Seed: the duke betrays\n- **Off-Screen:**\n- The duke marches\n</World_State>');
  assert.doesNotMatch(planted, /dragon|betrays/);
  assert.match(planted, /The duke marches/);
  assert.equal(sanitizeAssistantNarration('The bridge fell.</think>'), 'The bridge fell.');
  assert.equal(sanitizeAssistantNarration('plan</think>The bridge fell.</think>'), 'The bridge fell.');
  const hints = extractWorldStateCompletenessHints([{ messageId: 2, role: 'assistant', content: '<World_State>\n**Off-Screen:**\n- The duke marches on Karsk\n</World_State >\nThe tavern is quiet. Unresolved: everything after the block' }]);
  assert.deepEqual(hints.map(item => item.text), ['The duke marches on Karsk']);
});

test('40: capture and elapsed read a host row\'s mes, as lineage does', () => {
  const chat = [
    { is_user: true, is_system: false, mes: 'We wait.' },
    { is_user: false, is_system: false, mes: 'The north bridge collapsed.', content: 'stale text from another extension' },
  ];
  const exchange = assistantBoundaryExchange(chat, 1, chatLineage(chat));
  assert.equal(exchange.at(-1).content, 'The north bridge collapsed.');
  assert.equal(sanitizeExchangeMessage({ is_user: false, mes: 'Fresh.', content: 'Stale.' }).content, 'Fresh.');
});

test('41: a hidden user turn is no capture evidence, like a hidden reply', () => {
  const chat = [
    { is_user: false, is_system: false, mes: 'Earlier reply.' },
    { is_user: true, is_system: true, mes: 'A hidden note: the duke is dead.' },
    { is_user: true, is_system: false, mes: 'We ride on.' },
    { is_user: false, is_system: false, mes: 'The road is quiet.' },
  ];
  const ids = assistantBoundaryExchange(chat, 3, chatLineage(chat)).map(row => row.messageId);
  assert.deepEqual(ids, [2, 3]);
});

test('42-43: wrapped and curly-single dialogue is dialogue for elapsed time', () => {
  assert.equal(elapsed('‘I don’t think three days later works,’ she said.'), null);
  assert.equal(elapsed('"We wait here.\nThree days later we march," he said.'), null);
  assert.equal(elapsed('Three days later the march began.')?.meaningful, true);
});

test('44: past-tense modals, adjectives, nouns and "as if" do not hide a real skip', () => {
  for (const line of [
    'Three days later, she could finally walk.',
    'Two weeks later, the expected caravan arrived.',
    'Three weeks later, they were taken against their will.',
    'Three days later, he looked as if he had never slept.',
    'Two weeks later, the planned assault began.',
  ]) assert.equal(elapsed(line)?.meaningful, true, line);
  assert.equal(elapsed('We could reach the pass two days later.'), null);
  assert.equal(elapsed('If the rains come, three weeks later the river floods.'), null);
});

test('45: a user echoing the day step does not use up the narrator\'s next step', () => {
  const chat = [
    { is_user: false, is_system: false, mes: 'The next morning the caravan sets out.' },
    { is_user: true, is_system: false, mes: 'The next morning I ride with them.' },
    { is_user: false, is_system: false, mes: 'The following day they reach the ford.' },
  ];
  const lineage = chatLineage(chat);
  const hint = detectAccumulatedDayStepHint(chat, 2, { lineage });
  assert.equal(hint?.amount, 2);
});

test('46: each phrase is judged in its own clause, not where its words first occur', () => {
  // The first "two days later" is in a plan; the second, narrated, is the one found.
  assert.equal(elapsed('We could leave two days later, but two days later the storm broke.')?.meaningful, true);
});

test('47: the newest meaningful skip of a message is reported', () => {
  assert.equal(elapsed('Three days later the war ended. Two weeks later the king died.').raw, 'Two weeks later');
  assert.equal(detectElapsedHintFromExchange([{ messageId: 1, role: 'assistant', lineageKey: 'l1', content: 'Three days later the war ended. Two weeks later the king died.' }]).raw, 'Two weeks later');
});

test('48: a fortnight or a decade is converted when a hint is normalized', () => {
  assert.equal(normalizeElapsedHint({ raw: 'a fortnight', amount: 1, unit: 'fortnight' }).amount, 2);
  assert.equal(normalizeElapsedHint({ raw: 'two decades', amount: 2, unit: 'decades' }).amount, 20);
});
