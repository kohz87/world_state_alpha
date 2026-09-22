import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  BUNDLE_VERSION,
  LIMITS,
  ROLLBACK_JOURNAL_VERSION,
  SCHEMA_VERSION,
  SIDECAR_FORMAT_VERSION,
} from '../constants.js';
import {
  buildRelevanceIndex,
  selectRelevantRecords,
  updateRelevanceIndex,
} from '../relevance.js';
import {
  applyUndoPatch,
  createState,
  normalizeState,
  reduceMutations,
} from '../state-core.js';
import { chatLineage, commitMutationBoundary, extendChatLineage, reconcileBranch } from '../branch.js';
import { buildReleasePackage } from '../scripts/package-design.mjs';

function record(id, summary, {
  kind = 'fact',
  status = 'active',
  trend = null,
  anchors = [],
  lastChangedMessage = null,
  causedBy = [],
  affects = [],
} = {}) {
  return {
    id,
    kind,
    summary,
    status,
    trend,
    anchors,
    createdAtMessage: 1,
    lastChangedMessage,
    lastEvaluatedMessage: lastChangedMessage,
    timeAnchor: '',
    evidenceIds: [],
    causedBy,
    affects,
  };
}

test('Phase 8 application version is 0.8.0-alpha.1 while schema versions remain 1', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
  const index = fs.readFileSync('index.js', 'utf8');

  assert.ok(pkg.version === '0.8.0-alpha.1' || pkg.version === '0.9.0-alpha.1');
  assert.ok(manifest.version === '0.8.0-alpha.1' || manifest.version === '0.9.0-alpha.1');
  assert.match(index, /WORLD_STATE_ALPHA_VERSION\s*=\s*'(0\.8\.0-alpha\.1|0\.9\.0-alpha\.1)'/);
  assert.ok(inventory.stage === 'phase8-release-hardening' || inventory.stage === 'phase9-spatial-continuity');

  assert.ok(SCHEMA_VERSION === 1 || SCHEMA_VERSION === 2);
  assert.equal(SIDECAR_FORMAT_VERSION, 1);
  assert.equal(BUNDLE_VERSION, 1);
  assert.equal(ROLLBACK_JOURNAL_VERSION, 1);
});

test('indexed relevance matches unindexed relevance on broad deterministic fixture', () => {
  const r1 = record('r1', 'Kesselpass freight traffic is congested by inspections.', {
    kind: 'development',
    trend: 'rising',
    anchors: ['Kesselpass', 'freight traffic'],
    lastChangedMessage: 90,
  });
  const r2 = record('r2', 'Southport fish prices remain elevated.', {
    anchors: ['Southport', 'fish prices'],
    lastChangedMessage: 50,
  });
  const r3 = record('r3', 'Hadrik inspectors delay freight caravans.', {
    kind: 'development',
    anchors: ['Hadrik', 'freight'],
    lastChangedMessage: 85,
  });
  const state = { records: [r1, r2, r3], links: [{ id: 'l1', from: 'r1', to: 'r3', type: 'related', sourceMessageId: 90 }] };

  const unindexed = selectRelevantRecords(state, {
    recentText: 'Lucien talks to the Hadrik inspectors at Kesselpass.',
    currentMessageId: 100,
    maxRecords: 6,
  });

  const index = buildRelevanceIndex(state);
  const indexed = selectRelevantRecords(state, {
    index,
    recentText: 'Lucien talks to the Hadrik inspectors at Kesselpass.',
    currentMessageId: 100,
    maxRecords: 6,
  });

  assert.equal(indexed.metrics.indexUsed, true);
  assert.equal(unindexed.metrics.indexUsed, false);
  assert.deepEqual(
    indexed.selected.map(item => ({ id: item.record.id, score: item.score })),
    unindexed.selected.map(item => ({ id: item.record.id, score: item.score })),
  );
});

