import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('design remains universal and scope-free', () => {
  const model = fs.readFileSync('docs/DATA_MODEL.md', 'utf8');
  assert.match(model, /No \`scope\`/);
  assert.doesNotMatch(model, /"scope"\s*:/i);
});

test('durable model has fact and development, not event', () => {
  const architecture = fs.readFileSync('docs/ARCHITECTURE.md', 'utf8');
  assert.match(architecture, /two kinds/i);
  assert.match(architecture, /fact/i);
  assert.match(architecture, /development/i);
  assert.match(architecture, /Do not create a third durable Event/i);
});

test('core safety invariants are present', () => {
  const contract = fs.readFileSync('docs/core-contract.md', 'utf8');
  for (const expected of [
    /private world continuity/i,
    /not automatic player-character knowledge/i,
    /no full-world scan/i,
    /fail closed/i,
    /never edits the lorebook/i,
    /does not modify Ukiyo/i,
    /Writer's Mind/i,
    /those instructions are not inherited by capture or evolution/i,
    /are narration concerns and are not evidence/i,
    /Elapsed time is permission to evaluate/i,
    /zero evolution calls on ordinary relevant turns/i,
    /at most four developments/i,
    /Phase 5 exposes host-neutral service functions only/i,
    /current raw-message head/i,
    /preview-then-confirm/i,
    /never an automatic response to incompleteness/i,
    /do not replay lazy evolution/i,
    /atomically replace canonical state only after the complete chronological pass succeeds/i,
  ]) assert.match(contract, expected);
});

test('reference is pinned to inspected Delta main', () => {
  const ref = fs.readFileSync('docs/REFERENCE_REVIEW.md', 'utf8');
  assert.match(ref, /d20bf1dd03f85fe32ab11abb0363ec32eaa66d03/);
  assert.match(ref, /1\.0\.35/);
});
