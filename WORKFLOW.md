# World State Alpha workflow

## Current gate

Architecture is accepted. Phase 1 is authorized and later phases remain gated.

Allowed in the current gate:

- canonical state normalization/reducer
- evidence and causal-link storage
- deterministic IDs
- per-chat sidecar persistence abstraction
- exact branch/rollback journal and checkpoints
- export/import/reset primitives
- Phase 1 deterministic tests and validation

Not yet authorized: scanner/provider calls, capture/evolution prompts, relevance/injection, UI, commands, or host event wiring.

## Standard engineering loop

For an authorized implementation phase:

```text
inspect current main
 -> create isolated worktree from exact origin/main
 -> read AGENTS + contracts + architecture + current phase
 -> implement only the authorized phase
 -> run focused tests
 -> run full validation/test/package/prompt measurements required by that phase
 -> review diff against contracts
 -> fix findings
 -> commit candidate
 -> CI on exact candidate
 -> user/reviewer acceptance
 -> merge/publish only when explicitly authorized
```

Do not modify canonical `main` directly through local filesystem writes.

## Review discipline

A review must distinguish:

1. correctness defect
2. contract violation
3. performance risk
4. provider/live-environment boundary
5. optional enhancement

Do not turn optional enhancements into blockers unless a contract requires them.

## Reference use

When comparing with NPC State Delta:

- inspect current Delta main, never memory
- identify the invariant or pattern being reused
- remove NPC-specific assumptions
- prefer a smaller generalized implementation
- record when Delta complexity is intentionally not carried forward

## Design acceptance gate

Before Phase 1 runtime work, confirm:

- two-kind record model remains sufficient
- no mandatory scope/ontology was introduced
- branch strategy is exact-boundary/fail-closed
- source firewall is explicit
- injection privacy boundary is explicit
- normal-turn model-call budget is bounded
- lazy catch-up has conservative triggers
- coexistence namespace is isolated
- universal fixtures cover fantasy, sci-fi, and small social settings

## Verification categories

Always label evidence correctly:

- deterministic unit/integration tests
- synthetic SillyTavern host checks
- browser/UI checks
- live provider/model acceptance
- measured prompt/token/latency data

A mocked provider is not proof of live extraction quality or latency.

## Release discipline

Application versioning and persisted schema versions are separate concerns.

A release candidate must synchronize all application-version markers defined by the eventual runtime inventory and must not bump storage/journal schema versions unless their format actually changes.
