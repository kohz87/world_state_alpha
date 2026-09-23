# World State Alpha open questions

Only decisions that genuinely need user preference remain here.

Resolved: Phase 2 automatic capture defaults to one eligible capture after each completed assistant exchange, with empty/system-only exchanges skipped cheaply and duplicate raw-message receipts suppressed.

Resolved: Phase 3 private injection defaults to a hard 800 conservative local-token-unit budget, at most six selected records, shallow `IN_CHAT` SYSTEM placement at depth 1, and a much smaller typical payload.

Resolved: Phase 4 uses correctness-first lazy evolution for stale relevant active developments with a meaningful elapsed-time hint or grounded direct affecting evidence. Meaningful elapsed time may additionally fill the same request with up to three stale remote active developments from a bounded 32-entry indexed background sample. Relevant targets retain priority, the combined batch is capped at six, ordinary no-trigger turns use zero evolution calls, and elapsed time permits evaluation but never forces change.

Resolved: Phase 5 manual correction is attached only to the current raw-message head on the proven branch and requires an operator note; reset/import use preview-then-confirm; rebuild is explicit-only, bounded by assistant-completed exchange windows, atomic on success, reuses the capture firewall, and does not replay lazy evolution.

Resolved: Phase 6 uses a projection-only adaptive panel with Current / Recent / Resolved / Places / Search / Operations / Data views. Reality records expand inline on desktop/tablet/mobile; Places keeps the adaptive split/single-pane editor; mobile uses Current / Places / Ops / More bottom navigation plus full-height rebuild sheets. Maintenance/range/cancel controls emit intents only and do not acquire mutation authority.

Resolved: Phase 7 uses a minimal settings-card host with no separate launcher/watchdog framework and no generic slash-command family. It mounts the existing Phase 6 panel, stores only World State sidecar pointers under `extension_settings.world_state_alpha`, uses the existing private prompt key, and has no NPC State/Ukiyo/Megumin dependency or external-state adapter.

Resolved: Phase 8 uses an ephemeral per-chat relevance index with a 128 candidate cap, unreferenced evidence compaction on mutation with undo-patch preservation, application version 0.8.0-alpha.1 with immutable schema version 1, pure JS PKZip packaging with fixed timestamps, and a live acceptance protocol (`docs/LIVE_ACCEPTANCE.md`).

There are currently no unresolved design questions for Phases 1-9. The 0.9.0-alpha.7 through 0.9.0-alpha.18 hardening work is deterministic-test complete, including live rebuild interoperability, fenced-response compatibility, completeness capture, responsive/flat operator UX, passive-lineage protection, virtual hidden-message rebuild, the Alpha.15 integrity pass, Alpha.16 lifecycle reconciliation recovery, Alpha.17 manual history controls, and Alpha.18 durable semantic lineage hardening. Live SillyTavern/provider/browser acceptance, including timeout/cancel rebuild behavior, user-send timing, real Ternia registry import, Megumin display continuity, and explicit World_State coordinate extraction quality, is tracked via `docs/LIVE_ACCEPTANCE.md`.


Resolved for Phase 9:

- Spatial is optional and separate from Reality Core; location is not a third record kind.
- Canonical schema bumps to 2; sidecar/bundle/journal envelope formats stay at 1.
- Spatial extraction shares the existing eligible capture request rather than adding automatic provider fanout.
- Base maps are immutable read-only sources; campaigns store only a reference plus generated state/overrides.
- Ternia is an adapter/acceptance fixture, not core ontology.
- No Atlas renderer, Story Director, Megumin modification, or information-propagation simulator is part of 0.9.
