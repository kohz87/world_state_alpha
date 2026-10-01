# World State Alpha - agent instructions

## Authority and scope

Read in order:

1. `AGENTS.md`
2. `docs/core-contract.md`
3. `docs/ARCHITECTURE.md`
4. `WORKFLOW.md`
5. `docs/WORKPLAN.md`
6. `docs/REFERENCE_REVIEW.md`
7. `docs/TEST_PLAN.md`
8. `docs/RISK_REGISTER.md`

The user's current instruction controls scope and authorization. The core contract is the behavior authority. Architecture describes the accepted intended shape. The workplan defines implementation stages, not alternate runtime systems.

The design and runtime candidate are accepted and **Phases 1-9** are implemented. Phase 9 introduced optional Spatial Continuity in 0.9.0-alpha.1; subsequent 0.9 alphas hardened host lifecycle, capture completeness, rebuild integrity/interoperability/UX, branch ownership, hidden-message recovery, and session/device hydration. The current 0.9.0-alpha.43 candidate is audit batch 2 (capture and injection quality): relevance reads the newest end of the recent window and ignores function words (records and Places), Spatial selection needs a name match or more than one shared description word; updates never erase anchors or trend by accident (unsupported anchors and unknown trends keep the record's values, the duplicate gate keeps trend, evolution adds anchors rather than replacing them); a response cannot change a record it already ended nor create the same condition twice; evolution accepts one json code fence like capture; a narrated time skip after the same phrase in dialogue is detected; a hidden assistant reply ends its live-capture exchange and an excluded-hidden rebuild never sends hidden turns; checklist bullets with colons are kept and the exchange budget holds; Spatial injection never shows placeholder names, capture never renames a place to an un-narrated name, and an invented out-of-bounds coordinate is dropped without losing the place. Alpha.42 is a data-safety batch from a whole-codebase audit: a journal entry never claims an undo base below the journal floor (rolling back a message after a rollback onto the floor fails closed instead of keeping its changes); a chat's first sidecar write is revision-checked against the deterministic file instead of overwriting another device's sidecar; a rename carries the authoritative server sidecar and may replace a destination only when it is still retired or empty (renaming back works); rebuild advances past an assistant reply with no narration instead of failing on it; the Spatial wire emits optional location/route fields only when the model supplied them (revisits and route mentions no longer wipe type/context/notes/endpoints), a narrated relation without a distance keeps its distance mode, place Lock/Save read coordinates from canonical state, and Add place refuses an existing name; a full rebuild seeds its root checkpoint after assembling Spatial; bulk selections are pinned to the row they were ticked on; and import file pickers open before the chat queue. Alpha.41 closes the gap between live capture and rebuild: live capture now carries rebuild's recovery instruction word for word (recover every persistent condition, including off-screen, ignored, or unrelated to the PC objective; only rebuild keeps its historical-boundary framing), and live captures that failed and were never recovered (derived only from the non-canonical Operations log, keyed by message and lineage; cleared by a later successful capture of that message and lineage, a completed rebuild covering it, or an import/reset; a capture whose save failed counts as failed; log trimming never drops one) are offered as **Recapture from message N**, a From-message rebuild starting at the earliest failure, confirmed before any write (still exact-prefix, atomic, and never automatic); failure rows save immediately and pending rows flush on hide. Alpha.40 keeps the panel shell and rebuild sheet on-screen on tablets: SillyTavern's `html { transform: translateZ(0) }` plus its fixed mobile `<body>` below 1000px made `<html>` a zero-height containing block, so the `inset: 0` fixed layers collapsed and the rebuild sheet rendered above the screen on portrait tablets; both layers now size from the viewport and the sheet's Cancel / Start Rebuild row is sticky. Alpha.39 keeps the operator's scroll position in the World record list and Places list when the panel re-renders (selecting, expanding or bulk-ticking a row no longer jumps to the top; a tab change still starts at the top). Alpha.38 adds a bulk manual lifecycle action: a Select mode in the World panel lets the operator mark many active records resolved or superseded at once; the host re-validates every selected record against current state, requires one operator note and confirmation, and commits the whole selection as one all-or-nothing manual boundary capped at 100 records (summaries unchanged, no new durable format). Alpha.37 makes a failed manual rebuild resumable: a genuine boundary failure leaves an in-memory, never-persisted resume point that only an explicit operator Resume consumes, re-sending the failed boundary's unmodified request (never a correction retry) and refusing if the chat, canonical state, or rebuild settings changed; replacement stays atomic. Alpha.36 told capture and evolution to escape every double quote inside JSON strings (dialogue quotation marks in verbatim excerpts included; quote-free excerpts are also accepted because grounding ignores punctuation) and removes the prompt's own raw-quoted example; malformed output stays fail-closed. Alpha.35 taught capture that a death, destruction, or elimination established by the current exchange ends dependent shown records (resolve conditions they ran or suffered, keep the death itself current by updating the subject's state record or creating a fact; a threatened or suspected death ends nothing) and asks for present-condition create/update summaries instead of past-event narration; lifecycle slots and scene-context antecedents stay development-only. Alpha.34 accepted `stable` evolution evaluations that omit their trigger supportId by recording the target's own elapsed/current trigger as provenance (the prompt now asks every evaluation to cite it; changed outcomes stay strict), so an all-stable catch-up no longer invalidates the batch and repeats. Alpha.33 kept World State through ordinary chat editing: a local tail delete/regenerate rolls back (only a stored tail this session never proved against its own chat is treated as a newer server sidecar), swiping back to a captured reply resumes an in-memory parked branch exactly on an identical base, a settled existing swipe or edited latest reply is captured after a short debounce, a state with nothing journaled is exact from an equal on-branch checkpoint, hide/unhide (`is_system` only) is visibility-only and rebased, rollback starts at the first real change with the proven prefix rebased, the Operations log persists per chat in its own non-canonical `world-state-alpha-ops-*` server file, and partial rebuild names the earliest provable start. Alpha.32 accumulated narrated day steps (at most one per exchange, 40-message lookback, recomputed from the current branch, lineage-bound, offered only while fresh) into one meaningful elapsed hint at two days; accumulated time keeps the authority of an explicit skip (permission to evaluate, never evidence of change). Alpha.31 placed the floating button in viewport pixels so it stays on-screen under SillyTavern's mobile layout, and adds setting-neutral capture guidance that a single shown incident can establish an ongoing arrangement (control of a place, levies/tolls/protection payments, blockade/curfew/checkpoint) with dialogue-borne claims kept attributed; the source firewall is unchanged. Alpha.30 added one optional World-State-owned floating button (`launcher.js`) that only opens the existing panel; the launcher gate is narrowed to that button, while watchdog/MutationObserver, cross-extension launcher coordination, and slash-command gates remain. Alpha.29 fixed Places duplicate merging (archived/merged places leave the operator list, id-based merge suggestions, stable place selection keys, surfaced Spatial action rejections). Alpha.28 redesigned the projection-only operator panel (World / Places workspace, grouped trend-coded record rows, read-first Places with display-only nesting/duplicate hints) without changing durable formats or host actions. Alpha.27 made the same-backend SillyTavern sidecar explicitly server-authoritative across desktop/mobile/tabs: hydrated browser state is revision-aware, meaningful boundaries refresh newer durable revisions, stale cross-session writers are rejected and rehydrated, and a newer sidecar is preserved fail-closed when the local host chat is behind. Alpha.26 rapid branch-write race hardening, Alpha.25 host-ready hydration/missing-sidecar recovery, Alpha.24 Coordinate Profile controls, Alpha.23 pre-1.0 simplification, and earlier lifecycle hardening remain intact. Sidecar, bundle, and rollback-journal envelope versions remain 1. Spatial may share per-chat persistence, branch ownership, diagnostics, provider routing, settings and UI shell, but it must not become a third Reality Core record kind, mutate base-map sources, add Story Director behavior, or modify Megumin/Ukiyo.

