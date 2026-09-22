# World State Alpha architecture

Status: ARCHITECTURE & RUNTIME ACCEPTED (Phases 1-9 implemented candidate).

## 1. Recommended core

Use **one generic record schema** with two kinds:

- `fact`
- `development`

Do not create a third durable Event table in Alpha.

An event is useful as **evidence/provenance**: something happened at message N and caused record X to be created, changed, resolved, or superseded. Storing it as a separate top-level canonical object duplicates history that already exists in chat and mutation evidence.

If later UI needs "recent events", derive that view from mutation journal/evidence.

This is the main simplification relative to the initial three-class candidate.

## 2. Runtime ownership

Suggested modules once implementation is authorized:

```text
bootstrap.js
runtime.js                 event wiring / orchestration only
state-core.js              normalization + canonical mutation reducer
capture.js                 compact prompt builder + result validation
evolution.js               targeted catch-up prompt + result validation
relevance.js               local retrieval/ranking
injection.js               compact private continuity rendering
branch.js                  lineage + mutation journal + exact rollback
storage.js                 sidecar durability + export/import
provider-routing.js        one request dispatcher
diagnostics.js             bounded receipts
ui.js                      projections/search/evidence inspection
commands.js                optional /worldstate manual controls
```

Keep modules small and semantic. Do not repeat Delta's eventual monolithic file scale.

## 3. Canonical state

```json
{
  "schemaVersion": 1,
  "records": [],
  "evidence": {},
  "links": [],
  "lineage": [],
  "rollback": {},
  "metrics": {},
  "lastCaptureMessage": null
}
```

Only `records` and bounded causal links are current domain state. Evidence, lineage, rollback, and metrics are support layers.

## 4. Record semantics

A record is a current proposition, not a history bucket.

Examples:

```json
{
  "id": "wsr_...",
  "kind": "fact",
  "summary": "East Dormitory is inaccessible after the electrical fire.",
  "status": "active",
  "anchors": ["East Dormitory", "electrical fire"],
  "trend": null
}
```

```json
{
  "id": "wsr_...",
  "kind": "development",
  "summary": "The student fee protest is active; negotiations with university administration remain stalled.",
  "status": "active",
  "anchors": ["student fee protest", "University Administration"],
  "trend": "stable"
}
```

Do not force title, type, region, owner, faction, severity, probability, or geography.

## 5. Evidence model

Evidence entries are bounded and immutable enough to explain why a mutation was accepted.

Each accepted mutation references evidence IDs. Evidence retains:

- source message ID
- lineage key/fingerprint
- compact quoted/paraphrased claim, bounded
- source class
- optional opaque time anchor
- optional relation to prior record

Do not store full transcripts in every record.

## 6. Capture flow

Capture is a compact JSON extraction/reconciliation call after a completed assistant exchange when enabled and cadence allows.

Inputs:

- current exchange only
- small set of locally relevant existing records
- relevant lore snippets already available to the host, if the integration surface permits safe bounded retrieval
- source authority rules
- current opaque time clue if present

Output is a **mutation proposal**, not replacement state.

Candidate actions:

- `create`
- `update`
- `resolve`
- `supersede`
- `noop`

The deterministic reducer validates IDs, action shape, evidence ownership, duplicate similarity, source firewall, and lifecycle rules before state changes.

If nothing material changed, output `mutations: []`.

## 7. Evolution flow

Evolution is separate from capture but uses the same dispatcher and reducer.

Target set is selected deterministically.

Inputs are only:

- target development(s)
- directly linked current facts/developments
- bounded supporting evidence
- meaningful elapsed hint/time anchor if available
- relevant lore baseline

Output may update/resolve/supersede existing records and, conservatively, propose at most a very small number of materially derived records.

The reducer rejects unsupported new threads.

## 8. Relevance without scope

Phase 3 retrieval is implemented as a local deterministic ranker.

The current score surface is intentionally small and inspectable:

1. normalized anchor match in recent context
2. compact summary-token overlap
3. anchor/summary overlap with currently retrieved lore
4. bounded one-hop expansion from an already relevant active record
5. recent-change bonus only after independent relevance exists

Recency cannot bootstrap unrelated records into relevance. Resolved/superseded records are excluded from normal injection. The default final set is at most six records.

