# Changelog

## 0.9.0-alpha.27 - Server-authoritative multi-session freshness

### Fixed

- The per-browser World State cache is no longer treated as fresh merely because a chat was hydrated earlier in the same session.
- Meaningful boundaries now recheck the same-backend server sidecar and rehydrate when another desktop/mobile/tab session has advanced its revision.
- Chat activation, user/assistant boundaries, background continuity, panel open, maintenance/manual/Spatial actions, branch changes, and browser resume (`visibilitychange`, `pageshow`, window focus) all participate without permanent polling.
- If a newer durable sidecar is a strict continuation of the currently loaded SillyTavern chat, World State preserves the newer server state and fails continuity closed until the host chat catches up instead of rolling the server sidecar backward.
- A cross-session `WORLD_STATE_REVISION_CONFLICT` now rejects the stale writer, refreshes from durable server state, records bounded diagnostics, and prevents the obsolete candidate from being published in memory.
- Runtime status now exposes the hydrated revision and latest observed server revision for debugging.

### Architecture

- The SillyTavern `/user/files/world-state-alpha-*` sidecar is explicitly the canonical authority. In-memory state and relevance/spatial indexes remain disposable performance caches.
- No localStorage/IndexedDB canonical store, device-to-device sync layer, peer transport, or background polling was added.
- Different SillyTavern backends remain independent by design.

### Validation

- Added host regressions for server-authoritative freshness boundaries, revision-aware hydration metadata, resume refresh, stale-writer conflict recovery, and the fail-closed host-chat-behind condition.
- Canonical schema remains version 2; sidecar, bundle, and rollback-journal envelope versions remain 1.


## 0.9.0-alpha.26 - Rapid branch-write race hardening

### Fixed

- Rapid edit/delete/swipe/regenerate sequences can no longer let a capture or evolution result that started on the abandoned branch publish after the branch event.
- Canonical capture, evolution, exact branch restore, manual lifecycle, and Spatial writes now guard current chat/state lineage across the sidecar I/O boundary. If the operation becomes stale while the file write is in flight, the previously authoritative state is immediately persisted back before any candidate is published in memory.
- Failed stale-write compensation blocks the chat fail-closed with `WORLD_STATE_STALE_WRITE_RESTORE_FAILURE` instead of leaving an uncertain durable candidate behind.
- Explicit `MESSAGE_EDITED`, `MESSAGE_DELETED`, `MESSAGE_SWIPED`, and `MESSAGE_SWIPE_DELETED` events now synchronously revoke the latest passive-capture rebase candidate before incrementing the state epoch and queueing exact reconciliation. Passive host/Regex cleanup remains supported when no explicit branch event was observed.
- Manual lifecycle and Spatial edits use the same chat-head transaction guard, so an operator action cannot land on a branch that changed while a prompt/base-map/persistence wait was in progress.

### Delete/regenerate behavior

- Deleting the latest captured assistant message and immediately regenerating a replacement at the same slot rolls back only the abandoned suffix. Earlier facts/developments remain intact.
- A regenerated `MESSAGE_RECEIVED` waits behind the per-chat branch reconciliation queue when the explicit branch event arrived first; if event delivery is reordered, lineage mismatch still forces reconciliation before capture.
- A stale capture that was already inside sidecar persistence is compensatingly restored and returns before `setCachedState()` or `passiveCaptureRebaseCandidates.set()`.

### Validation

- Added an executable stale-write transaction regression that invalidates currentness during the candidate sidecar write and proves the durable write sequence is candidate -> prior authoritative state.
- Added a branch-core regression for established earlier facts/developments followed by delete + immediate regenerated assistant at the same message slot.
- Full suite: 322 tests. Phase 1-9 validation includes stale-write compensation and explicit branch-race invalidation.

## 0.9.0-alpha.25 - Session and device hydration hardening

### Fixed

- Startup no longer hydrates canonical World State from the DOM-ready phase. Hydration waits for SillyTavern host readiness so an early storage/settings race cannot be mistaken for a brand-new campaign.
- `EXTENSION_SETTINGS_LOADED` now rechecks any provisional fresh hydration instead of being ignored after the first bootstrap.
- Deterministic sidecar discovery retries bounded transient misses before concluding that no local durable file is reachable.
- A settings pointer whose `/user/files` target is absent is now a recoverable missing-baseline state, not an ordinary empty campaign and not an unrecoverable panel lockout.

### Fail-closed recovery

- An established chat with no reachable durable sidecar pauses automatic capture, evolution, private injection, branch persistence, manual record writes, and Spatial writes instead of silently starting continuity from the current turn.
- The UI shows a persistent recovery banner and hydration source. Recovery may establish a new baseline only through **Full chat rebuild**, bundle import, or explicit reset. Partial rebuild is disabled because the prior canonical boundary cannot be proven.
- If a baseline-establishing Full rebuild becomes stale after its candidate is already persisted, the recovered candidate is retained and reconciled against the latest branch. It is never compensated with an empty sidecar.
- Rename/delete lifecycle handlers also defer until host hydration readiness.

### Device/session boundary

- Same-backend browser/session changes can recover from the deterministic World State sidecar even when the local extension-settings pointer is absent or stale.
- A genuinely different SillyTavern backend does not share the original backend's `/user/files` store automatically. Alpha.25 detects that missing durable baseline and offers explicit rebuild/import recovery rather than presenting a false fresh state.

### Validation

