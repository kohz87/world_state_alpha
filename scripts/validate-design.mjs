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
  'at most four developments',
  'Phase 5 exposes host-neutral service functions only',
  'current raw-message head',
  'preview-then-confirm',
  'never an automatic response to incompleteness',
  'do not replay lazy evolution',
  'atomically replace canonical state only after the complete chronological pass succeeds',
  'Phase 6 is a **projection layer only**',
  'maintenance buttons emit caller-owned action intents',
  'ordinary rendered UI must not expose raw record IDs',
  'diagnostics pass through the existing allowlist sanitizer before display',
  'does not register SillyTavern event hooks',
]) {
  if (!contract.toLowerCase().includes(phrase.toLowerCase())) {
    throw new Error('Core contract missing invariant: ' + phrase);
  }
}

console.log('World State Alpha design validation passed.');