No embedding service or model call is required for Alpha retrieval. If semantic embeddings are later added, they must remain optional acceleration, not correctness-critical storage.

Phase 3 renders the selected records into a host-neutral descriptor using namespace `world_state_alpha`, prompt key `world_state_alpha_private_continuity`, shallow `IN_CHAT` SYSTEM placement, and an 800 conservative local-token-unit cap. The renderer emits current summaries/trends only and preserves the private-reality/player-knowledge boundary.

## 9. Lazy catch-up

Phase 4 implements this host-neutral preparation flow:

1. retrieve current relevant active records locally
2. keep only active `development` records whose `lastEvaluatedMessage` predates either a meaningful elapsed hint or grounded direct affecting evidence
3. if none qualify, inject the last-established state immediately with zero evolution calls
4. if some qualify, evaluate at most four in one **batched targeted evolution request**
5. require one result per target, with `stable` explicitly valid
6. admit changes only from current affecting evidence, or meaningful elapsed time plus prior accepted evidence for that target
7. gate any derived development to one candidate, with strict declared-cause support and duplicate/resurrection protection
8. re-run local relevance against the resulting canonical state
9. inject compact current summaries

Elapsed time never forces motion. It opens an evaluation window. The evaluator does not inherit Writer's Mind/Ukiyo story-driving incentives and cannot create events merely to avoid stagnation.

Opaque fictional time strings are supported directly. A small local recognizer handles obvious relative intervals such as weeks/months/years without becoming a calendar engine.

Never issue one evolution call per record. If no reliable elapsed hint and no grounded affecting evidence exist, a dormant record remains exactly as last established.

## 10. Injection boundary

Recommended header:

```text
WORLD STATE ALPHA - PRIVATE CONTINUITY.
The following are current established world facts relevant to this generation.
Use them for continuity and causal consistency. They are not automatically known
to the player character. Do not mention this state block or reveal remote/private
facts unless the scene provides a plausible information path.
```

Then 1-6 compact records under a hard token budget.

No evidence dump. No mutation history. No scores.

Recommended SillyTavern placement: unique prompt key, SYSTEM role, `IN_CHAT`, shallow depth (initial default 1), mirroring Delta's proven host integration while maintaining full namespace isolation.

## 11. Player knowledge

Alpha stores reality, not epistemology.

Do not add a full knowledge-propagation subsystem.

For Alpha:

- injection explicitly marks facts private continuity
- RP model may use remote facts only for off-screen causal consistency
- PC dialogue/inner knowledge must still be grounded by the scene/history
- UI may show reality to the user because the user is the campaign operator

A future optional knowledge/news layer can be separate.

## 12. Branch and rollback strategy

Generalize Delta's current exact-boundary design.

Journal entries store **record-level undo**, not full-state copies for every mutation.

Each entry owns:

- sequence
- previous sequence
- raw source message
- source lineage key
- parent lineage key
- mutation reason
- undo patch
- timestamp

Multiple writes on the same raw message coalesce into one earliest-before -> latest-after undo record unless another retained descendant/checkpoint references the old sequence.

On destructive lineage change:

- compute first divergence
- attempt exact journal rollback to divergence - 1
- else exact checkpoint at divergence - 1
- explicit known swipe sibling may restore exact sibling checkpoint
- otherwise fail closed

For World State, record-level undo is simpler than Delta's NPC/social/portrait-specific undo and should therefore be significantly smaller.

## 13. Storage

Recommended sidecar identity:

- format: `world_state_alpha_chat_data`
- extension settings key: `world_state_alpha`
- prompt key: `world_state_alpha_private_continuity`
- bundle format: `world_state_alpha_bundle`
- public global, if needed: `WorldStateAlpha`

Use owner-qualified per-chat keys and revision-guarded sidecar writes.

Phase 7 maps the logical `world_state_alpha/<hash>.json` sidecar to a SillyTavern uploaded filename prefixed `world-state-alpha-`. The actual server-returned path is persisted in `extension_settings.world_state_alpha.dataFiles[chatKey]`. Equal chat filenames owned by different characters/groups therefore remain separate. In 0.9.0-alpha.2, character/chat rename events migrate that owner-qualified key by durably writing the re-owned sidecar before moving the pointer; delete lifecycle removes the active pointer/cache ownership so later filename reuse cannot resurrect an unrelated campaign.

