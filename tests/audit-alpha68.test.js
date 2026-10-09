// alpha.68: Astra Pro audit on ec4973c, findings A11, A12, A13 and A15 (bounded storage, polarity and
// endings, evolution attribution, causal missed-capture recovery).
import test from 'node:test';
import assert from 'node:assert/strict';

import { chatLineage } from '../branch.js';
import { createDiagnosticStore, mergeOperationRows, unrecoveredCaptureFailures } from '../diagnostics.js';
import { runLazyEvolution } from '../evolution.js';
import { createSillyTavernWorldStateStorageAdapter } from '../host-storage.js';
import { applyCaptureSourceFirewall, claimContradictsStatement, claimStatesContinuation } from '../source-firewall.js';
import { createState, reduceMutations } from '../state-core.js';
import { encodeSidecar } from '../storage.js';
import { withoutWebLocks } from './web-locks.mjs';

const never = () => new Promise(() => {});

test('A11: a storage request that never settles fails within its deadline and releases the writer lock', async () => {
  let calls = 0;
  const hung = createSillyTavernWorldStateStorageAdapter({
    fetchFn: async () => { calls += 1; return never(); },
    deadlines: { readMs: 30, uploadMs: 30 },
  });
  await assert.rejects(hung.read('/user/files/world-state-alpha-a.json'), error => error.code === 'WORLD_STATE_STORAGE_TIMEOUT' && error.retryable === true);
  // A body read that never settles is bounded too.
  const hungBody = createSillyTavernWorldStateStorageAdapter({
    fetchFn: async () => ({ ok: true, status: 200, text: never }),
    deadlines: { readMs: 30, uploadMs: 30 },
  });
  await assert.rejects(hungBody.read('/user/files/world-state-alpha-a.json'), error => error.code === 'WORLD_STATE_STORAGE_TIMEOUT');

  // A hung first write does not hold the next write to the same file forever.
  const body = encodeSidecar({ chatKey: 'chat:a', state: createState('chat:a'), revision: 1 });
  let uploads = 0;
  const flaky = createSillyTavernWorldStateStorageAdapter({
    fetchFn: async (url, init) => {
      if (init?.method === 'GET') return { ok: false, status: 404 };
      uploads += 1;
      if (uploads === 1) return never();
      return { ok: true, status: 200, json: async () => ({ path: '/user/files/world-state-alpha-a.json' }) };
    },
    deadlines: { readMs: 30, uploadMs: 30 },
  });
  await withoutWebLocks(async () => {
    const first = flaky.write({ path: 'world_state_alpha/a.json', expectedRevision: 0, body });
    await assert.rejects(first, error => error.code === 'WORLD_STATE_STORAGE_TIMEOUT' && error.outcomeUnknown === true);
    const second = await flaky.write({ path: 'world_state_alpha/a.json', expectedRevision: 0, body });
    assert.equal(second.revision, 1);
  });
  assert.ok(calls >= 1);
});

const firewallState = () => reduceMutations(createState('a68'), {
  chatKey: 'a68', messageId: 0, lineageKey: 'l0', operation: 'capture',
  mutations: [{ action: 'create', kind: 'development', summary: 'The garrison occupies Northbridge', anchors: ['Northbridge'], evidence: [{ sourceMessageId: 0, claim: 'The garrison occupies Northbridge' }] }],
}).state;
const exchange = text => [{ messageId: 1, role: 'assistant', content: text, lineageKey: 'l1' }];

test('A12: a summary its cited clause negates, or an ending its claim says continues, is refused', () => {
  const state = firewallState();
  const created = applyCaptureSourceFirewall({
    action: 'create', kind: 'fact', summary: 'Northbridge has collapsed',
    evidence: [{ sourceMessageId: 1, claim: 'Northbridge has not collapsed' }],
  }, { exchange: exchange('Northbridge has not collapsed, though its stones groan.'), visibleRecords: state.records, state });
  assert.equal(created.ok, false);
  assert.match(created.reason, /opposite/);

  const record = state.records[0];
  const resolved = applyCaptureSourceFirewall({
    action: 'resolve', recordId: record.id, summary: 'The garrison no longer occupies Northbridge',
    evidence: [{ sourceMessageId: 1, claim: 'The garrison still occupies Northbridge' }],
  }, { exchange: exchange('The garrison still occupies Northbridge.'), visibleRecords: state.records, state });
  assert.equal(resolved.ok, false);
  assert.match(resolved.reason, /continues/);

  // Grounded endings and paraphrases still pass.
  const ended = applyCaptureSourceFirewall({
    action: 'resolve', recordId: record.id, summary: 'The garrison has abandoned Northbridge',
    evidence: [{ sourceMessageId: 1, claim: 'The garrison abandoned Northbridge at dawn' }],
  }, { exchange: exchange('The garrison abandoned Northbridge at dawn.'), visibleRecords: state.records, state });
  assert.equal(ended.ok, true);
  assert.equal(claimContradictsStatement('The bridge is no longer guarded', 'The guards left the bridge'), false);
  assert.equal(claimContradictsStatement('Bandits hold the pass', 'The bandits did not retreat; they hold the pass'), false);
  assert.equal(claimStatesContinuation('The garrison occupies Northbridge', 'The garrison no longer occupies Northbridge'), false);
});

