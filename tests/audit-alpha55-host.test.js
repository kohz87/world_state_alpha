// alpha.55: host-lifecycle items from the alpha.54 deep pass, run against index.js in a mocked SillyTavern
// (tests/host). Each scenario runs in its own process and fails on 0.9.0-alpha.54.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function scenario(name) {
  const run = spawnSync(process.execPath, ['tests/host/' + name + '.mjs'], { encoding: 'utf8', timeout: 60000 });
  const line = String(run.stdout || '').split('\n').find(item => item.startsWith('@@RESULT '));
  assert.ok(line, name + ' produced no result:\n' + String(run.stderr || '').slice(-2000));
  return JSON.parse(line.slice('@@RESULT '.length));
}

test('1: a sidecar unreadable while the chat loads is adopted later, never overwritten by the empty cache', () => {
  const result = scenario('missing-sidecar');
  // Before: the empty cache was taken as current and revision 8 was written with 0 records.
  assert.equal(result.afterLoad, 0);
  assert.equal(result.cachedAfterRefresh, 3);
  assert.ok(result.serverRecords >= 3, JSON.stringify(result));
});

test('2: a capture waiting on the base map never overwrites a newer save hydrated meanwhile', () => {
  const result = scenario('race-capture-basemap');
  assert.equal(result.waited, true);
  // Before: the capture wrote revision 3 without the other device's record.
  assert.equal(result.otherRecordKept, true);
});

test('9: another device\'s state from a different branch is not injected before reconcile', () => {
  const result = scenario('divergent-refresh');
  assert.equal(result.injectedOtherBranch, false);
  assert.equal(result.dirtyAtGeneration, true);
});

test('10: a sidecar restarted at a lower revision is adopted after a write conflict', () => {
  const result = scenario('revision-restart');
  // Before: the lower revision was ignored, so this device's captures were dropped until a reload.
  assert.equal(result.afterConflict, 1);
  assert.equal(result.keptRecovered, true);
  assert.equal(result.serverRevision, 2);
  assert.equal(result.records, 2);
});

test('11: a corrupt sidecar can be replaced by an explicit reset', () => {
  const result = scenario('corrupt-sidecar');
  // Before: hydration failed for good, the panel and every recovery action were blocked.
  assert.equal(result.blocked, false);
  assert.equal(result.bootstrap, true);
  assert.equal(result.replacedWithValid, true);
});

test('49: after a Full rebuild recovers a fail-closed branch, the next generation is injected', () => {
  const result = scenario('dirty-after-rebuild');
  assert.equal(result.dirtyBefore, true);
  assert.equal(result.phase, 'completed');
  assert.equal(result.injectedAtGeneration, true);
});

test('50: a same-chat activation that only extends the chat does not cancel a running rebuild', () => {
  assert.equal(scenario('rebuild-activation').phase, 'completed');
});

test('3 and 8: Add place never overwrites a punctuation variant; typed coordinates are the operator\'s', () => {
  const result = scenario('places-actions');
  // Before: "Kings Rest" overwrote "Kings-Rest" (type landmark, lock lost).
  assert.deepEqual([result.innName, result.innType, result.innLocked, result.places], ['Kings-Rest', 'inn', true, 2]);
  // Before: saved as an unlocked 'unknown' coordinate that derivation could overwrite.
  assert.equal(result.millbrook.authority, 'manual');
});
