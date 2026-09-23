import fs from 'node:fs';
import {
  BUNDLE_VERSION,
  ROLLBACK_JOURNAL_VERSION,
  SCHEMA_VERSION,
  SIDECAR_FORMAT_VERSION,
} from '../constants.js';
import { buildRelevanceIndex, selectRelevantRecords, updateRelevanceIndex } from '../relevance.js';
import { applyUndoPatch, createState, normalizeState, reduceMutations } from '../state-core.js';
import { buildReleasePackage } from './package-design.mjs';

const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const indexSource = fs.readFileSync('index.js', 'utf8');
const packageSource = fs.readFileSync('scripts/package-design.mjs', 'utf8');

// 1. Stage and version validation
if (inventory.stage !== 'phase8-release-hardening' && inventory.stage !== 'phase9-spatial-continuity') {
  throw new Error('Phase 8 runtime inventory stage mismatch: ' + inventory.stage);
}
if (!['0.8.0-alpha.1', '0.9.0-alpha.1', '0.9.0-alpha.2', '0.9.0-alpha.3', '0.9.0-alpha.4', '0.9.0-alpha.5', '0.9.0-alpha.6', '0.9.0-alpha.7', '0.9.0-alpha.8', '0.9.0-alpha.9', '0.9.0-alpha.10', '0.9.0-alpha.11'].includes(pkg.version) || manifest.version !== pkg.version) {
  throw new Error('Phase 8 application version markers inconsistent in package.json/manifest.json');
}
if (!indexSource.includes("WORLD_STATE_ALPHA_VERSION = '0.8.0-alpha.1'") && !indexSource.includes("WORLD_STATE_ALPHA_VERSION = '0.9.0-alpha.1'") && !indexSource.includes("WORLD_STATE_ALPHA_VERSION = '0.9.0-alpha.2'") && !indexSource.includes("WORLD_STATE_ALPHA_VERSION = '0.9.0-alpha.3'") && !indexSource.includes("WORLD_STATE_ALPHA_VERSION = '0.9.0-alpha.4'") && !indexSource.includes("WORLD_STATE_ALPHA_VERSION = '0.9.0-alpha.5'") && !indexSource.includes("WORLD_STATE_ALPHA_VERSION = '0.9.0-alpha.6'") && !indexSource.includes("WORLD_STATE_ALPHA_VERSION = '0.9.0-alpha.7'") && !indexSource.includes("WORLD_STATE_ALPHA_VERSION = '0.9.0-alpha.8'") && !indexSource.includes("WORLD_STATE_ALPHA_VERSION = '0.9.0-alpha.9'") && !indexSource.includes("WORLD_STATE_ALPHA_VERSION = '0.9.0-alpha.10'") && !indexSource.includes("WORLD_STATE_ALPHA_VERSION = '0.9.0-alpha.11'")) {
  throw new Error('Phase 8 index.js version marker not synchronized');
}
for (const required of [
  'const branchDirtyChats = new Set()',
  'if (branchDirtyChats.has(chatKey)) return null',
  'if (state?.recoveryRequired) return null',
  'if (result.failClosed) branchDirtyChats.add(chatKey)',
  'else branchDirtyChats.delete(chatKey)',
]) {
  if (!indexSource.includes(required)) throw new Error('Phase 8 branch-dirty fast-path guard missing: ' + required);
}

// 2. Persisted versions must remain 1 (schemaVersion may be 2 in Phase 9)
if ((SCHEMA_VERSION !== 1 && SCHEMA_VERSION !== 2) || SIDECAR_FORMAT_VERSION !== 1 || BUNDLE_VERSION !== 1 || ROLLBACK_JOURNAL_VERSION !== 1) {
  throw new Error('Phase 8 sidecar/bundle/journal versions must remain 1');
}

