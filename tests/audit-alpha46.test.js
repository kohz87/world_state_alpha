// alpha.46: external audit A09-A12 (Missed captures recovery path, parked branch after a hide), each
// reproduced against 0.9.0-alpha.45 first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { chatLineage, commitMutationBoundary, parkAbandonedBranch, reconcileBranch, relinkParkedBranches, resumeParkedBranch, seedRootCheckpoint } from '../branch.js';
import { trimOperationRows, unrecoveredCaptureFailures } from '../diagnostics.js';
import { createState, reduceMutations } from '../state-core.js';

const source = fs.readFileSync('index.js', 'utf8');

test('A09/A10: a rename clears the old log only after the new owner saved it; a failed upload is retried and never lost', () => {
  const retire = source.slice(source.indexOf('function retireOperationLog('), source.indexOf('function notify('));
  // Before: the successor save was only scheduled and the old log was emptied right away.
  assert.doesNotMatch(retire, /scheduleOperationLogSave\(successorKey\)/);
  assert.match(retire, /const target = liveOperationLogKey\(successorKey\);[\s\S]*?if \(!await saveOperationLog\(target\)\) \{\s*retry\(\);\s*return;\s*\}/);
  // The old log's lock is released before the new log is saved (opposite renames cannot deadlock).
  assert.match(retire, /const server = await queueOperationLogWrite\(chatKey, \(\) => readOperationLogForMerge\(chatKey\)/);
  assert.match(retire, /operationLogSuccessors\.set\(chatKey, successorKey\);[\s\S]{0,120}retiredOperationLogs\.delete\(successorKey\);/);
  const save = source.slice(source.indexOf('async function saveOperationLogLocked('), source.indexOf('function scheduleOperationLogSave('));
  // Before: an upload error was only logged; the rows were not retried, flushed or parked.
  assert.match(save, /await hostStorage\.uploadJsonFile\(operationLogFile\(chatKey\), operationLogBody\(chatKey, rows\)\);\s*\} catch \(error\) \{[\s\S]*?postponeOperationLogSave\(chatKey, snapshot, attempt\);\s*return false;/);
  assert.match(save, /if \(!snapshot\) unsavedOperationRows\.delete\(chatKey\);\s*return true;/);
  const postpone = source.slice(source.indexOf('function postponeOperationLogSave('), source.indexOf('function saveOperationLog('));
  // Out of retries, even a cached chat's rows are parked so a later eviction cannot drop them.
  assert.match(postpone, /if \(attempt >= OPERATION_LOG_SAVE_RETRIES\) \{\s*const rows = snapshot \|\| diagnosticStore\.records\(chatKey\);/);
});

test('A11: trimming keeps every still-unrecovered capture failure, however many', () => {
  let at = 0;
  const rows = [];
  for (let id = 1; id <= 41; id += 1) {
    rows.push({ label: 'capture', outcome: 'invalid-response', sourceMessageId: id * 2, lineageKey: 'ln' + id, operationId: 'capture:' + id, at: ++at, responseJson: '{"bad":' });
  }
  for (let id = 0; id < 40; id += 1) rows.push({ label: 'lazy-evolution', outcome: 'evolved', sourceMessageId: 200 + id, at: ++at });
  const trimmed = trimOperationRows(rows, 80);
  // Before: only the newest 40 failures were pinned, so message 2 vanished without any recovery.
  assert.equal(unrecoveredCaptureFailures(trimmed).length, 41);
  assert.equal(unrecoveredCaptureFailures(trimmed)[0].messageId, 2);
  assert.equal(trimmed.length, 80);
  // Older pinned rows shed their stored answer; the newest keep it.
  assert.equal(trimmed.find(row => row.sourceMessageId === 2).responseJson, '');
  assert.equal(trimmed.find(row => row.sourceMessageId === 82).responseJson, '{"bad":');
});

function capture(state, chat, messageId, summary) {
  const lineage = chatLineage(chat.slice(0, messageId + 1));
  const reduced = reduceMutations(state, {
    chatKey: state.chatKey, messageId, lineageKey: lineage[messageId].lineageKey,
    mutations: [{ action: 'create', kind: 'fact', summary, anchors: [summary.split(' ')[1]], evidence: [{ sourceMessageId: messageId, claim: chat[messageId].mes }] }],
  }).state;
  reduced.lastCaptureMessage = messageId;
  return commitMutationBoundary(state, reduced, chat.slice(0, messageId + 1), messageId, 'capture', { lineage });
}

test('A12: hiding an earlier message keeps a parked swipe resumable', () => {
  const chatA = [
    { name: 'You', is_user: true, is_system: false, mes: 'I climb the hill.' },
    { name: 'Sera', is_user: false, is_system: false, mes: 'The Watchtower stands.' },
    { name: 'You', is_user: true, is_system: false, mes: 'I look inside.' },
    { name: 'Sera', is_user: false, is_system: false, mes: 'The Armory is full.' },
  ];
  let state = seedRootCheckpoint(createState('a12'));
  state = reconcileBranch(state, chatA.slice(0, 2)).state;
  state = capture(state, chatA, 1, 'The Watchtower stands');
  state = reconcileBranch(state, chatA).state;
  state = capture(state, chatA, 3, 'The Armory is full');

  // Swipe reply 3 to B: A is parked.
  const chatB = chatA.map((message, index) => index === 3 ? { ...message, mes: 'The Armory is empty.' } : message);
  const toB = reconcileBranch(state, chatB);
  const park = parkAbandonedBranch(state, toB);
  assert.ok(park);
  let onB = capture(toB.state, chatB, 3, 'The Armory is empty');

  // Hide the first user row while on B: a visibility-only rebase of the shared prefix.
  const hide = chat => chat.map((message, index) => index === 0 ? { ...message, is_system: true } : message);
  const hidden = reconcileBranch(onB, hide(chatB));
  assert.equal(hidden.action, 'semantic-lineage-rebase');
  const parks = relinkParkedBranches([park], onB.lineage, hidden.state.lineage, Math.min(onB.lineage.length, hidden.state.lineage.length));
  onB = hidden.state;

  // Swipe back to the identical reply A.
  const backToA = reconcileBranch(onB, hide(chatA));
  assert.equal(backToA.failClosed, false);
  // Before: the park still pointed at the pre-hide lineage keys, so A never resumed.
  assert.equal(resumeParkedBranch(backToA.state, hide(chatA), [park]), null);
  const resumed = resumeParkedBranch(backToA.state, hide(chatA), parks);
  assert.ok(resumed);
  assert.deepEqual(resumed.state.records.map(record => record.summary).sort(), ['The Armory is full', 'The Watchtower stands']);
  // The host relinks parks after any proven prefix rebase.
  assert.match(source, /if \(provenPrefix > 0 && parks\.length\) parks = relinkParkedBranches\(parks, state\.lineage, result\.state\.lineage, provenPrefix\);[\s\S]{0,800}const resumed = resumeParkedBranch\(result\.state, liveChat, parks\);/);
});

test('review hardening: pinned failures are bounded to the earliest ones; a park still resumes when hide and swipe-back reconcile together', () => {
  // A pathological flood keeps the earliest failed messages (Recapture starts there), bounded.
  let at = 0;
  const flood = [];
  for (let id = 1; id <= 450; id += 1) flood.push({ label: 'capture', outcome: 'timeout', sourceMessageId: id, lineageKey: 'ln' + id, operationId: 'c' + id, at: ++at });
  const kept = trimOperationRows(flood, 80);
  assert.equal(kept.length, 400);
  assert.equal(unrecoveredCaptureFailures(kept)[0].messageId, 1);

  // The host relinks parks before trying to resume one, in the same reconcile.
  assert.ok(source.indexOf('parks = relinkParkedBranches(parks') < source.indexOf('const resumed = resumeParkedBranch(result.state, liveChat, parks);'));
  // An unexpected save error is retried, never an unhandled rejection.
  assert.match(source, /return await saveOperationLogLocked\(chatKey, snapshot, attempt\);\s*\} catch \(error\) \{[\s\S]{0,160}postponeOperationLogSave\(chatKey, snapshot, attempt\);/);
});
