// alpha.56: deep-pass items 14-36 (hearsay, plans and time passing).
import test from 'node:test';
import assert from 'node:assert/strict';

import { chatLineage } from '../branch.js';
import { assistantBoundaryExchange, processCaptureResponse } from '../capture.js';
import { duplicateSimilarity } from '../duplicate.js';
import { detectAccumulatedDayStepHint, detectElapsedHintFromExchange } from '../elapsed.js';
import { prepareWorldStateContinuity } from '../evolution.js';
import { sanitizeAssistantNarration } from '../narrative-sanitizer.js';
import { planChronologicalRebuild } from '../rebuild.js';
import { buildRelevanceIndex } from '../relevance.js';
import { preservesReportedInformationStatus, sentencesOf } from '../source-firewall.js';
import { createState, reduceMutations } from '../state-core.js';

const exchangeWith = text => [
  { messageId: 1, is_user: true, is_system: false, mes: 'I listen.', lineageKey: 'ln_1' },
  { messageId: 2, is_user: false, is_system: false, mes: text, lineageKey: 'ln_2' },
];
const capture = (state, text, mutations) => processCaptureResponse({
  text: JSON.stringify({ mutations }), state, exchange: exchangeWith(text), visibleRecords: state.records,
  chatKey: 'a56', sourceMessageId: 2, sourceLineageKey: 'ln_2',
});
function seeded(summary, anchors, kind = 'development') {
  return reduceMutations(createState('a56'), {
    chatKey: 'a56', messageId: 0, lineageKey: 'ln_0', operation: 'capture',
    mutations: [{ action: 'create', kind, summary, anchors, evidence: [{ sourceMessageId: 0, claim: summary }] }],
  }).state;
}
const create = (summary, claim, anchors) => [{ action: 'create', kind: 'fact', summary, anchors, evidence: [{ sourceMessageId: 2, claim }] }];
const created = (text, summary, claim, anchors) => capture(createState('a56'), text, create(summary, claim, anchors)).state.records.length;
const resolve = (state, summary, claim) => [{ action: 'resolve', recordId: state.records[0].id, summary, evidence: [{ sourceMessageId: 2, claim }] }];
const elapsed = text => detectElapsedHintFromExchange([{ messageId: 1, role: 'assistant', lineageKey: 'l1', content: text }]);

test('14: ordinary narration with reporting-like words is narration', () => {
  assert.equal(created('Without warning, the dam burst and the lower valley flooded.', 'The lower valley is flooded', 'Without warning, the dam burst and the lower valley flooded', ['lower valley']), 1);
  assert.equal(created('Bram swore as the north bridge collapsed into the river.', 'The north bridge has collapsed into the river', 'the north bridge collapsed into the river', ['north bridge']), 1);
  assert.equal(created('All told, the fire destroyed forty houses in the tannery quarter.', 'Forty houses in the tannery quarter are destroyed', 'the fire destroyed forty houses in the tannery quarter', ['tannery quarter']), 1);
  const siege = seeded('The siege of Karsk continues', ['Karsk', 'siege']);
  const ended = capture(siege, 'Without warning, the siege of Karsk ended when the defenders surrendered.', resolve(siege, 'The siege of Karsk ended in surrender', 'the siege of Karsk ended when the defenders surrendered'));
  assert.equal(ended.state.records[0].status, 'resolved');
  // Reporting words still report.
  assert.equal(created('A traveler claims the Southport dock strike ended.', 'The Southport dock strike ended', 'A traveler claims the Southport dock strike ended', ['Southport']), 0);
});

test('15: a reporting verb in a relative clause does not report the main clause', () => {
  assert.equal(created('The guard, who reported the theft, now patrols the treasury vault.', 'The guard patrols the treasury vault', 'now patrols the treasury vault', ['treasury vault']), 1);
});

test('16: a title abbreviation does not end the sentence that attributes the claim', () => {
  assert.deepEqual(sentencesOf('Lt. Varro came. The gate shut.'), ['Lt. Varro came.', 'The gate shut.']);
  assert.equal(created('Lt. Varro reported that the fort has fallen.', 'The fort has fallen', 'Lt. Varro reported that the fort has fallen', ['fort']), 0);
});

