# World State Alpha staged workplan

Status: design candidate. No runtime phase is authorized yet.

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

## Phase 1 - canonical state + branch-safe persistence

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

## Phase 2 - immediate capture

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

## Phase 3 - relevance + injection

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

## Phase 4 - lazy evolution + elapsed time

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

## Phase 5 - manual controls + rebuild

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

## Phase 6 - UI + evidence inspection

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

## Phase 7 - coexistence hardening

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

## Phase 8 - performance and release hardening

Measure and compact:

- TTFT delta
- total latency
- requests per exchange
- prompt chars/tokens
- injected token count
- backend record/evidence growth
- rollback bytes
- package/CI/release consistency

Acceptance:

- normal turn does no full-chat/full-world work
- capture/evolution prompts remain compact
- package is reproducible
- live SillyTavern/provider acceptance documented separately

## Why this order differs slightly from the proposed nine phases

Relevance/injection is moved before evolution. This proves that persistent state is useful without simulation first and prevents evolution machinery from dictating the storage ontology. UI is delayed until the canonical state and lazy lifecycle are stable.
