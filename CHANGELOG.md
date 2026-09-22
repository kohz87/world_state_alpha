# Changelog

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
