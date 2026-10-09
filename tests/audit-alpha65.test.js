// alpha.65: deep-pass items 111 and 113-137 (cleanups, shared helpers and performance).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { chatHeadKey, chatLineage, reconcileBranch } from '../branch.js';
import { normalizeCaptureExchange, boundedExchangeText, CAPTURE_LIMITS } from '../capture.js';
import { keyedUndo, tokenBudget, visibleRole, boundedText } from '../common.js';
import { detectAccumulatedDayStepHint, extractElapsedHint, normalizeElapsedHint } from '../elapsed.js';
import { queryWorldState, prepareWorldStateExport } from '../manual.js';
import { worldStateRouteFingerprint } from '../provider-routing.js';
import { evaluationBoundary } from '../relevance.js';
import {
  applyCaptureSourceFirewall,
  createCaptureFirewallContext,
  endsSentenceAt,
  quotedDialogueRanges,
} from '../source-firewall.js';
import { buildSpatialRelevanceIndex } from '../spatial-relevance.js';
import { createState, normalizeState, reduceMutations } from '../state-core.js';
import { exportBundle } from '../transfer.js';
import { buildWorldStateUiModel } from '../ui.js';

const index = fs.readFileSync('index.js', 'utf8');
const rebuild = fs.readFileSync('rebuild.js', 'utf8');
const ui = fs.readFileSync('ui.js', 'utf8');
const launcher = fs.readFileSync('launcher.js', 'utf8');

function seeded(rows, chatKey = 'a65') {
  return reduceMutations(createState(chatKey), {
    chatKey, messageId: 0, lineageKey: 'ln_0', operation: 'capture',
    mutations: rows.map(([summary, anchors]) => ({ action: 'create', kind: 'development', summary, anchors, evidence: [{ sourceMessageId: 0, claim: summary }] })),
  }).state;
}

test('121: a title or initial does not end the sentence an elapsed phrase is judged in', () => {
  assert.equal(endsSentenceAt('Mt. Ember', 2), false);
  assert.equal(endsSentenceAt('the gate fell. Then', 13), true);
  // Before: the sentence began after "Mt." / "Lt.", so the condition was not seen and the skip was established.
  assert.equal(extractElapsedHint('If the scouts reach Mt. Ember, two days later we march.'), null);
  assert.equal(extractElapsedHint('Should Lt. Varro agree, three days later the gate opens.'), null);
  const narrated = extractElapsedHint('Capt. Mora rode north. Three days later the fleet sailed.');
  assert.equal(narrated?.amount, 3);
});

test('121: elapsed and Places wire text is bounded idempotently by the shared helper', () => {
  const hint = normalizeElapsedHint({ raw: 'three days later', amount: 3, unit: 'day', context: `${'x'.repeat(399)} tail` });
  assert.equal(hint.context, boundedText(hint.context, 400));
  assert.deepEqual(normalizeElapsedHint(hint), hint);
});

