# World State Alpha open questions

Only decisions that genuinely need user preference remain here.

Resolved: Phase 2 automatic capture defaults to one eligible capture after each completed assistant exchange, with empty/system-only exchanges skipped cheaply and duplicate raw-message receipts suppressed.

Resolved: Phase 3 private injection defaults to a hard 800 conservative local-token-unit budget, at most six selected records, shallow `IN_CHAT` SYSTEM placement at depth 1, and a much smaller typical payload.

## 1. Automatic lazy-evolution latency policy

Two valid product behaviors:

- correctness-first: if a newly relevant stale development clearly requires catch-up, await one bounded evolution before the RP request
- latency-first: inject last-established state now and perform catch-up only on explicit/manual or post-turn opportunity

Recommended starting point: correctness-first only for explicit meaningful time skips/direct affecting events; otherwise no evolution.

User decision before Phase 4: acceptable tradeoff.

Everything else in the first-pass specification can be resolved by repository inspection and engineering judgment.
