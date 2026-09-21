# World State Alpha open questions

Only decisions that genuinely need user preference remain here.

Resolved: Phase 2 automatic capture defaults to one eligible capture after each completed assistant exchange, with empty/system-only exchanges skipped cheaply and duplicate raw-message receipts suppressed.

Resolved: Phase 3 private injection defaults to a hard 800 conservative local-token-unit budget, at most six selected records, shallow `IN_CHAT` SYSTEM placement at depth 1, and a much smaller typical payload.

Resolved: Phase 4 uses correctness-first lazy evolution only for stale relevant active developments with a meaningful elapsed-time hint or grounded direct affecting evidence. Ordinary relevant turns use zero evolution calls. Eligible records are evaluated in one batch capped at four targets; elapsed time permits evaluation but never forces change.

Resolved: Phase 5 manual correction is attached only to the current raw-message head on the proven branch and requires an operator note; reset/import use preview-then-confirm; rebuild is explicit-only, bounded by assistant-completed exchange windows, atomic on success, reuses the capture firewall, and does not replay lazy evolution.

There are currently no unresolved user-preference decisions required before Phase 6. UI presentation and host command ergonomics remain Phase 6+ decisions rather than backend-state semantics.
