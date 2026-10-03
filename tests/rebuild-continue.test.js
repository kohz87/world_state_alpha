// A rebuild survives messages appended after its range, and the panel re-reads the saved Operations log.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('index.js', 'utf8');

test('a manual rebuild is stale only when its own range changes, not when the operator keeps playing', () => {
  // Before: the whole live chat lineage had to equal the start lineage, so any new message cancelled the
  // rebuild and its missed captures stayed listed although later live captures succeeded.
  const rebuild = source.slice(source.indexOf('async function applyMaintenanceActionNow('), source.indexOf('async function applyRecordAction('));
  assert.doesNotMatch(rebuild, /stableStringify\(chatLineage\(getContext\(\)\.chat \|\| \[\]\)\) === startLineage/);
  assert.match(source, /const startTailKey = startLineage\.length \? startLineage\[startLineage\.length - 1\]\.lineageKey : '';/);
  assert.match(source, /const rangeCurrent = exact => \{\s*if \(currentChatKey\(\) !== chatKey \|\| \(operationInvalidations\.get\(chatKey\) \|\| 0\) !== startInvalidations\) return false;\s*if \(stateCache\.get\(chatKey\) !== startState\) return false;\s*const liveChat = getContext\(\)\.chat \|\| \[\];\s*if \(liveChat\.length < startLineage\.length\) return false;[\s\S]{0,400}rangeProof = \{ at: now, events, current: !startTailKey \|\| live\[startLineage\.length - 1\]\?\.lineageKey === startTailKey \};/);
  // Branch events after the range neither cancel its provider calls nor end it; it reads a frozen copy of the chat.
  assert.match(source, /cancelWorldStateRequests\(\{ chatKey, exceptOperationIdPrefix: 'rebuild:' \}\);/);
  assert.match(rebuild, /const chat = Number\.isInteger\(pendingResume\?\.params\?\.chatLength\)\s*\? liveAtStart\.slice\(0, pendingResume\.params\.chatLength\)\s*: liveAtStart\.slice\(\);/);
  assert.match(rebuild, /chatLength: chat\.length,/);
});

test('opening the panel merges the saved Operations log again, so another device\'s recovery clears the notice', () => {
  // Before: the log was read once per chat activation, so a rebuild on another device left the notice up.
  assert.match(source, /await refreshChatStateFromServer\(chatKey, \{ reason: 'panel-open' \}\);\s*void refreshOperationLogFromServer\(chatKey\);/);
  assert.match(source, /async function refreshOperationLogFromServer\(chatKey\) \{[\s\S]*?const rows = await readOperationLog\(chatKey\);[\s\S]*?diagnosticStore\.merge\(chatKey, rows\);/);
});
