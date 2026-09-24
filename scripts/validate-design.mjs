import fs from 'node:fs';

const required = [
  'README.md',
  'AGENTS.md',
  'WORKFLOW.md',
  'docs/core-contract.md',
  'docs/ARCHITECTURE.md',
  'docs/REFERENCE_REVIEW.md',
  'docs/DATA_MODEL.md',
  'docs/WORKPLAN.md',
  'docs/TEST_PLAN.md',
  'docs/RISK_REGISTER.md',
  'docs/OPEN_QUESTIONS.md',
  'docs/LIVE_ACCEPTANCE.md',
  'CHANGELOG.md',
];

for (const file of required) {
  if (!fs.existsSync(file)) throw new Error('Missing design authority: ' + file);
}

const corpus = required.map(file => fs.readFileSync(file, 'utf8')).join('\n');
for (const forbidden of [
  /"scope"\s*:/i,
  /kind\s*[:=]\s*["'`]event["'`]/i,
]) {
  if (forbidden.test(corpus)) throw new Error('Design reintroduced a forbidden mandatory ontology pattern: ' + forbidden);
}

const contract = fs.readFileSync('docs/core-contract.md', 'utf8');
for (const phrase of [
  'models change, not maps',
  'not automatic player-character knowledge',
  'exact-boundary',
  'no full-world scan',
  'World State never edits the lorebook',
  "Writer's Mind",
  'those instructions are not inherited by capture or evolution',
  'are narration concerns and are not evidence',
  'Elapsed time is permission to evaluate',
  'zero evolution calls on ordinary relevant turns',
  'at most six developments',
  'Phase 5 exposes host-neutral service functions only',
  'current raw-message head',
  'preview-then-confirm',
  'never an automatic response to incompleteness',
  'do not replay lazy evolution',
  'atomically replace canonical state only after the complete chronological pass succeeds',
  'Phase 6 is a **projection layer only**',
  'maintenance buttons emit caller-owned action intents',
  'ordinary Current/Recent/Resolved/Places/Search/Data views must not expose raw record IDs',
  'explicit Operations inspector is the sole exception',
  'diagnostics pass through the existing allowlist sanitizer before display',
  'does not register SillyTavern event hooks',
  'Phase 7 supplies the smallest real SillyTavern host shell',
  'NPC State Delta remains completely independent',
  'No external-extension state adapter is authorized in Phase 7',
  'All asynchronous provider-backed work is guarded by current chat identity',
  'Rebuild never becomes automatic',
  'Writer State, narrative plans, Story Director output, anticipated events, consequence timers, arc/scene planning, and spatial hypotheses are not canonical World State evidence',
  'Spatial state changes only from trusted base geography',
  'Spatial Continuity is an **optional sibling subsystem**',
  'never stores locations, spatial relations, or routes inside `records[]`',
  'one canonical base-map document shape',
  'Spatial automatic capture shares the existing eligible Reality capture request',
  'Canonical schema version 2 adds the durable `spatial` namespace',
  'suppress both Reality and Spatial private continuity injection',
  'allowlist only explicit successful capture boundary outcomes',
  'structurally malformed Reality or Spatial mutation row',
  'bare prospective `next ...` phrases are not elapsed evidence',
  'separate ephemeral bounded tombstone posting index',
  'Provider-authored rebuild mutations are narrative authority, not operator authority',
  'Direct relation proposals use the same grounding policy',
  'explicit `World_State` current-location header',
  'must likewise not keep the awaited `MESSAGE_SENT` preparation path open',
]) {
  if (!contract.toLowerCase().includes(phrase.toLowerCase())) {
    throw new Error('Core contract missing invariant: ' + phrase);
  }
}

console.log('World State Alpha design validation passed.');