test('1000-record rare-anchor fixture scores tiny bounded subset rather than full world', () => {
  const records = Array.from({ length: 1000 }, (_, i) => record(
    `wsr_bg_${i}`,
    `Background condition ${i} is operating normally.`,
    { anchors: [`bg-${i}`], lastChangedMessage: 1 },
  ));
  records[777] = record('wsr_target', 'Kesselpass freight gate is closed.', {
    kind: 'development',
    trend: 'rising',
    anchors: ['Kesselpass', 'freight gate'],
    lastChangedMessage: 900,
  });
  const state = { records, links: [] };
  const index = buildRelevanceIndex(state);

  const result = selectRelevantRecords(state, {
    index,
    recentText: 'They reach Kesselpass and see the freight gate.',
    currentMessageId: 1000,
  });

  assert.equal(result.metrics.indexUsed, true);
  assert.equal(result.metrics.corpusRecords, 1000);
  assert.ok(result.metrics.candidateRecords <= 8, `candidateRecords was ${result.metrics.candidateRecords}`);
  assert.ok(result.metrics.scoredRecords <= 8);
  assert.equal(result.selected[0]?.record?.id, 'wsr_target');
});

test('candidate cap saturation behavior is deterministic and exact anchors outrank common summary tokens', () => {
  const records = Array.from({ length: 500 }, (_, i) => record(
    `wsr_common_${i}`,
    `Standard common condition ${i} is active.`,
    { anchors: [`common-tag-${i}`], lastChangedMessage: i },
  ));
  records[123] = record('wsr_exact_anchor', 'Special anomaly in the North.', {
    anchors: ['Northglass Fortress'],
    lastChangedMessage: 10,
  });
  const state = { records, links: [] };
  const index = buildRelevanceIndex(state);

  const result1 = selectRelevantRecords(state, {
    index,
    recentText: 'Investigating standard condition near Northglass Fortress.',
    candidateCap: 64,
  });
  const result2 = selectRelevantRecords(state, {
    index,
    recentText: 'Investigating standard condition near Northglass Fortress.',
    candidateCap: 64,
  });

  assert.equal(result1.metrics.candidateRecords, 64);
  assert.equal(result2.metrics.candidateRecords, 64);
  assert.deepEqual(
    result1.selected.map(s => s.record.id),
    result2.selected.map(s => s.record.id),
  );
  assert.equal(result1.selected[0]?.record?.id, 'wsr_exact_anchor');
});

test('indexed candidate discovery has corpus-independent posting work bounds', () => {
  const records = Array.from({ length: 5000 }, (_, i) => record(
    `wsr_bound_${i}`,
    `Common market road condition ${i} remains active.`,
    { anchors: [`district-${i}`], lastChangedMessage: i },
  ));
  records[4321] = record('wsr_bound_target', 'Moonbridge customs gate is sealed.', {
    anchors: ['Moonbridge customs gate'],
    lastChangedMessage: 4999,
  });
  const state = { records, links: [] };
  const index = buildRelevanceIndex(state);
  const result = selectRelevantRecords(state, {
    index,
    recentText: 'At the Moonbridge customs gate the common market road is crowded.',
    candidateCap: 64,
    currentMessageId: 5000,
  });

  assert.equal(result.selected[0]?.record?.id, 'wsr_bound_target');
  assert.ok(result.metrics.scoredRecords <= 64);
  assert.ok(result.metrics.postingVisits <= result.metrics.postingVisitBudget);
  assert.ok(result.metrics.postingVisitBudget <= 768);
  assert.ok(result.metrics.phraseLookups <= 640);
});

test('incremental record refresh preserves pre-existing generic related-link adjacency', () => {
  let state = createState('chat:generic-link-test');
  const created = reduceMutations(state, {
    chatKey: 'chat:generic-link-test',
    messageId: 1,
    lineageKey: 'ln1',
    operation: 'capture',
    mutations: [
      { action: 'create', kind: 'fact', recordId: 'wsr_a', summary: 'Moonbridge is closed', anchors: ['Moonbridge'] },
      { action: 'create', kind: 'fact', recordId: 'wsr_b', summary: 'Caravans wait nearby', anchors: ['caravans'], relatedRecordIds: ['wsr_a'] },
    ],
  });
  state = created.state;
  const index = buildRelevanceIndex(state);

  const updated = reduceMutations(state, {
    chatKey: 'chat:generic-link-test',
    messageId: 2,
    lineageKey: 'ln2',
    operation: 'capture',
    mutations: [
      { action: 'update', recordId: 'wsr_a', summary: 'Moonbridge remains closed', anchors: ['Moonbridge'] },
    ],
  });
  state = updated.state;
  updateRelevanceIndex(index, updated.indexDelta);

  const rebuilt = buildRelevanceIndex(state);
  const live = selectRelevantRecords(state, { index, recentText: 'Moonbridge', maxRecords: 6 });
  const fresh = selectRelevantRecords(state, { index: rebuilt, recentText: 'Moonbridge', maxRecords: 6 });
  assert.deepEqual(live.selected.map(item => item.record.id), fresh.selected.map(item => item.record.id));
  assert.ok(live.selected.some(item => item.record.id === 'wsr_b' && item.source === 'linked'));
});