test('17: single quotes, curly single quotes and corner brackets are dialogue', () => {
  assert.equal(created("'The king is dead,' the herald cries.", 'The king is dead', 'The king is dead', ['king']), 0);
  assert.equal(created('‘The king is dead,’ the herald cries.', 'The king is dead', 'The king is dead', ['king']), 0);
  assert.equal(created('「王都の王は昨夜死んだ」と伝令が叫んだ。', '王都の王は昨夜死んだ', '王都の王は昨夜死んだ', ['王都']), 0);
  assert.equal(created('王都の王は昨夜死んだ。伝令が走る。', '王都の王は昨夜死んだ', '王都の王は昨夜死んだ', ['王都']), 1);
  // Apostrophes are not quotes.
  assert.equal(created("The guards' hall burned to the ground.", "The guards' hall has burned to the ground", "The guards' hall burned to the ground", ['guards hall']), 1);
});

test('18: conditions and plans are not done deeds', () => {
  const text = 'If the dam breaks tonight, the valley will flood.';
  assert.equal(created(text, 'The valley has flooded', 'the valley will flood', ['valley']), 0);
  assert.equal(created(text, 'The dam has broken', 'If the dam breaks tonight', ['dam']), 0);
  const plan = 'Tomorrow the duke plans to march on Varn.';
  assert.equal(created(plan, 'The duke marched on Varn', 'the duke plans to march on Varn', ['Varn']), 0);
  assert.equal(created(plan, 'The duke plans to march on Varn', 'the duke plans to march on Varn', ['Varn']), 1);
  const siege = seeded('The siege of Karsk continues', ['Karsk', 'siege']);
  const planned = capture(siege, 'If the relief army arrives, the siege of Karsk will end.', resolve(siege, 'The siege of Karsk ended', 'the siege of Karsk will end'));
  assert.equal(planned.state.records[0].status, 'active');
});

test('19 and 20: World_State planning lines and reasoning blocks are not evidence', () => {
  const seeds = 'The market is quiet.\n<World_State>\n- **Off-Screen:** The Wardens hold the mill.\n- **🌱 Planted Seeds:** A plague is spreading through the docks.\n</World_State>';
  assert.doesNotMatch(sanitizeAssistantNarration(seeds), /plague/);
  assert.match(sanitizeAssistantNarration(seeds), /Wardens hold the mill/);
  assert.equal(created(seeds, 'A plague is spreading through the docks', 'A plague is spreading through the docks', ['docks']), 0);
  assert.equal(created('<think>The granary burned down.</think>The market is quiet.', 'The granary has burned down', 'The granary burned down', ['granary']), 0);
  assert.equal(sanitizeAssistantNarration('reasoning first</think>\nThe market is quiet.'), 'The market is quiet.');
});

test('21: speech-act and noun words do not mark a summary as reported', () => {
  assert.equal(preservesReportedInformationStatus('The Free States levy a toll on every barge'), false);
  assert.equal(preservesReportedInformationStatus('Holy Orders hold the abbey'), false);
  assert.equal(preservesReportedInformationStatus('Land claims are disputed along the river'), false);
  assert.equal(created('"The Free States levy a toll on every barge," the ferryman says.', 'The Free States levy a toll on every barge', 'The Free States levy a toll on every barge', ['Free States']), 0);
  // A rumour cannot end an arrangement worded as a speech act.
  const levy = seeded("The duke's men are demanding a doubled levy from vendors", ['levy', 'vendors']);
  const rumour = capture(levy, "A trader says the duke's men stopped demanding the doubled levy from vendors.", resolve(levy, "Reportedly the duke's men stopped demanding the doubled levy", "A trader says the duke's men stopped demanding the doubled levy from vendors"));
  assert.equal(rumour.state.records[0].status, 'active');
});

