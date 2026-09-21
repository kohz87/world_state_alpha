# World State Alpha - core contract

Status: ARCHITECTURE ACCEPTED. Phase 1 core is implemented as a candidate; later runtime phases remain gated.

## C01. Product purpose

World State Alpha owns persistent **current dynamic world reality** for one SillyTavern chat/campaign.

Essential loop:

```text
completed exchange
 -> capture grounded world changes
 -> consolidate canonical current state
 -> persist with raw-message provenance
 -> retrieve only relevant state
 -> optionally catch up stale relevant developments
 -> inject compact private continuity
 -> existing RP model / Ukiyo narrates normally
```

It does not write the story and does not replace scene reasoning.

## C02. Universal ontology

The core schema must not require geographic, political, organizational, genre, or calendar ontology. World State Alpha models change, not maps.

No mandatory `scope` field exists.

Records may carry optional free-text `anchors[]` for retrieval. An anchor is a concept string, not a typed world entity.

## C03. Minimal durable record model

One generic record family is authoritative.

Two kinds are permitted:

- `fact`: a presently true condition
- `development`: an established ongoing condition capable of changing

A third durable `event` class is deliberately omitted in Alpha. Historical events are evidence/mutation provenance attached to current records. If an event has no current-world consequence worth retaining, it belongs in chat/memory rather than World State.

A record's human-facing `summary` is a compact **current** statement, never an append-only history log.

## C04. Lifecycle

Allowed status values:

- `active`
- `resolved`
- `superseded`

Facts are normally `active` until replaced/retired. Developments may be active/resolved/superseded.

Optional trend applies only when meaningful:

- `emerging`
- `rising`
- `stable`
- `falling`
- `uncertain`

Do not use numeric probabilities or invented precision.

Resolved/superseded records remain retained as bounded history/tombstones and are excluded from normal injection unless specifically relevant to preventing stale resurrection or explaining a current record.

## C05. Source firewall

Sources have different authority:

- current user/assistant narrative: may establish campaign reality
- recent chat: may provide supporting chronology/evidence
- accepted World State: current dynamic authority
- lore/world info: baseline/static canon, identities, normal conditions, causal possibilities
- external extension state: only when an explicit adapter is later authorized

Lore saying something *can*, *usually*, *historically*, or *sometimes* occurs is not evidence that it occurs now.

Accepted current state overrides conflicting stale baseline for campaign continuity. World State never edits the lorebook.

Ambiguous narration, hypothetical language, plans, questions, predictions, and model brainstorming do not become canonical world state without establishment evidence.

## C06. Capture

Routine capture examines only the completed current exchange plus the minimum already-retrieved state/lore context required to interpret it.

If no material world change is established, capture returns no mutations.

Capture may:

- create a grounded fact/development
- update/replace a current summary
- resolve/supersede a record
- attach evidence
- link causally related existing records

Capture must not run global simulation or fabricate off-screen developments merely to keep the world busy.

## C07. Evolution

Deliberative evolution is targeted, not global.

It may run when one or more records are relevant and at least one trigger justifies evaluation:

- meaningful elapsed campaign time is available
- a major new established event directly affects the record
- context returns to a stale relevant record
- user explicitly requests targeted update/refresh
- rebuild/recovery explicitly requires it

Elapsed time alone is not a change signal.

Evolution receives only the target record(s), bounded supporting evidence, relevant accepted state, available opaque time anchor/elapsed span, and relevant lore. It must preserve state when causality does not justify change.

No plot optimization, tension optimization, escalation bias, quest generation, or player-centric causality is allowed.

## C08. Derived developments and deduplication

New derived records require:

- explicit causal grounding from accepted state/evidence
- material persistence beyond a tiny observation
- semantic non-duplication with existing active/resolved related records
- bounded creation count per evaluation

Prefer updating/linking an existing record.

Duplicate candidates must consolidate by semantic equivalence plus overlapping anchors/evidence, never by title string alone.

## C09. Time

Raw message ordering is always authoritative.

Every record retains message-order provenance such as:

- `createdAtMessage`
- `lastChangedMessage`
- `lastEvaluatedMessage`

Optional `timeAnchor` and `elapsedHint` are opaque strings/normalized hints when available. Alpha does not require a calendar engine.

No fictional calendar parser is required for correctness.

## C10. Branch and rollback safety

