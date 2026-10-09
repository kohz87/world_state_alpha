# World State Alpha staged workplan

Status: architecture and runtime accepted. Phases 1-9 implemented candidates.

## Phase 0 - architecture/bootstrap

Deliverables:

- controller registration
- AGENTS/WORKFLOW
- reference review
- core contract
- architecture/data model
- deterministic design validator
- test/risk plans

Acceptance:

- repository is accessible through controller as Alpha
- Delta remains separate reference
- no runtime extension implementation exists
- design validator passes

## Phase 1 - canonical state + branch-safe persistence [IMPLEMENTED CANDIDATE]

Build only:

- state normalizer/reducer
- per-chat sidecar storage
- deterministic IDs
- evidence store
- record-level rollback journal
- exact lineage/checkpoint recovery
- export/import/reset primitives

No model prompts yet.

Acceptance:

- create/update/resolve/supersede mutations deterministic
- branch/swipe/delete fixtures restore exact state
- deep-tail delete fails closed when exact recovery unavailable
- corruption/revision/retry tests pass
- no `scope` field in schema

## Phase 2 - immediate capture [IMPLEMENTED CANDIDATE]

Build:

- request dispatcher/provider profile support
- compact current-exchange capture prompt
- wire-schema validator
- source firewall
- duplicate admission/consolidation
- stale-result rejection
- diagnostics receipts

Acceptance:

- no-change exchanges produce no mutation
- lore possibility alone cannot create current state
- direct established fact stores in one pass
- duplicate proposals consolidate
- one automatic capture request maximum per eligible exchange
- fantasy/sci-fi/social fixtures use identical schema

## Phase 3 - relevance + injection [IMPLEMENTED CANDIDATE]

Build:

- anchor extraction/normalization
- local relevance ranking
- causal one-hop expansion
- hard injection budget
- unique SillyTavern prompt key
- private-reality/player-knowledge header

Acceptance:

- relevant fact later injects
- unrelated records do not
- hundreds-record fixture still injects tiny subset
- no model call for retrieval
- NPC State simultaneous install has no namespace/prompt collision

## Phase 4 - lazy evolution + elapsed time [IMPLEMENTED CANDIDATE]

Build:

- opaque time/elapsed evidence capture
- stale-relevant trigger logic plus bounded indexed background-development selection
- one batched targeted evolution request capped at six total targets
- stability/no-change outcome
- resolve/supersede
- conservative derived-development gate

Acceptance:

- meaningful five-week skip can update one relevant stored development
- time passage with no causal support leaves it stable
- remote background records receive no calls without meaningful elapsed time; eligible background selection examines at most 32 indexed active-development entries and may fill up to three batch slots
- no thread explosion
- resolved record does not resurrect from lore

## Phase 5 - manual controls + rebuild [IMPLEMENTED CANDIDATE]

Build:

- inspect/query
- targeted update
- rebuild
- reset/export/import UX
- bounded chronological rebuild pipeline
- incremental-vs-rebuild equivalence fixture

Acceptance:

- rebuild never runs automatically
- controlled fixture converges to equivalent current state
- foreign import does not invent local message provenance

## Phase 6 - UI + evidence inspection [IMPLEMENTED CANDIDATE]

Build:

- Current / Recent / Resolved
- free-text search
- record detail/evidence
- diagnostics
- data/maintenance

Acceptance:

- desktop/mobile readability
- UI is projection of canonical state only
- backend internals not required for ordinary use

## Phase 7 - coexistence hardening [IMPLEMENTED CANDIDATE]

Build/test:

- NPC State Delta co-install
- Ukiyo unchanged
- settings/DOM/global/storage/command isolation
- optional external-state adapter boundary only if explicitly authorized

Acceptance:

- both extensions operate independently
- no duplicate dossier ownership
- no prompt-key collision
- no database reads/writes across namespaces

## Phase 8 - performance and release hardening [IMPLEMENTED CANDIDATE]

Build and measure:

- ephemeral per-chat relevance index caching (`relevanceIndices`, `buildRelevanceIndex`, `updateRelevanceIndex`)
- candidate cap saturation (128) and deterministic priority sorting (exact anchors outrank common summary tokens)
- unreferenced evidence compaction on canonical mutations (`compactEvidence`) while preserving undo patch rollback integrity
- application version synchronized to `0.8.0-alpha.1` across manifest, package, and runtime entrypoint
- persisted schema, sidecar format, bundle, and rollback journal versions preserved at 1
- pure-JS deterministic PKZip archive and release manifest generation (`scripts/package-design.mjs`)
- prompt, token, latency, and index scalability benchmarks (`scripts/measure-design.mjs`)
- live acceptance protocol in real SillyTavern environment (`docs/LIVE_ACCEPTANCE.md`)