## Product boundary

World State Alpha maintains current dynamic world reality. It is not a Story Director, map engine, economy engine, calendar engine, NPC simulator, news simulator, quest generator, or replacement for lorebooks, Memorybook, NPC State, Ukiyo, or ordinary RP reasoning.

The product loop is:

```text
completed exchange
 -> conservative world-change capture
 -> canonical current-state mutation
 -> branch-safe persistence
 -> relevance retrieval
 -> optional bounded lazy catch-up for stale relevant developments
 -> optional bounded background catch-up for established remote active developments on meaningful elapsed-time boundaries
 -> compact private continuity injection
 -> existing RP model / Ukiyo continues normal narration
```

## Universal-model rule

Never require setting-specific ontology. In particular, do not make any of these mandatory schema concepts:

- scope
- region
- polity
- nation
- faction
- settlement
- continent
- direction
- government
- dungeon
- organization type
- fantasy calendar

The Reality Core models change, not maps. Optional Spatial Continuity may model established/generated place continuity through its separate `spatial` namespace; do not introduce geography into Reality Core `records[]`.

## Spatial subsystem rule

Spatial Continuity is optional and semantically separate from Reality Core.

- never add `location` as a Reality record kind
- never place Spatial locations/relations/routes in `records[]`
- base geography is read-only source authority; campaign overrides live only in per-chat state
- precise coordinates require trusted base/manual/narrative-explicit evidence or deterministic derivation
- route/travel distance is not straight-line displacement unless explicitly established
- True North and unit-scale derivation are determined only by an explicit coordinate profile; no profile means no hidden setting-specific defaults
- `writer_state` and other planning material is never canonical evidence
- manual spatial edits use the branch journal and are campaign authority
- no full base-map/spatial scan on normal turns

