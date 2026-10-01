// Audit batch 3 (Missed captures gaps): each case was reproduced against 0.9.0-alpha.43 first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { chatLineage, contentLineageKey } from '../branch.js';
import { runCaptureOperation } from '../capture.js';
import { affectsCaptureRecovery, createDiagnosticStore, unrecoveredCaptureFailures } from '../diagnostics.js';
import { createSillyTavernWorldStateStorageAdapter } from '../host-storage.js';
import { createState } from '../state-core.js';

const chat = () => [
  { name: 'Sera', is_user: false, is_system: false, mes: 'Greeting.' },
  { name: 'You', is_user: true, is_system: false, mes: 'Go to the mill.' },
  { name: 'Sera', is_user: false, is_system: false, mes: 'The mill burns.' },
  { name: 'You', is_user: true, is_system: false, mes: 'Go to the bridge.' },
  { name: 'Sera', is_user: false, is_system: false, mes: 'The bridge falls.' },
];

test('a capture abandoned by a chat switch is a missed capture; one whose message was replaced settles that attempt only', () => {
  let at = 0;
  const row = (outcome, operationId, lineageKey = 'lnA') => ({ label: 'capture', outcome, sourceMessageId: 4, operationId, lineageKey, at: ++at });
  const ids = rows => unrecoveredCaptureFailures(rows).map(item => item.messageId);

  // Before: 'stale' counted as never attempted, so the reply was silently lost.
  assert.deepEqual(ids([row('stale', 'capture:4:1:1')]), [4]);
  assert.equal(affectsCaptureRecovery(row('stale', 'capture:4:1:1')), true);
  // The host settles an attempt whose own message was swiped, edited or deleted.
  assert.deepEqual(ids([row('stale', 'capture:4:1:1'), row('superseded', 'capture:4:1:1')]), []);
  assert.deepEqual(ids([row('failure', 'capture:4:1:1'), row('superseded', 'capture:4:1:1')]), []);
  // ...that attempt only: an earlier failure of the same version (swiped away and back) stays missed.
  assert.deepEqual(ids([row('timeout', 'capture:4:1:1'), row('stale', 'capture:4:3:2'), row('superseded', 'capture:4:3:2')]), [4]);
  assert.deepEqual(ids([row('stale', 'capture:4:1:1'), row('superseded', 'capture:4:9:9', 'lnB')]), [4]);
  // A capture that was dropped or undone after its 'applied' row stays missed.
  assert.deepEqual(ids([row('applied', 'capture:4:1:1'), row('not-saved', 'capture:4:unsaved:1')]), [4]);
  // 'skipped' (capture not due) is still not a failure, nor is a legacy stale row without lineage.
  assert.deepEqual(ids([row('skipped', 'capture:4:1:1')]), []);
  assert.deepEqual(ids([row('stale', 'capture:4:1:1', '')]), []);
});

test('hiding or unhiding an earlier message keeps a missed capture matched and clearable', () => {
  const messages = chat();
  const key = contentLineageKey(messages, 4);
  const lineageKey = chatLineage(messages)[4].lineageKey;
  assert.ok(key && key !== lineageKey);
  assert.equal(contentLineageKey(messages, 9), '');

  const hidden = messages.map((message, index) => index === 1 ? { ...message, is_system: true } : message);
  assert.notEqual(chatLineage(hidden)[4].lineageKey, lineageKey);
  assert.equal(contentLineageKey(hidden, 4), key);
  // Hiding the failed message itself does not change it either; an edit or swipe does.
  assert.equal(contentLineageKey(hidden.map((message, index) => index === 4 ? { ...message, is_system: true } : message), 4), key);
  assert.notEqual(contentLineageKey(messages.map((message, index) => index === 3 ? { ...message, mes: 'Go to the harbor.' } : message), 4), key);
  assert.notEqual(contentLineageKey(messages.map((message, index) => index === 4 ? { ...message, mes: 'The bridge holds.' } : message), 4), key);

  let at = 0;
  const row = (outcome, lineage, content = key) => ({ label: 'capture', outcome, sourceMessageId: 4, lineageKey: lineage, contentLineageKey: content, at: ++at });
  const hiddenLineageKey = chatLineage(hidden)[4].lineageKey;
  // The failure carries its hide-insensitive key, so the host can still match it after the hide.
  assert.deepEqual(unrecoveredCaptureFailures([row('failure', lineageKey)]), [{ messageId: 4, lineageKey, contentLineageKey: key }]);
  // A later success of the same story message under the new lineage clears it...
  assert.deepEqual(unrecoveredCaptureFailures([row('failure', lineageKey), row('applied', hiddenLineageKey)]), []);
  // ...a success of another version (different content) does not...
  assert.equal(unrecoveredCaptureFailures([row('failure', lineageKey), row('applied', 'lnOther', 'clOther')]).length, 1);
  // ...and a repeat failure of the same story message replaces the older row instead of listing it twice.
  const repeated = unrecoveredCaptureFailures([row('failure', lineageKey), row('timeout', hiddenLineageKey)]);
  assert.deepEqual(repeated, [{ messageId: 4, lineageKey: hiddenLineageKey, contentLineageKey: key }]);
});

