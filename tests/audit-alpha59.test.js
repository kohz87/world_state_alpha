// alpha.59: performance, contract-text and cleanup items 69-84 of the alpha.54 deep pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

import { chatLineage, seedRootCheckpoint } from '../branch.js';
import * as capture from '../capture.js';
import { validateCaptureEnvelope } from '../capture-wire.js';
import { clipMiddle } from '../common.js';
import { duplicateLookupKeys } from '../duplicate.js';
import { extractElapsedHint } from '../elapsed.js';
import { runLazyEvolution } from '../evolution.js';
import { buildRelevanceIndex, selectRelevantRecords } from '../relevance.js';
import { planChronologicalRebuild, runManualRebuild } from '../rebuild.js';
import { applySpatialManualMutation } from '../spatial-manual.js';
import * as spatialCore from '../spatial-core.js';
import * as narrativeSanitizer from '../narrative-sanitizer.js';
import * as transfer from '../transfer.js';
import * as relevance from '../relevance.js';
import { createState, reduceMutations } from '../state-core.js';

const OK = { dispatched: true, outcome: 'success', route: 'test', profileId: '' };

function scenario(name) {
  const run = spawnSync(process.execPath, ['tests/host/' + name + '.mjs'], { encoding: 'utf8', timeout: 60000 });
  const line = String(run.stdout || '').split('\n').find(item => item.startsWith('@@RESULT '));
  assert.ok(line, name + ' produced no result:\n' + String(run.stderr || '').slice(-2000));
  return JSON.parse(line.slice('@@RESULT '.length));
}

function record(id, summary, anchors = [], extra = {}) {
  return {
    id, kind: 'fact', summary, status: 'active', trend: null, anchors,
    createdAtMessage: 1, lastChangedMessage: null, lastEvaluatedMessage: null,
    timeAnchor: '', evidenceIds: [], causedBy: [], affects: [], ...extra,
  };
}

test('69/74: a capture saves with six state copies and a user send makes none', () => {
  const result = scenario('state-copies');
  assert.equal(result.records, 5);
  // Before: 8 normalizations and 4 copies per capture, 2 and 3 per user send.
  assert.ok(result.capture.normalize <= 6, JSON.stringify(result));
  assert.equal(result.capture.clone, 0, JSON.stringify(result));
  assert.deepEqual(result.send, { normalize: 0, clone: 0 });
});

test('69/72: a Places save applies each step once on one chat fingerprint; the panel counts replies rarely', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const save = source.slice(source.indexOf("if (actionId === 'save_location' && payload.location)"), source.indexOf("if (actionId === 'toggle_lock'"));
  assert.match(save, /const saveLineage = chatLineage\(chat\);/);
  assert.match(save, /applySequence\(afterLocation\.state, steps\.slice\(1\), baseMap, saveLineage\)/);
  assert.doesNotMatch(save, /applySequence\(state, steps\)/);
  assert.match(source, /assistantBoundaries: assistantBoundaryCount\(chatKey, chat\)/);
  assert.doesNotMatch(source, /assistantBoundaries: chat\.filter\(/);
});

test('70: relevance reads the scene window once per turn, not once per candidate', () => {
  const source = fs.readFileSync('relevance.js', 'utf8');
  assert.match(source, /overlapScore\(record\.summary, recentTokens\)/);
  assert.match(source, /overlapScore\(record\.summary, loreTokens\)/);
  assert.doesNotMatch(source, /const right = tokenSet\(rightText\)/);
});

test('71: a function-word anchor ("Will") matches only the name, never the modal', () => {
  const named = { records: [record('will', 'Will keeps the ferry at the river.', ['Will'])], links: [] };
  const index = buildRelevanceIndex(named);
  const pick = text => selectRelevantRecords(named, { index, recentText: text }).selected.map(item => item.record.id);
  // Before: the modal matched the anchor on almost every turn.
  assert.deepEqual(pick('They will leave at dawn and the guards will follow.'), []);
  assert.deepEqual(pick('Will you come with us?'), []);
  assert.deepEqual(pick('I go down to the docks and ask Will about the crossing.'), ['will']);
  assert.deepEqual(pick('"Ask Will," she says.'), ['will']);
  assert.deepEqual(pick('Will nods and pushes off from the bank.'), ['will']);
  assert.deepEqual(pick('Will, the ferryman, waves.'), ['will']);
  assert.deepEqual(pick('She asked, "Will you take us across?"'), []);
  assert.deepEqual(pick('Will the bridge hold?'), []);
});

