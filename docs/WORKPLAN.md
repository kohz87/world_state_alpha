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
- stale-relevant trigger logic
- one batched targeted evolution request
- stability/no-change outcome
- resolve/supersede
- conservative derived-development gate

Acceptance:

- meaningful five-week skip can update one relevant stored development
- time passage with no causal support leaves it stable
- dormant irrelevant records receive no calls
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
- canonical schema migration 1 -> 2 with empty Spatial state for legacy campaigns
- generic Cartesian 2D Spatial Core and generic base-map adapter
- Ternia v0.9.10 registry adapter/acceptance fixture
- read-only base geography plus per-chat generated locations and campaign overrides
- coordinate authority, True North validation and deterministic derivation
- writer-state narrative evidence sanitizer shared by normal capture and rebuild
- combined Reality + Spatial extraction in the existing single capture provider request
- ephemeral bounded spatial relevance index and compact private injection
- Spatial UI/manual add/edit/lock/archive/delete/merge/override/relation/route-association controls
- branch-journal/rollback/export/import/rebuild integration
- v0.9.0-alpha.1 version synchronization and release documentation
- v0.9.0-alpha.2 continuity hardening: production base-map host storage, Spatial editor correctness, host identity migration, runtime cancellation/serialization, retrieval/rebuild recovery, and collapsible settings

Acceptance:

- existing Reality Core regression suite remains green
- no Spatial entry enters `records[]`
- Spatial disabled adds zero Spatial injection and no new automatic provider call
- schema-1 sidecars/checkpoints migrate without data loss
- Ternia profile enforces +Y north / +X east, 5 km per unit, bounds and decimal precision
- generic/no-profile campaigns do not inherit Ternia scale, bounds, or compass assumptions; configured alternate Cartesian axes are honored
- route/travel distance never becomes Cartesian displacement without explicit straight-line evidence
- writer_state-only plans cannot establish Spatial or Reality evidence
- campaign overrides never modify base source geography
- manual edits are journaled and exact branch rollback restores Spatial state
- 1000-location fixture retrieves through bounded local indexing
- Megumin/Ukiyo remain untouched
