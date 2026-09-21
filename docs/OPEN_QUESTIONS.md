# World State Alpha open questions

Only decisions that genuinely need user preference remain here.

Resolved: Phase 2 automatic capture defaults to one eligible capture after each completed assistant exchange, with empty/system-only exchanges skipped cheaply and duplicate raw-message receipts suppressed.

Resolved: Phase 3 private injection defaults to a hard 800 conservative local-token-unit budget, at most six selected records, shallow `IN_CHAT` SYSTEM placement at depth 1, and a much smaller typical payload.

Resolved: Phase 4 uses correctness-first lazy evolution only for stale relevant active developments with a meaningful elapsed-time hint or grounded direct affecting evidence. Ordinary relevant turns use zero evolution calls. Eligible records are evaluated in one batch capped at four targets; elapsed time permits evaluation but never forces change.

Resolved: Phase 5 manual correction is attached only to the current raw-message head on the proven branch and requires an operator note; reset/import use preview-then-confirm; rebuild is explicit-only, bounded by assistant-completed exchange windows, atomic on success, reuses the capture firewall, and does not replay lazy evolution.

Resolved: Phase 6 uses a projection-only responsive panel with Current / Recent / Resolved / Search / Detail / Diagnostics / Data views. Desktop uses a bounded two-pane panel; <=700 px is full-screen/stacked; maintenance controls emit intents only and do not acquire mutation authority.

Resolved: Phase 7 uses a minimal settings-card host with no separate launcher/watchdog framework and no generic slash-command family. It mounts the existing Phase 6 panel, stores only World State sidecar pointers under `extension_settings.world_state_alpha`, uses the existing private prompt key, and has no NPC State/Ukiyo/Megumin dependency or external-state adapter.

There are currently no unresolved user-preference decisions required before Phase 8. Live SillyTavern co-install/provider/browser acceptance and release-performance thresholds remain Phase 8/release-hardening work rather than new semantic decisions.