async function rebuildPrompts(chat, mutationsByCall) {
  const prompts = [];
  await runManualRebuild({
    ctx: {},
    state: createState('lifecycle'),
    chat,
    chatKey: 'lifecycle',
    isCurrent: () => true,
    dispatcher: async (_ctx, options) => {
      prompts.push(options.prompt);
      return { text: JSON.stringify({ mutations: mutationsByCall[prompts.length - 1] || [] }), receipt: OK };
    },
  });
  return prompts;
}

const visibleOf = prompt => {
  const match = prompt.match(/VISIBLE WORLD STATE CONTEXT \([^\n]*\):\n(\[[^\n]*\])/);
  return match ? JSON.parse(match[1]) : [];
};

test('71: rebuild never makes a development the exchange does not touch the antecedent of another topic', async () => {
  const chat = [
    { role: 'user', content: 'We arrive in town.' },
    { role: 'assistant', content: 'The miller owes the guild a heavy debt.' },
  ];
  for (let i = 0; i < 7; i += 1) chat.push({ role: 'user', content: 'We wait.' }, { role: 'assistant', content: 'Rain falls on day ' + (i + 1) + '.' });
  chat.push({ role: 'user', content: 'We take the road.' }, { role: 'assistant', content: 'Bandits now raid the north road every night.' });
  chat.push({ role: 'user', content: 'I visit him.' }, { role: 'assistant', content: 'Miller smiles warmly.' });
  const calls = chat.filter(item => item.role === 'assistant').length;
  const mutations = Array.from({ length: calls }, () => []);
  mutations[0] = [{ action: 'create', kind: 'development', summary: 'The miller owes the guild a heavy debt.', anchors: ['miller debt'], evidence: [{ sourceMessageId: 1, claim: 'The miller owes the guild a heavy debt.' }] }];
  mutations[calls - 2] = [{ action: 'create', kind: 'development', summary: 'Bandits raid the north road every night.', anchors: ['bandits', 'north road'], evidence: [{ sourceMessageId: chat.length - 3, claim: 'Bandits now raid the north road every night.' }] }];
  const prompts = await rebuildPrompts(chat, mutations);
  assert.equal(prompts.length, calls);
  // Before: the bandit raids, unrelated to the miller, were offered as the reply's interpretive antecedent.
  assert.doesNotMatch(prompts.at(-1), /INTERPRETIVE LIFECYCLE ANTECEDENT/);
});

test('71: a recent development the exchange names by a synonym stays visible to rebuild', async () => {
  const chat = [
    { role: 'user', content: 'We arrive.' },
    { role: 'assistant', content: 'Plague spreads through the lower district. Bread prices are rising in the market.' },
    { role: 'user', content: 'We wait a week.' },
    { role: 'assistant', content: 'In the market bread is cheap again. The sickness finally breaks.' },
  ];
  const created = [
    { action: 'create', kind: 'development', summary: 'Plague spreads through the lower district.', anchors: ['plague'], evidence: [{ sourceMessageId: 1, claim: 'Plague spreads through the lower district.' }] },
    { action: 'create', kind: 'development', summary: 'Bread prices are rising in the market.', anchors: ['bread prices'], evidence: [{ sourceMessageId: 1, claim: 'Bread prices are rising in the market.' }] },
  ];
  const prompts = await rebuildPrompts(chat, [created]);
  assert.ok(visibleOf(prompts[1]).some(item => /Plague/.test(item.summary)));
});

test('71: an ending that names nothing still sees the recent development as its antecedent', async () => {
  const chat = [
    { role: 'user', content: 'I watch the orchard.' },
    { role: 'assistant', content: 'A swarm of wasps nests in the orchard wall.' },
    { role: 'user', content: 'I wait.' },
    { role: 'assistant', content: 'It finally ends at dawn.' },
  ];
  const created = [{ action: 'create', kind: 'development', summary: 'A wasp swarm nests in the orchard wall.', anchors: ['wasp swarm'], evidence: [{ sourceMessageId: 1, claim: 'A swarm of wasps nests in the orchard wall.' }] }];
  const prompts = await rebuildPrompts(chat, [created]);
  assert.match(prompts[1], /INTERPRETIVE LIFECYCLE ANTECEDENT/);
  assert.ok(visibleOf(prompts[1]).some(item => /wasp/.test(item.summary)));
});

function seedDevelopments(chatKey, definitions) {
  const chat = [{ role: 'assistant', content: 'The established developments are described here.' }];
  const lineage = chatLineage(chat);
  const reduced = reduceMutations(createState(chatKey), {
    chatKey,
    messageId: 0,
    lineageKey: lineage[0].lineageKey,
    mutations: definitions.map(definition => ({
      action: 'create',
      kind: 'development',
      summary: definition.summary,
      trend: 'stable',
      anchors: definition.anchors,
      evidence: [{ sourceMessageId: 0, lineageKey: lineage[0].lineageKey, sourceClass: 'assistant_narration', claim: definition.claim }],
    })),
  });
  return { state: reduced.state, chat };
}

