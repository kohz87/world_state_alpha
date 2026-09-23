# World State Alpha workflow

## Current gate

Architecture and runtime implementation are accepted. Phases 1-9 are implemented as candidate releases.

Included in the current gate:

- Phase 1 canonical state, persistence, transfer, and exact rollback substrate
- Phase 2 bounded immediate capture and request-scoped provider routing
- Phase 3 deterministic local relevance and compact private injection
- Phase 4 bounded stale-relevant lazy evolution plus meaningful-elapsed-time Background Development Catch-up from the indexed active-development pool
- Phase 5 inspect/query, current-head manual correction, transfer, and explicit rebuild services
- Phase 6 bounded Current/Recent/Resolved/Search/detail/evidence/diagnostics/data-maintenance projections
- Phase 7 minimal SillyTavern manifest/bootstrap, World-State-only settings/sidecar adapter, lifecycle capture/injection/rollback wiring, and mounting the existing Phase 6 panel
- Phase 8 performance & release hardening: ephemeral per-chat relevance indexing, candidate cap saturation (128), unreferenced evidence compaction on mutation, deterministic PKZip archive and manifest generation, prompt/latency measurements, and live acceptance protocol
- Phase 9 optional Spatial Continuity: separate durable spatial namespace/reducer, schema 1->2 migration, generic Cartesian base-map adapter with Ternia acceptance adapter, shared planning-evidence sanitation, manual location editing, bounded spatial relevance/injection, deterministic explicit current-location supplementation, and shared exact branch rollback
- 0.9.0-alpha.7 audit hardening: atomic rebuild success/structural gates, unresolved-recovery injection quarantine, established elapsed chronology, provider rebuild Spatial authority parity, disabled-Spatial preservation, omission-safe Reality updates, bounded tombstone admission, grounded direct relations, and non-blocking provider-backed MESSAGE_SENT continuity
- 0.9.0-alpha.8 live rebuild hardening: exact Reality schema in Spatial prompts, conservative provider-alias repair, shared rebuild diagnostics/status, named-place salvage from unsupported optional relation metadata, and conservative compositional place-name grounding
- 0.9.0-alpha.9 fenced-response hardening: accept exactly one provider JSON object either bare or enclosed in one Markdown JSON/code fence; reject surrounding prose and retain atomic rebuild semantics
- 0.9.0-alpha.10 completeness-checklist hardening: extract a bounded advisory checklist only from narrator-authored World_State Off-Screen/Unresolved sections so less-salient persistent conditions remain visible to the same one-call source-firewalled capture/rebuild path
- 0.9.0-alpha.11 responsive operator UX: adaptive desktop/tablet/mobile projection, Operations inspection, atomic rebuild progress/cancel, safe exact-prefix partial rebuild ranges, and configurable manual rebuild boundary cap
- 0.9.0-alpha.12 flat disclosure UX: continuity icon/title branding, inline expandable Reality records, flatter Operations/Data presentation, dismissible floating rebuild status, and scrollbar-arrow suppression
- 0.9.0-alpha.13 passive-lineage hardening: protect the exact latest captured assistant boundary from unannounced host/regex/reasoning rewrites while keeping explicit edit/delete/swipe rollback authoritative and exposing branch reconciliation diagnostics
- 0.9.0-alpha.14 virtual hidden-message rebuild: optional/default-on immutable rebuild view that reclassifies eligible hidden user/assistant roleplay for recovery only, excludes genuine system/tool/UI rows, and never toggles live chat visibility or lineage
- explicit coexistence hardening against NPC State Delta and Ukiyo/Megumin ownership
- cumulative Phase 1-9 deterministic tests and validation

Still gated: any unrelated semantic subsystem, Story Director behavior, atlas renderer, external-state adapter, launcher/watchdog framework, or generic slash-command surface.

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
