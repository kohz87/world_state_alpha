# World State Alpha - core contract

Status: ARCHITECTURE ACCEPTED. Phases 1-5 are implemented as candidates; Phase 6+ runtime work remains gated.

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

Default Alpha cadence is one eligible capture after each completed assistant exchange. A duplicate receipt for an already processed raw-message boundary must not issue a second automatic request. One automatic capture provider call is permitted per eligible boundary; malformed output is not automatically repaired with a second model call.

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

Automatic evolution may run when one or more records are relevant and at least one bounded trigger justifies evaluation:

- meaningful elapsed campaign time is available for that stale relevant development
- grounded new current-exchange evidence directly affects that stale relevant development

Merely returning to a stale context is not an automatic evolution trigger. Explicit manual update and rebuild/recovery are separate later-phase operations.

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

Every automatic canonical mutation is owned by one raw-message boundary and exact lineage fingerprint. A manual targeted mutation is also boundary-owned: it must attach to the current raw-message head on the same proven lineage, carry explicit operator evidence, and use the same reversible journal.

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
- preview/confirm semantics for destructive reset/import
- foreign import clears local message provenance unless same-chat provenance preservation is explicitly requested
- no correctness dependence on hidden in-memory state

## C12. Relevance retrieval

Normal RP injection selects only a small subset of active records.

Phase 3 retrieval is deterministic and local. It uses:

- normalized anchor matches in recent scene text
- compact token overlap with current summaries
- overlap with currently retrieved lore
- bounded one-hop links from already relevant active records
- recent-change bonus only after independent relevance already exists

Recency alone never makes an unrelated record relevant. Resolved/superseded records are excluded from normal current-state injection. The default selected set is capped at six records.

No geographic scope hierarchy is required. No model/provider call is permitted solely to choose what to inject.

## C13. Lazy catch-up

A record may remain untouched for many messages.

Phase 4 uses correctness-first catch-up only when an **active relevant development** is stale and one of these bounded triggers exists:

- a meaningful elapsed-time hint grounded to the current raw-message boundary, or
- grounded current-exchange evidence that directly affects that development

Ordinary relevance alone is not an evolution trigger. Short passage alone is not automatically meaningful. Opaque fictional time hints are allowed without requiring a calendar engine.

All eligible targets are evaluated in one batch, capped at four developments. Never issue one model request per record.

Elapsed time is permission to evaluate, not evidence that change occurred. `stable` is a first-class outcome. A changed outcome requires either grounded current affecting evidence, or meaningful elapsed time plus prior accepted evidence from that same development.

A stable evaluation may advance `lastEvaluatedMessage` and retain elapsed/evaluation provenance, but must not advance `lastChangedMessage` when current world truth did not change.

At most one derived development may be proposed per batch. It requires either at least two supplied causal target developments, or one target plus grounded current affecting evidence. Each declared cause must contribute its own non-time support; support cannot be borrowed from undeclared records. Duplicate/resolved-episode checks apply before admission.

Do not continuously simulate dormant state. Resolved/superseded records are not normal evolution targets and static lore cannot resurrect them.

## C14. Injection

World State owns namespace `world_state_alpha` and prompt key `world_state_alpha_private_continuity`. They must not collide with NPC State Delta or other extensions.

Default placement mirrors the proven Delta pattern: `IN_CHAT`, SYSTEM role, depth 1 by default, with a host-neutral descriptor until SillyTavern bootstrap wiring is separately authorized.

The default hard local budget is 800 conservative token units and six selected records, with typical output expected to be much smaller. If the mandatory privacy header cannot fit, inject nothing rather than dropping the boundary text.

Injection contains only current relevant summaries and minimal trend qualifiers. It does not dump record IDs, anchors, evidence, mutation history, or backend provenance.

The header must state that this is private world continuity and **not automatic player-character knowledge**, require a plausible information path before remote/private facts become character knowledge, and must not turn continuity notes into instructions for autonomous world motion or plot generation.

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
- zero evolution calls on ordinary relevant turns
- at most one batched evolution model call when a Phase 4 trigger is met
- at most four developments in that automatic evolution batch
- no full-world scan, including evolution
- no full-chat scan
- no per-record request fan-out
- local relevance retrieval
- compact injection

Manual inspect/query/correction and rebuild add no automatic normal-turn request path. Any additional automatic request path requires explicit contract justification and measurements.

## C19. Manual controls and rebuild

Phase 5 exposes host-neutral service functions only. It does not register slash commands, menus, DOM, or SillyTavern event hooks.

Manual inspect/query is deterministic and read-only. A targeted manual correction:

- requires an existing current raw-message head
- requires the stored state lineage to agree with the current chat branch
- requires a concise operator note stored as `manual` evidence
- goes through duplicate admission, the canonical reducer, and the same branch journal
- must not advance automatic capture cadence merely because an operator corrected state

Reset and import are preview-then-confirm operations. Foreign import preserves current semantic meaning but clears local raw-message provenance, branch lineage, rollback history, and local evidence ownership rather than pretending another chat's chronology occurred here.

Rebuild is explicit/manual expensive recovery, never ordinary runtime and never an automatic response to incompleteness.

The Phase 5 rebuild contract is:

- plan the current chat in bounded chronological assistant-completed exchange windows
- fail before provider work if the configured boundary cap is exceeded
- rebuild into an isolated candidate state from the root, never incrementally overwrite canonical state while scanning
- reuse the existing capture prompt, source firewall, duplicate gate, reducer, request dispatcher, and exact message lineage
- tag reconstructed narrative evidence as `rebuild`
- surface relevant resolved/superseded tombstones during reconstruction so passive historical similarity cannot resurrect an old episode
- allow a genuinely new related episode only through explicit new-episode semantics
- do not replay lazy evolution or run hidden off-screen simulation during rebuild
- discard the entire candidate on stale scope, malformed response, provider failure, or supporting-context failure
- atomically replace canonical state only after the complete chronological pass succeeds
- support controlled semantic comparison between incremental and rebuilt current state even when evidence source classes differ

Normal runtime must never depend on recurring rebuilds.

## C20. Ukiyo / story-driving CoT boundary

World State does not modify Ukiyo, Megumin Suite Beta, Writer's Mind, or the RP CoT.

World State Alpha may consume narrative produced by an RP model using a story-driving CoT such as Writer's Mind, but those instructions are not inherited by capture or evolution. Rebuild reuses the capture firewall and likewise does not inherit story-driving instructions.

Story-driving principles such as autonomous world motion, scene variation, chance, escalation, or avoiding stagnation are narration concerns and are not evidence that a world change occurred.

World State records or evolves state only from its own grounded evidence and causal contract.

It supplies compact continuity only. Scene reasoning and prose remain owned by the configured RP model.