test('capture rows carry the hide-insensitive key, including a capture abandoned before its request', async () => {
  const store = createDiagnosticStore();
  const lineage = chatLineage(chat());
  const exchange = chat().slice(3).map((message, index) => ({ ...message, messageId: index + 3, lineageKey: lineage[index + 3].lineageKey }));
  const asked = [];
  const result = await runCaptureOperation({
    ctx: { extensionSettings: { world_state_alpha: {}, disabledExtensions: [] }, async generateRaw() { throw new Error('not sent'); } },
    state: createState('b3'),
    exchange,
    chatKey: 'b3',
    sourceMessageId: 4,
    sourceLineageKey: lineage[4].lineageKey,
    sourceContentLineageKey: outcome => {
      asked.push(outcome);
      return 'cl_4';
    },
    isCurrent: () => false,
    diagnostics: store,
  });
  assert.equal(result.outcome, 'stale');
  // Before: a capture abandoned before its request left no row at all.
  const rows = store.records('b3');
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].outcome, rows[0].sourceMessageId, rows[0].lineageKey, rows[0].contentLineageKey], ['stale', 4, lineage[4].lineageKey, 'cl_4']);
  assert.deepEqual(asked, ['stale']);
  assert.deepEqual(unrecoveredCaptureFailures(store.recoveryRows('b3')).map(item => item.contentLineageKey), ['cl_4']);

  // A getter that throws never breaks the capture: the row just has no key.
  const quiet = createDiagnosticStore();
  await runCaptureOperation({
    ctx: { extensionSettings: { world_state_alpha: {}, disabledExtensions: [] }, async generateRaw() { return '{"mutations":[]}'; } },
    state: createState('b3'),
    exchange,
    chatKey: 'b3',
    sourceMessageId: 4,
    sourceLineageKey: lineage[4].lineageKey,
    sourceContentLineageKey: () => { throw new Error('boom'); },
    isCurrent: () => true,
    diagnostics: quiet,
  });
  assert.deepEqual(quiet.records('b3').map(item => [item.outcome, item.contentLineageKey]), [['no-change', '']]);
});