- Added host regressions for host-ready hydration gating, bounded deterministic retries, post-settings rehydration, missing-baseline write guards, Full-rebuild-only baseline recovery, and stale baseline-rebuild retention.
- Added responsive UI coverage for the recovery banner, hydration source, and disabled partial rebuild modes.

## 0.9.0-alpha.24 - Spatial Coordinate Profile controls

### Added

- Spatial Places now includes a collapsible **Coordinate Profile** editor for campaigns without an attached base map.
- Manual profiles can configure Cartesian North/East axes, kilometers per coordinate unit, optional X/Y bounds, coordinate precision, and True North lock.
- The mathematical system remains explicitly **Cartesian 2D**; unsupported systems still fail closed instead of pretending to use Cartesian math.

### Authority and safety

- An attached base map is the authoritative Coordinate Profile source. Its profile is displayed read-only and overrides any older stored campaign profile for capture, injection, relation validation, and UI projection.
- Detaching a loaded base map snapshots its currently authoritative profile into the campaign's manual profile so orientation/scale do not jump backward.
- Attaching a map with different profile math or manually changing orientation/scale/bounds/precision requires confirmation when derived coordinates exist.
- Confirmed math-changing profile edits atomically clear only `derived` coordinates to unknown; manual, narrative-explicit, campaign-override, and base-canonical coordinates are preserved.
- Profile edits use the existing journaled `set_profile` mutation and therefore participate in branch rollback/checkpoints.

### Validation

- Strict profile validation now rejects invalid axes, non-positive scale/precision, partial/invalid bounds, non-boolean True North lock values, and unsupported coordinate systems.

## 0.9.0-alpha.23 - Pre-1.0 schema and Spatial simplification

### Simplified

- Canonical World State is current-schema-only during pre-1.0 development. Schema-1 sidecars/checkpoints are rejected instead of carrying migration code forward.
- Removed old lineage metadata backfill and ambiguous-legacy recovery branches. Current lineage rows always own role and sanitized narration fingerprints; current semantic rebase and exact rollback remain.
- Removed world/version-specific base-map adapters, including the Ternia parser branch, and removed `baseMapRef.adapter`.
- Spatial base maps now use one setting-agnostic contract: optional Cartesian `profile`, `locations[]`, and optional `routes[]`.
- Source-map `version` is descriptive metadata only and never selects parser behavior.
- Derived base-map/location/route identities no longer depend on source version, so ordinary map revisions do not automatically orphan campaign overrides. The normalized content digest still changes with authoritative source content.
- The host base-map registry indexes each imported source by exact digest and stable map ID. Attached campaigns remain pinned to their path; pathless imported campaigns may rebind by stable ID to the locally available revision.
- Replaced the Ternia-specific parser fixture/validator with a generalized Cartesian base-map fixture.

### Preserved

- Narration-equivalent semantic lineage rebasing for current data.
- The bounded O(1) latest-captured-boundary rewrite detector for delayed SillyTavern/Regex normalization.
- Exact rollback/fail-closed branch recovery, immutable base-map authority, campaign overrides, provider alias repair, host rename/delete ownership safety, and the existing one-provider-call capture cadence.

### Pre-1.0 data note

- Experimental sidecars/checkpoints from earlier schema versions are intentionally outside the compatibility contract. Reset or Full chat rebuild is the recovery path when testing Alpha.23 against older experimental data.

## 0.9.0-alpha.22 - Legacy cleanup and architecture synchronization

### Cleaned

- Removed three proven-dead local helpers left behind by earlier refactors: the old rebuild message-text extractor, an unused Spatial relevance token-set wrapper, and the obsolete Reality detail-card wrapper superseded by inline disclosure rows.
- Removed stale named imports from the host shell, Spatial capture/core/manual modules, and UI. The underlying host-neutral Spatial service exports remain available where tests/other modules still exercise them.
- Synchronized architecture/data-model/status documentation with the shipped schema 2 state, actual module graph, and Alpha.22 release lineage.

### Deliberately retained compatibility

- Schema-1 -> schema-2 state/checkpoint migration remains supported for existing pre-Spatial campaigns.
- Legacy lineage metadata backfill and ambiguous-legacy fail-closed handling remain because old Alpha sidecars can still be loaded.
- Provider field-alias repair remains because live Gemini-compatible output can still emit unambiguous `category`/`description` drift.
- Character/chat rename migration, sidecar tombstones, `generic_v1`, and `ternia_v0_9_10` base-map adapters remain active compatibility contracts.
- No canonical schema, sidecar, bundle, rollback-journal, capture cadence, provider-call count, or lifecycle semantics changed.

## 0.9.0-alpha.21 - Lifecycle identity and history admission hardening

### Fixed

- Live capture and chronological rebuild now carry a bounded **interpretive lifecycle antecedent ID set** separately from evidence. Prior-scene text still never becomes mutation evidence; it may only bind an indirect current reference when exactly one candidate remains.
- Automatic non-create mutations must now identify the existing active target from current-exchange evidence unless that single bounded antecedent provides the referent. A provider cannot splice ending words from one condition into another visible record.
- Resolved/superseded tombstones exposed for recurrence checks are immutable to automatic capture/rebuild. A recurrence must use a new `create` with `newEpisodeOfRecordId`.
- A provider `create` already marked resolved may still be normalized into `resolve` when it clearly duplicates a visible active episode, but an unmatched terminal create is rejected instead of minting one-off event-log history.
- Duplicate consolidation now prefers a sufficiently similar **active** episode before considering older tombstones, preventing historical wording from blocking closure/update of the current recurrence.
- Any provider `create` that consolidates into `update`/`resolve` is source-firewalled a second time against the chosen target, so duplicate repair cannot bypass target identity checks.
- Explicit `newEpisodeOfRecordId` proposals now consolidate into an already-active sufficiently similar recurrence instead of creating another Current record; only a genuinely new active recurrence may create a new record.
- Live and rebuild relevance use the sanitized capture exchange surface, so planning-only assistant blocks cannot steer lifecycle or Spatial target retrieval.
- Phase 7/8 version assertions now accept synchronized future 0.9 alpha versions instead of requiring another hand-maintained allowlist edit.

