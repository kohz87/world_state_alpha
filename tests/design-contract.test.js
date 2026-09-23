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
    /at most six developments/i,
    /Phase 5 exposes host-neutral service functions only/i,
    /current raw-message head/i,
    /preview-then-confirm/i,
    /never an automatic response to incompleteness/i,
    /do not replay lazy evolution/i,
    /atomically replace canonical state only after the complete chronological pass succeeds/i,
    /Phase 6 is a \*\*projection layer only\*\*/i,
    /maintenance buttons emit caller-owned action intents/i,
    /ordinary Current\/Recent\/Resolved\/Places\/Search\/Data views must not expose raw record IDs/i,
    /explicit Operations inspector is the sole exception/i,
    /diagnostics pass through the existing allowlist sanitizer before display/i,
    /does not register SillyTavern event hooks/i,
    /Phase 7 supplies the smallest real SillyTavern host shell/i,
    /NPC State Delta remains completely independent/i,
    /No external-extension state adapter is authorized in Phase 7/i,
    /All asynchronous provider-backed work is guarded by current chat identity/i,
    /Rebuild never becomes automatic/i,
    /Writer State, narrative plans, Story Director output, anticipated events, consequence timers, arc\/scene planning, and spatial hypotheses are not canonical World State evidence/i,
    /Spatial state changes only from trusted base geography/i,
    /Spatial Continuity is an \*\*optional sibling subsystem\*\*/i,
    /never stores locations, spatial relations, or routes inside `records\[\]`/i,
    /Ternia is an adapter\/acceptance fixture, not core ontology/i,
    /Spatial automatic capture shares the existing eligible Reality capture request/i,
    /Canonical schema version 2 adds the durable `spatial` namespace/i,
    /suppress both Reality and Spatial private continuity injection/i,
    /allowlist only explicit successful capture boundary outcomes/i,
    /structurally malformed Reality or Spatial mutation row/i,
    /bare prospective `next \.\.\.` phrases are not elapsed evidence/i,
    /separate ephemeral bounded tombstone posting index/i,
    /Provider-authored rebuild mutations are narrative authority, not operator authority/i,
    /Direct relation proposals use the same grounding policy/i,
    /explicit `World_State` current-location header/i,
    /must likewise not keep the awaited `MESSAGE_SENT` preparation path open/i,
  ]) assert.match(contract, expected);
});

test('reference is pinned to inspected Delta main', () => {
  const ref = fs.readFileSync('docs/REFERENCE_REVIEW.md', 'utf8');
  assert.match(ref, /d20bf1dd03f85fe32ab11abb0363ec32eaa66d03/);
  assert.match(ref, /1\.0\.35/);
});
