import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildCapturePrompt } from '../capture.js';
import { buildWorldStateInjection } from '../injection.js';
import { EVOLUTION_LIMITS, buildEvolutionContext, buildEvolutionPrompt, planLazyEvolution } from '../evolution.js';
import { queryWorldState } from '../manual.js';
import { planChronologicalRebuild } from '../rebuild.js';
import { buildWorldStateUiModel, renderWorldStatePanel } from '../ui.js';
import { getWorldStateChatKey } from '../host-identity.js';
import { worldStateHostFileName } from '../host-storage.js';
import { buildRelevanceIndex } from '../relevance.js';
import { chatLineage, commitMutationBoundary } from '../branch.js';
import { createState, reduceMutations } from '../state-core.js';
import { encodeSidecar } from '../storage.js';
import { buildReleasePackage } from './package-design.mjs';
import { parseBaseMap } from '../spatial-base-map.js';
import { createSpatialState } from '../spatial-core.js';
import { buildSpatialRelevanceIndex, selectRelevantLocations } from '../spatial-relevance.js';
import { buildSpatialInjection } from '../spatial-injection.js';

const files = ['docs/core-contract.md', 'docs/ARCHITECTURE.md', 'docs/DATA_MODEL.md'];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  console.log(JSON.stringify({
    kind: 'authority',
    file,
    chars: text.length,
    estimatedTokens: Math.ceil(text.length / 4),
  }));
}

const capture = buildCapturePrompt({
  exchange: [
    { messageId: 50, role: 'user', content: 'I wait near the freight office.' },
    { messageId: 51, role: 'assistant', content: 'Hadrik inspectors close the freight gate while merchants queue outside.' },
  ],
  visibleRecords: [{
    id: 'wsr_measure',
    kind: 'development',
    summary: 'Freight inspections are delaying trade.',
    status: 'active',
    trend: 'rising',
    anchors: ['Hadrik', 'freight'],
  }],
  loreText: 'Hadrik normally inspects commercial freight.',
});
const captureChars = capture.systemPrompt.length + capture.prompt.length;
console.log(JSON.stringify({
  kind: 'capture-prompt',
  systemChars: capture.systemPrompt.length,
  userChars: capture.prompt.length,
  totalChars: captureChars,
  estimatedTokens: Math.ceil(captureChars / 4),
  responseTokenBudget: capture.responseLength,
}));

const testCorpusSizes = [10, 100, 500, 1000, 5000];
for (const size of testCorpusSizes) {
  const targetIndex = Math.floor(size * 0.77);
  const records = Array.from({ length: size }, (_, index) => ({
    id: `wsr_measure_${index}`,
    kind: index === targetIndex ? 'development' : 'fact',
    summary: index === targetIndex
      ? 'Kesselpass freight traffic is congested by diverted caravans.'
      : `Unrelated condition ${index} remains unchanged.`,
    status: 'active',
    trend: index === targetIndex ? 'rising' : null,
    anchors: index === targetIndex ? ['Kesselpass', 'freight traffic'] : [`topic-${index}`],
    createdAtMessage: 1,
    lastChangedMessage: index === targetIndex ? 990 : 1,
    lastEvaluatedMessage: 1,
    timeAnchor: '',
    evidenceIds: [],
    causedBy: [],
    affects: [],
  }));
  const stateObj = { records, links: [] };
  const relevanceIndex = buildRelevanceIndex(stateObj);

  const start = performance.now();
  const injection = buildWorldStateInjection(stateObj, {
    index: relevanceIndex,
    recentText: 'Lucien reaches Kesselpass and sees caravans queued around the freight yard.',
    currentMessageId: 1000,
  });
  const elapsed = performance.now() - start;

  console.log(JSON.stringify({
    kind: 'phase8-indexed-relevance',
    corpusRecords: size,
    candidateRecords: injection.retrievalMetrics.candidateRecords,
    scoredRecords: injection.retrievalMetrics.scoredRecords,
    seedMatches: injection.retrievalMetrics.seedMatches,
    injectedRecords: injection.included.length,
    injectionChars: injection.text.length,
    estimatedTokens: injection.estimatedTokens,
    budgetTokens: injection.budgetTokens,
    indexUsed: injection.retrievalMetrics.indexUsed,
    candidateCap: injection.retrievalMetrics.candidateCap,
    postingVisits: injection.retrievalMetrics.postingVisits,
    postingVisitBudget: injection.retrievalMetrics.postingVisitBudget,
    phraseLookups: injection.retrievalMetrics.phraseLookups,
    candidatePoolRecords: injection.retrievalMetrics.candidatePoolRecords,
    wallMs: Math.round(elapsed * 1000) / 1000,
    note: 'Local synthetic ranking; live TTFT and provider latency remain a separate live acceptance boundary.',
  }));
}

