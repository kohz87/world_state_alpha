# World State Alpha - core contract

Status: ARCHITECTURE & RUNTIME ACCEPTED. Phases 1-9 are implemented as candidates.

## C01. Product purpose

World State Alpha owns persistent **current dynamic world reality** for one SillyTavern chat/campaign.

Essential loop:

```text
completed exchange
 -> capture grounded world changes
 -> consolidate canonical current state
 -> persist with raw-message provenance
 -> retrieve only relevant state
 -> optionally catch up stale relevant plus bounded stale background developments
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

Routine capture examines only the completed current assistant boundary: messages after the previous assistant response through the current assistant response, plus the minimum already-retrieved state/lore context required to interpret it. It must not use a rolling history window that includes the previous assistant turn; chronological rebuild uses the same boundary semantics.

Default Alpha cadence is one eligible capture after each completed assistant exchange. A duplicate receipt for an already processed raw-message boundary must not issue a second automatic request. One automatic capture provider call is permitted per eligible boundary; malformed output is not automatically repaired with a second model call.

Provider capture/rebuild output must contain exactly one JSON object. The object may be bare or enclosed by one Markdown code fence with an optional `json` language tag. Surrounding prose, multiple-object extraction, and correction retries are forbidden; malformed or structurally invalid output remains fail-closed.

If no material world change is established, capture returns no mutations.

Capture is bounded for completeness rather than ranked only by immediate PC salience. Before output, the single capture request must sweep the whole bounded current exchange for each distinct materially persistent current condition established there, up to the existing mutation cap. When a narrator-authored `<World_State>` block is present, the host may surface a bounded advisory checklist from its `Off-Screen` and `Unresolved Threads` entries so less-salient persistent conditions remain visible to the same provider request. The checklist is not a second authority or a local mutation path: every proposed mutation still requires source-firewall evidence and all ordinary exclusions remain in force.

PC proximity, current objective, and player intervention are not admission criteria. An established ongoing condition that will continue independently after the PC leaves or ignores it remains a valid `development`, including when it is now off-screen.

Persistence means useful future continuity after the scene cuts away. Capture should ignore fleeting scenery, momentary positions, routine inventory/skill state, ordinary one-off transactions, notices/offers, isolated claims, plans, planted seeds, CYOA options, inner chatter, and mere possibilities unless the narration separately establishes a persistent condition. Known non-canonical assistant blocks such as `writer_state`, `NPC_Inner_Chatter`, `CYOA`, `Skill_Mastery`, and inventory blocks are removed from the capture/evidence view before model admission; current/narrated `World_State` summaries may remain as corroborating exchange text.

Persistent **information state** is a valid world condition when the exchange establishes that a rumor, report, warning, allegation, public belief, or other news is circulating, repeated, consequential, or otherwise likely to matter after the scene. Capture stores the existence/circulation of the information, not the unverified underlying claim. A summary must preserve its epistemic status, for example `Reports are circulating that...`, `Travelers warn that...`, or `X is reportedly...`.

Quoted dialogue alone establishes only that the speaker made the statement. It may establish a performative speech act itself, such as a declaration, threat, demand, promise, refusal, or warning, but not the truth of an external proposition embedded in that speech. If all supporting evidence for a mutation is quoted dialogue, the deterministic source firewall requires the summary either to describe that speech act or to preserve reported/rumored/believed epistemic status; otherwise it rejects the mutation as an attempted promotion into objective reality. A later unquoted narrator establishment may independently confirm, revise, or supersede the reported-information condition. A single isolated remark with no materially persistent information-state or speech-act significance remains excluded.

Capture may:

- create a grounded fact/development
- update/replace a current summary
- resolve/supersede a record
- attach evidence
- link causally related existing records

If several independent materially persistent conditions are established in one exchange, capture may represent each once in the same bounded request rather than stopping after the most scene-salient one.

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
- while branch ownership is unresolved or `recoveryRequired` is set, retain state only for recovery/inspection and suppress both Reality and Spatial private continuity injection

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

Phase 4 uses correctness-first catch-up for existing **active developments** through two bounded candidate paths:

- stale relevant developments may qualify from a meaningful elapsed-time hint grounded to the current raw-message boundary, or grounded current-exchange evidence that directly affects that development
- stale background developments may qualify only when a meaningful elapsed-time hint exists; they are drawn from the existing active-development index and do not need to be relevant to the current scene

Ordinary relevance alone is not an evolution trigger. Background selection without meaningful elapsed time is inert. Short passage alone is not automatically meaningful. Opaque fictional time hints are allowed without requiring a calendar engine.

Relevant developments retain priority: at most four relevant targets are admitted first. Background catch-up may fill at most three remaining slots. The combined automatic evolution batch is capped at six developments and always uses at most one provider request.

Background candidate discovery must remain bounded and non-global. The ephemeral relevance index maintains an active-development pool during already-authorized full index construction/replacement and incremental canonical updates. On an eligible elapsed-time boundary, background catch-up examines at most 32 pool entries and never scans all World State records merely to find remote work. The same elapsed-time evidence boundary may trigger at most one background sweep; it must not drain additional remote batches on following turns merely because the original time-skip text is still inside the bounded exchange.

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

Diagnostics never become canonical state and never store credentials, private prompts, story transcripts, transport headers, hidden/reasoning content, session identifiers, or other connection secrets. The explicit operator-only Operations inspector may retain a bounded slice of the model's extracted text response and bounded rejection JSON for debugging; this is ephemeral telemetry, never evidence/canonical authority, and is escaped before rendering.

## C18. Performance

Normal exchange target:

- at most one capture model call when capture is due
- zero evolution calls on ordinary relevant turns
- at most one batched evolution model call when a Phase 4 trigger is met
- at most six developments in that automatic evolution batch, with at most four relevant-priority targets and at most three background-fill targets
- background discovery examines at most 32 indexed active-development entries on an eligible elapsed-time boundary
- no full-world scan, including evolution
- no full-chat scan
- no per-record request fan-out
- local relevance retrieval
- compact injection

Manual inspect/query/correction, rebuild, and Phase 6 UI projection add no automatic normal-turn request path. UI projection/search/rendering is local and must issue zero model/provider calls. Any additional automatic request path requires explicit contract justification and measurements.

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

- plan the selected chat range in bounded chronological assistant-completed exchange windows using original global message IDs
- explicit rebuild may include hidden roleplay through an immutable virtual view, enabled by default but operator-toggleable; the stored chat array, `is_system` flags, DOM visibility, saves, and lineage fingerprints remain untouched
- hidden user rows may be virtually restored as user evidence; hidden assistant rows require conservative ordinary-assistant markers, while genuine system/tool/UI messages remain system and are excluded
- Full chat rebuild starts from a clean isolated root; an explicit partial rebuild may start from a later message only when the exact canonical prefix before that message can be proven and restored from lineage/checkpoint history
- after Reset or whenever the exact prefix is unavailable, partial rebuild fails before provider work and instructs the operator to use Full chat rather than approximating older state
- fail before provider work if the configurable assistant-boundary cap is exceeded; explicit maintenance may raise that cap up to the hard 4096-boundary ceiling
- rebuild into an isolated candidate state, never incrementally overwrite canonical state while scanning
- reuse the existing capture prompt, including its persistent-condition completeness sweep, source firewall, duplicate gate, reducer, request dispatcher, and exact message lineage
- historical rebuild windows explicitly recover materially persistent narrated conditions even when they were already off-screen, ignored by the PC, or unrelated to the PC objective
- tag reconstructed narrative evidence as `rebuild`
- surface relevant resolved/superseded tombstones during reconstruction so passive historical similarity cannot resurrect an old episode
- allow a genuinely new related episode only through explicit new-episode semantics
- do not replay lazy evolution or run hidden off-screen simulation during rebuild
- allowlist only explicit successful capture boundary outcomes (`applied` / `no-change`); timeout, cancellation, skipped/unexpected outcomes, stale scope, malformed response, provider failure, or supporting-context failure discard the entire candidate
- a structurally malformed Reality or Spatial mutation row inside an otherwise valid envelope invalidates the rebuild boundary; semantic admission rejections such as duplicate/resurrection blocking may still produce a valid no-change boundary
- a Reality-only rebuild preserves the disabled Spatial namespace instead of interpreting disabled extraction as deletion
- atomically replace canonical state only after the complete chronological pass succeeds
- support controlled semantic comparison between incremental and rebuilt current state even when evidence source classes differ

Normal runtime must never depend on recurring rebuilds.

## C20. Ukiyo / story-driving CoT boundary

World State does not modify Ukiyo, Megumin Suite Beta, Writer's Mind, or the RP CoT.

World State Alpha may consume narrative produced by an RP model using a story-driving CoT such as Writer's Mind, but those instructions are not inherited by capture or evolution. Rebuild reuses the capture firewall and likewise does not inherit story-driving instructions.

Story-driving principles such as autonomous world motion, scene variation, chance, escalation, or avoiding stagnation are narration concerns and are not evidence that a world change occurred.

World State records or evolves state only from its own grounded evidence and causal contract.

Writer State, narrative plans, Story Director output, anticipated events, consequence timers, arc/scene planning, and spatial hypotheses are not canonical World State evidence. Before Reality Core capture, Spatial capture, rebuild, elapsed-time detection, or evidence validation evaluates assistant narration, planning-only tagged blocks are removed from the evidence view only. Raw chat storage, raw-message ownership, lineage fingerprints, and branch history remain unchanged. Elapsed-time catch-up additionally requires an established chronology transition: system messages, quotations, hypotheticals, future plans/appointments, and bare prospective `next ...` phrases are not elapsed evidence. Accepted elapsed support retains a bounded surrounding narrative sentence rather than only the matched time phrase.

Spatial state changes only from trusted base geography, grounded user/assistant narrative evidence, deterministic derivation from already-established spatial facts, or explicit user/manual authority.

It supplies compact continuity only. Scene reasoning and prose remain owned by the configured RP model.


## C21. Phase 6 UI and evidence inspection

Phase 6 is a **projection layer only**. Canonical state, mutation admission, persistence, rollback, transfer, and rebuild remain owned by their existing core/Phase 5 services.

The Phase 6 UI surface provides:

- Current: active records only
- Recent: bounded records ordered by latest established change
- Resolved: resolved and superseded tombstones
- Search: bounded free-text summary/anchor search using the existing manual query semantics
- Detail/evidence: current summary/status/trend, anchors, message boundaries, optional time anchor, bounded evidence, and causal/related records
- Operations: expandable allowlisted telemetry for capture/rebuild/evolution, including bounded model response content and rejection JSON when available
- Data & maintenance: health/count summaries plus explicit export/import/rebuild/clear action intents; Clear is destructive and visually separated from rebuild

UI rules:

- the UI never calls the canonical reducer, storage writer, import/reset applier, or rebuild executor directly
- maintenance buttons emit caller-owned action intents; destructive preview/confirm semantics remain owned by Phase 5/caller wiring
- all canonical, evidence, and diagnostic text is escaped before HTML rendering
- ordinary Current/Recent/Resolved/Places/Search/Data views must not expose raw record IDs, evidence IDs, lineage fingerprints, checksums, rollback sequence numbers, undo patches, prompts, transcripts, credentials, transport headers, reasoning content, or provider payloads; the explicit Operations inspector is the sole exception for bounded escaped model response/rejection content
- journal data may contribute a small human change label such as "Captured from story" or "Manual correction", but rollback internals are not an ordinary UI surface
- evidence is bounded and source classes are translated to human labels
- diagnostics pass through the existing allowlist sanitizer before display
- list/detail/search outputs are bounded even when the backend contains hundreds or thousands of records
- desktop uses a wider bounded flat workspace where Reality records expand inline to anchors/timeline/evidence/relations; Places may retain a dedicated list/detail editor; tablet preserves inline Reality disclosures while adapting Places between split and single-pane detail; mobile uses full-screen navigation with Current / Places / Ops / More bottom navigation, full-height rebuild sheet, safe-area handling, and >=44px touch targets
- UI namespace/classes remain isolated under World State Alpha

Phase 6 exposes a host-neutral DOM mount/controller that accepts caller-supplied state, diagnostics/runtime status, close, and maintenance callbacks. The Phase 6 module does not register SillyTavern event hooks, slash commands, launchers, settings integration, extension manifests, or cross-extension adapters. Phase 7 may mount this controller through the separate host shell without moving host authority into `ui.js`.


## C22. Phase 7 SillyTavern host and coexistence boundary

Phase 7 supplies the smallest real SillyTavern host shell around the already-accepted core. The host shell owns integration mechanics only; it does not introduce new World State semantics.

Owned host namespace:

- extension settings key: `world_state_alpha`
- private prompt key: `world_state_alpha_private_continuity`
- settings/root DOM IDs and event selectors prefixed with `world_state_alpha` / `wsa`
- sidecar upload filenames prefixed with `world-state-alpha-`
- optional read-only debug global: `WorldStateAlpha`

NPC State Delta remains completely independent. World State Alpha must not read, mutate, enumerate, migrate, or depend on NPC State Delta settings, sidecars, DOM, prompt keys, globals, commands, or dossier internals. It must not target Ukiyo, Megumin Suite, Writer's Mind, or any other story-driving extension for mutation or configuration. No external-extension state adapter is authorized in Phase 7.

The host uses an owner-qualified per-chat key so equal chat filenames belonging to different characters/groups cannot share World State storage. A tiny sidecar pointer may live under World State's own extension settings; canonical bulk state remains in the World State sidecar. If that pointer is missing or has stale revision/checksum metadata, the host may recover the same owner-qualified sidecar from its deterministic World-State-only host path and repair the pointer without inventing new state. SillyTavern character/chat renames must migrate that ownership key without exposing a fresh empty continuity state; `CHARACTER_RENAMED_IN_PAST_CHAT` must rebase only proven lineage metadata for the renamed messages rather than treating a host cosmetic name rewrite as a story branch. Chat/group-chat/character deletion must resolve the exact owner or fail closed, persist a lifecycle ownership tombstone, and neutralize the retired sidecar to empty continuity when possible so later identity/filename reuse or a settings-save crash cannot resurrect unrelated state. Sidecar writes for the same target are serialized before revision check/upload, using the browser Web Locks API when available and an in-process queue otherwise. Ownership epochs invalidate stale hydration/write completions across rename/delete transitions. A durable pointer that fails hydration is never replaced by a fresh empty state. Hydration/corruption errors fail closed and suppress automatic mutation until the owned state is safely available again. For canonical mutations, the host persists the candidate sidecar before publishing that candidate into the in-memory canonical cache.

Normal lifecycle ownership:

- completed assistant message -> reconcile exact branch -> at most one eligible capture request -> canonical reducer result -> branch journal ownership -> sidecar persistence
- user message before the next generation -> hydrate/prepare from the last durably committed branch-safe state -> compact private injection immediately -> serialize optional provider-backed meaningful elapsed-time/background catch-up on the existing chat writer queue for later injections
- chat load/change -> cancel World State in-flight work, hydrate/reconcile current owned state, then refresh only the World State prompt/UI
- edit/delete/swipe lifecycle -> cancel World State requests, clear any passive post-processing rebase candidate, and run exact `reconcileBranch`; never preserve abandoned-branch state
- passive post-processing of the latest successfully captured assistant boundary -> the runtime may rebase lineage metadata without undoing canonical state only when that exact boundary is still `lastCaptureMessage`, all later already-owned message fingerprints are unchanged, and no branch lifecycle event marked the chat dirty; this capability is ephemeral and is not a general edit bypass
- character/chat rename -> migrate the owner-qualified World State key and pointer only after the new owned sidecar is durably written; host historical-name rewrites rebase proven lineage keys without rolling current world truth backward
- chat/group-chat/character delete -> resolve exact owner ownership, neutralize the retired sidecar when possible, persist a lifecycle tombstone, then remove active pointer/cache ownership; ambiguity preserves data fail-closed
- routing/enablement setting changes -> advance the state epoch and cancel matching provider work before new settings take effect

All asynchronous provider-backed work is guarded by current chat identity, exact raw-message lineage, and local state epoch. Host ownership-changing operations additionally use an ownership epoch so stale hydration or persistence completion cannot repopulate a renamed/deleted owner. Stale completion is discarded. Provider-backed automatic work and operator maintenance/Spatial mutations for one chat are serialized through the same per-chat work queue. Automatic assistant capture must not keep SillyTavern's awaited `MESSAGE_RECEIVED` render/save event open. Provider-backed continuity/evolution must likewise not keep the awaited `MESSAGE_SENT` preparation path open: that event publishes only the last durably committed safe state for the current generation, then queues remote completeness work whose committed result is eligible for later injections.

The host calls `setExtensionPrompt` only for `world_state_alpha_private_continuity`, SYSTEM / `IN_CHAT`, at the configured shallow depth. Disabling, leaving a chat, or failing hydration clears only that World State key. The host never mutates global RP provider/model/preset settings.

Phase 7 mounts the existing Phase 6 panel through one World-State-owned root and a small, natively collapsible settings card. It does not add a launcher/watchdog/MutationObserver framework or a generic slash-command surface. Maintenance remains a host projection over Phase 5 services:

- export is local
- import uses preview, explicit confirmation, then apply/persist
- reset uses preview, explicit confirmation, then apply/persist
- rebuild is explicit confirmation only, uses the bounded Phase 5 rebuild service, and atomically replaces state only after complete success

Rebuild never becomes automatic because of hydration failure, missing state, branch change, or ordinary play.

World-significant person facts may still exist as generic World State records, but Phase 7 does not read or duplicate NPC dossier fields such as personality, speech, appearance, mood, relationship, mannerism, behavioral profile, or personal goals.

Deterministic Phase 7 tests may prove namespace/prompt/storage/DOM isolation and mocked host transactions. They do not prove live SillyTavern browser compatibility, live provider quality/latency, or real simultaneous co-install behavior; those remain explicit acceptance boundaries for Phase 8/release hardening.

## C23. Phase 8 performance and release hardening

Phase 8 may optimize execution, storage growth, measurement, and packaging. It may not weaken the semantic/source/branch contracts established by earlier phases.

### C23.1 Ordinary-turn work bound

The real SillyTavern ordinary assistant/user path must not perform a full-chat or full-world traversal merely to prepare capture or continuity.

On an append-only ordinary turn:

- raw-message lineage is extended from the cached proven tail and only new message fingerprints are computed
- edit/delete/swipe signals mark that chat branch dirty immediately; a dirty chat must complete exact reconciliation before the append fast path is permitted again
- fail-closed recovery keeps the branch dirty and `recoveryRequired` blocks the fast path until exact recovery/rebuild clears it
- bounded recent exchange extraction reuses cached lineage
- provider currentness is guarded by chat identity, local state epoch, and the owned source-message fingerprint
- capture/evolution journal commits reuse the already-known lineage
- relevance uses the ephemeral index and bounded candidate discovery

Whole-chat lineage reconciliation remains authorized for hydration/recovery, edit/delete/swipe, rebuild, and other explicit operations requiring whole-history proof.

### C23.2 Indexed relevance bound

The Phase 8 index is ephemeral and non-canonical. It must not be serialized or treated as source authority.

Normal indexed retrieval must not iterate the complete record corpus, the complete exact-anchor dictionary, or every posting list. Query terms drive bounded posting-list lookups. Posting traversal and candidate scoring have hard deterministic caps. Exact/anchor evidence receives priority over weak common summary-token evidence before candidate truncation.

Once admitted to the candidate set, active records use the existing relevance scoring and one-hop expansion rules. A separate ephemeral bounded tombstone posting index may surface at most a tiny resolved/superseded admission slice to ordinary capture so recurrence can pass the existing new-episode/resurrection gate; tombstones remain excluded from current-state injection. A non-indexed compatibility path may remain for host-neutral/manual regression use, but the real normal-turn host path supplies the index.

Full index rebuild is restricted to hydration and whole-state replacement/recovery paths. Routine canonical mutations update the cached index using small non-persisted reducer deltas. Incremental refresh must preserve generic persisted relation edges as well as causedBy/affects adjacency.

### C23.3 Evidence compaction

After successful canonical mutation, live `state.evidence` may contain only evidence still referenced by retained records. Unreferenced evidence is pruned deterministically.

Compaction must preserve exact rollback. Undo data must retain any removed evidence necessary to restore a prior proven boundary. Persisted schema/sidecar/bundle/journal format versions remain unchanged.

### C23.4 Version and package reproducibility

For the Phase 8 / 0.8 release, application version was `0.8.0-alpha.1` and all persisted format versions were 1. Phase 9 intentionally bumps only the canonical state schema to version 2 because durable Spatial state is added. The 0.9.0-alpha.7 through 0.9.0-alpha.15 hardening releases change no durable format: sidecar, bundle, and rollback-journal envelope formats remain version 1 and canonical schema remains version 2.

`npm run package` must create a deterministic installable extension archive and deterministic release manifest. Unchanged source input must produce byte-identical output across repeated package runs. CI must verify this with output hashes, not merely file names.

### C23.5 Measurement honesty

Synthetic/local measurements may establish bounded request counts, prompt/injection sizes, indexed candidate work, storage growth, rollback-window bytes, and package reproducibility. They must not be described as live TTFT, provider latency, browser timing, or real co-install proof.

Real SillyTavern/provider/browser/Delta/Ukiyo/Megumin acceptance results are recorded separately under `docs/LIVE_ACCEPTANCE.md`. No live PASS result may be fabricated from mocks or deterministic tests.


## C24. Spatial Continuity

Spatial Continuity is an **optional sibling subsystem** inside World State Alpha. It is not a third Reality Core record kind and never stores locations, spatial relations, or routes inside `records[]`.

The semantic ownership boundary is:

```text
World State Alpha
|-- Reality Core
|   |-- fact / development
|   |-- evidence / relevance / evolution
|
`-- Spatial Continuity
    |-- locations
    |-- spatial relations
    |-- route associations
    |-- coordinate authority
    |-- campaign overrides
    `-- spatial retrieval/injection
