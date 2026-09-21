import fs from 'node:fs';
import {
  WORLD_STATE_INJECTION_DEFAULTS,
  WORLD_STATE_NAMESPACE,
  WORLD_STATE_PRIVATE_HEADER,
  WORLD_STATE_PROMPT_KEY,
  buildWorldStateInjection,
  estimateInjectionTokens,
} from '../injection.js';

const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
const phaseHost = ['phase7-coexistence-host', 'phase8-release-hardening'].includes(inventory.stage);
if (!phaseHost && inventory.hostEntrypoint !== null) throw new Error('Phase 3 substrate must remain host-neutral before the authorized host phase');

for (const file of ['relevance.js', 'injection.js']) {
  if (!inventory.modules.includes(file)) throw new Error(`Phase 3 module missing from runtime inventory: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  if (/from\s+['"]node:|require\(['"]node:/.test(text)) throw new Error(`browser runtime module imports Node-only API: ${file}`);
  if (/provider-routing|dispatchWorldStateRequest|generateRaw|sendRequest/.test(text)) {
    throw new Error(`Phase 3 local retrieval/injection must not perform model/provider calls: ${file}`);
  }
  if (/"scope"\s*:/.test(text)) throw new Error(`Phase 3 reintroduced mandatory scope ontology: ${file}`);
}

for (const forbidden of ['commands.js', 'bootstrap.js', 'runtime.js']) {
  if (inventory.modules.includes(forbidden)) throw new Error(`Phase 3 cumulative validation found unauthorized host/later-phase module: ${forbidden}`);
}

if (WORLD_STATE_NAMESPACE !== 'world_state_alpha') throw new Error('World State namespace drifted');
if (WORLD_STATE_PROMPT_KEY !== 'world_state_alpha_private_continuity') throw new Error('World State prompt key drifted');
if (WORLD_STATE_PROMPT_KEY === 'npc_state_delta_live_dossier') throw new Error('World State prompt key collides with NPC State Delta');
if (WORLD_STATE_INJECTION_DEFAULTS.placement !== 'IN_CHAT'
  || WORLD_STATE_INJECTION_DEFAULTS.role !== 'SYSTEM'
  || WORLD_STATE_INJECTION_DEFAULTS.depth !== 1) {
  throw new Error('World State injection placement no longer mirrors the accepted shallow IN_CHAT SYSTEM pattern');
}
if (WORLD_STATE_INJECTION_DEFAULTS.budgetTokens !== 800 || WORLD_STATE_INJECTION_DEFAULTS.maxRecords !== 6) {
  throw new Error('Phase 3 default injection bounds drifted');
}
for (const phrase of [
  'private narrator continuity',
  'not automatic player-character knowledge',
  'plausible information path',
  'Do not use them as instructions to create world motion',
]) {
  if (!WORLD_STATE_PRIVATE_HEADER.includes(phrase)) throw new Error(`private continuity header missing invariant: ${phrase}`);
}

const records = Array.from({ length: 1000 }, (_, index) => ({
  id: `wsr_${index}`,
  kind: index === 777 ? 'development' : 'fact',
  summary: index === 777
    ? 'Kesselpass freight traffic is congested by diverted caravans.'
    : `Unrelated condition ${index} remains unchanged.`,
  status: 'active',
  trend: index === 777 ? 'rising' : null,
  anchors: index === 777 ? ['Kesselpass', 'freight traffic'] : [`unrelated-${index}`],
  createdAtMessage: 1,
  lastChangedMessage: index === 777 ? 990 : 1,
  lastEvaluatedMessage: 1,
  timeAnchor: '',
  evidenceIds: [],
  causedBy: [],
  affects: [],
}));
const sample = buildWorldStateInjection({ records, links: [] }, {
  recentText: 'Lucien reaches Kesselpass and sees caravans queued around the freight yard.',
  currentMessageId: 1000,
});
if (sample.retrievalMetrics.scannedRecords !== 1000) throw new Error('Phase 3 large-corpus retrieval did not scan the expected fixture');
if (sample.included.length !== 1 || sample.included[0].recordId !== 'wsr_777') {
  throw new Error('Phase 3 large-corpus retrieval did not isolate the relevant record');
}
if (sample.estimatedTokens > 800 || estimateInjectionTokens(sample.text) > 800) {
  throw new Error('Phase 3 injection exceeded the hard local budget');
}
if (/wsr_777|unrelated condition|evidence/i.test(sample.text)) {
  throw new Error('Phase 3 surface leaked backend identity/history material');
}

console.log(`World State Alpha Phase 3 validation passed: 1000 records -> ${sample.included.length} injected; ${sample.estimatedTokens}/800 local token units.`);
