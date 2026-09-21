# World State Alpha architecture

Status: first design pass.

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
- prompt key: `world_state_alpha_continuity`
- bundle format: `world_state_alpha_bundle`
- public global, if needed: `WorldStateAlpha`

Use per-chat qualified keys and revision-guarded sidecar writes.

Keep a tiny settings pointer in extension settings; canonical bulk state lives in the sidecar.

## 14. UI

Primary views:

- Current
- Recent changes
- Resolved
- Search
- Details/evidence
- Diagnostics
- Data & maintenance

Current should answer "what is happening now?" without exposing backend mechanics.

Record detail should show:

- current summary/status/trend
- anchors
- created/changed/evaluated message boundaries
- bounded evidence
- causal links
- last mutation reason

UI search is free-text/anchor based. No region/faction taxonomy.

## 15. Manual controls

Recommended command family:

- `/worldstate inspect`
- `/worldstate inspect <query>`
- `/worldstate update <query>`
- `/worldstate rebuild`
- `/worldstate reset`
- `/worldstate export`
- `/worldstate import`

Avoid a no-argument automatic global `update` that silently evolves everything. If retained, no-argument update should only capture current exchange or require UI confirmation.

## 16. Provider handling

Adapt Delta's request-scoped Connection Profile strategy:

- default: host current RP connection via raw generation
- optional selected Connection Profile for World State
- same selected route for capture/evolution/rebuild chunks
- clear error if selected profile disappears
- timeout/cancellation accounting
- no silent fallback
- no credential copying

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

```text
explicit rebuild
   |
freeze ordinary automatic writers for this chat
   |
scan history in bounded chronological chunks
   |
extract grounded mutations/events
   |
deterministic reducer constructs current records
   |
reconcile relevant lore baseline without promoting possibilities
   |
rebuild evidence + lineage checkpoints
   |
compare controlled-fixture result to incremental state
   |
atomic replace on success
   |
resume ordinary runtime
```

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