## State model rule

Prefer one generic record schema with only two semantic kinds:

- `fact`: something presently true
- `development`: an established ongoing condition that can change

Do not add a durable `event` record class unless implementation evidence proves it is necessary. Historical events belong in evidence/mutation provenance and may establish or change current records.

Keep one canonical state owner, one persistence boundary, one branch/rollback owner, one model-request dispatcher, one relevance/injection owner, and one diagnostics owner.

## Authority firewall

Source precedence is semantic, not merely lexical:

- explicit current campaign evidence may establish current state
- accepted World State is current dynamic authority
- lore is baseline/static canon and causal possibility
- lore possibility is never proof of current occurrence
- stale baseline must not overwrite accepted current campaign state
- resolved/superseded records are tombstoned against passive lore resurrection
- ambiguous proposals are not permanent world facts
- no model output may create unsupported plot events

World State never rewrites source lore.

## World motion rule

Evolution may update established developments only from grounded causality. Never optimize for drama, challenge, pacing, quests, escalation, player engagement, or climax.

Passage of time alone does not require change. Quiet stability and quiet resolution are valid.

Derived developments must be conservative, deduplicated, causally grounded, and bounded. Prefer updating an existing record over creating a new one.

## Player-knowledge boundary

Stored world reality is private continuity context, not automatic player-character knowledge. Injection must say this explicitly. The extension does not itself narrate discoveries or information propagation in Alpha.

## Branch safety

Every automatic canonical mutation must be traceable to raw-message lineage and source evidence. Swipe, delete, edit, truncate, or branch changes must not leave abandoned-branch world state behind.

Recovery is exact-boundary/fail-closed. Never substitute a convenient older snapshot when the requested parent boundary cannot be proven.

## Performance rule

Normal turns must not:

- scan the full chat
- scan the full world database
- evolve every record
- inject every record
- fan out per-record model calls
- block ordinary RP on background completeness work

Use small current-exchange capture, deterministic/local relevance ranking, and bounded targeted evolution only when justified.

## NPC State coexistence

Use the `world_state_alpha` namespace for settings, storage, DOM, prompt keys, globals, bundles, diagnostics, commands, and sidecars.

Do not read or mutate NPC State Delta storage. World State may store world-significant person facts but never detailed NPC dossier ownership such as personality, speech, mood, appearance, relationship, or behavioral profile.

No installed-extension dependency on NPC State Delta is allowed.

## Reference repository rule

NPC State Delta is a reference only. The design pass is pinned to current Delta main commit `d20bf1dd03f85fe32ab11abb0363ec32eaa66d03` / release `1.0.35`.

Do not modify Delta. Do not copy its NPC semantics, relationship machinery, appearance/forms, social graph, birthdays/calendar engine, candidate admission model, cast scanning, portrait system, or accumulated migration surface.

Reuse architectural lessons only where they simplify World State.

## Development discipline

Inspect repository HEAD, working tree, remote state, and available tools before changing files.

Use isolated worktrees for implementation. Preserve unrelated work. Do not silently broaden a phase.

Before release publication, run the repository-defined validation/test/package/prompt-measurement workflow for the exact candidate. Synthetic tests do not prove live SillyTavern/provider behavior.

## Reporting

Report:

- what changed
- current phase/status
- deterministic verification performed
- live boundaries still unverified
- commit/PR when created

Do not describe design documents as a completed runtime product.