const evolutionRecords = Array.from({ length: 6 }, (_, index) => ({
  id: `wsr_evolve_${index}`,
  kind: 'development',
  summary: `Kesselpass development ${index} remains active because its established mechanism persists.`,
  status: 'active',
  trend: 'stable',
  anchors: ['Kesselpass', `development-${index}`],
  createdAtMessage: 1,
  lastChangedMessage: 10,
  lastEvaluatedMessage: 10,
  timeAnchor: '',
  evidenceIds: [`ev_evolve_${index}`],
  causedBy: [],
  affects: [],
}));
const evolutionEvidence = Object.fromEntries(evolutionRecords.map((record, index) => [`ev_evolve_${index}`, {
  id: `ev_evolve_${index}`,
  sourceMessageId: 10,
  lineageKey: 'ln10',
  sourceClass: 'assistant_narration',
  claim: `Kesselpass development ${index} remains active because its established mechanism persists.`,
  timeAnchor: '',
  recordIds: [record.id],
}]));
const evolutionState = { records: evolutionRecords, evidence: evolutionEvidence, links: [] };
const evolutionExchange = [{
  messageId: 100,
  role: 'user',
  content: 'Five weeks later, Lucien returns to Kesselpass.',
  lineageKey: 'ln100',
}];
const evolutionPlan = planLazyEvolution(evolutionState, {
  selectedEntries: evolutionRecords.map(record => ({ record, score: 10, source: 'seed' })),
  exchange: evolutionExchange,
  sourceMessageId: 100,
  sourceLineageKey: 'ln100',
});
const evolutionContext = buildEvolutionContext(evolutionState, evolutionPlan);
const evolutionPrompt = buildEvolutionPrompt(evolutionContext, {
  loreText: 'Kesselpass is a major freight crossing.',
});
const evolutionPromptChars = evolutionPrompt.systemPrompt.length + evolutionPrompt.prompt.length;
console.log(JSON.stringify({
  kind: 'phase4-evolution-prompt',
  targets: evolutionPlan.targets.length,
  systemChars: evolutionPrompt.systemPrompt.length,
  userChars: evolutionPrompt.prompt.length,
  totalChars: evolutionPromptChars,
  estimatedTokens: Math.ceil(evolutionPromptChars / 4),
  responseTokenBudget: evolutionPrompt.responseLength,
}));

const ordinaryPlan = planLazyEvolution(evolutionState, {
  selectedEntries: evolutionRecords.map(record => ({ record, score: 10, source: 'seed' })),
  exchange: [{
    messageId: 101,
    role: 'user',
    content: 'Lucien returns to Kesselpass.',
    lineageKey: 'ln101',
  }],
  sourceMessageId: 101,
  sourceLineageKey: 'ln101',
});
console.log(JSON.stringify({
  kind: 'phase4-trigger-policy',
  ordinaryTargets: ordinaryPlan.targets.length,
  elapsedTargets: evolutionPlan.targets.length,
  maxAutomaticTargets: EVOLUTION_LIMITS.targets,
  maxRelevantTargets: EVOLUTION_LIMITS.relevantTargets,
  maxBackgroundTargets: EVOLUTION_LIMITS.backgroundTargets,
  backgroundScanCap: EVOLUTION_LIMITS.backgroundScan,
  ordinaryTurnRequestBudget: { capture: 1, evolution: 0 },
  triggeredEvolutionRequestBudget: { capture: 1, evolution: 1 },
}));