async function evolve(definitions, evaluations) {
  const chat = [{ role: 'assistant', content: 'The established developments are described here.' }];
  const lineage = chatLineage(chat);
  const seeded = reduceMutations(createState('a68-evo'), {
    chatKey: 'a68-evo', messageId: 0, lineageKey: lineage[0].lineageKey,
    mutations: definitions.map(item => ({ action: 'create', kind: 'development', summary: item.summary, trend: 'stable', anchors: item.anchors, evidence: [{ sourceMessageId: 0, lineageKey: lineage[0].lineageKey, sourceClass: 'assistant_narration', claim: item.claim }] })),
  }).state;
  const fullChat = [...chat, { role: 'user', content: 'Five weeks later, I return to the border.' }];
  const fullLineage = chatLineage(fullChat);
  const messages = fullChat.map((message, messageId) => ({ ...message, messageId, lineageKey: fullLineage[messageId].lineageKey }));
  const response = JSON.stringify({ evaluations: evaluations(seeded.records), derived: [] });
  return runLazyEvolution({
    ctx: { extensionSettings: { world_state_alpha: {}, disabledExtensions: [] }, async generateRaw() { return response; } },
    state: seeded,
    selectedEntries: seeded.records.map(record => ({ record, score: 10, source: 'seed', reasons: ['recent-anchor'] })),
    exchange: messages,
    chatKey: 'a68-evo',
    isCurrent: () => true,
    sourceMessageId: 1,
    sourceLineageKey: fullLineage[1].lineageKey,
  });
}

test('A13: evolution keeps a rumour a rumour and ends nothing established on reported support alone', async () => {
  const rumour = await evolve(
    [{ summary: 'Merchants report that the border fort has fallen.', anchors: ['border fort'], claim: 'Merchants report that the border fort has fallen.' }],
    ([record]) => [{ recordId: record.id, outcome: 'update', summary: 'The border fort has fallen.', reason: 'Time passed.', supportIds: ['t0', 'h0'] }],
  );
  assert.equal(rumour.outcome, 'invalid-response');
  assert.match(rumour.errorMessage, /reported account/);

  const ended = await evolve(
    [{ summary: 'The border fort is held by the king.', anchors: ['border fort'], claim: 'Merchants report that the border fort will fall soon.' }],
    ([record]) => [{ recordId: record.id, outcome: 'resolve', summary: 'The border fort has fallen.', reason: 'Time passed.', supportIds: ['t0', 'h0'] }],
  );
  assert.equal(ended.outcome, 'invalid-response');
  assert.match(ended.errorMessage, /reported or planned support/);

  // A rumour that keeps its reporting status may still evolve.
  const kept = await evolve(
    [{ summary: 'Merchants report that the border fort has fallen.', anchors: ['border fort'], claim: 'Merchants report that the border fort has fallen.' }],
    ([record]) => [{ recordId: record.id, outcome: 'update', summary: 'Merchants still report that the border fort has fallen.', reason: 'Time passed.', supportIds: ['t0', 'h0'] }],
  );
  assert.notEqual(kept.outcome, 'invalid-response');
});

const failure = (messageId, at, extra = {}) => ({ label: 'capture', at, sourceMessageId: messageId, lineageKey: 'ln-' + messageId, contentLineageKey: 'c-' + messageId, outcome: 'invalid-response', operationId: 'capture:' + messageId + ':' + at, ...extra });

test('A15: missed-capture recovery follows which failures a recovery saw, not device clocks', () => {
  // Device A's clock runs ahead: its failure is stamped 200. Device B saw it and recaptured, stamped 100.
  const deviceA = createDiagnosticStore({ session: 'device-a', now: () => 200 });
  deviceA.record('chat:x', failure(4, 200));
  const deviceB = createDiagnosticStore({ session: 'device-b', now: () => 100 });
  deviceB.merge('chat:x', deviceA.allRecords('chat:x'));
  deviceB.record('chat:x', { label: 'capture', sourceMessageId: 4, lineageKey: 'ln-4', contentLineageKey: 'c-4', outcome: 'applied', operationId: 'capture:4:b' });
  const merged = mergeOperationRows(deviceA.allRecords('chat:x'), deviceB.allRecords('chat:x'));
  assert.deepEqual(unrecoveredCaptureFailures(merged), []);

  // Device C's clock runs ahead: an old success stamped 300 never saw device A's later failure (stamped 250).
  const deviceC = createDiagnosticStore({ session: 'device-c', now: () => 300 });
  deviceC.record('chat:y', { label: 'capture', sourceMessageId: 6, lineageKey: 'ln-6', contentLineageKey: 'c-6', outcome: 'applied', operationId: 'capture:6:c' });
  const later = createDiagnosticStore({ session: 'device-a', now: () => 250 });
  later.record('chat:y', failure(6, 250));
  const both = mergeOperationRows(deviceC.allRecords('chat:y'), later.allRecords('chat:y'));
  assert.deepEqual(unrecoveredCaptureFailures(both).map(item => item.messageId), [6]);

  // Rows from before sessions were recorded keep the time-ordered rule.
  assert.deepEqual(unrecoveredCaptureFailures([
    { ...failure(2, 10), operationId: '' },
    { label: 'capture', at: 20, sourceMessageId: 2, lineageKey: 'ln-2', outcome: 'applied' },
  ]), []);
});