### Preserved

- Current remains active truth only. Recent remains a bounded latest-change feed and may show a just-resolved record; Resolved remains bounded tombstone history.
- Exact current-exchange excerpts remain the only automatic Reality mutation evidence.
- One capture provider call, the eight-record visible Reality cap, recurrence/new-episode protections, manual lifecycle controls, branch rollback, and all persisted schema/envelope versions remain unchanged.

## 0.9.0-alpha.20 - Live lifecycle retention and partial rebuild recovery

### Fixed

- Live capture now reserves up to two relevant active **development** records for lifecycle reconciliation before filling the ordinary eight-record capture context. Selection may use a bounded prior-scene retrieval window so indirect endings such as “the last two collapse” can still surface the development that must be resolved.
- The wider lifecycle window is retrieval-only. Mutation evidence remains restricted to the exact current exchange and still passes the existing source firewall, so prior narration cannot itself resolve or update state.
- Capture relevance now uses the same sanitized narrative surface sent to the extractor instead of allowing private planning blocks to influence record retrieval.
- Partial rebuild now reconciles/extends the live branch before testing a nonzero start range. Narration-equivalent SillyTavern/Regex rewrites therefore rebase first instead of producing a premature `WORLD_STATE_REBUILD_RANGE_BASE_UNAVAILABLE`.
- Checkpoint trimming now preserves the root checkpoint inside the existing bounded checkpoint cap, avoiding the ~48 assistant-boundary cliff where the root previously aged out.

### Preserved

- Current remains canonical state; Recent remains a bounded recent-change feed and may legitimately include a record immediately after it is resolved or superseded.
- Automatic capture still uses one provider request per eligible assistant boundary, a maximum of eight visible Reality records, exact-current-exchange mutation evidence, and the existing reducer/source firewall.
- A genuine reset or genuinely unavailable historical prefix still fails partial rebuild closed and requires Full chat recovery.

## 0.9.0-alpha.19 - Manual lifecycle branch reconciliation

### Fixed

- Manual **Mark resolved** and **Mark superseded** actions now reconcile the live chat lineage before resolving their opaque UI row target, so narration-equivalent SillyTavern/Regex presentation rewrites no longer cause a silent manual branch-mismatch failure.
- Genuine fail-closed branch uncertainty blocks the manual lifecycle change with a visible recovery message instead of attempting to mutate ambiguous history.
- Unexpected manual lifecycle or persistence errors are caught at the queued host boundary and surfaced to the operator instead of escaping as an unhandled UI promise.

### Preserved

- Manual lifecycle changes still require an operator note, exact current-branch ownership, the ordinary reducer, rollback journaling, and durable sidecar persistence.
- Record IDs remain hidden from the panel, automatic capture cadence is unchanged, and no provider call is added.

## 0.9.0-alpha.18 - Durable semantic lineage hardening

### Fixed

- Branch lineage now persists assistant narration fingerprints and role metadata alongside raw fingerprints so presentation-only rewrites can be proven equivalent after reload instead of relying on one ephemeral latest-capture token.
- Reconciliation can safely rebase **multiple** older assistant messages in one pass when their sanitized narration is unchanged, covering host/Regex/reasoning cleanup that rewrites several historical messages together.
- A legacy Alpha.17 sidecar with no semantic lineage metadata is backfilled and durably persisted on the first clean reconciliation.
- If a legacy assistant lineage has already diverged before semantic proof can be backfilled, Alpha now fails closed with canonical records preserved instead of replaying the rollback journal and potentially wiping all records.
- `MESSAGE_EDITED`/swipe/delete reconciliation no longer discards the latest passive-rewrite proof before branch reconciliation has a chance to validate it.

### Diagnostics

- Multi-message semantic rebases emit `WORLD_STATE_SEMANTIC_LINEAGE_REBASE` with the rebased message count.
- Legacy unprovable rewrites surface `legacy-lineage-semantic-proof-unavailable` recovery rather than destructive rollback.

### Preserved

- Real semantic assistant edits, user edits, swipes, and deletions still use exact rollback semantics when a changed branch is actually proven.
- Canonical schema remains version 2; sidecar, bundle, and rollback-journal envelope versions remain 1. The added lineage fields are backward-compatible metadata within the existing state envelope.

## 0.9.0-alpha.17 - Manual history controls

### Added

- Expanded active Reality records now expose **Mark resolved** and **Mark superseded** controls for operator intervention when automatic lifecycle detection or rebuild recovery is insufficient.
- Manual lifecycle changes require a concise operator reason, prefill an editable history summary from the current record, store the reason as `manual` evidence, journal the mutation at the exact current chat head, persist through the ordinary sidecar path, and immediately refresh private continuity injection.
- The UI continues to hide canonical record IDs: record actions use the existing opaque row key plus visible snapshot metadata, and the host rejects stale row actions before resolving the canonical record internally.