Hydration is fail-closed. An existing pointer that cannot be read/decoded is preserved; the host must not overwrite it with a fresh empty state.

Keep only the tiny settings pointer in extension settings; canonical bulk state lives in the sidecar.

## 14. UI

Phase 6 implements a host-neutral, projection-only UI. It consumes canonical state and bounded diagnostics but does not own mutation, persistence, rebuild, provider routing, or SillyTavern lifecycle registration.

Primary views:

- Current: active records only, newest established change first, bounded to 120 rows
- Recent changes: latest changed records across lifecycle states, bounded to 40 rows
- Resolved: resolved and superseded tombstones, bounded to 80 rows
- Search: free-text summary/anchor search using the Phase 5 manual-query semantics, bounded to 100 rows
- Details/evidence: current summary/status/trend, anchors, created/changed/evaluated boundaries, optional time anchor, at most 32 evidence items, and at most 24 causal/related rows
- Diagnostics: at most 40 rows after the existing diagnostics allowlist sanitizer
- Data & maintenance: safe counts/recovery health plus export/import/rebuild/reset action intents

Current answers "what is happening now?" without exposing backend mechanics. Recent may translate a journal reason into a human label such as "Captured from story" or "Manual correction", but raw journal sequence numbers, lineage keys, undo patches, checksums, raw record/evidence IDs, prompts, transcripts, credentials, and provider payloads are not ordinary UI output.

All state/evidence/diagnostic text is escaped before HTML rendering. Search and record-detail projections return cloned data rather than mutable references to canonical state.

The host-neutral controller accepts a caller-supplied root, `getState()`, optional `getDiagnostics()`, `onMaintenanceAction()`, and `onClose()`. Maintenance buttons emit an intent only. Phase 5/caller wiring retains preview/confirm and mutation authority.

Desktop uses a centered panel up to roughly 1040 px with a list/detail split. At 700 px and below the panel becomes full-screen `100vw × 100dvh` with a vertically scrollable stacked body and >=44 px tab targets. At 420 px and below dense grids collapse to one column.

Phase 6 itself remains host-neutral. Phase 7 mounts it through one `world_state_alpha_panel_root` plus a compact, natively collapsible World State settings card. Phase 7 still deliberately omits a launcher/watchdog/MutationObserver framework, generic slash-command surface, and cross-extension adapter.

## 15. Manual controls

Phase 5 implements a host-neutral manual-control service layer. It does **not** register commands or UI yet.

Available service behavior:

- deterministic free-text/status/kind query over canonical records
- inspect one record with bounded evidence and related links
- targeted manual create/update/resolve/supersede through the canonical reducer
- export preparation
- import preview + explicit confirmation
- reset preview + explicit confirmation
- explicit rebuild orchestration

A targeted manual mutation is not an unowned side edit. It must be attached to the current raw-message head on the same proven branch, include a concise operator note as `manual` evidence, pass duplicate/lifecycle validation, and journal through the ordinary branch owner. Manual correction does not advance automatic capture cadence.

Phase 7 does not add a generic slash-command family. The settings/panel host wires export/import/reset/rebuild to the existing Phase 5 services, preserving their preview/confirm and atomicity contracts.

There is no no-argument automatic global update that silently evolves everything.

## 16. Provider handling

Adapt Delta's request-scoped Connection Profile strategy:

- default: host current RP connection via raw generation
- optional selected Connection Profile for World State
- same selected route for capture/evolution/rebuild chunks
- clear error if selected profile disappears
- timeout/cancellation accounting
- no silent fallback
- no credential copying

## 16.5. Phase 7 host shell

The SillyTavern shell is intentionally thin:

- `manifest.json` -> `bootstrap.js` -> `index.js`
- `host-identity.js` derives owner-qualified character/group chat keys without reading another extension
- `host-storage.js` adapts the existing revision/checksum sidecar contract to SillyTavern `/api/files/upload` and pointer GETs, and exposes the JSON upload/fetch surface used by immutable Spatial base-map sources
- `index.js` owns World-State-only settings, hydration cache, identity rename/delete migration, event registration, currentness guards, per-chat work serialization, persistence, prompt application, and mounting the Phase 6 panel

The shell calls existing capture/evolution/relevance/branch/manual/rebuild services rather than duplicating their semantic logic.