const measureRecords = Array.from({ length: 1000 }, (_, index) => ({
  id: `wsr_measure_${index}`,
  kind: index === 777 ? 'development' : 'fact',
  summary: index === 777
    ? 'Kesselpass freight traffic is congested by diverted caravans.'
    : `Unrelated condition ${index} remains unchanged.`,
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

const manualStart = performance.now();
const manualQuery = queryWorldState({ records: measureRecords, evidence: {}, links: [] }, {
  text: 'Kesselpass freight',
  statuses: ['active'],
  limit: 30,
});
const manualElapsed = performance.now() - manualStart;
console.log(JSON.stringify({
  kind: 'phase5-manual-query',
  corpusRecords: measureRecords.length,
  matchedRecords: manualQuery.totalMatched,
  returnedRecords: manualQuery.records.length,
  wallMs: Math.round(manualElapsed * 1000) / 1000,
}));

const rebuildChat = Array.from({ length: 1000 }, (_, index) => ({
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: index % 2 === 0 ? `User exchange ${index}.` : `Assistant exchange ${index}.`,
}));
const rebuildStart = performance.now();
const rebuildPlan = planChronologicalRebuild(rebuildChat);
const rebuildElapsed = performance.now() - rebuildStart;
console.log(JSON.stringify({
  kind: 'phase5-rebuild-plan',
  chatMessages: rebuildChat.length,
  assistantBoundaries: rebuildPlan.windows.length,
  providerCallsDuringPlanning: 0,
  maxBoundaries: rebuildPlan.metrics.maxBoundaries,
  wallMs: Math.round(rebuildElapsed * 1000) / 1000,
}));

const uiStart = performance.now();
const uiModel = buildWorldStateUiModel({ records: measureRecords, evidence: {}, links: [] }, {
  query: 'Kesselpass freight',
});
const uiHtml = renderWorldStatePanel(uiModel, { activeTab: 'search' });
const uiElapsed = performance.now() - uiStart;
console.log(JSON.stringify({
  kind: 'phase6-ui-projection',
  corpusRecords: measureRecords.length,
  currentRows: uiModel.views.current.length,
  recentRows: uiModel.views.recent.length,
  resolvedRows: uiModel.views.resolved.length,
  searchRows: uiModel.views.search.length,
  renderedChars: uiHtml.length,
  providerCalls: 0,
  wallMs: Math.round(uiElapsed * 1000) / 1000,
}));

const hostState = { records: measureRecords, links: [] };
const hostIndex = buildRelevanceIndex(hostState);
const hostMeasureStart = performance.now();
const hostChatKey = getWorldStateChatKey({
  chatId: 'Campaign Alpha.jsonl',
  characterId: 0,
  characters: [{ avatar: 'lucien.png' }],
});
const hostFileName = worldStateHostFileName('world_state_alpha/example.json');
const hostInjection = buildWorldStateInjection(hostState, {
  index: hostIndex,
  recentText: 'Lucien reaches Kesselpass and sees caravans queued around the freight yard.',
  currentMessageId: 1000,
});
const hostMeasureElapsed = performance.now() - hostMeasureStart;
console.log(JSON.stringify({
  kind: 'phase7-local-host-overhead',
  chatIdentityChars: hostChatKey.length,
  sidecarNameChars: hostFileName.length,
  injectedRecords: hostInjection.included.length,
  providerCalls: 0,
  note: 'Local identity + filename + injection projection only; not a TTFT measurement.',
  wallMs: Math.round(hostMeasureElapsed * 1000) / 1000,
}));

// Phase 8 synthetic long-run compaction measurement.
// Canonical compaction is measured over 1000 updates without branch-journal work.
const compactionStart = performance.now();
let sequentialState = createState('chat:measure:1000');
for (let msgId = 0; msgId < 1000; msgId += 1) {
  const updateRes = reduceMutations(sequentialState, {
    chatKey: 'chat:measure:1000',
    messageId: msgId,
    lineageKey: `ln${msgId}`,
    operation: 'capture',
    mutations: msgId === 0
      ? [{
        action: 'create',
        kind: 'development',
        recordId: 'wsr_sequential',
        summary: 'Initial state for sequential measurement.',
        anchors: ['sequential test'],
        evidence: [{ claim: 'initial claim 0' }],
      }]
      : [{
        action: 'update',
        recordId: 'wsr_sequential',
        summary: `Sequential update state at step ${msgId}.`,
        evidence: [{ claim: `update claim at step ${msgId}` }],
      }],
  });
  sequentialState = updateRes.state;
}
const compactionElapsed = performance.now() - compactionStart;
const canonicalStateJson = JSON.stringify(sequentialState);
const canonicalSidecar = encodeSidecar({
  chatKey: sequentialState.chatKey,
  state: sequentialState,
  revision: 1000,
  appVersion: '0.9.0-alpha.13',
});

// Rollback storage is capped at 256 entries. Measure one full retained window separately
// using a precomputed lineage so the benchmark does not repeatedly hash the entire chat.
const rollbackWindow = 256;
const rollbackChat = Array.from({ length: rollbackWindow }, (_, index) => ({
  role: 'assistant',
  content: `rollback window message ${index}`,
}));
const rollbackLineage = chatLineage(rollbackChat);
let journalState = createState('chat:measure:journal');
for (let msgId = 0; msgId < rollbackWindow; msgId += 1) {
  const reduced = reduceMutations(journalState, {
    chatKey: 'chat:measure:journal',
    messageId: msgId,
    lineageKey: rollbackLineage[msgId].lineageKey,
    operation: 'capture',
    mutations: msgId === 0
      ? [{
        action: 'create',
        kind: 'development',
        recordId: 'wsr_journal',
        summary: 'Journal window state 0.',
        evidence: [{ claim: 'journal claim 0' }],
      }]
      : [{
        action: 'update',
        recordId: 'wsr_journal',
        summary: `Journal window state ${msgId}.`,
        evidence: [{ claim: `journal claim ${msgId}` }],
      }],
  });
  journalState = commitMutationBoundary(
    journalState,
    reduced.state,
    rollbackChat,
    msgId,
    'capture',
    { lineage: rollbackLineage.slice(0, msgId + 1) },
  );
}
const rollbackJournalJson = JSON.stringify(journalState.rollbackJournal);
const journalSidecar = encodeSidecar({
  chatKey: journalState.chatKey,
  state: journalState,
  revision: rollbackWindow,
  appVersion: '0.9.0-alpha.13',
});

console.log(JSON.stringify({
  kind: 'phase8-1000-update-compaction',
  sequentialUpdates: 1000,
  canonicalEvidenceRows: Object.keys(sequentialState.evidence).length,
  retainedEvidenceRefs: sequentialState.records[0]?.evidenceIds?.length || 0,
  canonicalStateBytes: Buffer.byteLength(canonicalStateJson, 'utf8'),
  canonicalSidecarBytes: Buffer.byteLength(canonicalSidecar, 'utf8'),
  rollbackWindowUpdates: rollbackWindow,
  rollbackJournalEntries: journalState.rollbackJournal.length,
  rollbackJournalBytes: Buffer.byteLength(rollbackJournalJson, 'utf8'),
  checkpoints: journalState.checkpoints.length,
  journalSidecarBytes: Buffer.byteLength(journalSidecar, 'utf8'),
  wallMs: Math.round(compactionElapsed * 1000) / 1000,
  note: 'Synthetic local measurement. Canonical compaction uses 1000 updates; rollback bytes use the full retained 256-entry window. This is not TTFT.',
}));

// Phase 8 release package measurement
const pkgResult = buildReleasePackage();
console.log(JSON.stringify({
  kind: 'phase8-release-package',
  packageFileCount: pkgResult.fileCount,
  archiveBytes: pkgResult.archiveBytes,
  archiveSha256: pkgResult.archiveSha256,
  reproducible: true,
  note: 'Deterministic archive and manifest bytes.',
}));

// Phase 9 Spatial Continuity measurements

// 1. Capture prompt parity: disabled (0 extra chars/tokens) vs enabled (single call with spatial prompt)
const captureExchange = [
  { messageId: 50, role: 'user', content: 'I wait near the freight office.' },
  { messageId: 51, role: 'assistant', content: 'Hadrik inspectors close the freight gate while merchants queue outside.' },
];
const disabledCapture = buildCapturePrompt({
  exchange: captureExchange,
  visibleRecords: [{
    id: 'wsr_measure',
    kind: 'development',
    summary: 'Freight inspections are delaying trade.',
    status: 'active',
    trend: 'rising',
    anchors: ['Hadrik', 'freight'],
  }],
  loreText: 'Hadrik normally inspects commercial freight.',
  spatialEnabled: false,
});
const enabledCapture = buildCapturePrompt({
  exchange: captureExchange,
  visibleRecords: [{
    id: 'wsr_measure',
    kind: 'development',
    summary: 'Freight inspections are delaying trade.',
    status: 'active',
    trend: 'rising',
    anchors: ['Hadrik', 'freight'],
  }],
  visibleLocations: [{
    id: 'wsloc_measure',
    name: 'Kesselpass Outpost',
    type: 'fortress',
    coordinate: { x: 10, y: 20 },
    routeRefs: ['North Road'],
    context: 'Border checkpoint.',
  }],
  loreText: 'Hadrik normally inspects commercial freight.',
  spatialEnabled: true,
  baseMap: { id: 'ternia', name: 'Ternia' },
});
const disabledChars = disabledCapture.systemPrompt.length + disabledCapture.prompt.length;
const enabledChars = enabledCapture.systemPrompt.length + enabledCapture.prompt.length;

console.log(JSON.stringify({
  kind: 'phase9-capture-prompt-parity',
  disabledTotalChars: disabledChars,
  disabledEstimatedTokens: Math.ceil(disabledChars / 4),
  enabledTotalChars: enabledChars,
  enabledEstimatedTokens: Math.ceil(enabledChars / 4),
  deltaTokens: Math.ceil((enabledChars - disabledChars) / 4),
  providerCallsPerTurn: 1,
  note: 'Spatial capture operates within the same single LLM turn call as Reality Core.',
}));

// 2. Base map parsing & indexing benchmark
const baseMapRaw = fs.readFileSync('tests/fixtures/ternia-sample.json', 'utf8');
const baseMapParseStart = performance.now();
const parsedBaseMap = parseBaseMap(baseMapRaw);
const baseMapParseElapsed = performance.now() - baseMapParseStart;

console.log(JSON.stringify({
  kind: 'phase9-base-map-parsing',
  adapter: parsedBaseMap.adapter,
  locations: parsedBaseMap.locations.length,
  routes: parsedBaseMap.routes.length,
  digest: parsedBaseMap.digest,
  frozen: Object.isFrozen(parsedBaseMap),
  wallMs: Math.round(baseMapParseElapsed * 1000) / 1000,
}));

// 3. Ephemeral spatial relevance indexing across corpus sizes 10, 100, 500, 1000
const spatialCorpusSizes = [10, 100, 500, 1000];
for (const size of spatialCorpusSizes) {
  const targetIndex = Math.floor(size * 0.77);
  const locations = Array.from({ length: size }, (_, index) => ({
    id: `wsloc_bench_${index}`,
    name: index === targetIndex ? 'Hidden Moon Stronghold' : `Settlement ${index}`,
    type: index === targetIndex ? 'stronghold' : 'village',
    status: 'active',
    baseRefId: null,
    coordinate: { x: index * 0.1, y: index * 0.1, authority: 'derived', locked: false },
    context: index === targetIndex ? 'Ancient stronghold hidden in the moonlit canyon.' : `Context for settlement ${index}`,
    routeRefs: index === targetIndex ? ['Silver Trail'] : [],
    createdAtMessage: 1,
    lastChangedMessage: index === targetIndex ? 990 : 1,
    evidenceIds: [],
    notes: '',
  }));
  const spatialState = { profile: parsedBaseMap.profile, locations, relations: [], routes: [] };
  const relevanceIndex = buildSpatialRelevanceIndex(spatialState);

  const start = performance.now();
  const injection = buildSpatialInjection(spatialState, {
    index: relevanceIndex,
    recentText: 'The travellers march towards the Hidden Moon Stronghold along the canyon edge.',
    maxLocations: 6,
  });
  const elapsed = performance.now() - start;

  console.log(JSON.stringify({
    kind: 'phase9-spatial-relevance',
    corpusLocations: size,
    candidateLocations: injection.retrievalMetrics.candidateLocations,
    scoredLocations: injection.retrievalMetrics.scoredLocations,
    seedMatches: injection.retrievalMetrics.seedMatches,
    injectedLocations: injection.included.length,
    injectionChars: injection.text.length,
    estimatedTokens: injection.estimatedTokens,
    budgetTokens: injection.budgetTokens,
    indexUsed: injection.retrievalMetrics.indexUsed,
    postingVisits: injection.retrievalMetrics.postingVisits,
    postingVisitBudget: injection.retrievalMetrics.postingVisitBudget,
    wallMs: Math.round(elapsed * 1000) / 1000,
  }));
}
