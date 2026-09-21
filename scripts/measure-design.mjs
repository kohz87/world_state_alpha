import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildCapturePrompt } from '../capture.js';
import { buildWorldStateInjection } from '../injection.js';
import { buildEvolutionContext, buildEvolutionPrompt, planLazyEvolution } from '../evolution.js';

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

const records = Array.from({ length: 1000 }, (_, index) => ({
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

const start = performance.now();
const injection = buildWorldStateInjection({ records, links: [] }, {
  recentText: 'Lucien reaches Kesselpass and sees caravans queued around the freight yard.',
  currentMessageId: 1000,
});
const elapsed = performance.now() - start;
console.log(JSON.stringify({
  kind: 'phase3-relevance-injection',
  corpusRecords: records.length,
  scannedRecords: injection.retrievalMetrics.scannedRecords,
  seedMatches: injection.retrievalMetrics.seedMatches,
  injectedRecords: injection.included.length,
  injectionChars: injection.text.length,
  estimatedTokens: injection.estimatedTokens,
  budgetTokens: injection.budgetTokens,
  wallMs: Math.round(elapsed * 1000) / 1000,
}));


const evolutionRecords = Array.from({ length: 4 }, (_, index) => ({
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
  maxAutomaticTargets: 4,
}));