Co-install boundaries are structural:

- Alpha settings: `world_state_alpha`; Delta settings: `npc_state_delta`
- Alpha prompt: `world_state_alpha_private_continuity`; Delta prompt remains separate
- Alpha uploaded sidecars: `world-state-alpha-*`; Delta file names remain separate
- Alpha DOM IDs/classes use `world_state_alpha` / `wsa`; Delta DOM remains separate
- Alpha optional debug global: `WorldStateAlpha`; Delta global remains separate
- manifest has no dependency on Delta
- Alpha never queries or mutates Delta DOM/storage/settings/global state

No Ukiyo/Megumin/Writer's Mind integration hook is needed: they continue to consume normal SillyTavern prompt composition, while World State injects only its private continuity block.

## 17. Normal-turn sequence

```text
Assistant exchange completes
        |
        v
record raw-message receipt / lineage
        |
        v
Is capture due and exchange material?
     /      \
   no        yes
   |          |
   |     build compact capture prompt
   |          |
   |     one provider request
   |          |
   |     validate mutation proposals
   |          |
   |     dedupe + source firewall
   |          |
   |     apply canonical reducer
   |          |
   |     journal exact-message undo
   |          |
   +--------> persist sidecar
               |
               v
Before next generation:
local relevance select
        |
        v
bounded stale relevant development?
     /      \
   no        yes
   |       one batched targeted
   |       evolution request if justified
   |          |
   |       reducer + journal + persist
   |          |
   +----------+
        |
        v
render tiny private continuity block
        |
        v
setExtensionPrompt
        |
        v
Ukiyo / RP model narrates normally
```

## 18. Meaningful time-skip flow

```text
new exchange contains reliable elapsed span/time anchor
        |
capture established immediate changes
        |
store opaque time anchor on affected evidence
        |
do NOT scan all records
        |
next-generation relevance selects records
        |
for selected stale developments only:
evaluate elapsed span + causal evidence
        |
change / stable / resolve
        |
inject only current relevant result
```

## 19. Context-return flow

```text
record dormant for 60 messages
        |
scene mentions matching anchor
        |
local retrieval selects record
        |
is catch-up justified?
  no -> inject last established current state
 yes -> bounded targeted evolution for selected record set
        |
persist
        |
inject refreshed summary
```

## 20. Branch rollback flow

```text
host lineage changes
        |
find first divergence D
        |
exact journal undo to D-1 available?
 yes -> restore
 no  -> exact checkpoint D-1 available?
          yes -> restore
          no  -> known exact swipe sibling?
                   yes -> restore sibling
                   no  -> FAIL CLOSED
                         keep canonical state
                         mark affected records/rebuild need
        |
prune abandoned suffix history
        |
persist rebased lineage
```

## 21. Manual rebuild flow

Phase 5 rebuild remains host-neutral and explicit-only:

```text
explicit rebuild request
   |
snapshot canonical state + exact current chat lineage
   |
plan bounded assistant-completed exchange windows
   |
start isolated empty/root-checkpoint candidate
   |
for each window in chronology:
   existing capture prompt + source firewall
   + relevant active records
   + relevant resolved/superseded tombstones
   -> one bounded capture-style request
   -> evidence reclassified as rebuild provenance
   -> reducer + exact-message journal on candidate only
   |
never replay lazy evolution / never simulate missing off-screen motion
   |
stale / malformed / provider/context failure?
 yes -> discard whole candidate, canonical state unchanged
 no  -> finish full lineage
   |
compare controlled current-state semantics where requested
   |
atomic replace candidate on complete success
```

The provider-call ceiling for rebuild is therefore bounded by the number of assistant-completed exchange windows admitted by the configured rebuild limit. The default Phase 5 cap is 1024 boundaries. Planning itself is local and performs zero provider calls.

Rebuild deliberately prefers narrated evidence over reconstructing hypothetical Phase 4 evolution. If an earlier evolved condition materially affected the campaign, subsequent established narration can recover that consequence. Otherwise rebuild does not manufacture it.

## 22. Design review questions A-S

### A. Smallest durable core record model?
One generalized record family with `kind=fact|development`, current summary, lifecycle, optional trend, anchors, message chronology, evidence refs, and causal links.

### B. Need Fact / Thread / Event separately?
No. Fact + Development are sufficient for Alpha. Events belong in evidence/mutation history.

