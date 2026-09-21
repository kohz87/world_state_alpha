import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildCapturePrompt } from '../capture.js';
import { buildWorldStateInjection } from '../injection.js';

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
