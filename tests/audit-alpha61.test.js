// alpha.61: data loss and wrong state found by the deep pass on alpha.60 (items 1-23).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

import { chatLineage, commitMutationBoundary, reconcileBranch, seedRootCheckpoint } from '../branch.js';
import { boundedText } from '../common.js';
import { createDiagnosticStore, trimOperationRows, unrecoveredCaptureFailures } from '../diagnostics.js';
import { boundedExcerpt, canonicalText, hashText, stableStringify } from '../hash.js';
import { createSillyTavernWorldStateStorageAdapter, worldStateHostDeterministicPath } from '../host-storage.js';
import { createState, reduceMutations } from '../state-core.js';
import { encodeSidecar } from '../storage.js';
import { withoutWebLocks } from './web-locks.mjs';

const source = fs.readFileSync('index.js', 'utf8');

function scenario(name) {
  const run = spawnSync(process.execPath, ['tests/host/' + name + '.mjs'], { encoding: 'utf8', timeout: 60000 });
  const line = String(run.stdout || '').split('\n').find(item => item.startsWith('@@RESULT '));
  assert.ok(line, name + ' produced no result:\n' + String(run.stderr || '').slice(-2000));
  return JSON.parse(line.slice('@@RESULT '.length));
}

const failure = (messageId, at) => ({ label: 'capture', at, sourceMessageId: messageId, lineageKey: 'ln-' + messageId, contentLineageKey: 'c-' + messageId, outcome: 'invalid-response' });