Every automatic mutation is owned by one raw-message boundary and exact lineage fingerprint.

Maintain a reversible mutation journal and bounded checkpoints sufficient to restore proven boundaries. Recovery is exact-boundary only; approximate ancestor substitution is forbidden.

On swipe/delete/edit/truncation/branch:

- exact known boundary restore is allowed
- abandoned suffix mutations are removed
- no older approximate checkpoint may substitute for a missing parent
- if exact recovery cannot be proven, fail closed and preserve canonical state while marking targeted rebuild/rescan need

No ghost state may survive an abandoned branch.

## C11. Persistence

One canonical per-chat state owner and one sidecar persistence boundary.

Requirements:

- schema versioning/migration
- deterministic IDs
- revision/concurrency guard
- atomic/corruption-safe writes where host APIs allow
- bounded retry/recovery snapshot
- export/import
- reset
- rebuild
- no correctness dependence on hidden in-memory state

## C12. Relevance retrieval

Normal RP injection selects only a small subset of active records.

Signals may include:

- exact/normalized anchor mention
- semantic similarity to recent scene text
- overlap with currently retrieved lore
- causal links from already relevant records
- recent record changes
- direct relationship to selected records

No geographic scope hierarchy is required.

Relevance selection is deterministic/local by default. Do not add a model call solely to choose what to inject.

## C13. Lazy catch-up

A record may remain untouched for many messages.

When it becomes relevant again, World State may evaluate only that stale relevant record and tightly connected records before injection if meaningful elapsed time or intervening evidence makes evaluation necessary.

Do not continuously simulate dormant state.

## C14. Injection

World State uses its own unique prompt key/namespace and injects a compact SYSTEM continuity block through SillyTavern's extension prompt mechanism.

Default placement should mirror the proven Delta pattern: `IN_CHAT`, system role, shallow configurable depth, with a unique World State key and strict token budget.

Injection contains only current relevant summaries and minimal causal/state qualifiers. It does not dump evidence/history.

The header must state that this is private world continuity and **not automatic player-character knowledge**.

## C15. NPC State boundary

NPC State owns detailed individual dossiers.

World State may own world-significant facts involving people, such as death, succession, removal from office, defection, or appointment, when these materially change world reality.

World State does not own personality, speech, appearance, mood, relationships, personal mannerisms, or ordinary personal goals.

Namespaces, settings, storage, UI, prompt key, commands, diagnostics, and bundles must not collide with `npc_state_delta`.

## C16. Provider routing

One request dispatcher owns all World State model calls.

Default route may use the host's normal raw generation path. Optional SillyTavern Connection Profiles may provide a request-scoped alternate route.

Missing selected profiles fail clearly. Never silently fall back to a different provider/model.

Do not mutate global RP connection settings to route scanner requests.

## C17. Diagnostics

Diagnostics are bounded, allowlisted, read-only telemetry.

They may record:

- operation label
- source message boundary
- target record IDs
- mutation counts
- prompt/response character estimates
- provider route category
- duration
- stale/cancelled/failure outcome
- retrieval/injection counts

Diagnostics never become canonical state and never store credentials, full private prompts, full story transcripts, or full provider responses.

## C18. Performance

Normal exchange target:

- at most one capture model call when capture is due
- zero evolution calls unless a bounded trigger is met
- no full-world scan
- no full-chat scan
- no per-record fan-out
- local relevance retrieval
- compact injection

Any additional automatic request path requires explicit contract justification and measurements.

## C19. Rebuild

Rebuild is manual/expensive recovery, not ordinary runtime.

It may scan campaign history in bounded chunks, reconcile lore baseline, reconstruct current records, rebuild evidence/provenance, and compare incremental equivalence.

Normal runtime must never depend on recurring rebuilds.

## C20. Ukiyo / story-driving CoT boundary

World State does not modify Ukiyo, Megumin Suite Beta, Writer's Mind, or the RP CoT.

World State Alpha may consume narrative produced by an RP model using a story-driving CoT such as Writer's Mind, but those instructions are not inherited by capture or evolution.

Story-driving principles such as autonomous world motion, scene variation, chance, escalation, or avoiding stagnation are narration concerns and are not evidence that a world change occurred.

World State records or evolves state only from its own grounded evidence and causal contract.

It supplies compact continuity only. Scene reasoning and prose remain owned by the configured RP model.