test('incremental index update for create/update/resolve plus appended link matches freshly rebuilt index', () => {
  let state = createState('chat:incremental-test');

  const createBatch = reduceMutations(state, {
    chatKey: 'chat:incremental-test',
    messageId: 1,
    lineageKey: 'ln1',
    operation: 'capture',
    mutations: [
      { action: 'create', kind: 'development', recordId: 'wsr_dev_1', summary: 'Trade dispute', anchors: ['trade'] },
      { action: 'create', kind: 'fact', recordId: 'wsr_fact_1', summary: 'Dock closed', anchors: ['dock'], relatedRecordIds: ['wsr_dev_1'] },
    ],
  });
  state = createBatch.state;
  const index = buildRelevanceIndex(state);

  const updateBatch = reduceMutations(state, {
    chatKey: 'chat:incremental-test',
    messageId: 2,
    lineageKey: 'ln2',
    operation: 'capture',
    mutations: [
      { action: 'update', recordId: 'wsr_dev_1', summary: 'Trade dispute escalated', anchors: ['trade', 'escalated'] },
      { action: 'resolve', recordId: 'wsr_fact_1', summary: 'Dock reopened' },
      { action: 'create', kind: 'fact', recordId: 'wsr_fact_2', summary: 'Warehouse guarded', anchors: ['warehouse'], relatedRecordIds: ['wsr_dev_1'] },
    ],
  });
  state = updateBatch.state;
  updateRelevanceIndex(index, updateBatch.indexDelta);

  const freshlyRebuilt = buildRelevanceIndex(state);

  const queryEscalated = { recentText: 'The escalated trade situation.' };
  const queryResolved = { recentText: 'Dock reopened today.' };
  const queryLinked = { recentText: 'Warehouse security around the trade dispute.' };

  const live1 = selectRelevantRecords(state, { index, ...queryEscalated });
  const rebuilt1 = selectRelevantRecords(state, { index: freshlyRebuilt, ...queryEscalated });
  assert.deepEqual(live1.selected.map(s => s.record.id), rebuilt1.selected.map(s => s.record.id));

  const live2 = selectRelevantRecords(state, { index, ...queryResolved });
  const rebuilt2 = selectRelevantRecords(state, { index: freshlyRebuilt, ...queryResolved });
  assert.equal(live2.selected.length, 0);
  assert.equal(rebuilt2.selected.length, 0);

  const live3 = selectRelevantRecords(state, { index, ...queryLinked });
  const rebuilt3 = selectRelevantRecords(state, { index: freshlyRebuilt, ...queryLinked });
  assert.deepEqual(live3.selected.map(s => s.record.id), rebuilt3.selected.map(s => s.record.id));
});

test('suffix-only lineage extension matches full lineage and host ordinary paths avoid full-chat reconciliation', () => {
  const chat = Array.from({ length: 1000 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `message ${index}`,
  }));
  const prior = chatLineage(chat.slice(0, 900));
  const appended = extendChatLineage(prior, chat);
  const full = chatLineage(chat);
  assert.ok(Array.isArray(appended));
  assert.deepEqual([...prior, ...appended], full);

  const source = fs.readFileSync('index.js', 'utf8');
  assert.ok((source.match(/extendCurrentBranchFast\(chatKey\)/g) || []).length >= 2);
  assert.match(source, /const branchDirtyChats = new Set\(\)/);
  assert.match(source, /if \(branchDirtyChats\.has\(chatKey\)\) return null/);
  assert.match(source, /if \(state\?\.recoveryRequired\) return null/);
  assert.match(source, /if \(result\.failClosed\) branchDirtyChats\.add\(chatKey\)/);
  assert.match(source, /else branchDirtyChats\.delete\(chatKey\)/);
  const guardStart = source.indexOf('function operationGuard');
  const guardEnd = source.indexOf('function queueChatWork', guardStart);
  const guardSource = source.slice(guardStart, guardEnd);
  assert.doesNotMatch(guardSource, /chatLineage\(/);
  assert.match(source, /commitMutationBoundary\(before, result\.state, liveChat, messageId, 'capture', \{ lineage: before\.lineage \}\)/);
  assert.match(source, /commitMutationBoundary\(before, prepared\.state, liveChat, messageId, 'evolution', \{ lineage: before\.lineage \}\)/);
});