```

Reality Core and Spatial Continuity may share per-chat ownership, sidecar envelope, raw-message lineage, rollback journal/checkpoints, diagnostics, provider routing, settings, UI shell, and one eligible capture request. They do **not** share semantic mutation reducers.

### C24.1 Optional universal profile

Spatial Continuity is disabled independently by default and must remain usable outside Ternia. The durable profile is generic Cartesian 2D metadata: north/east axes, unit scale, optional bounds, decimal precision, and True North lock.

A campaign with Spatial enabled but no configured profile may still retain named places, explicit coordinates, and relative-only relations. It must not inherit a hidden unit scale, bounds, or True North transform. Scale-based coordinate derivation requires an explicit profile with a positive unit scale; locked direction validation requires an explicit profile. The declared north/east axes are part of the math rather than decorative metadata.

Ternia is an adapter/acceptance fixture, not core ontology. Its accepted profile is North = +Y, South = -Y, East = +X, West = -X; 5 km per coordinate unit; X/Y bounds -500..500; decimal step 0.1; True North locked.

Route, road, river, and sea-lane geometry may curve. Route/travel length is not Cartesian displacement unless accepted evidence explicitly establishes straight-line/direct displacement.

### C24.2 Base map versus campaign state

Read-only base geography and per-chat campaign Spatial state are different authorities.

- imported base data remains immutable source/reference geography
- generated campaign locations, relations, routes, and overrides remain in that chat's canonical `spatial` namespace
- no generated location is automatically written back into a base source
- a campaign override shadows a base location without mutating the source
- separate chats may attach the same base map while accumulating different generated places
- if a campaign declares a base-map authority but the referenced source cannot be loaded, automatic Spatial capture/injection fails closed rather than treating campaign-generated state as the complete map

### C24.3 Coordinate authority and derivation

Coordinate authority is deterministic. The effective precedence is:

1. locked manual campaign coordinate
2. campaign override coordinate
3. base canonical coordinate
4. grounded narrative-explicit coordinate
5. unlocked manual coordinate
6. deterministic derived coordinate
7. relative-only location
8. unknown

A locked or higher-authority coordinate may not be silently moved by lower authority. Unlocking a manual coordinate explicitly permits a later grounded higher-ranked observation to correct it. Provider-authored rebuild mutations are narrative authority, not operator authority, and therefore obey the same base-map, lock, coordinate-rank, and manual-metadata restrictions as automatic capture. Provider response extraction may unwrap a standard text envelope such as `choices[0].message.content`, but hidden/reasoning fields are never capture output. Provider wire compatibility may repair only deterministic, unambiguous field-name aliases whose values preserve the canonical meaning (currently `category` -> `kind` and `description` -> `summary`). Canonical and alias fields that conflict remain structurally invalid; compatibility repair must be counted in bounded diagnostics and must not weaken atomic rebuild failure. Connection-profile transport extraction may accept either an already-extracted text/content string or the raw OpenAI-compatible `choices[0].message.content` field; hidden `reasoning_content` is never capture evidence or output.

Precise X/Y must never be invented merely because a location exists. Relative-only and unknown are valid durable states.

Deterministic derivation is allowed only from a known anchor plus grounded direction and grounded straight-line/direct distance under an explicit configured profile with a positive unit scale. Cardinal and diagonal vectors use that profile's declared north/east axes and unit scale. Vague distance and route/travel distance do not yield exact coordinates.

When True North is locked, any stored direction whose endpoints both have known coordinates must agree with the coordinate delta. Direct relation proposals use the same grounding policy as relative-location proposals: accepted narration must ground the endpoint identities and any direction, numeric distance, or distance meaning that is persisted. Unsupported precision is removed or rejected rather than canonicalized. For an otherwise grounded proper named location, failure of optional relative-position metadata may drop only that unsupported relation while retaining the location with unknown position; generic scenery does not receive this salvage.

### C24.4 Admission and evidence firewall

Generated-location admission is conservative. A place may be retained when grounded evidence establishes at least one durable signal such as a proper name, explicit position/coordinate, revisit, persistent infrastructure/resource/NPC association, route-landmark role, material consequence, or explicit manual creation. Generic unnamed scenery is not durable geography.

Spatial automatic capture shares the existing eligible Reality capture request. It may add a bounded `spatialMutations` envelope to that response, but it does not create a second automatic provider call.

Every automatic Spatial mutation passes its own source/evidence firewall and reducer. A multi-token proper generated place name may be admitted compositionally only when every normalized name token occurs together in one accepted evidence claim; this is a bounded grounding rule, not fuzzy name inference. `writer_state`, planning blocks, anticipated events, and model-only hypotheses are not evidence. Rebuild uses the same sanitized evidence view. Within the bounded current exchange only, deterministic parsing may supplement a successful model response from an explicit `World_State` current-location header by proposing the named place and unambiguous same-header X/Y pair through the ordinary Spatial admission/reducer path. It may merge with a matching model proposal, but ambiguous/conflicting associations fail closed; it never directly writes state or bypasses base-map authority, currentness, journaling, rollback, or Spatial disablement.

### C24.5 Manual authority and UI

The Spatial panel must support campaign-authoritative editing without a model call:

- add location
- rename and edit type/context
- edit/clear X and Y
- select coordinate authority and lock/unlock
- edit relative anchor, direction, distance and distance meaning
- edit route associations
- archive or delete a generated location/override
- merge accidental campaign duplicates
- create a campaign override for a base location
- inspect provenance/evidence

Manual spatial edits journal through the ordinary raw-message boundary owner. Base entries remain read-only until the user creates an override. Operator-authored location metadata, relations, and route semantics are campaign authority: automatic capture may attach confirming evidence and grounded additive route associations, but it may not rewrite those manual semantics.

### C24.6 Branch, migration, import/export and rebuild

Canonical schema version 2 adds the durable `spatial` namespace. Schema version 1 sidecars/bundles/checkpoints migrate to schema 2 by supplying an empty Spatial state. Sidecar format, bundle format, and rollback-journal format remain version 1.

Spatial undo data participates in the same branch journal and checkpoints as Reality Core. Swipe/delete/edit/branch reconciliation must restore both subsystems to the same proven boundary. Stale provider completion is rejected by the existing host currentness guard.

Export/import carries campaign Spatial state. Foreign import clears false local spatial message/lineage provenance. Base-map source files remain separate read-only references identified by campaign `baseMapRef`; foreign import preserves source identity/digest but clears the machine-local source path so the target host must rebind or reattach the read-only source.

Explicit rebuild reconstructs generated Spatial state from the same chronological sanitized evidence stream when Spatial reconstruction is enabled, retains the attached base-map reference/profile, and atomically replaces state only after complete success. A Reality-only rebuild preserves the disabled Spatial sibling wholesale rather than treating disabled extraction as deletion.

### C24.7 Bounded retrieval and private injection

Normal turns must not scan every campaign location, the complete base map, every route/polyline, or the full chat.

Spatial relevance uses an ephemeral per-chat index and bounded candidates. Normal private injection is a compact continuity block containing only the relevant current place/coordinate/context, a few directly linked/relevant places, and useful route/connection information. It is private continuity, not automatic PC knowledge.

Spatial injection does not modify Megumin Suite. It supplies authoritative continuity through World State Alpha's existing private prompt so Megumin/RP narration can keep its own scene/world-state presentation.

### C24.8 No Story Director

Spatial Continuity does not plan arcs, invent places for drama, escalate conflicts, generate quests, avoid stagnation, shape scenes, or simulate a map. It remembers and deterministically relates established geography only.