test('72: the derived-development duplicate check finds its duplicate through the relevance index', async () => {
  const filler = Array.from({ length: 30 }, (_, i) => ({ summary: 'Quiet condition ' + i + ' persists elsewhere.', anchors: ['quiet ' + i], claim: 'Quiet condition ' + i + ' persists elsewhere.' }));
  const seeded = seedDevelopments('derived-index', [
    { summary: 'Trade restrictions are limiting food shipments.', anchors: ['trade restrictions', 'food shipments'], claim: 'Trade restrictions are limiting food shipments into the district.' },
    { summary: 'Food shortages are worsening.', anchors: ['food shortages'], claim: 'Food shortages are worsening as legal supplies remain constrained.' },
    { summary: 'An illicit food trade is becoming established around constrained legal supply.', anchors: ['illicit food trade', 'food supply'], claim: 'An illicit food trade is becoming established.' },
    ...filler,
  ]);
  const [trade, shortage, illicit] = seeded.state.records;
  const exchange = [...seeded.chat, { role: 'user', content: 'Five weeks later, I return to the food market.' }];
  const lineage = chatLineage(exchange);
  const rows = exchange.map((message, messageId) => ({ ...message, messageId, lineageKey: lineage[messageId].lineageKey }));
  const response = JSON.stringify({
    evaluations: [
      { recordId: trade.id, outcome: 'stable', reason: 'No direct change is established.', supportIds: ['t0'] },
      { recordId: shortage.id, outcome: 'stable', reason: 'No direct change is established.', supportIds: ['t0'] },
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
    ctx: { extensionSettings: { world_state_alpha: {}, disabledExtensions: [] }, generateRaw: async () => response },
    state: seeded.state,
    index: buildRelevanceIndex(seeded.state),
    selectedEntries: [trade, shortage].map(item => ({ record: item, score: 10, source: 'seed' })),
    exchange: rows,
    chatKey: 'derived-index',
    isCurrent: () => true,
    sourceMessageId: rows.at(-1).messageId,
    sourceLineageKey: rows.at(-1).lineageKey,
  });
  assert.equal(result.derivedCount, 0);
  assert.equal(result.rejectedDerived[0].duplicateRecordId, illicit.id);
  // Spaceless-script text is compared by character pairs, which the index does not post: every record.
  assert.equal(duplicateLookupKeys({ summary: '北の橋が崩れた', anchors: [] }), null);
  assert.deepEqual(duplicateLookupKeys({ summary: 'The north bridge fell', anchors: ['North Bridge'] }), { anchors: ['north bridge'], words: ['north', 'bridge', 'fell'] });
});

test('73: an over-limit rebuild is refused before any message is read, hashed or copied', () => {
  let reads = 0;
  const chat = Array.from({ length: 40 }, (_, i) => {
    const message = { is_user: i % 2 === 0, name: i % 2 ? 'Bot' : 'User' };
    Object.defineProperty(message, 'mes', { get() { reads += 1; return 'Message ' + i; }, enumerable: true });
    return message;
  });
  assert.throws(() => planChronologicalRebuild(chat, { maxBoundaries: 5 }), error => error?.code === 'WORLD_STATE_REBUILD_BOUNDARY_LIMIT');
  // Before: every message was fingerprinted and copied first (160 reads).
  assert.equal(reads, 0);
  const plan = planChronologicalRebuild(chat, { maxBoundaries: 50 });
  assert.equal(planChronologicalRebuild(chat, { maxBoundaries: 50, lineage: plan.lineage }).lineage, plan.lineage);
});

test('74: capture and evolution keep no unused snapshot token; record links read the state in place', () => {
  assert.equal(typeof capture.captureSnapshotToken, 'undefined');
  const ui = fs.readFileSync('ui.js', 'utf8');
  const status = ui.slice(ui.indexOf('function recordStatusOfKey(key)'), ui.indexOf('function shownModel()'));
  assert.doesNotMatch(status, /normalizeState/);
  const index = fs.readFileSync('index.js', 'utf8');
  const changed = index.slice(index.indexOf('function stateChanged('), index.indexOf('function pointerFor('));
  assert.doesNotMatch(changed, /normalizeState/);
});

test('75-78: the contract describes schema, copies, cited coordinates and evolution triggers as the code does', () => {
  const contract = fs.readFileSync('docs/core-contract.md', 'utf8');
  assert.doesNotMatch(contract, /Schema version 1 sidecars\/bundles\/checkpoints migrate to schema 2/);
  assert.match(contract, /schema version 1 is not migrated/i);
  assert.doesNotMatch(contract, /A canonical mutation copies the state once/);
  assert.match(contract, /host passes no affecting evidence/i);
  assert.match(contract, /A coordinate is narrative-explicit only in a cited sentence/);
});

test('79/80/81: dead code is gone and the tested elapsed detector is the one the extension runs', () => {
  for (const [module, names] of [
    [spatialCore, ['straightLineDistance', 'unitsToKm']],
    [narrativeSanitizer, ['containsWriterState', 'extractWriterStateBlocks']],
    [transfer, ['cloneForExport']],
    [relevance, ['scoreRecordRelevance']],
    [capture, ['CAPTURE_DEFAULT_INTERVAL']],
  ]) for (const name of names) assert.equal(module[name], undefined, name);
  const manual = fs.readFileSync('spatial-manual.js', 'utf8');
  assert.doesNotMatch(manual, /querySpatialLocations|inspectSpatialLocation/);
  for (const file of ['capture.js', 'spatial-capture.js', 'spatial-core.js']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /relationsChanged|routesChanged/, file);
  }
  // Before: extractElapsedHint read quoted plans and promises as time that had passed.
  assert.equal(extractElapsedHint('"Two weeks later we will be home," she promised.'), null);
  assert.equal(extractElapsedHint('They would arrive two weeks later.'), null);
  assert.equal(extractElapsedHint('Two weeks later, the snow melts.')?.meaningful, true);
});