test('1: a recovery row is kept with the failure it clears and reported as saved at once, even in a full log', () => {
  const saves = [];
  const store = createDiagnosticStore({ limit: 80, now: () => 1000, onRecord: (_key, row, info) => saves.push({ outcome: row.outcome, ...info }) });
  for (let id = 0; id < 85; id += 1) store.record('chat:x', { ...failure(id, id + 1), operationId: 'capture:' + id });
  store.record('chat:x', { label: 'capture', at: 200, sourceMessageId: 0, lineageKey: 'ln-0', contentLineageKey: 'c-0', outcome: 'forfeited', operationId: 'capture:0:forfeited' });
  // The store judged the recovery before trimming: it clears a listed failure, so the host saves it now.
  assert.deepEqual(saves.at(-1), { outcome: 'forfeited', failuresListed: true });
  const rows = store.recoveryRows('chat:x');
  // The forfeit row stays with its failure; merged with a server copy of that failure, the failure stays cleared.
  assert.ok(rows.some(row => row.outcome === 'forfeited'));
  assert.equal(unrecoveredCaptureFailures([failure(0, 1), ...rows]).some(item => item.messageId === 0), false);

  // trimOperationRows itself pins a row that clears a failure still in the list.
  const list = [failure(0, 1), ...Array.from({ length: 10 }, (_, i) => ({ label: 'branch', at: 2 + i, outcome: 'same' })),
    { label: 'capture', at: 50, sourceMessageId: 0, lineageKey: 'ln-0', outcome: 'applied' }];
  const trimmed = trimOperationRows(list, 3);
  assert.ok(trimmed.some(row => row.outcome === 'applied'));
  assert.match(source, /onRecord: \(chatKey, row, \{ failuresListed = false \} = \{\}\) => scheduleOperationLogSave/);
  assert.doesNotMatch(source, /function capturesFailedBefore\(/);
});

test('2: a completed rebuild clears failures in its own range only, not replies added while it ran', () => {
  const rows = [failure(3, 1), failure(9, 2), failure(12, 3),
    { label: 'rebuild', at: 10, sourceMessageId: 10, operationId: 'rebuild:10:4:5', outcome: 'rebuild-completed' }];
  // Message 3 is before the start, 12 after the last message the rebuild read.
  assert.deepEqual(unrecoveredCaptureFailures(rows).map(item => item.messageId), [3, 12]);
  // Import and reset still clear every failure.
  assert.deepEqual(unrecoveredCaptureFailures([...rows, { label: 'import', at: 11, outcome: 'applied' }]), []);
});

test('3: renaming a chat that needs recovery writes no empty sidecar; the new name stays recovery-required', () => {
  const result = scenario('rename-recovery');
  assert.equal(result.before, true);
  assert.equal(result.sidecarsAfter, 0);
  assert.equal(result.newRequired, true);
  const migrate = source.slice(source.indexOf('async function migrateWorldStateChatKey('), source.indexOf('function characterOwnerKeyPrefix('));
  assert.match(migrate, /recoverExistingSidecarPointer\(oldKey, oldPointer, \{ reportCorrupt: true \}\)/);
  assert.match(migrate, /if \(!recoveredSource\?\.payload\?\.state && \(bootstrapRequiredChats\.has\(oldKey\) \|\| recoveredSource\?\.corrupt\)\s*&& !holdsContinuity\(sourceState\)\) \{[\s\S]{0,700}?settings\.recoveryRequiredChats\[newKey\] = \{ reason: 'renamed-unrecovered', from: oldKey \};[\s\S]{0,500}?await retireOperationLog\(oldKey, newKey\);\s*if \(ownershipEpoch\(oldKey\) === oldOwnerEpoch\) clearChatRuntimeState\(oldKey\);[\s\S]{0,200}?bootstrapRequiredChats\.add\(newKey\);/);
});

test('4 and 7: a freshness check never adopts this session\'s own write; a compensated write is this session\'s revision', () => {
  const persist = source.slice(source.indexOf('async function persistState('), source.indexOf('async function loadChatState('));
  assert.match(persist, /sidecarWritesInFlight\.set\(chatKey, \(sidecarWritesInFlight\.get\(chatKey\) \|\| 0\) \+ 1\);\s*let committed;\s*try \{/);
  assert.match(persist, /\} finally \{\s*const left = \(sidecarWritesInFlight\.get\(chatKey\) \|\| 1\) - 1;/);
  const refresh = source.slice(source.indexOf('async function refreshChatStateFromServer('));
  // One still running is counted; one that finished during the read has moved the settings pointer.
  assert.match(refresh, /\|\| sidecarPointerToken\(pointerFor\(chatKey\)\) !== startSettingsToken\s*\|\| sidecarWritesInFlight\.has\(chatKey\)\) \{\s*return \{ outcome: 'raced', changed: false \};/);
  assert.match(source, /function noteCompensatedRevision\(chatKey, restoredState, pointer\) \{\s*if \(pointer\?\.path && stateCache\.get\(chatKey\) === restoredState\) hydratedPointers\.set/);
  assert.match(source, /const restored = await persistState\(chatKey, recoveryState, \{ expectedPointer: committed \}\);\s*noteCompensatedRevision\(chatKey, recoveryState, restored\);/);
  assert.match(source, /expectedPointer: rebuildCommitted,\s*\}\);\s*noteCompensatedRevision\(chatKey, state, restored\);/);
});

test('5 and 6: a capture abandoned by a chat switch or dropped by a failed reconcile is a missed capture', () => {
  const handler = source.slice(source.indexOf('async function handleAssistantMessage('), source.indexOf('function storyFingerprintOf('));
  assert.match(handler, /if \(captureStarted\) return;\s*if \(currentChatKey\(\) !== chatKey\) recordAbandonedCapture\(chatKey, messageId, prefix, startFingerprint\);\s*else if \(outcome === 'branch-unavailable'\)/);
  assert.match(handler, /code: 'WORLD_STATE_CAPTURE_BRANCH_UNAVAILABLE'/);
  // Keyed from the messages as they were when the reply arrived; a reply the state already holds is not missed.
  assert.match(handler, /const prefix = chat\.slice\(0, messageId \+ 1\);/);
  assert.match(handler, /state\?\.lastCaptureMessage === messageId && state\.lineage\?\.\[messageId\]\?\.lineageKey === lineageKey\) return;/);
  assert.match(handler, /outcome: 'stale',\s*code: 'WORLD_STATE_CAPTURE_ABANDONED'/);
  assert.match(source, /return currentChatKey\(\) === chatKey \? 'branch-unavailable' : undefined;/);
  const timer = source.slice(source.indexOf('function scheduleBranchCapture('), source.indexOf('const BRANCH_CAPTURE_REASONS'));
  assert.match(timer, /if \(currentChatKey\(\) !== chatKey\) \{\s*recordAbandonedCapture\(chatKey, messageId, prefix, storyStart\);/);
  // A lineage-keyed 'stale' row is listed as a missed capture.
  assert.equal(unrecoveredCaptureFailures([{ label: 'capture', at: 1, sourceMessageId: 4, lineageKey: 'ln', outcome: 'stale' }]).length, 1);
});

test('8: a rebuild whose conflict rehydration fails, or that throws past its handling, ends as failed', () => {
  assert.match(source, /conflictHandled = await handleServerRevisionConflict\(chatKey, persistError, \{ label: 'rebuild', sourceMessageId \}\);\s*\} catch \(conflictError\) \{[\s\S]{0,160}error = conflictError;/);
  const entry = source.slice(source.indexOf('async function applyMaintenanceAction('), source.indexOf('function rebuildRunning('));
  assert.match(entry, /if \(actionId === 'rebuild' && rebuildRunning\(chatKey\)\) \{\s*rebuildStatuses\.set\(chatKey, \{[\s\S]{0,80}phase: 'failed',/);
});

test('9-12: Operations-log saves, retirements and stale loads keep their rows and their owner', () => {
  const save = source.slice(source.indexOf('async function saveOperationLogLocked('), source.indexOf('function flushAllOperationLogs('));
  assert.match(save, /const generation = operationStoreGenerations\.get\(chatKey\) \|\| 0;\s*const localAtStart = snapshot \|\| diagnosticStore\.rowsSnapshot\(chatKey\);/);
  assert.match(save, /if \(!snapshot && \(operationStoreGenerations\.get\(chatKey\) \|\| 0\) !== generation\) snapshot = localAtStart;/);
  assert.match(source, /diagnosticStore\.clear\(key\);\s*operationStoreGenerations\.set\(key, \(operationStoreGenerations\.get\(key\) \|\| 0\) \+ 1\);/);
  const retireStart = source.indexOf('function retireOperationLog(');
  const retire = source.slice(retireStart, source.indexOf('\n}\n', retireStart));
  assert.match(retire, /if \(attempt === 0\) retiredOperationLogs\.delete\(successorKey\);/);
  assert.match(retire, /could not be cleared; retrying\.', error\);\s*retry\(\);/);
  for (const name of ['async function ensureChatStateLoaded(', 'async function recheckProvisionalFreshHydration(']) {
    const body = source.slice(source.indexOf(name), source.indexOf('\n}\n', source.indexOf(name)));
    assert.match(body, /if \(error\?\.code !== 'WORLD_STATE_STALE_OWNERSHIP'\) \{\s*hydrationErrors\.set\(chatKey, error\);\s*loadedChats\.delete\(chatKey\);\s*\}/);
  }
});

function storageHost({ files = new Map() } = {}) {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push([url, options.method]);
    if (options.method === 'GET') {
      return files.has(url)
        ? { ok: true, status: 200, text: async () => files.get(url) }
        : { ok: false, status: 404, text: async () => '' };
    }
    const payload = JSON.parse(options.body);
    const target = '/user/files/' + payload.name;
    files.set(target, Buffer.from(payload.data, 'base64').toString('utf8'));
    return { ok: true, status: 200, json: async () => ({ path: target }) };
  };
  return { files, calls, adapter: createSillyTavernWorldStateStorageAdapter({ fetchFn }) };
}

const sidecar = (chatKey, revision) => encodeSidecar({ chatKey, state: createState(chatKey), revision });

test('13 and 14: the revision check reads the file the upload replaces, and never replaces another chat\'s file', async () => {
  // A pointer path in another form still names the sanitized file under /user/files/.
  const host = storageHost();
  const odd = '/user/files/world state alpha odd.json';
  const physical = worldStateHostDeterministicPath(odd);
  host.files.set(physical, sidecar('chat:a:x', 5));
  assert.deepEqual(await host.adapter.write({ path: odd, expectedRevision: 2, body: sidecar('chat:a:x', 3) }), { conflict: true, currentRevision: 5 });
  assert.equal(host.calls[0][0], physical);

  // Another chat's sidecar at the target is a hard failure, whatever its revision.
  const other = storageHost();
  const path = '/user/files/world-state-alpha-shared.json';
  other.files.set(path, sidecar('chat:b:y', 2));
  await assert.rejects(other.adapter.write({ path, expectedRevision: 2, body: sidecar('chat:a:x', 3) }));
  assert.equal(JSON.parse(other.files.get(path)).chatKey, 'chat:b:y');
});

test('15: without Web Locks a write reads its upload back and reports a concurrent writer as a conflict', () => withoutWebLocks(async () => {
  const path = '/user/files/world-state-alpha-race.json';
  const files = new Map([[path, sidecar('chat:a:x', 2)]]);
  const fetchFn = async (url, options = {}) => {
    if (options.method === 'GET') return files.has(url) ? { ok: true, status: 200, text: async () => files.get(url) } : { ok: false, status: 404, text: async () => '' };
    // Another tab passed the same revision check and uploaded its own revision 3 right after this one.
    files.set(path, encodeSidecar({ chatKey: 'chat:a:x', state: { ...createState('chat:a:x'), lastCaptureMessage: 9 }, revision: 3 }));
    return { ok: true, status: 200, json: async () => ({ path }) };
  };
  const adapter = createSillyTavernWorldStateStorageAdapter({ fetchFn });
  assert.deepEqual(await adapter.write({ path, expectedRevision: 2, body: sidecar('chat:a:x', 3) }), { conflict: true, currentRevision: 3 });
  // A read-back that finds this very body succeeds as before.
  const quiet = storageHost({ files: new Map([[path, sidecar('chat:a:x', 2)]]) });
  const written = await quiet.adapter.write({ path, expectedRevision: 2, body: sidecar('chat:a:x', 3) });
  assert.equal(written.revision, 3);
  assert.deepEqual(quiet.calls.map(call => call[1]), ['GET', 'POST', 'GET']);
}));

test('16: a Places index built before the base map loaded is rebuilt once the map is at hand', () => {
  // Remembered by digest, so the index never keeps an evicted base map in memory.
  assert.match(source, /function buildSpatialIndexFor\(spatialState, baseMap\) \{\s*const index = buildSpatialRelevanceIndex\(spatialState, baseMap\);[\s\S]{0,120}index\.baseMapDigest = String\(baseMap\?\.digest \|\| ''\);/);
  assert.match(source, /if \(existing && \(!baseMap\?\.digest \|\| existing\.baseMapDigest === String\(baseMap\.digest\)\)\) return existing;/);
  assert.doesNotMatch(source, /baseMapLocations/);
});

test('17: a damaged sidecar stays recovery-required on every activation instead of a load error', () => {
  const result = scenario('corrupt-reactivate');
  assert.deepEqual(result.first, { error: false, required: true });
  assert.deepEqual(result.second, { error: false, required: true });
  assert.equal(result.corruptPath, true);
});

test('18: the chat growing keeps a failed rebuild\'s resume point', () => {
  assert.match(source, /if \(!lineageOnly\) \{\s*canonicalGenerations\.set\(chatKey, \(canonicalGenerations\.get\(chatKey\) \|\| 0\) \+ 1\);\s*rebuildResumes\.delete\(chatKey\);\s*\}/);
});

test('19: a checkpoint without a snapshot fails closed instead of throwing', () => {
  const chatKey = 'chat:a:snap';
  const chat = [
    { is_user: true, name: 'U', mes: 'We ride to the bridge.' },
    { is_user: false, name: 'B', mes: 'The north bridge has collapsed into the river.' },
    { is_user: true, name: 'U', mes: 'We look for a ford.' },
    { is_user: false, name: 'B', mes: 'They find a shallow ford downstream.' },
  ];
  let state = seedRootCheckpoint(createState(chatKey));
  for (const id of [1, 3]) {
    const lineage = chatLineage(chat.slice(0, id + 1));
    const reduced = reduceMutations(state, { chatKey, messageId: id, lineageKey: lineage[id].lineageKey, operation: 'capture', mutations: [
      { action: 'create', kind: 'fact', summary: 'Fact ' + id + ' holds.', evidence: [{ claim: chat[id].mes }] },
    ] });
    state = commitMutationBoundary(state, reduced.state, chat.slice(0, id + 1), id, 'capture', { lineage });
  }
  // An old or foreign save: checkpoints without snapshots, no journal to undo by.
  const broken = JSON.parse(JSON.stringify(state));
  broken.checkpoints = broken.checkpoints.map(({ snapshot, ...rest }) => rest);
  broken.rollbackJournal = [];
  let result;
  assert.doesNotThrow(() => { result = reconcileBranch(broken, chat.slice(0, 2)); });
  assert.equal(result.failClosed, true);
});

test('20: stableStringify agrees with JSON for values JSON drops or converts', () => {
  const value = { b: 1, a: undefined, c: [1, undefined, () => 0], d: { toJSON: () => 'x' }, e: new Date(0) };
  assert.equal(stableStringify(value), stableStringify(JSON.parse(JSON.stringify(value))));
  assert.equal(stableStringify(value), '{"b":1,"c":[1,null,null],"d":"x","e":"1970-01-01T00:00:00.000Z"}');
  assert.equal(hashText(stableStringify({ a: 1, b: undefined })), hashText(stableStringify({ a: 1 })));
});

test('21 and 22: bounding is idempotent and never ends on half an astral character', () => {
  const spaced = 'abcd efgh';
  assert.equal(boundedText(spaced, 5), 'abcd');
  assert.equal(boundedText(boundedText(spaced, 5), 5), boundedText(spaced, 5));
  const emoji = 'ab\u{1F600}cd';
  assert.equal(boundedText(emoji, 3), 'ab');
  assert.doesNotMatch(boundedText(emoji, 3), /[\uD800-\uDBFF]$/);
  const excerpt = boundedExcerpt('\u{1F600}'.repeat(10), 5);
  assert.doesNotMatch(excerpt, /[\uD800-\uDBFF]$/);
  assert.equal(excerpt, '\u{1F600}'.repeat(2));
  assert.equal(boundedExcerpt('Hello \u{1F600}world and more', 7), 'Hello');
});

test('23: canonical text lowercases without the device locale', () => {
  assert.equal(canonicalText('ISTANBUL Iron'), 'istanbul iron');
  const hash = fs.readFileSync('hash.js', 'utf8');
  assert.doesNotMatch(hash, /\.toLocaleLowerCase\(/);
  assert.doesNotMatch(fs.readFileSync('source-firewall.js', 'utf8'), /\.toLocaleLowerCase\(/);
  // The Places modules bound text with the shared idempotent helper.
  for (const file of ['spatial-core.js', 'spatial-base-map.js']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /^function boundedText\(/m);
  }
});

test('review hardening: a rename carries real cached continuity, and a damaged sidecar renames without an error', () => {
  // A sidecar briefly unreachable leaves the cache holding the chat's continuity: it moves to the new name.
  const cached = scenario('rename-cached');
  assert.equal(cached.required, true);
  assert.equal(cached.savedRecords, 1);
  assert.equal(cached.cachedRecords, 1);
  // A damaged sidecar is reported rather than thrown, so the rename keeps the chat recovery-required.
  const corrupt = scenario('rename-corrupt');
  assert.deepEqual(corrupt, { before: true, newSidecars: 0, newRequired: true, errors: [] });
});

test('review hardening: a capture that throws after a chat switch is a missed capture', () => {
  const handler = source.slice(source.indexOf('async function handleAssistantMessage('), source.indexOf('function recordAbandonedCapture('));
  assert.match(handler, /if \(!captureStarted\) \{\s*if \(currentChatKey\(\) !== chatKey\) recordAbandonedCapture\(chatKey, messageId, prefix, startFingerprint\);\s*else recordCaptureStartFailure\(chatKey, messageId, startFingerprint, error\);/);
});

test('review hardening: a kept clearing row never takes a stored answer from a failure', () => {
  const answer = { responseJson: '{"mutations":[]}' };
  const list = [{ ...failure(1, 1), ...answer }, { ...failure(2, 2), ...answer },
    ...Array.from({ length: 6 }, (_, i) => ({ label: 'branch', at: 10 + i, outcome: 'same' })),
    { label: 'capture', at: 50, sourceMessageId: 1, lineageKey: 'ln-1', outcome: 'applied', ...answer }];
  const trimmed = trimOperationRows(list, 3);
  // Message 1's failure was recovered, so it may go; its clearing row stays, and message 2's failure keeps its answer.
  assert.equal(trimmed.find(row => row.sourceMessageId === 2 && row.outcome === 'invalid-response').responseJson, answer.responseJson);
  assert.equal(trimmed.find(row => row.outcome === 'applied').responseJson, answer.responseJson);
});

test('review hardening: a recorded damaged path in another spelling can still be replaced; saves copy no rows', async () => {
  const path = '/user/files/world-state-alpha-damaged.json';
  const files = new Map([[path, '{"broken":']]);
  const fetchFn = async (url, options = {}) => {
    if (options.method === 'GET') return files.has(url) ? { ok: true, status: 200, text: async () => files.get(url) } : { ok: false, status: 404, text: async () => '' };
    const payload = JSON.parse(options.body);
    files.set('/user/files/' + payload.name, Buffer.from(payload.data, 'base64').toString('utf8'));
    return { ok: true, status: 200, json: async () => ({ path: '/user/files/' + payload.name }) };
  };
  const adapter = createSillyTavernWorldStateStorageAdapter({ fetchFn });
  const written = await adapter.write({ path, expectedRevision: 0, body: sidecar('chat:a:x', 1), replaceCorrupt: 'user/files/world-state-alpha-damaged.json' });
  assert.equal(written.revision, 1);
  const saveStart = source.indexOf('async function saveOperationLogLocked(');
  const save = source.slice(saveStart, source.indexOf('\n}\n', saveStart));
  assert.doesNotMatch(save, /allRecords/);
  const store = createDiagnosticStore();
  store.record('chat:y', failure(3, 1));
  const rows = store.rowsSnapshot('chat:y');
  store.record('chat:y', failure(4, 2));
  assert.equal(rows.length, 1);
});
