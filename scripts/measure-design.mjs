import fs from 'node:fs';
import { buildCapturePrompt } from '../capture.js';

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
