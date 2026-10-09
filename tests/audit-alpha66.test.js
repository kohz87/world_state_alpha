// alpha.66: Astra Pro audit on ec4973c, findings A01-A05, A10, A18 and A19 (data and ownership).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { ownEntry, reservedMapKey, tokenBudget } from '../common.js';
import { consolidateCreateCandidate, distinctSubjects } from '../duplicate.js';
import { estimateInjectionTokens, fitLine } from '../injection.js';
import { inspectWorldStateRecord } from '../manual.js';
import { createSpatialState, normalizeSpatialState } from '../spatial-core.js';
import { createState, normalizeState, reduceMutations } from '../state-core.js';
import { buildWorldStateUiModel } from '../ui.js';

const index = fs.readFileSync('index.js', 'utf8');
const ui = fs.readFileSync('ui.js', 'utf8');

const record = (summary, anchors) => ({ id: 'r1', kind: 'development', status: 'active', summary, anchors });
const create = (summary, anchors) => ({ action: 'create', kind: 'development', summary, anchors, evidence: [{ sourceMessageId: 1, claim: summary }] });

test('A01: a shared faction or predicate never makes two named subjects one record', () => {
  const ravenford = record('Ravenford is besieged by the Iron Legion.', ['Iron Legion']);
  const stonehaven = consolidateCreateCandidate(create('Stonehaven is besieged by the Iron Legion.', ['Iron Legion']), [ravenford]);
  assert.equal(stonehaven.mutation.action, 'create');
  assert.equal(consolidateCreateCandidate(create('Joren is badly wounded after the ambush.', ['ambush']), [record('Mira is badly wounded after the ambush.', ['ambush'])]).mutation.action, 'create');
  assert.equal(distinctSubjects('Ravenford is besieged by the Iron Legion.', 'Stonehaven is besieged by the Iron Legion.'), true);
  // The same subject in other words still consolidates; a name only one side mentions is no conflict.
  const same = consolidateCreateCandidate(create('Ravenford remains besieged by the Iron Legion.', ['Iron Legion', 'Ravenford']), [record('Ravenford is besieged by the Iron Legion.', ['Iron Legion', 'Ravenford'])]);
  assert.equal(same.mutation.action, 'update');
  assert.equal(distinctSubjects('Bandits hold the pass', 'The bandits still hold the pass'), false);
  // A later sentence's first word is a common noun, not a name.
  assert.equal(distinctSubjects('The harbor is sealed. Guards patrol the docks', 'The harbor is sealed. Soldiers patrol the docks'), false);
});