### Preserved

- Manual history controls do not delete records, bypass the reducer, alter automatic capture cadence, add provider calls, or change durable schemas.
- Historical records do not expose lifecycle buttons; a manual move is one-way through the ordinary lifecycle reducer and remains inspectable/rollback-owned as history.

## 0.9.0-alpha.16 - Lifecycle reconciliation recovery

### Fixed

- Capture now explicitly reconciles lifecycle for shown active developments: grounded endings resolve, explicit replacements supersede, continuing changed conditions update, and mere silence/off-screen absence/escape/uncertainty does not close a thread.
- Rebuild now treats later historical boundaries as possible closures of earlier reconstructed active threads, so a full rebuild can retire episodes that ended in old chat instead of leaving them permanently active.
- Each rebuild boundary reserves up to two active development lifecycle candidates before ordinary relevance filling. Candidates qualify by current-exchange overlap or by having changed within the previous 12 raw messages, covering short implicit follow-ups such as “the last two collapse.”
- Lifecycle and resolved-tombstone reservation share one bounded state pass; rebuild does not add another provider call or replay background evolution.
- Added direct source-firewalled resolve coverage and an end-to-end rebuild regression proving an indirectly phrased later ending moves the reconstructed thread to Resolved.

### Preserved

- Resolution still requires grounded CURRENT EXCHANGE evidence and the existing source firewall; rebuild never closes a thread merely because it disappears from narration.
- Automatic capture remains one provider request per eligible assistant boundary. Rebuild remains explicit, chronological, atomic, and capture-only.
- Canonical schema remains version 2; sidecar, bundle, and rollback-journal envelope versions remain 1.

## 0.9.0-alpha.15 - World-state integrity hardening

### Fixed

- Capture evidence must now support the proposed/current assertion instead of merely existing somewhere in the cited source message. Unsupported proposed anchors are discarded before canonical mutation.
- Reported, rumored, quoted, and indirectly attributed information keeps its epistemic status unless summary-relevant objective evidence independently corroborates the same assertion. Unrelated objective evidence can no longer wash a rumor into fact.
- A provider envelope containing any structurally malformed Reality row, or any structurally malformed Spatial row when Spatial capture is enabled, now fails closed as one response. Live capture still consumes the dispatched boundary once, but no valid sibling row is partially committed.
- Strict durable/import normalization rejects present invalid Reality lifecycle/provenance enums and Spatial lifecycle/authority/distance/provenance/profile-axis values instead of silently coercing them into valid-looking state. Legacy omitted fields retain their historical defaults.
- Passive post-capture rebase now requires the rewritten assistant boundary to have the same sanitized narration fingerprint as the captured boundary. Reasoning/`writer_state` stripping remains tolerated, while silent semantic rewrites fall back to exact rollback.
- Hidden-message rebuild checks hard system/tool/UI markers before user/assistant role flags, preventing tool rows with misleading role metadata from entering recovery evidence.
- Rebuild commit rechecks currentness around durable persistence. If the operation becomes stale while the sidecar write is in flight, the previous canonical state is compensatingly persisted before the candidate can be published; failed compensation blocks the chat fail-closed.
- Host lifecycle event registration is retryable and idempotent when SillyTavern exposes `eventSource` after initial DOM-ready initialization.

### Preserved

- No additional provider call, schema bump, sidecar/bundle/journal envelope bump, Story Director behavior, live chat visibility mutation, or NPC State dependency is introduced.
- Canonical schema remains version 2; sidecar, bundle, and rollback-journal envelope versions remain 1.

## 0.9.0-alpha.14 - Virtual hidden-message rebuild

### Added

- Rebuild from Chat now includes an **Include hidden chat messages** option, enabled by default.
- Hidden roleplay messages are reconstructed through an immutable virtual rebuild view. SillyTavern `chat[]`, `is_system`, DOM visibility, saves, and canonical lineage are never toggled during rebuild.
- Hidden user turns are admitted as user evidence when enabled. Hidden assistant turns are admitted only when conservative roleplay markers remain (assistant role/type, character avatar metadata, swipes, generation timing, or model/API generation metadata).
- Known system/tool/UI messages remain excluded, including small-system/tool rows and named system message types.
- Rebuild Operations/status telemetry reports how many hidden messages and hidden assistant boundaries were actually included.

### Fixed

- Disabling hidden-message scanning now excludes hidden user messages as well as hidden assistant messages; the previous role resolver could let hidden user rows pass because it checked `is_user` before `is_system`.

### Preserved

- No live chat unhide/rehide mutation, save, UI flicker, branch event, lineage rewrite, schema change, or additional provider call is introduced.
- Canonical schema remains version 2; sidecar, bundle, and rollback-journal envelope versions remain 1.

## 0.9.0-alpha.13 - Passive lineage rewrite hardening

### Fixed

- Prevented a post-`MESSAGE_RECEIVED` host/regex/reasoning rewrite of the latest captured assistant message from being mistaken for a real branch change and replaying that boundary's undo patch.
- Added a narrowly scoped ephemeral rebase candidate for only the latest successfully captured assistant boundary. Rebase is allowed only when it is still `lastCaptureMessage`, later already-owned message fingerprints are unchanged, and no edit/delete/swipe event marked the chat dirty.
- Genuine branch events still clear the candidate before exact reconciliation, so abandoned-branch state continues to roll back normally.
- Import, reset, and successful rebuild clear any stale passive-rebase candidate.
- Branch reconciliation now emits bounded Operations diagnostics for passive rebases, exact rollbacks, and fail-closed recovery, including before/after record counts without retaining story text.