// 3. Module inventory and browser-safe runtime check
for (const file of [...inventory.modules, ...(inventory.assets || []), ...(inventory.hostFiles || [])]) {
  if (!fs.existsSync(file)) throw new Error('Phase 8 inventory file missing: ' + file);
}
for (const file of inventory.modules) {
  const source = fs.readFileSync(file, 'utf8');
  if (/from\s+['"]node:|require\(['"]node:/.test(source)) {
    throw new Error('browser-safe runtime module imports Node-only API: ' + file);
  }
  await import(new URL('../' + file, import.meta.url));
}

// 4. Ephemeral Relevance Index Validation
const records = Array.from({ length: 1000 }, (_, index) => ({
  id: `wsr_perf_${index}`,
  kind: index === 777 ? 'development' : 'fact',
  summary: index === 777
    ? 'Kesselpass freight traffic is congested by diverted caravans.'
    : `Unrelated condition ${index} remains unchanged under normal circumstances.`,
  status: 'active',
  trend: index === 777 ? 'rising' : null,
  anchors: index === 777 ? ['Kesselpass', 'freight traffic'] : [`topic-${index}`],
  createdAtMessage: 1,
  lastChangedMessage: index === 777 ? 990 : 1,
  lastEvaluatedMessage: 1,
  timeAnchor: '',
  evidenceIds: [],
  causedBy: [],
  affects: [],
}));
const state = { records, links: [] };
const index = buildRelevanceIndex(state);

const queryResult = selectRelevantRecords(state, {
  index,
  recentText: 'Lucien reaches Kesselpass and sees caravans queued around the freight yard.',
  currentMessageId: 1000,
  maxRecords: 6,
});

if (!queryResult.metrics.indexUsed) throw new Error('Phase 8 indexed relevance did not report indexUsed');
if (queryResult.metrics.candidateRecords > 16) {
  throw new Error('Phase 8 1000-record query scored too many candidate records: ' + queryResult.metrics.candidateRecords);
}
if (queryResult.selected[0]?.record?.id !== 'wsr_perf_777') {
  throw new Error('Phase 8 indexed query did not retrieve target record');
}

// Candidate Cap Saturation & Determinism
const saturatedRecords = Array.from({ length: 1000 }, (_, i) => ({
  id: `wsr_sat_${i}`,
  kind: 'fact',
  summary: `Standard operating condition ${i} continues.`,
  status: 'active',
  trend: null,
  anchors: i === 42 ? ['Priority Target'] : [`anchor-${i}`],
  createdAtMessage: i,
  lastChangedMessage: i,
  lastEvaluatedMessage: i,
  timeAnchor: '',
  evidenceIds: [],
  causedBy: [],
  affects: [],
}));
const saturatedState = { records: saturatedRecords, links: [] };
const saturatedIndex = buildRelevanceIndex(saturatedState);
const saturatedResult = selectRelevantRecords(saturatedState, {
  index: saturatedIndex,
  recentText: 'Priority Target discussed under standard operating condition.',
  candidateCap: 128,
});
if (saturatedResult.metrics.candidateRecords !== 128) {
  throw new Error('Phase 8 candidate cap saturation was not bounded to 128: ' + saturatedResult.metrics.candidateRecords);
}
if (saturatedResult.selected[0]?.record?.id !== 'wsr_sat_42') {
  throw new Error('Phase 8 exact anchor candidate did not outrank common-token candidates under saturation');
}

// Incremental Index Update
const testState = createState('chat:incremental');
const createBatch = reduceMutations(testState, {
  chatKey: 'chat:incremental',
  messageId: 1,
  lineageKey: 'ln1',
  operation: 'capture',
  mutations: [
    { action: 'create', kind: 'development', recordId: 'wsr_inc_1', summary: 'Initial development', anchors: ['alpha'] },
    { action: 'create', kind: 'fact', recordId: 'wsr_inc_2', summary: 'Second fact', anchors: ['beta'], relatedRecordIds: ['wsr_inc_1'] },
  ],
});
const liveIndex = buildRelevanceIndex(createBatch.state);

const updateBatch = reduceMutations(createBatch.state, {
  chatKey: 'chat:incremental',
  messageId: 2,
  lineageKey: 'ln2',
  operation: 'capture',
  mutations: [
    { action: 'update', recordId: 'wsr_inc_1', summary: 'Updated development text', anchors: ['alpha', 'gamma'] },
    { action: 'resolve', recordId: 'wsr_inc_2', summary: 'Resolved fact' },
  ],
});
updateRelevanceIndex(liveIndex, updateBatch.indexDelta);
const rebuiltIndex = buildRelevanceIndex(updateBatch.state);

const liveRes = selectRelevantRecords(updateBatch.state, { index: liveIndex, recentText: 'gamma discussion' });
const rebuiltRes = selectRelevantRecords(updateBatch.state, { index: rebuiltIndex, recentText: 'gamma discussion' });
if (liveRes.selected[0]?.record?.id !== rebuiltRes.selected[0]?.record?.id || liveRes.selected[0]?.record?.summary !== 'Updated development text') {
  throw new Error('Phase 8 incremental index update drifted from rebuilt index');
}

// 5. Evidence Compaction Validation
let compactState = createState('chat:compact');
let lastUndo = null;
for (let step = 0; step < 50; step += 1) {
  const res = reduceMutations(compactState, {
    chatKey: 'chat:compact',
    messageId: step,
    lineageKey: `ln${step}`,
    operation: 'capture',
    mutations: step === 0
      ? [{ action: 'create', kind: 'development', recordId: 'wsr_c', summary: 'Initial state', evidence: [{ claim: 'claim 0' }] }]
      : [{ action: 'update', recordId: 'wsr_c', summary: `Update ${step}`, evidence: [{ claim: `claim ${step}` }] }],
  });
  lastUndo = res.undo;
  compactState = res.state;
}
if (Object.keys(compactState.evidence).length > 32) {
  throw new Error('Phase 8 evidence compaction failed: evidence store exceeded 32 refs: ' + Object.keys(compactState.evidence).length);
}
const rolledBack = applyUndoPatch(compactState, lastUndo);
if (rolledBack.records[0].summary !== 'Update 48') {
  throw new Error('Phase 8 undo patch failed after evidence compaction');
}

// 6. Release Package Reproducibility Validation
if (/node:zlib|deflateRawSync/.test(packageSource) || !/compressionMethod = 0/.test(packageSource)) {
  throw new Error('Phase 8 release archive must use deterministic STORE entries without zlib-dependent compression');
}
const pkg1 = buildReleasePackage();
const pkg2 = buildReleasePackage();
if (pkg1.archiveSha256 !== pkg2.archiveSha256) {
  throw new Error('Phase 8 release package is not byte-reproducible: hashes differ');
}
if (pkg1.archiveBytes !== pkg2.archiveBytes) {
  throw new Error('Phase 8 release package archive size differs between runs');
}
if (pkg1.manifestJson !== pkg2.manifestJson) {
  throw new Error('Phase 8 release package manifest differs between runs');
}

console.log('World State Alpha Phase 8 compatibility validation passed under the current application: Phase 8 index/compaction/package contracts remain valid and sidecar/bundle/journal envelope versions remain 1.');