Acceptance:

- normal turn does no full-chat/full-world work (1000-record index retrieval scores $\le 16$ candidate records)
- capture/evolution prompts remain compact (<24,000 characters)
- evidence storage bounded across 1000 sequential updates (canonical evidence bounded to active record refs)
- package archive and release manifest are 100% byte-reproducible (SHA-256 verified across repeat builds)
- live SillyTavern/provider acceptance protocol documented in `docs/LIVE_ACCEPTANCE.md`

## Why this order differs slightly from the proposed nine phases

Relevance/injection is moved before evolution. This proves that persistent state is useful without simulation first and prevents evolution machinery from dictating the storage ontology. UI is delayed until the canonical state and lazy lifecycle are stable.


## Phase 9 - Spatial Continuity [IMPLEMENTED CANDIDATE]

Deliverables:

- optional sibling `spatial` namespace; Reality Core fact/development schema unchanged
- canonical schema 2 with sibling Spatial state
- generic Cartesian 2D Spatial Core and one setting-agnostic base-map document contract
- read-only base geography plus per-chat generated locations and campaign overrides
- coordinate authority, True North validation and deterministic derivation
- writer-state narrative evidence sanitizer shared by normal capture and rebuild
- combined Reality + Spatial extraction in the existing single capture provider request
- ephemeral bounded spatial relevance index and compact private injection
- Spatial UI/manual add/edit/lock/archive/delete/merge/override/relation/route-association controls
- branch-journal/rollback/export/import/rebuild integration
- v0.9.0-alpha.1 version synchronization and release documentation
- v0.9.0-alpha.2 continuity hardening: production base-map host storage, Spatial editor correctness, host identity migration, runtime cancellation/serialization, retrieval/rebuild recovery, and collapsible settings
- v0.9.0-alpha.3 settings polish: replace the custom collapse shell with SillyTavern's standard inline-drawer structure and host chevron behavior
- v0.9.0-alpha.4 hardening: deterministic sidecar recovery, ownership epochs/tombstones, historical rename-lineage migration, owner-probed deletion, chat-bound panel actions, bounded host caches, stale Spatial-ID rejection, co-located base-anchor preservation, and profileless generic-map handling
- v0.9.0-alpha.5 capture completeness: keep the one-call source-firewalled capture path, but require a whole-exchange sweep for each distinct materially persistent established condition, including ongoing off-screen conditions that continue independently after the PC leaves or ignores them
- v0.9.0-alpha.6 Background Development Catch-up: meaningful elapsed-time boundaries may fill the existing one-call evolution batch with a bounded indexed sample of stale remote active developments; rebuild from chat recovers narrated persistent developments but never replays hidden evolution
- v0.9.0-alpha.7 audit hardening: rebuild outcome/structural integrity, recovery prompt quarantine, sanitized chronology evidence, automatic Spatial authority parity, disabled-Spatial preservation, omission-preserving Reality updates, bounded tombstone admission, direct relation grounding, deterministic explicit current-location recovery, and non-blocking provider-backed user-send continuity
- v0.9.0-alpha.8 live rebuild hardening: exact Reality output schema under Spatial mode, bounded provider alias compatibility, persistent shared rebuild diagnostics/status, named-place salvage when only optional relation precision is unsupported, and conservative compositional proper-place grounding
- v0.9.0-alpha.9 fenced-response hardening: accept a single bare or singly fenced JSON object from providers without weakening no-prose/no-multiple-object validation or atomic rebuild semantics
- v0.9.0-alpha.10 completeness-checklist hardening: surface bounded narrator-authored World_State Off-Screen/Unresolved entries to the existing capture/rebuild request as advisory completeness hints while retaining source-firewall and exclusion rules
- v0.9.0-alpha.11 responsive operator UX: master/detail desktop, adaptive tablet, mobile bottom navigation/sheets, Operations expansion with bounded response/rejection content, atomic rebuild progress/cancel, and exact-prefix Full/Last/From range controls
- v0.9.0-alpha.12 flat disclosure UX: replace nested Reality master/detail cards with inline disclosure rows, retain expandable Operations JSON, add icon-first World continuity header, floating dismissible rebuild status, flatter maintenance sections, and hidden scrollbar arrow controls
- v0.9.0-alpha.13 passive-lineage hardening: preserve canonical state when the exact latest captured assistant boundary is passively rewritten after receipt, retain exact rollback for explicit branch events, clear stale candidates on state replacement, and expose branch reconciliation diagnostics
- v0.9.0-alpha.14 virtual hidden-message rebuild: default-on operator toggle, immutable rebuild-only role projection for eligible hidden user/assistant RP, conservative exclusion of actual system/tool/UI rows, hidden-inclusion telemetry, and no live chat visibility/lineage mutation
- v0.9.0-alpha.15 integrity hardening: source/evidence affinity and epistemic preservation, atomic malformed-envelope capture, strict durable enum validation, semantic passive-rebase protection, hidden system/tool precedence, stale rebuild compensation, and late event-source registration retries
- v0.9.0-alpha.16 lifecycle reconciliation recovery: explicitly retire grounded completed/replaced developments and reserve up to two bounded lifecycle candidates during chronological rebuild so later narrated endings close earlier reconstructed threads without evolution replay or provider fanout
- v0.9.0-alpha.17 manual history controls: expanded active Reality rows expose explicit resolve/supersede intents, require operator evidence, validate stale opaque row snapshots before canonical targeting, and persist through the existing current-head manual reducer/journal path
- v0.9.0-alpha.18 durable semantic lineage hardening: persist assistant narration-equivalence metadata, rebase one or many presentation-only rewrites without undo replay, durably backfill clean Alpha.17 lineages, and fail closed with canonical records preserved when legacy semantic proof is unavailable
- v0.9.0-alpha.19 manual lifecycle host reconciliation: reconcile live lineage before Resolve/Supersede and surface fail-closed/error states instead of silently dropping queued manual actions
- v0.9.0-alpha.20 live lifecycle/partial-rebuild recovery: reserve lifecycle candidates during live capture, reconcile semantic lineage before partial-prefix proof, preserve the root checkpoint under bounded trimming, and keep prior-scene context retrieval-only
- v0.9.0-alpha.21 lifecycle identity/history admission: bind automatic non-create mutations to active targets, keep tombstones immutable to provider capture/rebuild, reject unmatched terminal history creates, and dedupe recurrences against active episodes
- v0.9.0-alpha.22 maintenance cleanup: remove proven-dead helpers/imports and synchronize design-era architecture/data-model/status documentation
- v0.9.0-alpha.23 pre-1.0 simplification: drop schema-1 and old-lineage upgrade compatibility, collapse base-map parsing to one generalized Cartesian contract, remove adapter identity, and keep map/location identity stable across source-version changes
- v0.9.0-alpha.24 Coordinate Profile controls: expose journaled manual Cartesian profile editing, make attached base-map profiles authoritative/read-only, and invalidate stale derived coordinates when profile math changes
- v0.9.0-alpha.25 session/device hydration hardening: gate canonical hydration on host readiness, retry/recheck deterministic sidecar discovery, and pause established chats with missing durable state until Full rebuild/import/reset establishes a proven baseline
- v0.9.0-alpha.26 rapid branch-write hardening: guard currentness across sidecar I/O, compensate stale in-flight canonical writes before publication, synchronously revoke passive capture ownership on explicit edit/delete/swipe events, and preserve earlier World State across immediate delete/regenerate replacement
- v0.9.0-alpha.27 server-authoritative multi-session freshness: revision-aware hydration, boundary rechecks of the same-backend sidecar, stale cross-session writer rejection, and fail-closed preservation of a newer sidecar when the host chat is behind
- v0.9.0-alpha.28 operator panel redesign: World / Places workspace with a More menu, grouped trend-coded record disclosures, read-first Places with display-only nesting/duplicate hints, and consolidated scoped CSS; projection-only, no durable-format or host-action change
- v0.9.0-alpha.29 Places merge repair: hide archived/merged campaign places from the operator list while keeping archived base-map overrides reachable, id-based duplicate merge suggestions, id-derived place selection keys, active-only relative-anchor resolution, and surfaced archive/merge/lock/delete rejections
- v0.9.0-alpha.30 floating World State button: one opener-only, draggable, per-browser-positioned `launcher.js` button with a left-side default, hidden when World State or the setting is off, stacked below host drawers/popups, and isolated from hydration failures
- v0.9.0-alpha.31 mobile placement and arrangement capture: compute the floating button's default spot in viewport pixels (SillyTavern's transformed, zero-height <html> broke CSS percentages on phones/tablets), and add capture guidance for ongoing arrangements shown through one incident with attributed dialogue-borne claims
- v0.9.0-alpha.32 accumulated day steps: narrated day steps since the last persisted elapsed catch-up (one per exchange, hidden/quoted/planned/hypothetical excluded, lineage-bound, fresh-window only) combine into one meaningful elapsed hint at two days; last elapsed boundary tracked incrementally on the relevance index
- v0.9.0-alpha.33 branch continuity through ordinary editing: local tail delete/regenerate rolls back instead of failing closed as host-chat-behind, parked swipe branches resume exactly, settled existing swipes and edited latest replies are captured, unjournaled states are exact from an equal on-branch checkpoint, hide/unhide is visibility-only with rollback from the first real change, the Operations log persists in its own per-chat server file, and partial rebuild names the earliest provable start; durable formats unchanged
- v0.9.0-alpha.34 stable evolution provenance: the evolution prompt asks every evaluation to cite its trigger support; a `stable` evaluation that omits it records its own target's elapsed/current trigger instead of invalidating the batch; changed outcomes stay strict; durable formats unchanged
- v0.9.0-alpha.35 death ends dependent records: setting-neutral capture rule that an established death/destruction/elimination resolves conditions the dead ran or suffered and keeps the death current (update the subject's state record or create a fact; threats end nothing), present-condition create/update summaries, and a fact-inclusive per-request LIFECYCLE CHECK; durable formats unchanged
- v0.9.0-alpha.36 parseable model JSON: capture and evolution prompts require escaping every double quote inside strings (quote-free excerpts also accepted) and drop the capture prompt's raw-quoted example; malformed output stays fail-closed with no repair; durable formats unchanged
- v0.9.0-alpha.37 resumable rebuild: a boundary failure keeps an in-memory resume point (candidate before the failed boundary + snapshot token + plan) that only an explicit operator Resume consumes, re-sending the unmodified request, refused if chat/state/settings changed, still atomic; panel Resume from message N; durable formats unchanged
- v0.9.0-alpha.38 bulk manual lifecycle: World panel Select mode with Select all shown, Mark resolved / Mark superseded for up to 100 active records; the host re-validates each selected row against current canonical state, takes one note and one confirmation, and `applyManualLifecycleBatch` commits one all-or-nothing manual boundary; no durable format change.
- v0.9.0-alpha.39 panel scroll retention: the wholesale panel re-render restores scroll offsets remembered from scroll events per list identity (chat, tab, filters, Places detail state), so selecting, expanding and bulk ticks no longer reset to the top, another chat or filter still starts at the top, and the phone Places list survives a detail; no format change.
- v0.9.0-alpha.40 tablet rebuild sheet: the panel shell and rebuild sheet layer size from the viewport (`100vw`/`100dvh`) instead of `inset: 0`, because SillyTavern's transformed `<html>` collapses to zero height under its fixed mobile `<body>` below 1000px; the sheet's action row is sticky; UI-only.
- v0.9.0-alpha.41 live capture parity: live capture carries rebuild's recovery instruction word for word; unrecovered live capture failures (Operations-log derived, cleared by a later successful capture, a covering completed rebuild, or import/reset) are offered as an explicitly confirmed **Recapture from message N** From-message rebuild; failures are keyed by message and lineage, pinned in log trimming and recorded when a capture's save fails; failure rows save immediately and pending rows flush on hide.
- v0.9.0-alpha.42 audit batch 1 (data safety): journal-floor-bounded undo base; revision-checked first sidecar writes; server-authoritative rename with retired/empty destination reuse; empty-narration rebuild boundaries; Spatial wire optional fields and relation distance-mode coupling; canonical-state place Lock/Save; Add place duplicate guard; Spatial-aware rebuild root checkpoint; fingerprint-pinned bulk selection; import pickers outside the chat queue.
- v0.9.0-alpha.43 audit batch 2 (capture and injection quality): newest-first, function-word-free relevance for records and Places with a Spatial minimum; no accidental anchor/trend erasure (firewall, duplicate gate, wire, evolution); in-batch ended-record and duplicate-create guards; fenced evolution JSON; dialogue-safe elapsed detection; hidden-reply exchange boundaries for live capture and excluded-hidden rebuild; colon-safe checklist and exact exchange budget; Spatial injection/rename/bounds fixes.
- v0.9.0-alpha.44 audit batch 3 (Missed captures gaps): chat-switch and save-time abandonment recorded as missed captures, `superseded` settles a capture whose own message changed; hide-insensitive Operations-log lineage key for matching and clearing; full reconcile before a partial rebuild; unreadable Operations log never overwritten (postponed save with retries, rename keeps unread rows, failed load retried).
- v0.9.0-alpha.45 external audit A01-A08: server-authoritative past-chat rename; indexes rebuilt from the cached state after stale/conflicting writes; evolution index published only after save; Spatial history replayed by Reality-only rebuilds (partial and full) with a warning for inseparable history; persistent `operatorOwned` Spatial authority; same-position confirmation keeps authority; offset-anchored, meaningful-first elapsed detection.
- v0.9.0-alpha.46 external audit A09-A12 plus rebuild continuity: range-scoped rebuild staleness (appended messages keep it running); panel-open Operations log refresh; successor-durable rename of the Operations log; retried/parked log uploads; unbounded pinning of unrecovered failures; parked-branch relink after prefix rebases with a lineage-insensitive base hash.
- v0.9.0-alpha.47 external audit A13-A17 and A22-A26: malformed anchors ignored; malformed spatial containers fail closed; clause- and quote-aware attribution; reported accounts cannot end established conditions; subject-sensitive duplicate gate; place-bound, non-hearsay coordinate grounding; hypothetical places refused; metadata-preserving header supplement; contradicted directions cleared after moves; effective-id override merges.
- v0.9.0-alpha.48 external audit A19-A21 and A27-A29 plus batch 4 robustness/UX: active-only one-hop budget; rarest-first phrase/word and newest-bigram candidate discovery; newest-preserving host relevance view; route-fingerprinted rebuild Resume; Places/profile drafts kept across re-renders and rejected saves; composition-safe panel input; archived-anchor relations kept on save; failed panel actions reported; chat activations serialized per chat.
- v0.9.0-alpha.49 external audit A30 plus batch 5 performance: changed-places-only Spatial delta resolution with a cached base-map index; shared append-only history in state copies; frozen shared history entries; once-per-text sidecar verification; single-read boundary refresh for chats without a pointer; key-free injection exchange; plan-lineage rebuild commits with an event-invalidated range proof; copy-free panel scroll bookkeeping.
- v0.9.0-alpha.50 deep-pass data loss and host lifecycle: subject-safe new episodes; zero-boundary Reality-only rebuild keeps journaled places; effective place ids after base-map detach; collision-free place ids; capture start failures recorded as missed; retried network failures on save; rename-aware missing-continuity notice; editor closes with its place; branch events not held by a running rebuild; identity-based history comparison; single read on first activation; chat events counted first; reported base-map/override rejections; non-Error provider rejections.
- v0.9.0-alpha.61 deep-pass data loss and wrong state: recovery rows judged before the log trim and kept with their failure; range-bound rebuild recovery; eviction-safe, retried and successor-safe Operations-log saves; recovery-required rename without an empty sidecar; own in-flight writes never adopted; compensated revisions recorded; abandoned and branch-unavailable captures listed; failed rebuild commits end failed; stale-ownership loads and damaged sidecars kept recovery-required; physical-file and same-chat revision checks with a Web Locks read-back fallback; base-map-aware Places index; resume points kept as the chat grows; snapshot-less checkpoints fail closed; JSON-consistent checksums; locale-free matching; idempotent, surrogate-safe bounding.
- v0.9.0-alpha.60 forfeit a missed capture: per-message Forfeit in the Missed captures notice; a confirmed, version-bound `forfeited` Operations-log row clears that failure without a rebuild and changes no World State.
- v0.9.0-alpha.59 deep-pass performance, contract text and cleanups: six state copies per saved capture and none per user send; once-per-selection scene tokens; function-word anchors as names only; topic-bound rebuild lifecycle recency; indexed derived-duplicate check; mapped Places name matching; rarely recounted panel replies; limit-first, hash-once rebuild planning; one-pass Places saves; dead code removed; runtime elapsed detector under test; shared helpers in `common.js`; null status not stated; every checklist bullet style; non-array chat and trailing Places edits in Reality-only rebuild; contract C07, C12, C23.1, C24.6 corrected.
- v0.9.0-alpha.58 deep-pass panel and accessibility: host toasts above the open panel; dialog focus on open, kept across re-renders, Tab trap, Escape by layer, persistent live region; phone search kept when emptied; declined Archive/Merge/Delete keep the form; cancellable Add place; free-text relation directions shown as stated and kept on save; rendered-row record clicks; active-place rebuild counts.
- v0.9.0-alpha.57 deep-pass Places capture and host: relation direction and distance read in cited sentences naming the places, with direction usage; thousands separators; cited-sentence coordinates; firewall-paired Places dialogue; narrated routeRefs only; archived overrides and merged-away names not re-created (`mergedInto`); base routes not replaced; per-row Places cap; post-save relation True North; reducer row numbers; own-key direction aliases; Spatial toggle indexes current state; host-model rebuild pin; rename-relinked missed captures; profile error text; explained rebuild no-start; resume dropped on chat leave; registry after saved attach; saved-only detach success.
- v0.9.0-alpha.56 deep-pass hearsay, plans and time passing: reporting words only in reporting use; relative-clause and abbreviation-aware attribution; single, curly-single and bracket quotes; numeric dialogue endings and quoted names; prospective and conditional claims; speech-act records not ended by rumours; World_State planning and reasoning blocks stripped; spaced closing tags; coordinated acts outside a threat's reach; word-boundary excerpt cuts and anchors; spaceless-script pair matching; narrator messages inside the next exchange; wider skip recognition, clause-local modals, meaningful-skip precedence, per-occurrence day steps, unknown vague amounts, due-only background slot counting.
- v0.9.0-alpha.55 deep-pass data loss and wrong state: revision-free missing/corrupt sidecar stand-ins; corrupt sidecars recovery-required and replaceable only by a baseline recovery write; lower server revision adopted after a conflict; divergent adopted state kept dirty; capture guard before the base-map wait; lineage-only extensions not counted as new canonical state by a running rebuild; branch settled after import, reset and Full rebuild; injection toggles cancel nothing; every kept Operations-log row saved; operator places kept by a Places-on rebuild; position-preserving undo; anchor-only new-episode absorption refused; numeric subject identifiers; idempotent base-map bounding; distinct override and route ids; folded panel name checks; typed coordinates manual.
- v0.9.0-alpha.54 deep-pass performance and cleanups: one copy per reduction (no unused undo patches in the Reality or Places reducers, no second canonical-domain copy, one copy per commit side), skipped empty Places passes, no extra capture copy, manual edits fingerprint the chat once, one exact range check at rebuild end, panel clicks reuse the rendered model; one shared text canonicalizer and opposite-direction table, single resume lookup, no redundant routing branches, no unreachable elapsed branch, single-pass search filter.
- v0.9.0-alpha.53 deep-pass UI and relevance: search text kept as typed; focus and caret kept across re-renders; record links beyond the bounded list; Copy JSON of the shown row; declined Reset profile keeps its draft; short landscape panel; content-word anchor postings; non-ASCII-only bigrams; background scan list without retired developments.
- v0.9.0-alpha.52 deep-pass Places accuracy: locked-coordinate confirmations; narrated positions for position-less overrides; coordinates beside header names; straight-line distances only with straight-line wording; narrated near-match coordinates; whole-word place names; relations to same-name places outside the visible set; override authority through Lock/Unlock; base-map places found by name; reverse relations; active-only neighbour linking; base-map import of unknown coordinates and repeated names; injected routes; unshifted rejection rows.
- v0.9.0-alpha.51 deep-pass capture accuracy: word-boundary grounding; per-sentence attribution of multi-sentence excerpts; line-paired quotations; reported speech-act complements; self-closing planning tags; travel/schedule/duration phrases excluded from elapsed time; unknown elapsed amounts; retried background catch-up; wire-bounded evolution targets; rebuild evidence class on merged duplicates.

Acceptance:

- existing Reality Core regression suite remains green
- no Spatial entry enters `records[]`
- Spatial disabled adds zero Spatial injection and no new automatic provider call
- obsolete pre-current sidecars/checkpoints are rejected explicitly during pre-1.0 development
- generalized base maps use profile/locations/routes with no setting/version adapter
- no-profile campaigns inherit no hidden scale, bounds, or compass assumptions; configured alternate Cartesian axes are honored
- route/travel distance never becomes Cartesian displacement without explicit straight-line evidence
- writer_state-only plans cannot establish Spatial or Reality evidence
- campaign overrides never modify base source geography
- manual edits are journaled and exact branch rollback restores Spatial state
- 1000-location fixture retrieves through bounded local indexing
- Megumin/Ukiyo remain untouched