### Preserved

- Canonical schema remains version 2; sidecar, bundle, and rollback-journal envelope versions remain 1.
- No provider call, prompt, evidence-firewall, Spatial authority, or Story Director behavior was added.

## 0.9.0-alpha.12 - Flat disclosure workspace

### Changed

- Replaced the old `World State Alpha` eyebrow with a compact continuity-node icon, `World continuity` title, and concise current/history/place counts.
- Reality records now use inline disclosure rows. Expanding a row reveals bounded anchors, timeline, evidence, connections, and change reason directly under that record instead of opening a large nested detail card.
- Operations remains disclosure-based and continues to expose bounded model response/rejection JSON with copy controls.
- Rebuild progress/completion moved out of normal layout flow into a dismissible floating toast, so tabs/navigation no longer shift downward while rebuild status is visible.
- Data & Maintenance, statistics, health, and operation rows use flatter separators and reduced card depth.
- Scoped WebKit scrollbar arrow buttons are suppressed while scrolling remains available.
- Capture now admits materially persistent rumor/news circulation as information state when the summary explicitly preserves reported/rumored/believed status instead of asserting the underlying claim as verified reality.
- The source firewall now detects mutations supported only by quoted dialogue and rejects summaries that drop that epistemic framing, preventing tavern talk or other hearsay from silently becoming objective world truth.
- Live automatic capture now uses the exact completed assistant boundary (messages after the previous assistant through the current assistant), matching chronological rebuild semantics instead of feeding the previous turn into a rolling capture window.
- A passively rewritten latest captured assistant message no longer masquerades as a branch change and roll back its freshly captured state. Alpha may rebase that one runtime-owned boundary when no edit/delete/swipe event was observed; genuine branch events still clear the guard and use exact rollback.

### Responsive behavior

- Tablet/mobile keep the Alpha.11 navigation model while Reality disclosures expand in place at every width.
- On mobile, the floating rebuild toast sits above the bottom navigation and can be dismissed without cancelling the rebuild.
- Places retains its dedicated adaptive list/detail editing surface.

### Preserved

- Operations privacy boundary, rebuild atomicity/range semantics, provider cancellation, canonical schema version 2, and sidecar/bundle/journal envelope version 1 are unchanged.
- No new provider calls, persisted fields, Story Director behavior, or cross-extension dependencies were added.

## 0.9.0-alpha.11 - Responsive Operations and rebuild workspace

### Added

- Reworked the World State panel into an adaptive desktop/tablet/mobile workspace: desktop master/detail, tablet adaptive split/single-pane detail, and mobile Current / Places / Ops / More bottom navigation.
- Added a full rebuild sheet with Full chat, Last N messages, From message, and configurable maximum assistant-boundary controls.
- Added visible rebuild progress with processed/total boundaries, provider calls, current-record count, place count, final success/failure state, and a real Cancel action.
- Added expandable Operations rows for capture, rebuild and lazy/background evolution. Operations can inspect bounded escaped model response content and rejection JSON and copy that content.
- Expanded ephemeral diagnostics retention from 40 to 80 rows for operator debugging.
- Separated Data & Maintenance into State files, Recovery, and a visually isolated Danger zone for Clear World State.

### Safety and behavior

- Rebuild no longer implies Clear. Full rebuild constructs an isolated candidate and atomically replaces canonical state only after complete success and durable persistence.
- Partial rebuild preserves the exact historical prefix and existing rollback/checkpoint journal. It is admitted only when stored lineage proves the prefix and exact reconciliation succeeds.
- After Reset, a partial/nonzero start fails before provider work with `WORLD_STATE_REBUILD_RANGE_BASE_UNAVAILABLE`; Full chat remains the safe recovery path.
- Explicit manual rebuild boundary caps may be raised up to the existing hard 4096-boundary ceiling.
- Rebuild cancellation bypasses the serialized writer queue only as control-plane abort; all canonical mutations and persistence remain serialized.
- Operations never retain/display prompts, story transcripts, provider transport headers, hidden/reasoning content, session identifiers, credentials or API secrets. Bounded extracted model response/rejection content is ephemeral telemetry only and never canonical authority.
- No new automatic provider request path, persisted schema field, Story Director behavior, or cross-extension dependency was added.

### Responsive behavior

- Desktop workspace expands to approximately 1180 px.
- Tablet landscape (768-1099 px) uses an adaptive 40/60 split.
- Tablet portrait (<768 px) uses list/detail single-pane navigation.
- Mobile (<600 px) uses full-screen bottom navigation, safe-area handling, >=44 px touch controls, full-height rebuild sheet, and internally scrollable JSON inspectors.

## 0.9.0-alpha.10 - Structured completeness checklist

### Fixed

- Capture/rebuild now extracts a bounded advisory completeness checklist from narrator-authored `<World_State>` `Off-Screen` and `Unresolved Threads` entries before prompt clipping.
- The same single provider request must re-check each checklist item and represent materially persistent conditions that are established by the exchange and not already present in visible current state.
- Long scenes no longer rely solely on salience inside the clipped narrative window for off-screen persistence completeness; Brackenford-style market extortion remains visible to the extractor alongside boar combat, handcart state, and Spatial continuity.
- Diagnostics now expose a bounded `State checklist` count for each capture/rebuild boundary so operators can verify that structured completeness hints were supplied.
- Added exact HTML/source-firewall regression coverage for the Brackenford extortion payload to prove the development is admitted and retained once proposed.