### C. Backend evidence versus surface state?
Backend keeps provenance, source IDs, lineage, mutation history, previous values/undo, causal links, timestamps, diagnostics. Surface injects only current relevant summaries and minimal lifecycle/trend qualifiers.

### D. Immediate capture trigger?
Completed assistant story exchange, cadence/enablement permits, and non-empty meaningful text. The model may return no mutations. Do not pre-classify via another model call.

### E. Evolution trigger?
Only targeted relevance plus meaningful elapsed time, direct affecting evidence, explicit manual update, major established event, or rebuild. Time alone is insufficient.

### F. Relevance without scope?
Optional anchors + summary/context similarity + retrieved-lore overlap + causal links + recency. Deterministic/local first.

### G. Duplicate consolidation?
Deterministic similarity gate using normalized anchors + summary token semantics + evidence overlap, followed by conservative reducer rules. A provider may suggest merge IDs but cannot merge unilaterally.

### H. Prevent resolved-state resurrection?
Resolved/superseded record retained as tombstone; lore is baseline only. New activation requires new campaign evidence and normally a new record ID when it is a genuinely new episode.

### I. Branch rollback?
Message-owned undo journal + exact checkpoints + exact sibling restore; fail closed when exact parent cannot be proved.

### J. Campaign time representation?
Message chronology mandatory. Optional opaque `timeAnchor` and normalized `elapsedHint`; no required calendar parsing.

### K. Coexist with NPC State?
Strict namespace/storage/prompt/UI/command isolation; World State stores only world-significant person facts, never dossier internals.

### L. What gets injected?
Top relevant active current summaries, normally 1-6 records under a hard token budget, with private-continuity/player-knowledge header.

### M. Prompt-stack location?
Unique World State extension prompt, SYSTEM, `IN_CHAT`, shallow depth default 1, configurable after live acceptance.

### N. Prevent knowledge leakage?
Explicit injection instruction: reality is private continuity, not automatic PC knowledge; no Alpha epistemology simulator.

### O. Keep ordinary turns fast?
One small capture request when due, local retrieval, no global scans, no per-record calls, batched evolution only when triggered, hard token budgets.

### P. What does rebuild need?
Historical chunking, chronology reconciliation, broader evidence recovery, migration repair, and atomic replacement. Normal scanning does not.

### Q. Delta parts to reuse/adapt?
Single-owner architecture, request dispatcher, stale-result rejection, sidecar durability, exact rollback, bounded diagnostics, injection budgeting, manual heavy-operation separation.

### R. Delta parts not to copy?
NPC fields/admission, relationship/social graph, appearance/forms, birthdays/calendar engine, portrait system, cast scanning/backfill, accumulated migrations.

### S. Unnecessary assumptions to remove?
A third Event table, mandatory status `latent`, required tags, required typed anchors, required calendar parsing, background global simulation, geographic activity classes, and automatic semantic embeddings.

## 23. Challenge to the original specification

Three changes are recommended:

1. **Remove Event as a durable top-level class.** Evidence/mutation history already owns events.
2. **Do not make `latent` a lifecycle status.** A not-yet-established condition is not current state. Store nothing until established; use `emerging` trend on an active development when evidence supports it.
3. **Do not run evolution before every injection merely because a record is old.** Old is not stale in the causal sense. Require elapsed/affecting evidence or explicit request.

These reduce model calls, ontology size, resurrection risk, and thread proliferation.

## 24. Phase 8 performance and release hardening architecture

Phase 8 changes execution cost, storage growth, and release reproducibility without changing World State semantics or persisted schema.

### A. Ephemeral relevance index

Normal host retrieval uses a per-chat in-memory index. It is never serialized into sidecars or bundles.

The implementation maintains:

```text
byId                    active record ID -> record
anchorPhrases           normalized exact anchor -> record IDs
anchorTokens            anchor token -> record IDs
anchorBigrams           bounded non-ASCII bigram -> record IDs
summaryTokens           summary token -> record IDs
recordTerms             record ID -> the posting-list keys owned by that record
linkGraph               persisted generic related links
recordRelations         record ID -> causedBy/affects targets
reverseRecordRelations  target ID -> records pointing to it
```

`recordTerms` makes an ordinary record refresh proportional to that record's own indexed terms instead of scanning every posting list.

