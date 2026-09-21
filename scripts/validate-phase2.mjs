import fs from 'node:fs';
import { buildCapturePrompt, CAPTURE_SYSTEM_PROMPT } from '../capture.js';

const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
if (inventory.hostEntrypoint !== null) throw new Error('Phase 2 substrate must remain valid before SillyTavern host wiring');

const required = [
  'capture-wire.js',
  'source-firewall.js',
  'duplicate.js',
  'diagnostics.js',
  'provider-routing.js',
  'capture.js',
];

for (const file of inventory.modules) {
  if (!fs.existsSync(file)) throw new Error(`missing runtime module: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  if (/from\s+['"]node:|require\(['"]node:/.test(text)) throw new Error(`browser runtime module imports Node-only API: ${file}`);
  if (/"scope"\s*:/.test(text)) throw new Error(`runtime module contains mandatory scope field: ${file}`);
  await import(new URL(`../${file}`, import.meta.url));
}
for (const file of required) {
  if (!inventory.modules.includes(file)) throw new Error(`Phase 2 module missing from runtime inventory: ${file}`);
}

for (const forbidden of ['commands.js', 'bootstrap.js', 'runtime.js']) {
  if (inventory.modules.includes(forbidden)) throw new Error(`Phase 2 cumulative validation found unauthorized later-phase module: ${forbidden}`);
}

if (!/Story-driving CoT principles/.test(CAPTURE_SYSTEM_PROMPT)
  || !/do not apply to capture and are not evidence/.test(CAPTURE_SYSTEM_PROMPT)) {
  throw new Error('capture prompt is missing the story-driving CoT firewall');
}
if (!/Lore is baseline context\/possibility only/.test(CAPTURE_SYSTEM_PROMPT)) {
  throw new Error('capture prompt is missing lore authority separation');
}

const sample = buildCapturePrompt({
  exchange: [
    { messageId: 10, role: 'user', content: 'I watch the freight gate.' },
    { messageId: 11, role: 'assistant', content: 'Hadrik inspectors close the freight gate for a new inspection.' },
  ],
  visibleRecords: [{
    id: 'wsr_sample',
    kind: 'development',
    summary: 'Freight inspections are delaying trade.',
    status: 'active',
    trend: 'rising',
    anchors: ['Hadrik', 'freight'],
  }],
  loreText: 'Hadrik normally inspects commercial freight.',
});
const chars = sample.systemPrompt.length + sample.prompt.length;
if (chars > 24000) throw new Error(`sample capture prompt exceeds Phase 2 compactness budget: ${chars}`);

console.log(`World State Alpha Phase 2 validation passed: ${required.length} capture modules; sample prompt ${chars} chars.`);