test('82: shared helpers live once; evolution clipping keeps a small limit', () => {
  for (const file of ['state-core.js', 'spatial-core.js', 'diagnostics.js', 'capture-wire.js', 'evolution-wire.js', 'spatial-wire.js', 'capture.js', 'source-firewall.js', 'elapsed.js', 'index.js', 'evolution.js']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /^(?:export )?function (?:clone|uniqueStrings|messageText|clip)\(/m, file);
  }
  assert.doesNotMatch(fs.readFileSync('evolution.js', 'utf8'), /duplicateThreshold/);
  assert.ok(clipMiddle('x'.repeat(200), 50, 0.58).length <= 50);
  assert.ok(clipMiddle('x'.repeat(500), 200, 0.58).includes('[bounded]'));
});

test('83: a null optional status is "not stated", like a null trend', () => {
  const evidence = [{ sourceMessageId: 1, claim: 'The north bridge has collapsed.' }];
  const wire = validateCaptureEnvelope({ mutations: [
    { action: 'create', kind: 'fact', summary: 'The north bridge has collapsed.', status: null, evidence },
    { action: 'update', recordId: 'r1', summary: 'The bridge is gone.', status: null, evidence },
  ] });
  assert.equal(wire.rejected.length, 0, JSON.stringify(wire.rejected));
  assert.equal(wire.mutations[0].status, 'active');
  assert.equal('status' in wire.mutations[1], false);
});

test('84: World_State checklists read every bullet style and "Offscreen"', () => {
  const mes = '<World_State>\n**Offscreen:**\n• Bandits hold the north pass\n1. The mill burned down last week\n+ The guild raised its tolls again\n2) Ferry service suspended indefinitely\n**Arc Phase:** setup\n- not this one at all\n</World_State>';
  const hints = capture.extractWorldStateCompletenessHints([{ messageId: 3, is_user: false, mes }]).map(item => item.text);
  assert.deepEqual(hints, ['Bandits hold the north pass', 'The mill burned down last week', 'The guild raised its tolls again', 'Ferry service suspended indefinitely']);
  // A numbered label ending at its colon is a heading that closes the section, not an entry.
  const planned = '<World_State>\nOff-screen:\n- garrison marching north\n1. Scene goals for next reply:\n- Mira wants to reach the ferry\n</World_State>';
  assert.deepEqual(capture.extractWorldStateCompletenessHints([{ messageId: 4, is_user: false, mes: planned }]).map(item => item.text), ['garrison marching north']);
});