The host builds/rebuilds the full index only when a whole canonical state is hydrated or replaced, including exact branch restore, import, reset, and rebuild. Routine capture applies the reducer's small `indexDelta`; routine evolution applies its small delta before rendering the refreshed injection. Forward-only raw-message lineage extension preserves the index because canonical relevance data did not change.

Candidate discovery is query-driven rather than corpus-driven. It performs bounded exact anchor phrase lookups, bounded non-ASCII bigram lookups, anchor-token lookups, and summary-token lookups. Posting traversal has a hard budget derived from `candidateCap`, and the scored candidate set is capped before the existing relevance scorer runs. It must not iterate every record, every anchor phrase, or every posting list on an ordinary turn.

Exact anchor evidence is processed before weaker token evidence. Once a record enters the candidate set, the existing relevance scoring/ranking semantics remain authoritative. One-hop expansion then uses the indexed generic/causal relation maps.

The legacy no-index path remains for host-neutral services and regression comparison. The real SillyTavern normal-turn host path supplies the index.

### B. Normal-turn lineage fast path

Phase 8 also removes full-chat lineage hashing from ordinary user/assistant events.

- The cached exact lineage is extended only for newly appended raw messages.
- The previous tail fingerprint is checked before suffix extension.
- Edit/delete/swipe events synchronously mark the chat branch dirty; a dirty chat cannot use the append fast path and must complete exact reconciliation first.
- Bounded exchange extraction reuses cached lineage.
- Provider currentness guards compare the owned source-message fingerprint plus chat/state epoch instead of rebuilding the whole lineage.
- Capture/evolution journal commits receive the already-known lineage.

Full `chatLineage` / exact `reconcileBranch` work remains appropriate for chat hydration, edit/delete/swipe recovery, explicit rebuild, and other operations that genuinely need whole-history proof. Branch-changing events bump the local epoch and cancel Alpha requests immediately before queued exact reconciliation.

### C. Canonical evidence compaction

After a successful canonical reducer batch, `compactEvidence(state)` removes evidence rows that are no longer referenced by any active, resolved, or superseded record.

This does not weaken rollback. Undo patches are computed against the pre-mutation state and include evidence removed by compaction, so exact branch rollback can restore the prior evidence mapping.

The record-level `evidenceIds` bound therefore also bounds live canonical evidence growth rather than leaving older orphan rows behind indefinitely.

### D. Deterministic release packaging

Phase 8 used application version `0.8.0-alpha.1`. Phase 9 was introduced in `0.9.0-alpha.1`; continuity hardening landed in `0.9.0-alpha.2`, and the current UI-standardization candidate is `0.9.0-alpha.3`. Canonical schema is version 2 while sidecar/bundle/rollback-journal envelope formats remain 1.

`scripts/package-design.mjs` creates a real extension ZIP from the runtime inventory using:

- stable sorted entry order
- fixed ZIP timestamps/metadata
- deterministic STORE entries with no compressor-version dependency
- per-file SHA-256 entries
- archive SHA-256 and byte count
- deterministic JSON release manifest

Two package runs from an unchanged tree must produce byte-identical archive and manifest outputs. CI records hashes from the first package and verifies a second package against them.

### E. Measurement and live boundary

Phase 8 deterministic measurements report prompt sizes, request budgets, indexed candidate/scoring work, posting-visit bounds, injection size, long-run evidence/storage growth, rollback-window bytes, and package hash/size.

These local/synthetic measurements are not TTFT measurements. Actual provider latency, TTFT, browser event timing, real SillyTavern storage behavior, responsive UI behavior, and simultaneous live Delta/Ukiyo/Megumin operation are acceptance observations recorded separately in `docs/LIVE_ACCEPTANCE.md`.


## 24. Spatial Continuity architecture

Spatial Continuity is a sibling domain inside the same per-chat canonical state envelope:

```text
state
|-- records/evidence/links        # Reality Core
|-- spatial                      # Spatial Continuity
|   |-- profile
|   |-- baseMapRef
|   |-- locations
|   |-- relations
|   |-- routes
|   |-- evidence
|   `-- lastCaptureMessage
|-- lineage / rollback / checkpoints
```

The two domains share ownership and transaction infrastructure, not reducers. Reality mutations remain owned by `state-core.js`; Spatial mutations remain owned by `spatial-core.js`.

### 24.1 Capture flow

When Spatial is enabled, the ordinary eligible capture request asks for one JSON object containing both Reality `mutations` and optional `spatialMutations`. This preserves the Phase 8 request budget: Spatial does not add a second automatic model request.

Before prompt construction and evidence validation, assistant narration passes through `narrative-sanitizer.js`, which removes `<writer_state>...</writer_state>` blocks only from the evidence surface. Raw stored chat and lineage fingerprints remain untouched.

Spatial proposals then pass:

```text
wire validation
 -> grounded sanitized evidence
 -> generated-place admission
 -> explicit-coordinate / relative-position firewall
 -> True North validation
 -> spatial reducer
 -> shared branch journal
```

### 24.2 Base map adapter boundary

`spatial-base-map.js` has a generic Cartesian adapter and an explicit Ternia v0.9.10 adapter.

The generic adapter accepts a compact map document containing a profile/coordinate system, locations and optional routes. It does not depend on Ternia fields.

The Ternia adapter additionally understands the supplied registry layers such as top-level locations, starting-area/local features, Wild Zones, geographic features, major-route anchors and route metadata. Route draw geometry is not imported as Cartesian displacement. Base-map parsing creates an immutable runtime projection and a deterministic digest.

The original source file is never modified. `host-base-map.js` stores a read-only normalized source payload and the campaign sidecar stores only `baseMapRef`. Base-map authority is preloaded when a chat hydrates. If an attached source is unavailable, Spatial automatic capture/injection pauses rather than presenting a partial generated-only map as authoritative.

### 24.3 Effective geography

Effective locations are a projection:

```text
base canonical locations
  + campaign overrides shadowing matching base ids
  + campaign-generated locations
```

A campaign override is a source-layer fact (`baseRefId` / `isOverridden`), not necessarily the coordinate authority itself. A manually edited override may therefore remain a Campaign Override while its coordinate authority is `manual`.

### 24.4 Coordinate model

Spatial profile is setting-agnostic Cartesian 2D:

- `northAxis`
- `eastAxis`
- `unitKm`
- optional rectangular bounds
- decimal step
- True North lock

Coordinates support exact known X/Y or unresolved X/Y. Authority and lock are separate.

The absence of a profile is meaningful: Spatial may still remember named places, explicit X/Y, and relative relations, but it does not assume Ternia's scale, bounds, or compass transform. A profile may also omit unit scale; in that case scale-dependent derivation remains disabled. A configured profile may orient north/east along any perpendicular signed Cartesian axes.

Deterministic coordinate derivation accepts only established anchor coordinate + grounded direction + grounded straight-line distance under an explicit profile. Diagonals use normalized vector math projected through the profile's declared north/east axes. Route/travel distances remain relational metadata only.

### 24.5 Retrieval and injection

Spatial has its own ephemeral per-chat index over effective active locations. It indexes names, context/type, route associations and bounded relation adjacency. Base data is indexed once when attached/loaded rather than scanned on every turn.

Normal retrieval returns a bounded handful of relevant locations. Private injection contains current/relevant coordinate/context plus directly useful relations/routes and repeats the profile orientation only when useful. It does not dump the base map.

### 24.6 Manual/UI flow

The existing World State panel adds a Spatial tab. `ui.js` projects fields and emits action intents; `index.js` calls `spatial-manual.js` and persists only after reducer success. Unchanged coordinate authority is preserved when editing non-coordinate metadata. Manual location metadata, relations, and route semantics are not rewritten by later automatic capture.

The editor supports add, rename, type/context, coordinate authority/lock, relative anchor/direction/distance, route associations, archive/delete, duplicate merge, campaign override, and evidence inspection. Reducer-level delete/merge rewrites or removes related spatial graph references so the UI cannot create dangling topology.

### 24.7 Branch/migration/rebuild

Schema 1 normalizes to schema 2 by adding an empty Spatial namespace. Existing Reality data and old rollback checkpoints remain valid.

Spatial undo patches are nested in the same journal boundary as Reality undo. Whole-state checkpoint restore normalizes legacy snapshots before use.

Rebuild starts from a clean schema-2 candidate, retains the attached profile/base-map reference, replays the same sanitized chronological capture surface, and remains atomic/fail-closed.
