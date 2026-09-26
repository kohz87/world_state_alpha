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