test('A02: the Places form carries what it was rendered from and the host saves only changed fields', () => {
  const state = createState('a66');
  state.spatial.locations = [{ id: 'p1', name: 'Millbrook', type: 'village', status: 'active', baseRefId: null, coordinate: { x: 1, y: 2, authority: 'manual', locked: false }, context: 'A mill town', routeRefs: [], notes: 'old', createdAtMessage: 1, lastChangedMessage: 1, evidenceIds: [] }];
  const model = buildWorldStateUiModel(state, { activeTab: 'spatial' });
  const detail = model.spatial.detail;
  assert.deepEqual(detail.editBase, { name: 'Millbrook', type: 'village', context: 'A mill town', notes: 'old', routeRefs: [], coordinate: { x: 1, y: 2, authority: 'manual', locked: false } });
  assert.ok(Object.hasOwn(model.spatial, 'profileBase'));
  assert.match(ui, /profileBase: currentModel\.spatial\.profileBase \?\? null,/);
  // Unchanged fields keep the current value; a field changed here and elsewhere is refused.
  assert.match(index, /const dirty = String\(typed \?\? ''\) !== String\(shownValue \?\? ''\);\s*if \(!dirty\) \{\s*saved\[field\] = currentValue \?\? '';/);
  assert.match(index, /This place was changed elsewhere since you opened it/);
  // A position differing only from a newer server value is not "typed".
  assert.match(index, /const positionTyped = fd\.x !== null && \(fd\.x !== shownX \|\| fd\.y !== shownY\);/);
  assert.match(index, /const coordinateChanged = coordinateTouched && \(/);
  assert.match(index, /The Coordinate Profile was changed elsewhere since you opened Map settings/);
});

test('A03: a stale ownership transition is never swallowed by best-effort cleanup', () => {
  const remove = index.slice(index.indexOf('async function removeWorldStateChatOwnership('), index.indexOf('function scheduleDeleteOwnershipRetry('));
  assert.equal((remove.match(/rethrowStaleOwnership\(error\);/g) || []).length, 2);
  assert.match(remove, /assertOwnershipEpoch\(chatKey, ownerEpoch\);\s*delete settings\.recoveryRequiredChats\[chatKey\];\s*settings\.sidecarTombstones\[chatKey\] = \{/);
  assert.match(remove, /await persistCriticalHostSettings\('retired World State ownership'\);\s*assertOwnershipEpoch\(chatKey, ownerEpoch\);/);
  const migrate = index.slice(index.indexOf('async function migrateWorldStateChatKey('), index.indexOf('function holdsContinuity('));
  assert.match(migrate, /rethrowStaleOwnership\(error\);/);
  assert.match(migrate, /await retireOperationLog\(oldKey, newKey\);\s*\/\/[^\n]*\n\s*assertOwnershipEpoch\(oldKey, oldOwnerEpoch\);\s*assertOwnershipEpoch\(newKey, newOwnerEpoch\);\s*clearChatRuntimeState\(oldKey\);/);
  // A retired log is emptied only while its identity is still retired (renaming back revives it).
  assert.match(index, /queueOperationLogWrite\(chatKey, \(\) => \(retiredOperationLogs\.has\(chatKey\)\s*\? hostStorage\.uploadJsonFile/);
  // A superseded transition is not reported as a failure.
  assert.match(index, /if \(supersededOwnership\(error, 'chat rename migration'\)\) return;/);
});

test('A04: a renamed chat that still needs recovery stays recovery-required across reloads', () => {
  assert.match(index, /recoveryRequiredChats: \{\},/);
  assert.match(index, /settings\.recoveryRequiredChats\[newKey\] = \{ reason: 'renamed-unrecovered', from: oldKey \};/);
  assert.match(index, /function settleBootstrapRequired\(chatKey\) \{\s*if \(durableRecoveryRequired\(chatKey\)\) bootstrapRequiredChats\.add\(chatKey\);/);
  // Every path that accepts a readable sidecar settles the flag instead of clearing it.
  assert.equal((index.match(/settleBootstrapRequired\(chatKey\);/g) || []).length, 4);
  // Only a recovery write clears the marker.
  assert.match(index, /const recoveryMarkerCleared = durableRecoveryRequired\(chatKey\);\s*if \(recoveryMarkerCleared\) delete settings\.recoveryRequiredChats\[chatKey\];/);
  assert.match(index, /if \(durableRecoveryRequired\(chatKey\)\) bootstrapRequiredChats\.add\(chatKey\);\s*if \(bootstrapRequiredChats\.has\(chatKey\) && !allowBootstrapRecovery\)/);
});

test('A05: hidden roleplay turns count as existing history', () => {
  const established = index.slice(index.indexOf('function chatHasEstablishedHistory('), index.indexOf('async function recheckProvisionalFreshHydration('));
  assert.match(established, /const role = message\?\.is_system \? hiddenConversationRole\(message\) : messageRole\(message\);/);
});

test('A10: evidence references are own keys only and "__proto__" is no evidence id', () => {
  const reality = createState('a66');
  reality.records = [{ id: 'r1', kind: 'fact', summary: 'The mill burned', status: 'active', evidenceIds: ['constructor'], anchors: [] }];
  assert.throws(() => normalizeState(reality, { strictSchema: true }), /missing evidence: constructor/);
  const proto = JSON.parse('{"__proto__": {"id": "__proto__", "claim": "x", "sourceMessageId": 0}}');
  assert.throws(() => normalizeState({ ...createState('a66'), evidence: proto }, { strictSchema: true }), /reserved/);
  const places = createSpatialState();
  places.locations = [{ id: 'p1', name: 'Millbrook', type: 'village', status: 'active', coordinate: { x: null, y: null, authority: 'unknown', locked: false }, evidenceIds: ['toString'] }];
  assert.throws(() => normalizeSpatialState(places, { strict: true }), /missing evidence: toString/);
  assert.throws(() => normalizeSpatialState({ ...createSpatialState(), evidence: proto }, { strict: true }), /reserved/);
  // A lenient read never hands back an inherited function as evidence.
  const lenient = createState('a66');
  lenient.records = [{ id: 'r1', kind: 'fact', summary: 'The mill burned', status: 'active', evidenceIds: ['constructor'], anchors: [] }];
  assert.deepEqual(inspectWorldStateRecord(normalizeState(lenient), 'r1').evidence, []);
  assert.equal(ownEntry({}, 'constructor'), undefined);
  assert.equal(reservedMapKey('__proto__'), true);
});

test('A18: a line is cut to the longest useful length that fits, even when a midpoint was too short', () => {
  assert.equal(estimateInjectionTokens('Header\n- Northern gate'), 9);
  assert.equal(fitLine('- Northern gate', 'Header', 8), '- Northern…');
  // Too short to be useful is still empty.
  assert.equal(fitLine('- Northern gate', 'Header', 3), '');
});

test('A19: a null or blank saved budget is the default, never one token', () => {
  assert.equal(tokenBudget(null, 800), 800);
  assert.equal(tokenBudget('  ', 500), 500);
  assert.match(index, /settings\.injectBudgetTokens = tokenBudget\(settings\.injectBudgetTokens, DEFAULTS\.injectBudgetTokens\);/);
  assert.match(index, /settings\.spatialInjectBudgetTokens = tokenBudget\(settings\.spatialInjectBudgetTokens, DEFAULTS\.spatialInjectBudgetTokens\);/);
  assert.doesNotMatch(index, /Number\(settings\.injectBudgetTokens\)/);
});

test('A01 through the reducer: the second town keeps its own record', () => {
  const state = reduceMutations(createState('a66'), {
    chatKey: 'a66', messageId: 0, lineageKey: 'l0', operation: 'capture',
    mutations: [create('Ravenford is besieged by the Iron Legion.', ['Iron Legion'])].map(item => ({ ...item, evidence: [{ sourceMessageId: 0, claim: item.summary }] })),
  }).state;
  const consolidated = consolidateCreateCandidate(create('Stonehaven is besieged by the Iron Legion.', ['Iron Legion']), state.records);
  const next = reduceMutations(state, { chatKey: 'a66', messageId: 1, lineageKey: 'l1', operation: 'capture', mutations: [consolidated.mutation] }).state;
  assert.deepEqual(next.records.map(item => item.summary).sort(), ['Ravenford is besieged by the Iron Legion.', 'Stonehaven is besieged by the Iron Legion.']);
});