### Preserved

- The checklist is advisory only and never writes canonical state itself.
- `Planted Seeds`, consequence timers, arc/scene phase, CYOA, NPC inner chatter, writer planning, and character inventory/skill state remain excluded from the checklist/capture authority.
- No second provider call, correction retry, full-world scan, or new Story Director behavior was added.
- Every admitted mutation still passes the existing source firewall, duplicate gate, reducer, branch ownership, and rebuild atomicity rules.
- Canonical schema remains version 2; sidecar, bundle, and rollback-journal envelope versions remain 1.

## 0.9.0-alpha.9 - Fenced provider response interoperability

### Fixed

- Capture/rebuild response parsing now accepts exactly one JSON object either bare or wrapped in a single Markdown code fence (`json` language tag optional).
- Surrounding prose before or after the fenced object, multiple objects, malformed JSON, and structural wire violations remain invalid and fail closed.
- Added a five-boundary rebuild regression matching the live failure pattern where four successful Gemini responses were followed by a fenced fifth response; the rebuilt Current/Places state now commits instead of being discarded atomically at the final boundary.

### Preserved

- No second parse retry, provider retry, or permissive prose extraction path was added.
- Rebuild remains atomic and source-firewalled.
- Canonical schema remains version 2; sidecar, bundle, and rollback-journal envelope versions remain 1.

## 0.9.0-alpha.8 - Live rebuild interoperability

### Fixed

- Selected Connection Profile responses now accept raw OpenAI-compatible `choices[0].message.content` envelopes, including the Gemini 3.7 Flash High shape observed live, while never treating `reasoning_content` as World State output.
- Spatial-enabled capture/rebuild prompts now include the full exact Reality mutation schema instead of an ellipsis placeholder that allowed providers to drift to noncanonical field names.
- The wire layer conservatively repairs only unambiguous provider aliases observed live from Gemini 3.7 Flash High: `category` -> `kind` and `description` -> `summary`. Conflicting canonical/alias values remain structurally invalid and rebuild remains atomic/fail-closed.
- Rebuild now uses the host's real per-chat diagnostic store for every chronological boundary instead of temporary stores that disappeared after each call.
- Diagnostics expose bounded rebuild operation label/detail, failed boundary, provider calls, alias-repair count, and processed/total boundaries without retaining prompts, story transcript, credentials, or raw provider payloads.
- Rebuild maintenance now emits an immediate started notification and detailed final failure/success notification, including boundary progress and resulting Current/Places counts.
- A grounded proper named place is retained when only its optional model-proposed relative precision is unsupported; the unsupported relation is dropped instead of erasing the place.
- Multi-token generated place names may be grounded compositionally when every name token occurs together in one accepted evidence claim, fixing cases such as `Applecross ditchline, the culvert` -> `Applecross Culvert` without enabling arbitrary fuzzy matching.
- Connection-profile routing now accepts either the already-extracted `content` string or the raw OpenAI-compatible `choices[0].message.content` response shape observed from Gemini proxy adapters; `reasoning_content` is never used as capture output.

### Preserved

- Structurally ambiguous/conflicting provider output still fails closed.
- Rebuild remains atomic: canonical state changes only after every chronological boundary succeeds and the rebuilt state persists durably.
- Spatial precision still requires grounded evidence; unsupported relation/distance claims are not canonicalized.
- Canonical schema remains version 2; sidecar, bundle, and rollback-journal envelope versions remain 1.

## 0.9.0-alpha.7 - Recovery and authority hardening

### Fixed

- Rebuild now accepts only explicit successful boundary outcomes. Timeout, cancellation, stale scope, malformed output, provider failure, and unexpected outcomes abort the isolated candidate and leave the prior canonical state unchanged.
- Rebuild treats structurally malformed Reality or Spatial mutation rows as reconstruction failure while preserving legitimate semantic no-change rejections such as duplicate/resurrection protection.
- Fail-closed branch recovery now suppresses both Reality and Spatial private continuity; retained abandoned-branch state remains inspectable for recovery but cannot influence narration.
- Elapsed-time detection now uses the sanitized narrative evidence surface, ignores system/planning blocks, rejects prospective/hypothetical/quoted scheduling and bare `next ...` phrases, and carries bounded surrounding chronology context into evolution evidence.
- Rebuild now uses the same automatic Spatial base-map, lock, authority, and manual-metadata protections as ordinary capture.
- Reality-only rebuild preserves the disabled Spatial namespace rather than clearing attached profile/base-map/campaign locations.
- Capture-wire normalization now preserves omitted Reality update fields. Summary-only and trend-only updates no longer clear anchors/trend unless the provider explicitly replaces or clears them.
- Ordinary capture admission now has a bounded resolved/superseded tombstone index separate from active-state injection, allowing the existing new-episode/resurrection gate to work without a full-world scan.
- Direct Spatial relations now ground endpoint names, direction, numeric distance, and distance meaning from accepted narration rather than accepting unsupported precision.
- Successful Spatial capture/rebuild now supplements model output with bounded deterministic extraction from explicit `World_State` current-location headers. Applecross-style place/coordinate headers recover through the ordinary Spatial reducer even if the model omits coordinates or the entire Spatial mutation.
- Explicit coordinate parsing now covers signed bracket/parenthesis pairs plus signed/Markdown/pipe/quoted-axis X/Y forms; ambiguous or conflicting header coordinates fail closed.
- Provider-backed continuity/evolution no longer keeps the awaited `MESSAGE_SENT` preparation path open. The current generation uses the last durably committed state; queued results become available only after serialized commit for later injections.