test('22 and 25: dialogue ending in a number closes, and a quoted name is not dialogue', () => {
  assert.equal(created('"The toll is now 20" he says. The north bridge collapses into the river.', 'The north bridge has collapsed into the river', 'The north bridge collapses into the river', ['north bridge']), 1);
  assert.equal(created('The "Black Gull" anchors in the harbor of Varn.', 'The Black Gull is anchored in the harbor of Varn', 'The "Black Gull" anchors in the harbor of Varn', ['harbor of Varn']), 1);
});

test('23: a narrated act joined by "and" is not the content of a threat', () => {
  assert.equal(created('Raiders threatened the villagers and burned the granary.', 'The granary has been burned by raiders', 'Raiders threatened the villagers and burned the granary', ['granary']), 1);
});

test('24: an excerpt longer than the limit is cut at a word boundary and still grounds', () => {
  const text = 'The north bridge collapses into the river ' + 'and the water rises over the old grey stones '.repeat(14) + 'at last.';
  assert.ok(text.length > 600);
  assert.equal(created(text, 'The north bridge has collapsed into the river', text, ['north bridge']), 1);
});

test('26: a closing tag with a space ends its block', () => {
  assert.equal(sanitizeAssistantNarration('A<writer_state x>plan</writer_state >B'), 'AB');
});

test('27: Chinese and Japanese paraphrases, short anchors and near-duplicates', () => {
  assert.equal(created('王都の門は兵士によって封鎖されている。', '王都の門が封鎖された', '王都の門は兵士によって封鎖されている', ['王都']), 1);
  const gate = seeded('王都の門は封鎖されている', ['王都']);
  const opened = capture(gate, '今朝、王都の門は開かれた。', [{ action: 'update', recordId: gate.records[0].id, summary: '王都の門は開かれた', evidence: [{ sourceMessageId: 2, claim: '王都の門は開かれた' }] }]);
  assert.equal(opened.state.records[0].summary, '王都の門は開かれた');
  assert.ok(duplicateSimilarity({ kind: 'development', summary: '王都の門は封鎖されている', anchors: ['王都'] }, { kind: 'development', summary: '王都の門が封鎖されている', anchors: ['王都'] }) >= 0.78);
});

test('28: anchors are supported only as whole words', () => {
  const out = capture(createState('a56'), 'The pirate ship burns in the bay.', create('The pirate ship is burning in the bay', 'The pirate ship burns in the bay', ['rat', 'pirate ship']));
  assert.deepEqual(out.state.records[0].anchors, ['pirate ship']);
});

test('29: a visible narrator message is narration of the next reply, not a boundary', () => {
  const chat = [
    { is_user: true, is_system: false, name: 'You', mes: 'I sneak into the vault.' },
    { is_user: false, is_system: false, name: 'System', mes: 'The alarm bell rings.', extra: { type: 'narrator' } },
    { is_user: false, is_system: false, name: 'Bot', mes: 'Guards seal the vault doors.' },
  ];
  assert.deepEqual(assistantBoundaryExchange(chat, 2).map(row => row.messageId), [0, 1, 2]);
  assert.deepEqual(assistantBoundaryExchange(chat, 1), []);
  assert.deepEqual(planChronologicalRebuild(chat).windows.map(window => window.messageId), [2]);
});

test('30-32: common skips are recognised; modals elsewhere and names do not void them', () => {
  const read = text => { const hint = elapsed(text); return hint && [hint.raw, hint.amount, hint.unit, hint.meaningful]; };
  assert.deepEqual(read('Two weeks had passed since the siege.'), ['Two weeks had passed', 2, 'week', true]);
  assert.deepEqual(read('Weeks later, the town was quiet.'), ['Weeks later', null, 'week', true]);
  assert.deepEqual(read('Months passed.'), ['Months passed', null, 'month', true]);
  assert.deepEqual(read('Twenty years later, the keep lay in ruins.'), ['Twenty years later', 20, 'year', true]);
  assert.deepEqual(read('A fortnight later, they met.'), ['A fortnight later', 2, 'week', true]);
  assert.deepEqual(read('The next month, the harvest failed.'), ['The next month', 1, 'month', true]);
  assert.equal(elapsed('Three weeks later, Will rode back.')?.raw, 'Three weeks later');
  assert.equal(elapsed('Two weeks had passed, but the duke would not yield.')?.raw, 'Two weeks had passed');
  // Still prospective or conditional.
  assert.equal(elapsed("Two weeks later, we'll be gone."), null);
  assert.equal(elapsed('The caravan will arrive three days later.'), null);
  assert.equal(elapsed('If the rains come, three weeks later the river floods.'), null);
  assert.equal(elapsed('We meet next month.'), null);
});

