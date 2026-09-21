import fs from 'node:fs';
import { EVIDENCE_SOURCE_CLASSES } from '../constants.js';
import {
  EVOLUTION_LIMITS,
  EVOLUTION_SYSTEM_PROMPT,
  buildEvolutionContext,
  buildEvolutionPrompt,
  planLazyEvolution,
} from '../evolution.js';
import { extractElapsedHint } from '../elapsed.js';
import { EVOLUTION_WIRE_LIMITS } from '../evolution-wire.js';

const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
if (!['phase4-lazy-evolution', 'phase5-manual-rebuild', 'phase6-ui-evidence', 'phase7-coexistence-host', 'phase8-release-hardening'].includes(inventory.stage)) throw new Error('Phase 4 cumulative runtime inventory stage mismatch');
if (!['phase7-coexistence-host', 'phase8-release-hardening'].includes(inventory.stage) && inventory.hostEntrypoint !== null) throw new Error('Phase 4 substrate must remain host-neutral before the authorized host phase');

const required = ['elapsed.js', 'evolution-wire.js', 'evolution.js'];
for (const file of required) {
  if (!inventory.modules.includes(file)) throw new Error(`Phase 4 module missing from runtime inventory: ${file}`);
  const source = fs.readFileSync(file, 'utf8');
  if (/from\s+['"]node:|require\(['"]node:/.test(source)) {
    throw new Error(`browser runtime module imports Node-only API: ${file}`);
  }
  if (/"scope"\s*:/.test(source)) throw new Error(`Phase 4 reintroduced mandatory scope ontology: ${file}`);
  await import(new URL(`../${file}`, import.meta.url));
}

for (const forbidden of ['commands.js', 'bootstrap.js', 'runtime.js']) {
  if (inventory.modules.includes(forbidden)) throw new Error(`Phase 4 inventory contains unauthorized later-phase/host module: ${forbidden}`);
}

for (const phrase of [
  'Elapsed time is permission to evaluate',
  'elapsed time alone is not evidence that a change occurred',
  'Story-driving CoT principles',
  'Prefer stable',
  'Do not invent new actors',
  'At most one derived development',
]) {
  if (!EVOLUTION_SYSTEM_PROMPT.includes(phrase)) throw new Error(`evolution prompt missing invariant: ${phrase}`);
}

if (EVOLUTION_LIMITS.targets !== 4) throw new Error('automatic evolution target cap drifted');
if (EVOLUTION_WIRE_LIMITS.derived !== 1) throw new Error('derived-development cap drifted');
if (!EVIDENCE_SOURCE_CLASSES.includes('elapsed_hint')) throw new Error('elapsed_hint evidence class missing');

const fiveWeeks = extractElapsedHint('Five weeks later, Lucien returns to Kesselpass.', {
  sourceMessageId: 100,
  lineageKey: 'ln100',
});
if (!fiveWeeks?.meaningful || fiveWeeks.unit !== 'week' || fiveWeeks.amount !== 5) {
  throw new Error('five-week meaningful elapsed detection failed');
}

const records = Array.from({ length: 6 }, (_, index) => ({
  id: `wsr_phase4_${index}`,
  kind: 'development',
  summary: `Kesselpass development ${index} remains active.`,
  status: 'active',
  trend: 'stable',
  anchors: ['Kesselpass'],
  createdAtMessage: 1,
  lastChangedMessage: 10,
  lastEvaluatedMessage: 10,
  timeAnchor: '',
  evidenceIds: [`ev_${index}`],
  causedBy: [],
  affects: [],
}));
const evidence = Object.fromEntries(records.map((record, index) => [`ev_${index}`, {
  id: `ev_${index}`,
  sourceMessageId: 10,
  lineageKey: 'ln10',
  sourceClass: 'assistant_narration',
  claim: `Kesselpass development ${index} remains active due to its established cause.`,
  timeAnchor: '',
  recordIds: [record.id],
}]));
const state = { records, evidence, links: [] };
const selectedEntries = records.map(record => ({ record, score: 10, source: 'seed' }));
const exchange = [{
  messageId: 100,
  role: 'user',
  content: 'Five weeks later, Lucien returns to Kesselpass.',
  lineageKey: 'ln100',
}];

const plan = planLazyEvolution(state, {
  selectedEntries,
  exchange,
  sourceMessageId: 100,
  sourceLineageKey: 'ln100',
});
if (plan.targets.length !== 4) throw new Error(`Phase 4 target cap failed: ${plan.targets.length}`);
const context = buildEvolutionContext(state, plan);
const prompt = buildEvolutionPrompt(context, { loreText: 'Kesselpass is a major freight crossing.' });
const promptChars = prompt.systemPrompt.length + prompt.prompt.length;
if (promptChars > 24000) throw new Error(`Phase 4 four-target prompt exceeds compactness budget: ${promptChars}`);

const ordinaryPlan = planLazyEvolution(state, {
  selectedEntries,
  exchange: [{
    messageId: 101,
    role: 'user',
    content: 'Lucien returns to Kesselpass.',
    lineageKey: 'ln101',
  }],
  sourceMessageId: 101,
  sourceLineageKey: 'ln101',
});
if (ordinaryPlan.targets.length !== 0) throw new Error('ordinary relevant turn incorrectly triggered evolution');

console.log(`World State Alpha Phase 4 validation passed: ordinary targets 0; elapsed targets ${plan.targets.length}; four-target prompt ${promptChars} chars.`);