test('an unreadable Operations log is never treated as empty; only a missing or corrupt one is', async () => {
  const respond = (status, body = '') => async () => ({ status, ok: status >= 200 && status < 300, text: async () => body });
  const read = fetchFn => createSillyTavernWorldStateStorageAdapter({ fetchFn }).fetchJsonFile('/user/files/world-state-alpha-ops-x.json');
  assert.equal(await read(respond(404)), null);
  await assert.rejects(read(respond(200, '{broken')), error => error.code === 'WORLD_STATE_JSON_INVALID');
  await assert.rejects(read(respond(503)), error => error.code !== 'WORLD_STATE_JSON_INVALID');
  await assert.rejects(read(async () => { throw new TypeError('Failed to fetch'); }), error => error.code !== 'WORLD_STATE_JSON_INVALID');

  const source = fs.readFileSync('index.js', 'utf8');
  const save = source.slice(source.indexOf('function saveOperationLog('), source.indexOf('function scheduleOperationLogSave('));
  // Before: `readOperationLog(chatKey).catch(() => [])` then upload of this session's rows alone.
  assert.doesNotMatch(save, /\.catch\(\(\) => \[\]\)/);
  assert.match(save, /server = await readOperationLogForMerge\(chatKey\);\s*\} catch \(error\) \{[\s\S]*?return;\s*\}/);
  assert.match(source, /async function readOperationLogForMerge\(chatKey\) \{[\s\S]*?if \(error\?\.code === 'WORLD_STATE_JSON_INVALID'\) return \[\];\s*throw error;/);
  const retire = source.slice(source.indexOf('function retireOperationLog('), source.indexOf('function notify('));
  assert.doesNotMatch(retire, /\.catch\(\(\) => \[\]\)/);
  // An unread rename is retried and never cleared.
  assert.match(retire, /if \(server === null\) \{[\s\S]*?retireOperationLog\(chatKey, successorKey, attempt \+ 1\)[\s\S]*?return;\s*\}\s*\}\s*await hostStorage\.uploadJsonFile\(operationLogFile\(chatKey\), operationLogBody\(chatKey, \[\]\)\);/);
  // A postponed save is a pending timer the flush on leave/hide sees; a snapshot that never saves is parked.
  assert.match(save, /operationLogTimers\.set\(chatKey, setTimeout\(\(\) => \{\s*operationLogTimers\.delete\(chatKey\);\s*void saveOperationLog\(chatKey, null, attempt \+ 1\);/);
  assert.match(save, /unsavedOperationRows\.set\(chatKey, mergeOperationRows\(/);
  assert.match(source, /function restoreUnsavedOperationRows\(chatKey\) \{[\s\S]*?diagnosticStore\.merge\(chatKey, parked\);/);
  // A failed load is retried later instead of being remembered as loaded, without dropping a newer load.
  assert.match(source, /if \(operationLogLoads\.get\(chatKey\) === load\) operationLogLoads\.delete\(chatKey\);/);
});

test('the live capture handler records captures the chat switch or a mid-save switch threw away', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const handler = source.slice(source.indexOf('async function handleAssistantMessage('), source.indexOf('async function handleUserMessage('));
  assert.match(handler, /sourceContentLineageKey,\s*route: routeSettings\(\),/);
  // Before: a save undone by compensation (stale, no conflict) recorded nothing after its 'applied' row.
  assert.match(handler, /\} else if \(persisted\.stale\) \{[\s\S]*?recordAbandoned\(/);
  assert.match(handler, /if \(!isCurrent\(\)\) \{\s*if \(result\.outcome === 'applied'\) recordAbandoned\(/);
  assert.match(handler, /result\.outcome !== 'applied' && result\.outcome !== 'no-change' && messageSuperseded\(\)/);
  // The hide-insensitive key is only hashed for rows that can list or clear a failure.
  assert.match(handler, /if \(settled && operationLogsHydrated\.has\(chatKey\) && !unrecoveredCaptureFailures\(diagnosticStore\.recoveryRows\(chatKey\)\)[\s\S]{0,80}\.some\(failure => failure\.messageId === messageId\)\) return '';/);
  // Keyed from the messages and fingerprints as they were when the capture began.
  assert.match(handler, /contentLineageKey\(captureMessages, messageId, captureLineage\)/);
  // A superseded row settles only its own attempt.
  assert.match(handler, /outcome: 'superseded',[\s\S]{0,200}operationId: captureOperationId,|operationId: captureOperationId,[\s\S]{0,200}outcome: 'superseded',/);
  const pending = source.slice(source.indexOf('function pendingCaptureFailures('), source.indexOf('function capturesFailedBefore('));
  assert.match(pending, /currentContentLineageKeys\(chat, lineage, needKeys\)/);
  assert.match(pending, /hiddenConversationRole\(chat\[messageId\]\) === 'assistant'/);
});

test('Recapture after hiding an earlier message proves its prefix with a full reconcile', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  // Before: the tail-only fast path missed the hide, so the partial rebuild refused its own prefix.
  assert.match(source, /if \(startMessageId > 0\) \{\s*(?:\/\/[^\n]*\n\s*)*const branch = await reconcileCurrentBranch\(chatKey, \{ persistRestore: true \}\);/);
});

test('review hardening: keys are verified against the capture-start lineage; settling one attempt never exposes a trimmed failure', async () => {
  const { trimOperationRows } = await import('../diagnostics.js');
  const messages = chat();
  const lineage = chatLineage(messages);
  const key = contentLineageKey(messages, 4, lineage);
  assert.equal(key, contentLineageKey(messages, 4));
  // Hiding is still tolerated against the recorded fingerprints...
  assert.equal(contentLineageKey(messages.map((message, index) => index === 1 ? { ...message, is_system: true } : message), 4, lineage), key);
  // ...but an earlier message edited in place since then yields no key instead of the edited chat's.
  assert.equal(contentLineageKey(messages.map((message, index) => index === 3 ? { ...message, mes: 'Go to the harbor.' } : message), 4, lineage), '');

  // An earlier failure of a version stays pinned while a later attempt of it is open, then settled.
  let at = 0;
  const failure = { label: 'capture', outcome: 'timeout', sourceMessageId: 4, operationId: 'capture:4:1:1', lineageKey: 'lnA', at: ++at };
  const rows = [failure, { label: 'capture', outcome: 'stale', sourceMessageId: 4, operationId: 'capture:4:2:2', lineageKey: 'lnA', at: ++at }];
  for (let id = 0; id < 30; id += 1) rows.push({ label: 'rebuild', outcome: 'applied', sourceMessageId: 100 + id, operationId: 'rebuild:200:1:100:' + id, at: ++at });
  const trimmed = trimOperationRows(rows, 6);
  assert.ok(trimmed.includes(failure));
  const settled = [...trimmed, { label: 'capture', outcome: 'superseded', sourceMessageId: 4, operationId: 'capture:4:2:2', lineageKey: 'lnA', at: ++at }];
  assert.deepEqual(unrecoveredCaptureFailures(settled).map(item => item.messageId), [4]);
});