test('1000 canonical updates retain only bounded referenced evidence', () => {
  let state = createState('chat:compaction-1000');
  for (let i = 0; i < 1000; i += 1) {
    const result = reduceMutations(state, {
      chatKey: 'chat:compaction-1000',
      messageId: i,
      lineageKey: `ln${i}`,
      operation: 'capture',
      mutations: i === 0
        ? [{
          action: 'create',
          kind: 'development',
          recordId: 'wsr_compact_1000',
          summary: 'Initial long-run state',
          evidence: [{ claim: 'claim 0' }],
        }]
        : [{
          action: 'update',
          recordId: 'wsr_compact_1000',
          summary: `Long-run update ${i}`,
          evidence: [{ claim: `claim ${i}` }],
        }],
    });
    state = result.state;
  }
  assert.equal(state.records[0].evidenceIds.length, LIMITS.evidenceRefsPerRecord);
  assert.equal(Object.keys(state.evidence).length, LIMITS.evidenceRefsPerRecord);
});

test('orphan evidence compaction bounds evidence store over sequential updates while preserving rollback', () => {
  let state = createState('chat:compaction-test');
  const chat = [];

  const initial = reduceMutations(state, {
    chatKey: 'chat:compaction-test',
    messageId: 0,
    lineageKey: 'ln0',
    operation: 'capture',
    mutations: [{
      action: 'create',
      kind: 'development',
      recordId: 'wsr_compact_target',
      summary: 'Initial status at step 0',
      anchors: ['test anchor'],
      evidence: [{ claim: 'initial claim 0' }],
    }],
  });
  chat.push({ role: 'assistant', content: 'initial claim 0' });
  state = commitMutationBoundary(state, initial.state, chat, 0, 'capture');

  for (let i = 1; i <= 100; i += 1) {
    chat.push({ role: 'assistant', content: `claim for step ${i}` });
    const res = reduceMutations(state, {
      chatKey: 'chat:compaction-test',
      messageId: i,
      lineageKey: `ln${i}`,
      operation: 'capture',
      mutations: [{
        action: 'update',
        recordId: 'wsr_compact_target',
        summary: `Updated status at step ${i}`,
        evidence: [{ claim: `claim for step ${i}` }],
      }],
    });
    state = commitMutationBoundary(state, res.state, chat, i, 'capture');
  }

  // Canonical evidence store must only contain referenced evidence (<= LIMITS.evidenceRefsPerRecord = 32)
  const evidenceKeys = Object.keys(state.evidence);
  assert.ok(evidenceKeys.length <= LIMITS.evidenceRefsPerRecord, `evidence keys length was ${evidenceKeys.length}`);
  assert.equal(evidenceKeys.length, state.records[0].evidenceIds.length);

  // Journal and checkpoints remain bounded
  assert.ok(state.rollbackJournal.length <= LIMITS.rollbackEntries);
  assert.ok(state.checkpoints.length <= LIMITS.checkpoints);

  // Reconcile branch swipe restores prior state with its evidence
  const truncatedChat = chat.slice(0, 51);
  const branchResult = reconcileBranch(state, truncatedChat);
  assert.equal(branchResult.exactRestored, true);
  assert.equal(branchResult.state.records[0].summary, 'Updated status at step 50');
  assert.ok(Object.keys(branchResult.state.evidence).length <= LIMITS.evidenceRefsPerRecord);
});

test('package reproducibility generates byte-for-byte identical archive and manifest', () => {
  const pkg1 = buildReleasePackage();
  const pkg2 = buildReleasePackage();

  assert.equal(pkg1.archiveSha256, pkg2.archiveSha256);
  assert.equal(pkg1.archiveBytes, pkg2.archiveBytes);
  assert.equal(pkg1.manifestJson, pkg2.manifestJson);

  const archiveBuffer1 = fs.readFileSync(`dist/${pkg1.archiveName}`);
  const archiveBuffer2 = fs.readFileSync(`dist/${pkg2.archiveName}`);
  assert.equal(archiveBuffer1.compare(archiveBuffer2), 0);
});