### Preserved

- No new provider request path, no per-record fan-out, and no full-world normal-turn scan were added.
- Rebuild remains explicit, chronological, source-firewalled, atomic, and non-simulative.
- Deterministic current-location recovery is a proposal supplement only. It still passes Spatial evidence admission, base-map authority, currentness, journaling, rollback, and persistence.
- Canonical schema remains version 2; sidecar, bundle, and rollback-journal envelope versions remain 1.
- Live SillyTavern/browser/provider timing and extraction quality remain explicit acceptance boundaries.

## 0.9.0-alpha.6 - Background Development Catch-up

### Added

- Meaningful elapsed-time boundaries may now reevaluate a bounded sample of already-established remote active developments even when they are not relevant to the current scene.
- Relevant developments retain priority: up to four relevant targets are admitted first, background catch-up may fill up to three remaining slots, and the combined automatic evolution batch is capped at six in one provider request.
- Background discovery uses the ephemeral active-development index, advances a bounded cursor through at most 32 pool entries per eligible elapsed boundary, and remembers that boundary so the same time-skip hint cannot repeatedly retrigger catch-up.
- Background developments use the same conservative causal evaluator, source firewall, stable outcome, duplicate/resurrection protection, branch ownership, persistence, and rollback path as ordinary Phase 4 evolution.
- Rebuild from chat explicitly asks the completeness-hardened capture path to recover materially persistent narrated off-screen developments from historical exchange windows, including developments the PC ignored or left.

### Preserved

- Meaningful elapsed time permits evaluation but never proves that a remote development changed; unsupported movement remains `stable`.
- Ordinary turns without a valid evolution trigger still issue zero evolution requests.
- Background catch-up does not create a second provider request, perform per-record fan-out, scan the full world, or inherit Story Director / Writer's Mind incentives.
- Rebuild remains explicit, chronological, atomic, and capture-only. It reconstructs narrated developments but does not replay hidden background evolution between narrated boundaries.
- Canonical schema remains version 2; sidecar, bundle, and rollback-journal envelope versions remain 1.

## 0.9.0-alpha.5 - Persistent capture completeness

### Fixed

- Capture now treats PC proximity, current objective, and player intervention as irrelevant to admission when the current exchange explicitly establishes a materially persistent world condition.
- Added a bounded completeness sweep inside the existing single capture request so multiple independent persistent conditions may be captured together instead of stopping after the most scene-salient one.
- Explicitly preserves ongoing conditions that continue independently after the PC leaves or ignores them, including off-screen developments already grounded by narration.
- Tightened exclusions for transient scenery, momentary positions, ordinary one-off transactions, inventory/skill state, notices/offers/rumors, plans, planted seeds, CYOA options, inner chatter, and mere possibilities unless narration separately establishes the underlying condition as current reality.
- Deterministically removes `writer_state`, `NPC_Inner_Chatter`, `CYOA`, `Skill_Mastery`, and inventory blocks from the assistant capture/evidence view while retaining narrated/current `World_State` summaries.
- Added regression coverage for a Brackenford-style market extortion development being captured alongside a PC-adjacent trench-boar fact in one provider call.

### Preserved

- Automatic capture remains one provider request per eligible assistant boundary.
- The source firewall still requires grounded current-exchange evidence for every mutation; no remote event may be invented merely to make the world feel active.
- Canonical schema remains version 2; sidecar, bundle, and rollback-journal envelope versions remain 1.
- Reality Core remains `fact` / `development` only and Spatial Continuity remains a sibling subsystem.

## 0.9.0-alpha.4 - Host identity and spatial hardening

### Fixed

- Recovered deterministic World State sidecars when extension-settings pointers are missing or stale, repaired recovered revision/checksum metadata, and synchronously persisted critical ownership transitions.
- Added ownership epochs so stale hydration/write completions cannot repopulate continuity after rename/delete lifecycle changes.
- Hardened chat/group/character deletion with authoritative owner probing, fail-closed ambiguity handling, durable lifecycle tombstones, and best-effort neutralization of retired sidecars so deleted continuity cannot reappear after a settings crash window.
- Migrated `CHARACTER_RENAMED_IN_PAST_CHAT` lineage metadata so SillyTavern's historical character-name rewrites do not look like destructive branch changes or roll valid World State backward.
- Bound an open World State panel and its maintenance/spatial actions to the chat that opened it, closing the panel on navigation instead of retargeting stale UI callbacks.
- Moved automatic `MESSAGE_RECEIVED` capture off SillyTavern's awaited render/save event path while retaining per-chat serialization and stale-result guards.
- Bounded dormant chat-state and base-map caches instead of allowing long sessions to grow them without limit.
- Rejected Spatial updates carrying an unknown explicit `locationId` instead of accidentally turning stale cross-chat UI identities into new locations.
- Preserved distinct named Ternia anchors that legitimately share the same coarse coordinate instead of merging them solely by coordinate equality.
- Kept generic base maps profileless when no coordinate profile is explicitly supplied, preventing hidden Cartesian assumptions from entering profile-neutral campaigns.

### Preserved