test('33-35: an older meaningful skip survives a newer short span; first mentions and vague amounts', () => {
  const hint = detectElapsedHintFromExchange([
    { messageId: 10, role: 'assistant', lineageKey: 'a', content: 'Three weeks later, the snow melted.' },
    { messageId: 11, role: 'user', lineageKey: 'b', content: 'An hour later I knock on the door.' },
  ]);
  assert.equal(hint.raw, 'Three weeks later');
  assert.equal(hint.sourceMessageId, 10);
  const chat = [
    { is_user: true, mes: 'We rest.' },
    { is_user: false, mes: 'We will set out the next morning, she says. The next morning, they set out. If it rains, the following day is lost.' },
    { is_user: true, mes: 'We ride on.' },
    { is_user: false, mes: 'The following day, rain falls.' },
  ];
  const accumulated = detectAccumulatedDayStepHint(chat, 3, { lineage: chatLineage(chat) });
  assert.equal(accumulated?.amount, 2);
  assert.match(accumulated.context, /The next morning, they set out\./);
  assert.equal(elapsed('Several days later, rain fell.').amount, null);
  assert.equal(elapsed('Many years later, the tower fell.').amount, null);
});

test('36: relevant developments evaluated since the skip leave background slots open', async () => {
  const chat = [{ role: 'assistant', content: 'The established developments are described here.' }];
  const lineageKey = chatLineage(chat)[0].lineageKey;
  const definitions = [
    'Kesselpass freight congestion remains active.', 'Kesselpass hiring pressure remains active.',
    'Kesselpass lodging pressure remains active.', 'Kesselpass inspection delays remain active.',
    'North quarry labor unrest remains active.', 'West canal silting remains unresolved.',
    'Hill shrine repairs remain incomplete.', 'East orchard blight remains active.',
  ];
  let state = reduceMutations(createState('a56-bg'), {
    chatKey: 'a56-bg', messageId: 0, lineageKey, operation: 'capture',
    mutations: definitions.map((summary, index) => ({
      action: 'create', kind: 'development', summary, trend: 'stable', anchors: [index < 4 ? 'Kesselpass' : summary.split(' ').slice(0, 2).join(' ')],
      evidence: [{ sourceMessageId: 0, lineageKey, sourceClass: 'assistant_narration', claim: chat[0].content }],
    })),
  }).state;
  // The four relevant developments were evaluated at this skip already.
  state = { ...state, records: state.records.map((record, index) => (index < 4 ? { ...record, lastEvaluatedMessage: 500 } : record)) };
  const remoteIds = state.records.slice(4).map(record => record.id);
  const response = JSON.stringify({
    evaluations: remoteIds.slice(0, 3).map(recordId => ({ recordId, outcome: 'stable', reason: 'No change is established.', supportIds: ['t0'] })),
    derived: [],
  });
  const exchange = [{ role: 'user', content: 'Five weeks later, I return to Kesselpass.', messageId: 500, lineageKey: 'lineage-500' }];
  const result = await prepareWorldStateContinuity({
    ctx: { extensionSettings: { world_state_alpha: {}, disabledExtensions: [] }, generateRaw: async () => response },
    state, index: buildRelevanceIndex(state), recentText: exchange[0].content, currentMessageId: 500, exchange,
    chatKey: 'a56-bg', sourceMessageId: 500, sourceLineageKey: 'lineage-500', isCurrent: () => true,
  });
  // Before: the four relevant developments took four of six slots, leaving two background slots.
  assert.equal(result.evolution.backgroundSelection.selected, 3);
  assert.equal(result.evolution.plan.targets.length, 3);
});
