import fs from 'node:fs';
import {
  MANUAL_LIMITS,
  previewWorldStateReset,
  queryWorldState,
} from '../manual.js';
import {
  REBUILD_LIMITS,
  compareWorldStateSemantics,
  planChronologicalRebuild,
  runManualRebuild,
} from '../rebuild.js';
import { createState } from '../state-core.js';

const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
if (!['phase5-manual-rebuild', 'phase6-ui-evidence', 'phase7-coexistence-host', 'phase8-release-hardening'].includes(inventory.stage)) throw new Error('Phase 5 cumulative runtime inventory stage mismatch');
if (!['phase7-coexistence-host', 'phase8-release-hardening'].includes(inventory.stage) && inventory.hostEntrypoint !== null) throw new Error('Phase 5 service substrate must remain host-neutral before the authorized host phase');

for (const file of ['manual.js', 'rebuild.js']) {
  if (!inventory.modules.includes(file)) throw new Error(`Phase 5 module missing from runtime inventory: ${file}`);
  const source = fs.readFileSync(file, 'utf8');
  if (/from\s+['"]node:|require\(['"]node:/.test(source)) {
    throw new Error(`browser runtime module imports Node-only API: ${file}`);
  }
  if (/"scope"\s*:/.test(source)) throw new Error(`Phase 5 reintroduced mandatory scope ontology: ${file}`);
  await import(new URL(`../${file}`, import.meta.url));
}

for (const forbidden of ['commands.js', 'bootstrap.js', 'runtime.js']) {
  if (inventory.modules.includes(forbidden)) throw new Error(`Phase 5 inventory contains unauthorized Phase 6+/host module: ${forbidden}`);
}

for (const file of ['capture.js', 'evolution.js', 'injection.js', 'relevance.js', 'provider-routing.js']) {
  const source = fs.readFileSync(file, 'utf8');
  if (/from\s+['"]\.\/rebuild\.js['"]|runManualRebuild|planChronologicalRebuild/.test(source)) {
    throw new Error(`normal runtime path may not invoke manual rebuild: ${file}`);
  }
}

const rebuildSource = fs.readFileSync('rebuild.js', 'utf8');
for (const forbidden of ['runLazyEvolution', 'prepareWorldStateContinuity', "from './evolution.js'"]) {
  if (rebuildSource.includes(forbidden)) throw new Error(`rebuild may not replay lazy evolution: ${forbidden}`);
}
for (const required of [
  "operation: 'rebuild'",
  "evidenceSourceClass: 'rebuild'",
  "'WORLD_STATE_REBUILD_BOUNDARY_LIMIT'",
  "'WORLD_STATE_REBUILD_CURRENT_GUARD_REQUIRED'",
]) {
  if (!rebuildSource.includes(required)) throw new Error(`rebuild missing invariant: ${required}`);
}

const manualSource = fs.readFileSync('manual.js', 'utf8');
for (const required of [
  'manual mutation must be anchored to the current raw-message head',
  "'WORLD_STATE_MANUAL_BRANCH_MISMATCH'",
  "'WORLD_STATE_IMPORT_CONFIRMATION_REQUIRED'",
  "'WORLD_STATE_RESET_CONFIRMATION_REQUIRED'",
  "sourceClass: 'manual'",
]) {
  if (!manualSource.includes(required)) throw new Error(`manual controls missing invariant: ${required}`);
}

const duplicateSource = fs.readFileSync('duplicate.js', 'utf8');
if (!/resolvedThreshold\s*=\s*0\.70/.test(duplicateSource)) {
  throw new Error('resolved/superseded tombstone admission threshold drifted');
}

if (REBUILD_LIMITS.maxBoundaries !== 1024 || REBUILD_LIMITS.maxVisibleRecords !== 8) {
  throw new Error('Phase 5 rebuild bounds drifted');
}
if (MANUAL_LIMITS.queryResults !== 100) throw new Error('Phase 5 manual query bound drifted');

const sampleChat = [
  { role: 'user', content: 'I enter the harbor.' },
  { role: 'assistant', content: 'The harbor gate closes.' },
  { role: 'user', content: 'I wait.' },
  { role: 'assistant', content: 'The harbor remains quiet.' },
];
const plan = planChronologicalRebuild(sampleChat);
if (plan.windows.length !== 2 || plan.windows[0].messageId !== 1 || plan.windows[1].messageId !== 3) {
  throw new Error('Phase 5 chronological assistant-boundary planning failed');
}

const empty = createState('phase5-validate');
const query = queryWorldState(empty, { text: 'anything' });
if (query.records.length !== 0) throw new Error('empty manual query should return no records');
const resetPreview = previewWorldStateReset(empty);
if (resetPreview.kind !== 'world_state_alpha_reset_preview') throw new Error('reset preview contract drifted');

const localRebuild = await runManualRebuild({
  state: empty,
  chat: [{ role: 'user', content: 'No assistant exchange exists yet.' }],
  chatKey: 'phase5-validate',
});
if (localRebuild.outcome !== 'completed' || localRebuild.providerCalls !== 0) {
  throw new Error('no-assistant rebuild must remain a local zero-provider operation');
}
if (!compareWorldStateSemantics(empty, localRebuild.state).equivalent) {
  throw new Error('empty local rebuild semantic equivalence failed');
}

console.log(`World State Alpha Phase 5 validation passed: ${plan.windows.length} bounded assistant windows; manual query local; rebuild explicit-only and host-neutral.`);
