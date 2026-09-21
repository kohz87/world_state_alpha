# World State Alpha open questions

Only decisions that genuinely need user preference remain here.

Resolved: Phase 2 automatic capture defaults to one eligible capture after each completed assistant exchange, with empty/system-only exchanges skipped cheaply and duplicate raw-message receipts suppressed.

## 1. Default injection budget

Recommended initial engineering default: 700-900 tokens maximum with a much smaller typical output, because world state is supplementary to lore/NPC continuity.

User decision before Phase 3: preferred default cap.

## 2. Automatic lazy-evolution latency policy

Two valid product behaviors:

- correctness-first: if a newly relevant stale development clearly requires catch-up, await one bounded evolution before the RP request
- latency-first: inject last-established state now and perform catch-up only on explicit/manual or post-turn opportunity

Recommended starting point: correctness-first only for explicit meaningful time skips/direct affecting events; otherwise no evolution.

User decision before Phase 4: acceptable tradeoff.

Everything else in the first-pass specification can be resolved by repository inspection and engineering judgment.