test('121: one role rule for hidden rows; lineage roles are the shared message role', () => {
  assert.equal(visibleRole({ is_user: true, is_system: true }), 'system');
  assert.equal(visibleRole({ is_user: true }), 'user');
  assert.equal(visibleRole({ is_user: false, is_system: false }), 'assistant');
  assert.equal(chatLineage([{ is_user: true, mes: 'hi' }, { is_user: false, mes: 'yo' }]).map(row => row.role).join(','), 'user,assistant');
  assert.doesNotMatch(index, /^function messageRole\(/m);
  assert.match(index, /visibleRole as messageRole/);
  assert.doesNotMatch(fs.readFileSync('branch.js', 'utf8'), /function lineageRole/);
});

test('121: shared helpers replace the module copies', () => {
  assert.equal(tokenBudget(null, 800), 800);
  assert.equal(tokenBudget(99999, 800), 2400);
  assert.deepEqual(keyedUndo([{ id: 'a', v: 1 }], [{ id: 'a', v: 1 }]), []);
  assert.equal(evaluationBoundary({ lastChangedMessage: 4, createdAtMessage: 1 }), 4);
  assert.doesNotMatch(fs.readFileSync('evolution.js', 'utf8'), /function lastEvaluationBoundary/);
  assert.match(launcher, /export const CONTINUITY_ICON_SVG/);
  assert.match(ui, /CONTINUITY_ICON_SVG \+ '<\/span>'/);
  assert.equal((index.match(/\.\.\.Object\.keys\(settings\.dataFiles \|\| \{\}\),/g) || []).length, 1);
  // One finish helper records every ending of a rebuild.
  assert.match(index, /const endRun = \(\{ phase, outcome, code, detail, logDetail = detail, at = sourceMessageId, status = \{\}, log = \{\} \}\) => \{/);
  assert.equal((index.match(/endRun\(\{/g) || []).length, 7);
  assert.doesNotMatch(index, /phase: 'committing',[\s\S]{0,4000}?processedBoundaries: result\.processedBoundaries \|\| 0,\n\s*totalBoundaries: result\.plan\?\.assistantBoundaries \?\? totalBoundaries,\n\s*providerCalls/);
});

test('121: a profile lookup that throws gives no signature on every route', () => {
  const ctx = {
    ConnectionManagerRequestService: { getProfile() { throw new Error('boom'); } },
    extensionSettings: {},
  };
  assert.equal(worldStateRouteFingerprint(ctx, { profileId: 'p1' }).signature, null);
  const fallback = { extensionSettings: { connectionManager: { profiles: [{ id: 'p1', api: 'x', model: 'm' }] } } };
  assert.ok(worldStateRouteFingerprint(fallback, { profileId: 'p1' }).signature);
});

test('121: the capture exchange and the relevance view keep the same newest end within the budget', () => {
  const long = 'w '.repeat(CAPTURE_LIMITS.perMessageChars);
  const exchange = Array.from({ length: 8 }, (_, id) => ({ messageId: id, role: id % 2 ? 'assistant' : 'user', content: `${id} ${long}` }));
  const rows = normalizeCaptureExchange(exchange);
  assert.ok(rows.reduce((sum, row) => sum + row.content.length, 0) <= CAPTURE_LIMITS.exchangeChars);
  assert.equal(rows.at(-1).messageId, 7);
  const text = boundedExchangeText(exchange.map(row => row.content));
  assert.ok(text.length <= CAPTURE_LIMITS.exchangeChars);
  assert.match(text, /7 w/);
});

test('122: the firewall judges every row of one response on one context', () => {
  const state = seeded([['The north gate is barred', ['north gate']]]);
  const exchange = [{ messageId: 1, role: 'assistant', content: 'The north gate is barred with chains.' }];
  const mutation = { action: 'update', recordId: state.records[0].id, summary: 'The north gate is barred with chains', evidence: [{ sourceMessageId: 1, claim: 'The north gate is barred with chains.' }] };
  const direct = applyCaptureSourceFirewall(mutation, { exchange, visibleRecords: state.records, state });
  const context = createCaptureFirewallContext({ exchange, visibleRecords: state.records, state });
  assert.deepEqual(applyCaptureSourceFirewall(mutation, { context }), direct);
  assert.equal(direct.ok, true);
  assert.match(fs.readFileSync('capture.js', 'utf8'), /const firewallContext = createCaptureFirewallContext\(/);
});

test('122: quoted spans are paired once per text and cannot be edited', () => {
  const text = 'Mira said, "The toll is 20." The gate shut.';
  const first = quotedDialogueRanges(text);
  assert.equal(quotedDialogueRanges(text), first);
  assert.ok(Object.isFrozen(first));
  assert.throws(() => first.push([0, 1]));
});

test('123: the day-step walk judges each message once per text and still sees an edit', () => {
  const chat = [
    { is_user: true, mes: 'We rest.' },
    { is_user: false, mes: 'The next morning, the caravan sets out.' },
    { is_user: true, mes: 'Onward.' },
    { is_user: false, mes: 'The next day, the road climbs into the hills.' },
  ];
  const lineage = chatLineage(chat);
  const fired = detectAccumulatedDayStepHint(chat, 3, { lineage });
  assert.equal(fired?.amount, 2);
  // The same reply edited to drop its day step: the cached judgement of the old text is not reused.
  const edited = chat.map((row, id) => (id === 3 ? { ...row, mes: 'The road climbs into the hills.' } : row));
  assert.equal(detectAccumulatedDayStepHint(edited, 3, { lineage: chatLineage(edited) }), null);
});

test('125 and 126: the head guard compares the chained head key, without lineage rows', () => {
  const chat = [{ is_user: true, mes: 'a' }, { is_user: false, mes: 'b' }];
  const lineage = chatLineage(chat);
  assert.equal(chatHeadKey(chat), `2:${lineage.at(-1).lineageKey}`);
  assert.notEqual(chatHeadKey([chat[0], { ...chat[1], mes: 'c' }]), chatHeadKey(chat));
  assert.match(index, /const startHead = chatHeadKey\(getContext\(\)\.chat \|\| \[\]\);/);
});

test('131: reconcile reuses a supplied lineage and returns what hashing would', () => {
  const state = seeded([['The ford is flooded', ['ford']]]);
  const chat = [{ is_user: true, mes: 'go' }];
  const lineage = chatLineage(chat);
  const hashed = reconcileBranch(state, chat);
  const reused = reconcileBranch(state, chat, { lineage });
  assert.deepEqual(reused.state.lineage, hashed.state.lineage);
  assert.equal(reused.action, hashed.action);
  // A partial rebuild and every boundary commit use the plan's lineage instead of copying the chat prefix.
  assert.match(rebuild, /reconcileBranch\(original, prefix, \{ lineage: currentLineage\.slice\(0, plan\.metrics\.startMessageId\) \}\)/);
  assert.doesNotMatch(rebuild, /chat\.slice\(0, window\.messageId \+ 1\)/);
});

test('129: an export normalizes once and writes the same bundle', () => {
  const state = seeded([['The mill burned', ['mill']]]);
  const normalized = normalizeState(state, { strictSchema: true });
  const exportedAt = '2026-01-01T00:00:00.000Z';
  assert.equal(exportBundle(normalized, { exportedAt, strictlyNormalized: true }), exportBundle(state, { exportedAt }));
  assert.equal(prepareWorldStateExport(state, { exportedAt }).text, exportBundle(state, { exportedAt }));
});

test('132: panel reads leave the state untouched and return copies', () => {
  const state = seeded([['The mill burned', ['mill']]]);
  const before = JSON.stringify(state);
  const rows = queryWorldState(state, { text: 'mill' }).records;
  rows[0].summary = 'changed';
  assert.equal(JSON.stringify(state), before);
  const model = buildWorldStateUiModel(state);
  assert.equal(model.views.current[0].summary, 'The mill burned');
  assert.equal(JSON.stringify(state), before);
});

test('135: Places name and description postings skip function words', () => {
  const spatial = normalizeState(createState('a65')).spatial;
  spatial.locations.push({ id: 'p1', name: 'The Tower of Dawn', type: 'tower', status: 'active', coordinate: { x: null, y: null, authority: 'unknown', locked: false }, context: 'a ruin on the hill', routeRefs: [], notes: '', evidenceIds: [] });
  const built = buildSpatialRelevanceIndex(spatial);
  assert.equal(built.nameTokens.has('the'), false);
  assert.equal(built.nameTokens.has('of'), false);
  assert.ok(built.nameTokens.get('tower')?.has('p1'));
  assert.equal(built.contextTokens.has('on'), false);
  assert.ok(built.contextTokens.get('ruin')?.has('p1'));
});