test('84: a Reality-only rebuild takes a non-array chat, and a place added after the last reply stays at its own message', async () => {
  const empty = await runManualRebuild({ state: createState('c'), chat: null, chatKey: 'c', isCurrent: () => true, spatialEnabled: false });
  assert.equal(empty.outcome, 'completed');

  const chatKey = 'trailing';
  const chat = [
    { role: 'user', content: 'We arrive at the village.' },
    { role: 'assistant', content: 'The village is calm under grey skies.' },
    { role: 'user', content: 'I mark the old mill on my map.' },
  ];
  const edited = applySpatialManualMutation({
    state: seedRootCheckpoint(createState(chatKey)), chat, chatKey, messageId: 2,
    mutation: { action: 'upsert_location', name: 'Old Mill', type: 'mill', coordinate: { x: 1, y: 2 } },
    note: 'marked',
  });
  const result = await runManualRebuild({
    ctx: {}, state: edited.state, chat, chatKey, isCurrent: () => true, spatialEnabled: false,
    dispatcher: async () => ({ text: '{"mutations":[]}', receipt: OK }),
  });
  assert.equal(result.outcome, 'completed');
  assert.deepEqual(result.state.spatial.locations.map(item => item.name), ['Old Mill']);
  // Before: it was journaled at the reply (message 1), so deleting message 2 kept it.
  assert.deepEqual(result.state.rollbackJournal.filter(entry => entry.undo?.spatial).map(entry => entry.messageId), [2]);
});

test('review hardening: rebuild reads every word of a long exchange, and adds no checkpoint for an unchanged trailing message', async () => {
  const filler = Array.from({ length: 320 }, (_, i) => 'filler' + i).join(' ');
  const chat = [
    { role: 'user', content: 'We watch the orchard.' },
    { role: 'assistant', content: 'Wasps nest in the orchard wall.' },
    { role: 'user', content: 'We smoke them out.' },
    { role: 'assistant', content: 'The wasps are gone for good.' },
  ];
  for (let i = 0; i < 7; i += 1) chat.push({ role: 'user', content: 'We wait.' }, { role: 'assistant', content: 'Rain falls on day ' + (i + 1) + '.' });
  chat.push({ role: 'user', content: 'Weeks pass.' }, { role: 'assistant', content: filler + ' Wasps return to the orchard wall.' });
  const prompts = [];
  await runManualRebuild({
    ctx: {}, state: createState('long-window'), chat, chatKey: 'long-window', isCurrent: () => true,
    dispatcher: async (_ctx, options) => {
      prompts.push(options.prompt);
      const visible = visibleOf(options.prompt);
      const mutations = prompts.length === 1
        ? [{ action: 'create', kind: 'development', summary: 'Wasps nest in the orchard wall.', anchors: ['wasps'], evidence: [{ sourceMessageId: 1, claim: 'Wasps nest in the orchard wall.' }] }]
        : prompts.length === 2
          ? [{ action: 'resolve', recordId: visible[0]?.id, summary: 'The wasps are gone from the orchard wall for good.', evidence: [{ sourceMessageId: 3, claim: 'The wasps are gone for good.' }] }]
          : [];
      return { text: JSON.stringify({ mutations }), receipt: OK };
    },
  });
  // The ended episode is recurrence context for a new one named after 320 other words of the newest reply.
  assert.ok(visibleOf(prompts.at(-1)).some(item => item.status === 'resolved' && /wasp/i.test(item.summary)), JSON.stringify(visibleOf(prompts.at(-1))));

  const chatKey = 'trailing-noop';
  const trailing = [
    { role: 'user', content: 'We arrive at the village.' },
    { role: 'assistant', content: 'The village is calm under grey skies.' },
    { role: 'user', content: 'I look around.' },
  ];
  const result = await runManualRebuild({
    ctx: {}, state: seedRootCheckpoint(createState(chatKey)), chat: trailing, chatKey, isCurrent: () => true, spatialEnabled: false,
    dispatcher: async () => ({ text: '{"mutations":[]}', receipt: OK }),
  });
  assert.equal(result.outcome, 'completed');
  assert.ok(!result.state.checkpoints.some(item => item.messageId === 2), JSON.stringify(result.state.checkpoints.map(item => item.messageId)));
});

test('review hardening: lineage-only reconciles compare lineage fields, the reply count keeps no chat, host text reads mes first', () => {
  const index = fs.readFileSync('index.js', 'utf8');
  const changed = index.slice(index.indexOf('function stateChanged('), index.indexOf('function pointerFor('));
  assert.match(changed, /return !sameLineage\(left\?\.lineage, right\?\.lineage\);/);
  assert.match(index, /assistantBoundaryMemo = \{ chatKey, length: chat\.length, events, at: Date\.now\(\), count \};/);
  assert.match(index, /import \{ clone, hostMessageText as messageText \} from '\.\/common\.js';/);
  assert.doesNotMatch(fs.readFileSync('source-firewall.js', 'utf8'), /Object\.freeze\(new Set/);
});