- Canonical schema remains version 2; sidecar, bundle, and rollback-journal envelope versions remain 1.
- Reality Core remains `fact` / `development` only; Spatial Continuity remains a sibling subsystem.
- Base-map sources remain read-only, provider routing remains request-scoped, and Megumin/Ukiyo behavior is unchanged.

## 0.9.0-alpha.3 - Standard settings drawer

### Changed

- Replaced the custom `<details>/<summary>` settings collapse with SillyTavern's native `extension_container > inline-drawer > inline-drawer-toggle/inline-drawer-content` pattern, matching NPC State Delta and other standard extension drawers.
- Uses SillyTavern's standard circular chevron, full header click target, and host drawer behavior while preserving the grouped low-glare World State controls inside the expanded panel.

### Preserved

- No World State capture, persistence, provider-routing, Reality Core, or Spatial Continuity semantics changed.
- Canonical schema remains version 2; sidecar, bundle, and rollback-journal envelope versions remain 1.

## 0.9.0-alpha.2 - Continuity hardening

### Fixed

- Made the World State extension settings card natively collapsible while preserving the calmer grouped dark-theme layout.
- Added the production SillyTavern JSON file adapter methods required by Spatial base-map import and reload.
- Fixed Spatial manual editing for rename, coordinate clearing, context/notes clearing, route-association replacement, and campaign overrides addressed by their stored override ID.
- Prevented unresolved coordinates from being locked and required non-root manual Spatial edits to own the current raw-message boundary.
- Restored reducer atomicity so a rejected Reality lifecycle-smuggling update cannot leak a new time anchor.
- Isolated Reality evolution from Spatial-only injection and invalidated in-flight/queued work when routing or enablement settings change.
- Serialized maintenance and Spatial manual mutations through the per-chat work queue and added post-await chat guards.
- Added continuity migration for SillyTavern character/chat rename events and cleaned deleted character/chat/group-chat sidecar pointers from active ownership.
- Removed sticky negative base-map caching, made Spatial rebuild fail closed when declared base authority is unavailable, and wired indexed Spatial context terms into retrieval.

### Preserved

- Reality Core and Spatial Continuity remain separate semantic reducers.
- Base-map sources remain read-only and campaign overrides remain per-chat.
- Existing source firewall, branch rollback, provider routing, and Story-Director boundaries remain intact.

## 0.9.0-alpha.1 - Spatial Continuity

### Added

- Optional Spatial Continuity sibling subsystem with separate locations, spatial relations, routes, evidence, coordinate profile, and base-map reference.
- Canonical schema version 2 with safe schema-1 migration; sidecar, bundle, and rollback-journal envelope formats remain version 1.
- Generic Cartesian 2D base-map adapter plus a Ternia v0.9.10 registry adapter.
- Read-only base geography with per-chat campaign-generated locations and campaign overrides.
- Deterministic coordinate authority, profile-driven True North/cardinal math, cardinal/diagonal derivation, optional bounds/precision handling, and route-vs-straight-distance separation.
- Profile-neutral operation: campaigns without a configured profile retain named/explicit/relative geography without inheriting Ternia's 5 km scale or bounds.
- Shared capture request support for bounded `spatialMutations` without adding a second automatic provider call.
- Deterministic `<writer_state>...</writer_state>` evidence-view sanitation for Reality capture, Spatial capture, and rebuild while preserving raw chat/lineage ownership.
- Ephemeral bounded Spatial relevance indexing and compact private Spatial continuity injection.
- Spatial panel with add/edit authority/lock, relative anchor/direction/distance, route association, override, archive/delete, duplicate merge, and evidence inspection.
- Spatial branch rollback, stale-result rejection, export/import, rebuild, and campaign-isolation coverage.
- Spatial live-acceptance scenarios for real Ternia registry import and Megumin continuity.

### Fixed

- World State connection routing now exposes SillyTavern Connection Profiles as a supported-profile dropdown instead of requiring a raw profile ID, while preserving the default RP route and visibly retaining deleted selections as unavailable.
- The SillyTavern settings card now uses grouped controls, dark theme-aware numeric/select fields, consistent control sizing, and calmer spacing instead of glare-prone browser-default number inputs.

### Preserved

- Reality Core retains only `fact` and `development` record kinds.
- Spatial entities never enter Reality Core `records[]`.
- Existing source firewall, branch ownership, rollback, relevance/evolution, provider routing, and Story-Director boundary remain authoritative.
- Megumin Suite/Ukiyo is not modified.
- Base-map source files are never mutated by campaign play.

### Reference acceptance

The Ternia adapter is designed against:

- `Ternia_Map_Registry_v0.9.10_Runtime_Retrieval_Acceptance_Hardening.json`
- `Ternia_Map_Lore_v0.9.10_Runtime_Retrieval_Acceptance_Hardening_ST.json`

The supplied map authority defines Cartesian True North (+Y), East (+X), 5 km per unit, -500..500 bounds, decimal coordinates, and curved route geometry that does not redefine geographic direction.

## 0.8.0-alpha.1 - Release hardening

- Ephemeral Reality relevance indexing and bounded candidate scoring.
- Orphan evidence compaction with rollback preservation.
- Deterministic reproducible extension packaging and release manifests.
- Live acceptance protocol.
- Base-map hydration now preloads attached authority on chat load and fails Spatial capture/injection closed if that source is unavailable.
- Foreign imports retain base-map identity/digest but clear machine-local source paths for safe rebinding.
- Manual location metadata, relations, and route semantics are protected from later automatic rewrites.
- Automatic capture binds same-name visible base locations instead of minting campaign duplicates.
