# World State Alpha test plan

## Deterministic fixture worlds

The same core schema/runtime must run all fixtures.

### A. Fantasy geopolitical

- border inspection dispute
- mercenary hiring increase
- bridge destruction
- trade diversion
- resolved dock strike with static lore still mentioning labor tension

### B. Sci-fi single location

- reactor output degradation
- oxygen refinery maintenance
- crew labor dispute
- sealed habitation deck

### C. Small social setting

- university building closure
- student fee protest
- budget shortfall
- administration negotiation

No fixture may require schema code specific to its setting.

## Required edge cases

1. Fact changes, persists, and injects later.
2. Unrelated development is not injected.
3. Record leaves context for many messages and returns.
4. Meaningful elapsed time enables justified catch-up.
5. Time passes but no causal support exists; state remains stable.
6. Development resolves.
7. Lore still describes underlying pressure; resolved episode does not resurrect.
8. Later new evidence creates a genuinely new related episode.
9. Semantic duplicate candidates consolidate.
10. Swipe/branch removes source event and rolls state back.
11. Deep-tail delete restores exact prior state when proof exists.
12. World-significant NPC event records without dossier duplication.
13. Lore possibility without narrative establishment creates no current fact.
14. Remote private fact injection does not instruct automatic PC knowledge.
15. Hundreds of records yield tiny relevant injection.
16. NPC State Delta coexists without namespace/storage/UI/prompt conflict.
17. Ukiyo remains unchanged.
18. Non-fantasy fixtures pass unchanged schema.
19. No record requires geographic/faction `scope`.
20. Rebuild and incremental state are equivalent for controlled fixture.
21. Manual targeted correction is current-head/branch-owned and rolls back with the branch journal.
22. Reset/import require preview plus explicit confirmation.
23. Rebuild failure/staleness discards the whole candidate and leaves canonical state untouched.
24. Relevant resolved tombstone blocks passive rebuild resurrection.
25. Explicit new episode may be reconstructed only when grounded and linked to the resolved predecessor.
26. Rebuild never invokes lazy evolution or hidden world simulation.
27. Current / Recent / Resolved / Search projections return the correct lifecycle sets and deterministic ordering.
28. Detail view exposes bounded human-readable evidence and relations without mutable canonical references.
29. Canonical/evidence/diagnostic HTML metacharacters are escaped and cannot become executable markup.
30. Ordinary Current/Recent/Resolved/Places/Search/Data views contain no raw record IDs, evidence IDs, lineage keys, rollback internals, prompts, transcripts, credentials, transport headers, reasoning content, or provider payloads; explicit Operations may show only bounded escaped model response/rejection content.
31. A 1000-record backend still yields bounded Current / Recent / Resolved / Search UI lists.
32. Desktop, 768-1099px tablet, <768px single-pane tablet/mobile, and <600px bottom-navigation rules keep the UI readable with >=44px touch controls and no page-wide horizontal scrolling.
33. Owner-qualified host identity keeps equal chat filenames under different characters/groups separate.
34. Host sidecar upload uses the World State filename namespace, revision checks the existing pointer, and persists the actual server-returned path.
35. Hydration failure with an existing pointer fails closed and never overwrites durable state with a fresh empty state.
36. Assistant lifecycle performs at most one eligible capture request and journals/persists only if its chat/lineage/epoch guard remains current.
37. User lifecycle performs local relevance/injection and only one batched lazy-evolution request when an existing Phase 4 trigger is justified; meaningful elapsed time may add bounded background targets from the indexed active-development pool without a full-world scan or repeated background sweep from the same elapsed boundary.
38. Edit/delete/swipe lifecycle cancels World State requests and restores exact branch state or fails closed.
39. Alpha and pinned Delta identifiers do not collide across settings, prompt key, DOM, global, sidecar filename, manifest dependency, or loading order.
40. Phase 7 host source neither reads nor mutates NPC State Delta, Ukiyo, Megumin Suite, or Writer's Mind state.
41. Import/reset/rebuild host actions preserve Phase 5 preview/confirm/atomic contracts and rebuild remains explicit-only.
42. No watchdog/MutationObserver, cross-extension launcher coordination, or generic slash-command framework is introduced by Phase 7. The only floating control is the World-State-owned `launcher.js` button, which opens the existing panel, persists its position per browser, and references no other extension.
43. 1000-record indexed retrieval isolates the relevant record while evaluating <=16 candidate records.
44. Candidate cap saturation bounds candidates to 128 while deterministically prioritizing exact anchors over common-token matches.
45. Incremental index update produces identical retrieval output to an index rebuilt from scratch.
46. 50+ sequential updates compact unreferenced evidence to <=32 entries while undo patch accurately rolls back prior state.
47. Release package archive and manifest generation are 100% byte-reproducible with identical SHA-256 hashes across runs.
48. One exchange establishing both a PC-adjacent fact and a separate ongoing off-screen condition may capture both in the same provider call; PC proximity/current objective do not suppress the persistent development.
49. A persistent condition explicitly shown continuing after the PC ignores or leaves it remains eligible for capture. Isolated notices/claims/plans/options remain non-canonical; materially persistent rumor/news circulation may be captured only as explicitly reported/rumored/believed information state, never as verification of the underlying claim.
50. Quoted dialogue used as the sole mutation evidence cannot promote its contents into objective world truth; an epistemically framed reported-information summary is admitted, while an otherwise identical factual summary is rejected by the source firewall.
51. Live automatic capture and chronological rebuild use identical assistant-boundary exchange semantics: messages after the previous assistant response through the current assistant response. Live capture must not include the previous assistant turn merely because a rolling context window has room for it.
52. Capture a fact on an assistant boundary, then passively rewrite that same assistant message without emitting an edit/delete/swipe event and append the next exchange. The next reconciliation rebases lineage metadata and preserves the captured fact instead of replaying its undo. The same rewrite without the runtime candidate still follows ordinary rollback, and a real branch event clears the candidate before reconciliation.
53. With hidden-message scanning enabled, a hidden user turn and a hidden assistant turn with ordinary assistant-generation markers are virtually included in chronological rebuild windows, while genuine system/tool/UI rows remain excluded.
54. The virtual hidden-message rebuild view never mutates the original chat object or any stored `is_system` flag, and accepted hidden assistant narration can still pass the ordinary capture/source-firewall path as rebuild evidence.
55. With hidden-message scanning disabled, hidden user and hidden assistant rows are both excluded from rebuild evidence/boundaries.
56. Direct capture may resolve a visible active development only from grounded current-exchange evidence explicitly establishing its ending; the source firewall remains authoritative.
57. Full chronological rebuild creates an active development at an earlier boundary, then later narration such as `the last two collapse` can resolve it even when that later exchange no longer repeats the original anchor phrase, because a bounded recent lifecycle candidate remains visible.
58. Rebuild lifecycle reservation remains bounded to two active developments and never treats silence, off-screen status, temporary absence, escape, interruption, or uncertainty as deterministic resolution.
59. An expanded active Reality record exposes Mark resolved and Mark superseded controls; historical records expose neither control.
60. A manual history action requires an operator note, passes through the ordinary current-head manual reducer and journal, persists durably, and removes the record from Current without deleting its history.
61. A stale opaque UI row snapshot cannot target a different canonical record: the host revalidates row key, kind, status, visible summary, created boundary, and last-changed boundary before resolving the internal record ID; the operator may edit the history summary before final confirmation.
62. A clean Alpha.17 lineage is backfilled with role and sanitized narration fingerprints during exact reconciliation and reports `lineageMetadataUpgraded=true` without changing canonical records.
63. Two older assistant messages whose raw text changed only by removal of non-canonical planning blocks rebase together with `semantic-lineage-rebase`; all canonical records, evidence and rollback ownership remain intact.
64. A semantic assistant rewrite (for example `bridge closed` -> `bridge open`) still follows exact rollback and does not use semantic rebase.
65. A legacy non-user lineage that has already diverged before narration fingerprints can be backfilled fails closed with `legacy-lineage-semantic-proof-unavailable` and preserves the pre-reconciliation record count.
66. Live acceptance verification is governed by [LIVE_ACCEPTANCE.md](file:///C:/AI-Agent/worktrees/504dbad2-phase8-release-hardening/docs/LIVE_ACCEPTANCE.md).

## Additional safety tests

- model output references unknown record ID -> reject
- update omits existing anchors -> omission is non-destructive unless explicit replacement semantics allow
- malformed JSON -> no mutation
- timed-out request -> no mutation
- stale request completes after branch change -> discard
- duplicate assistant receipt -> no duplicate capture
- exchange contains an ignored/off-screen extortion racket plus a nearby combat/hazard fact -> both grounded persistent conditions can coexist in one capture response
- notice-board offer or planted seed appears beside a real ongoing development -> only independently established current reality is canonical
- tavern/news rumor is materially established as circulating -> capture the information state with reported/rumored/believed wording; quoted claim alone must not become objective truth
- two canonical writes at same message -> coalesced rollback undo
- exact parent missing on deep destructive edit -> fail closed
- selected provider profile deleted -> clear recoverable failure, no fallback
- lore contradicts current accepted state -> current state wins for campaign
- resolved record plus identical passive lore -> remains resolved
- explicit new episode with same anchors -> new record or deliberate supersession, not resurrection
- derived candidate with weak causality -> reject
- derived candidate limit exceeded -> bounded reject
- record summary grows history-like -> consolidation truncates/replaces
- import from another chat -> source message IDs rebased/cleared, not trusted as local
- manual mutation against non-head or divergent lineage -> reject
- rebuild boundary limit exceeded -> reject before provider work
- rebuild provider fails, times out, cancels, or returns an unexpected outcome on the first or a later chunk -> original canonical state unchanged
- rebuild currentness changes mid-run -> discard whole candidate
- rebuild valid JSON contains a structurally invalid Reality/Spatial mutation row -> discard whole candidate with bounded rejection detail
- rebuild passive duplicate of resolved episode -> reject
- rebuild explicit new related episode -> create new record, retain tombstone
- rebuild historical exchange contains an ignored persistent off-screen condition -> recover it as current development with `rebuild` evidence, without replaying hidden evolution
- long assistant exchange contains narrator-authored World_State Off-Screen/Unresolved entries -> bounded completeness checklist retains those current-state candidates while excluding Planted Seeds/timers/arc-scene/CYOA/inner chatter/planning
- exact Brackenford HTML extortion evidence remains grounded through the source firewall and is not deleted by the reducer once proposed
- meaningful elapsed hint remains visible across subsequent bounded exchanges -> at most one background sweep for that elapsed evidence boundary
- meaningful elapsed time in an unrelated scene -> examine at most 32 indexed active-development entries, fill at most three background slots, and keep the combined evolution batch at six or fewer
- empty UI search -> no accidental whole-database dump
- malicious HTML in summary/anchor/evidence/diagnostic fields -> escaped text only
- UI maintenance click -> emits caller action intent only; no direct reset/import/rebuild/storage mutation
- diagnostics with prompt/story/credential extras -> unexpected fields dropped before display
- UI projection over 1000 records -> hard list/detail caps remain enforced
- UI source imports provider/Node/host lifecycle APIs -> validation failure
- same chat filename under two character owners -> different Alpha chat keys and sidecars
- same chat filename under group vs character -> different Alpha chat keys and sidecars
- server-side sidecar revision differs from pointer -> conflict before upload
- desktop hydrates revision N, mobile advances the same-backend sidecar to N+1, desktop resumes -> desktop rehydrates N+1 before using World State as authority
- desktop hydrates N, another session advances through N+1/N+2/N+3 -> one freshness boundary may hydrate directly to N+3
- hydrated revision equals durable revision -> freshness check preserves the working copy and does not rebuild canonical state unnecessarily
- settings pointer advances independently while the working copy still owns revision N -> write still uses hydrated revision N and conflicts rather than borrowing the newer pointer
- provider/manual/Spatial result starts from N, another session commits N+1 before its write -> stale writer is rejected and server N+1 is rehydrated
- local SillyTavern chat is a strict prefix of a newer server-side lineage -> preserve the newer sidecar, suppress continuity, and fail closed until host history catches up
- visibility resume, pageshow, and window focus -> bounded freshness refresh without permanent polling
- server upload returns a non-logical path -> pointer stores returned path, not guessed filename
- existing sidecar pointer GET/parse fails -> no empty replacement write
- missing/stale settings pointer with intact deterministic sidecar -> recover exact owned state and repair revision/checksum pointer
- rename/delete while hydration or write is in flight -> ownership epoch discards stale completion
- character rename that rewrites past chat display names -> proven lineage metadata rebases without rolling back current world truth
- duplicate chat filename under multiple owners then bare CHAT_DELETED -> authoritative host ownership probe selects only the removed owner; ambiguity preserves data
- whole-group deletion event emitted before host group list settles -> one delayed owner-resolution retry, never current-group guessing
- delete/rename ownership retirement -> lifecycle tombstone plus neutralized sidecar prevents stale-state resurrection after settings-save crash
- World State panel opened on chat A then navigation to chat B -> stale panel closes and cannot mutate chat B
- MESSAGE_RECEIVED capture -> listener returns without awaiting provider work; per-chat queue/currentness still serialize commit
- MESSAGE_SENT -> current generation uses last durably committed safe injection without awaiting queued provider-backed continuity; later committed result remains serialized/currentness-guarded
- fail-closed recoveryRequired/dirty branch -> both Reality and Spatial private prompt content are suppressed until recovery clears
- chat/branch changes during capture/evolution/rebuild -> stale result discarded
- Alpha + Delta pinned namespace fixture -> no settings/prompt/DOM/global/file/load-order collision
- disabling Alpha/injection -> clear only `world_state_alpha_private_continuity`
- maintenance rebuild -> reachable only after explicit user confirmation

## Model/provider acceptance

Run focused live tests after deterministic tests pass:

- Gemini through OpenAI-compatible/default host path
- one alternate Connection Profile if configured
- no-change extraction reliability
- direct established fact
- duplicate consolidation
- five-week targeted catch-up
- quiet stability
- quiet resolution
- source-firewall lore trap
- non-fantasy fixtures

Measure actual request count and latency; do not infer live quality from mocks.

## Performance measurements

Per ordinary exchange capture:

- capture request count
- evolution request count
- capture prompt chars / estimated tokens
- provider duration
- total extension-added wait
- injection chars/tokens
- retrieved candidate count
- injected record count

Corpus measurements:

- 10 / 100 / 500 / 1000 records
- evidence growth after 1000 exchanges
- rollback journal bytes across 256-message active window
- relevance selection wall time

## Acceptance result template

```text
Build/commit:
SillyTavern version:
Provider/route:
NPC State installed: yes/no
Ukiyo/Megumin installed: yes/no

Fixture:
Observed:
Expected:
PASS/FAIL:

Capture calls:
Evolution calls:
Added latency:
Injection tokens:
Notes:
```


## Phase 9 Spatial Continuity coverage

Coordinate/profile:

43. +Y north, -Y south, +X east, -X west.
44. Decimal coordinates and configured bounds are enforced.
45. Unit conversion and straight-line distance use the profile scale.
46. Cardinal and diagonal deterministic displacement produce correct vectors.
47. Route/travel distance does not become Cartesian displacement without explicit straight-line evidence.
48. Unknown anchor or vague distance remains relative/unknown.

Authority:

49. Locked manual coordinate blocks automatic narrative movement.
50. Unlocked manual coordinate may be corrected only by a higher-ranked grounded authority.
51. Base canonical coordinate blocks lower-authority automatic proposals.
52. Campaign override shadows base without mutating the base source.
53. Manual editing of an override may retain manual coordinate authority while override identity remains.
54. True North rejects relation directions inconsistent with known coordinate deltas.

Admission/evidence:

55. Named/persistent generated place is admitted; generic unnamed scenery is rejected.
56. Model-proposed precise coordinate without narrative support is stripped/rejected.
57. Relative-only location remains durable without fabricated X/Y.
58. Same-name generated location consolidates rather than multiplying.
59. `writer_state` cannot create/move a location or route.
60. Same sanitation applies to manual rebuild; accepted narration can establish the place.

Ownership/branch:

61. Same generated name in different chats produces different campaign IDs/state.
62. Spatial manual mutation journals on current raw-message boundary.
63. Edit/delete/swipe rollback restores Spatial and Reality to one exact boundary.
64. Stale automatic completion cannot persist Spatial changes.
65. Schema-1 state/checkpoint migrates to schema 2 with empty Spatial state.
66. Export/import preserves Spatial semantics while foreign import clears false local chronology.

Base map:

67. Generic Cartesian base map parses without Ternia-specific code path.
68. Ternia v0.9.10 adapter reads profile, major locations and route anchors from the supplied registry shape.
69. Distinct named Ternia anchors sharing one coarse coordinate remain distinct unless identity/name proves they are the same source location.
70. Generic base map with no explicit coordinate profile remains profileless.
71. Base source remains immutable and campaign overrides remain per-chat.
72. Route draw/path geometry is never treated as straight-line displacement.

Manual/UI:

73. Spatial panel exposes add/save/authority/lock/archive/delete/merge/override/relative/distance/route fields.
74. Delete removes dangling relations/route references.
75. Merge rewires relations/routes and archives the duplicate source.
76. Base location is read-only until Create Campaign Override.
77. Provenance/evidence is visible without exposing mutable canonical references.

Performance/injection:

78. Disabled Spatial produces no Spatial injection and no extra provider call.
79. Reality + Spatial extraction shares one eligible capture request.
80. 1000-location campaign/base projection retrieves a bounded candidate subset.
81. Injection remains budgeted and does not dump the map.
82. Normal turns do not reparse the base source or scan every route/polyline.
83. Rebuild provider timeout/cancellation/unexpected outcome on first and later boundaries leaves original canonical state unchanged.
84. Structurally malformed Reality or Spatial row inside valid rebuild JSON invalidates the reconstruction; semantic duplicate/new-episode rejection remains distinguishable.
85. Fail-closed deep rollback retains recovery data but emits no Reality or Spatial continuity prompt.
86. Elapsed detector rejects writer/timer/planning blocks, system messages, quotations, hypotheticals, future appointments and bare prospective next-week language; established elapsed narration remains accepted with bounded context.
87. Rebuild narration cannot shadow a locked/base canonical location or inherit operator Spatial privileges.
88. Disable Spatial -> Reality rebuild -> re-enable preserves saved profile, base-map reference and campaign locations.
89. Summary-only and trend-only Reality updates preserve omitted fields; explicit supported clear/replacement remains possible.
90. Bounded ordinary capture tombstone admission retrieves a relevant resolved predecessor without placing it into current-state injection or scanning the full record set.
91. Direct Spatial relation stores only grounded endpoint/direction/distance/mode; unsupported 900 km precision is rejected and narrated road distance cannot become straight-line precision.
92. Exact Applecross-style World_State current-location header recovers name/context/X/Y when successful model output omits coordinate or the entire Spatial mutation.
93. Deterministic current-location supplementation deduplicates a matching model proposal, fails closed on conflicting/ambiguous pairs, obeys Spatial disabled mode, and rolls back through the ordinary branch journal.
94. Coordinate parser accepts signed bracket/parenthesis pairs plus signed/Markdown/pipe/quoted-axis X/Y formats and rejects malformed/ambiguous pairs.
95. Provider-backed background continuity is detached from awaited MESSAGE_SENT while remaining on the single per-chat writer queue with stale/currentness guards.
96. Connection-profile transport accepts the raw OpenAI-compatible `choices[0].message.content` shape and ignores `reasoning_content`.
97. Live Gemini rebuild payload using `category`/`description` aliases reconstructs Current plus Brackenford / North Road / Northgate Stockyard / Applecross Culvert after reset.
96. Spatial-enabled capture/rebuild prompt renders the exact Reality schema rather than an ellipsis placeholder.
97. Live Gemini `category`/`description` aliases repair deterministically to `kind`/`summary`; conflicting aliases remain invalid.
98. Reset -> rebuild using the captured Gemini payload restores three Current developments plus Brackenford, North Road, Northgate Stockyard and Applecross Culvert.
99. Rebuild uses the host per-chat diagnostic store and exposes safe start/per-boundary/failure/completion progress; Operations may expand bounded escaped model response/rejection content but never prompts, headers, reasoning, credentials, or story transcript.
100. Grounded proper named locations survive unsupported optional relative metadata while the relation is dropped; generic scenery still fails admission.
101. Compositional proper-place grounding requires every normalized name token in one accepted evidence claim and does not permit arbitrary fuzzy matching.
102. Full-chat rebuild succeeds without Clear and replaces canonical state only after complete persistence.
103. Partial rebuild from a later message preserves exact prefix rollback/checkpoint history and converges with the full current semantics.
104. Partial rebuild after Reset or missing exact prefix fails before provider work with WORLD_STATE_REBUILD_RANGE_BASE_UNAVAILABLE.
105. User may raise the explicit manual rebuild assistant-boundary cap up to 4096; exceeding the chosen cap fails during planning before provider calls.
106. Rebuild progress callback reports global message IDs, processed/total boundaries, provider calls, accepted/rejected counts, current records and places without acquiring mutation authority.
107. Rebuild cancellation by operation-id prefix aborts the active provider call immediately and is not queued behind the rebuild writer operation.
108. Operations lists newest telemetry first and expands capture/rebuild/evolution response/rejection content with bounded escaped JSON/text.
109. Operations drops prompts, transport headers, reasoning content, session IDs, credentials and unexpected private fields.
110. Desktop/tablet/mobile renderer exposes inline Reality record disclosures, expandable Operations diagnostics/JSON, adaptive Places detail, bottom navigation, full-height rebuild sheet, and isolated danger-zone Clear control.
111. Main header contains the trusted continuity icon + `World continuity` title and does not render the old `World State Alpha` eyebrow.
112. Rebuild status is absolutely positioned outside layout flow, can be dismissed independently of cancellation, and does not shift the tab/navigation row.
113. Scoped WebKit scrollbar buttons are suppressed while normal scrolling remains available.
114. Narrated day steps accumulate into a meaningful elapsed hint at two days: at most one step per exchange; quoted/planned/hypothetical/hidden/system text never counts; the count restarts after the last persisted elapsed catch-up and at explicit skips; firing points are deterministic from the current branch within a 40-message lookback; an explicit skip in the current exchange takes precedence.
115. Deleting back past the first capture (fresh chat or imported baseline) restores the pre-capture state instead of failing closed; an unjournaled change with no matching on-branch checkpoint still fails closed.
116. Swiping back to a captured reply resumes its parked branch exactly (records, lastCaptureMessage, merged root checkpoint, monotonic journal sequence) and the resumed branch still rolls back exactly; a changed base, different content, or a no-change rollback never parks/resumes. A seeded randomized swipe/delete/regenerate/evolution sequence test (4 seeds × 40 steps, with parking and swipe capture) matches a from-scratch replay with zero fail-closed outcomes.
117. A swipe to an existing reply, a swipe deletion, or an edit of the latest reply schedules one debounced capture of the latest reply; overswipe generation, a non-assistant tail, and a reply that changes before the delay do not capture; a change further back warns instead.
118. A tail delete or regenerate whose stored tail this session proved locally rolls back before the next prompt (injection stays on, the deleted reply's records are gone, the new reply is captured), including right after a page reload; a stored tail never proven locally still fails closed as host-chat-behind.
119. Hiding or unhiding user and assistant rows (single rows and ranges) keeps World State and rebases lineage; a real edit reconciled together with a hide rolls back only from the edited row; the seeded randomized branch test includes hide/unhide ranges mixed with swipes, deletes, regenerates and evolution, exercises every operation kind, and fails on the previous branch code.
120. The Operations log is saved per chat in its own `world-state-alpha-ops-*` server file (never the sidecar), restored on chat activation, merged read-merge-write on save, carried across rename and emptied on delete; restored rows merge without re-triggering saves.
121. A partial rebuild before the kept journal floor fails before any provider call and names the earliest provable start; starting there completes; the rebuild sheet shows that earliest start only when it is later than message 1.
122. `tests/phase1-visibility-rebase.test.js` (SillyTavern-shaped `{ name, is_user, is_system, mes }` rows with journaled captures): hiding a user+assistant range, hiding one user row, and unhide/rehide rebase with every record active and `recoveryRequired` null; a state already stuck with `recoveryRequired` from the pre-fix behavior heals on the next reconcile and extends lineage to the live chat; a hide plus a real user edit, or a hidden row whose content also changed, never rebases and leaves no ghost state (exact rollback, or fail-closed marked for recovery).
123. A batch of `stable` evaluations with `supportIds: []` (the live Lazy Evolution shape) is accepted: each target records its own elapsed or current trigger as evaluation provenance, advances `lastEvaluatedMessage` without changing summary or `lastChangedMessage`, and is not re-offered at the same boundary; update/resolve/supersede with empty support and a stable citing a foreign supportId are still rejected; the prompt asks every evaluation, stable included, to cite its trigger.
124. Death ends dependent records: the capture system prompt states the death/elimination rule (resolve conditions the dead ran or suffered, keep the death current by updating the subject's state record or creating a fact, never only in history, and a threatened/feared/suspected death ends nothing) and present-condition create/update summaries; the per-request LIFECYCLE CHECK covers facts and developments and names death/elimination; a Grey Post death exchange's records all reach capture through the production relevance pick; that exchange is accepted to update Vena's and Clara's facts to dead (still active) and resolve Bran's racket.
125. The capture and evolution prompts require escaping every double quote inside JSON strings (dialogue quotation marks in verbatim excerpts included; an excerpt without its marks is also accepted) and contain no prose example wrapped in raw double quotes; a dialogue excerpt with its quotation marks escaped or left out still grounds and is accepted; a reply with a raw unescaped dialogue quote, and the live reply corrupted by a stray token between `]` and `}`, are both still rejected whole (fail closed, no repair).
126. Resumable rebuild: a boundary failure returns an in-memory resume point (candidate before the failed boundary, fromMessageId, snapshot token, processed count) while canonical state stays untouched; resuming re-sends the failed boundary's identical request (the malformed reply is never fed back), calls only the failed and later boundaries, and converges with an uninterrupted full rebuild; a changed chat, canonical state, or plan option (hidden inclusion, boundary limit, start) refuses the resume before any provider call, and a tampered processed count is re-derived from the plan; stale and cancelled runs offer no resume; the host keeps the point only in memory, requires the Resume request to name the failed message, refuses a stale snapshot or changed connection profile before any reconcile/status side effect, consumes the point only when the resumed run starts, drops it on any new canonical state and with the chat's runtime continuations, never persists it, gives the resumed run a distinct operation id, and reports whole-rebuild totals; the panel shows Resume from message N on the failed status and in the rebuild sheet and ignores repeat clicks while a resume runs; live SillyTavern: a stray-token glitch at message 6 of 6 boundaries resumed with 3 calls instead of a 6-call re-run and reported 7 calls in total.
127. Bulk manual lifecycle: `applyManualLifecycleBatch` resolves or supersedes many active records in one manual boundary with per-record manual evidence, unchanged summaries and one journal entry; it rejects the whole batch for a missing or non-active record, an empty or over-100 selection, a non-lifecycle action, a missing note, or a non-head boundary; the panel renders Select records, per-row checkboxes (active rows only), a count, Select all shown, Clear, Mark resolved/superseded and Done, hides them on the Resolved tab, and prunes stale selections; the host validates every selected row (identity, active, summary, created/changed message) and cancels the batch if any is stale.
128. Panel scroll retention: the controller records scroll offsets from capture-phase scroll events (never by reading the DOM at render time) into a bounded memory keyed by list identity (chat, tab, search, place filter, Places detail/editing state; detail-like panes also by selection) and restores them right after the wholesale re-render, so selecting, expanding, bulk ticks and refreshes keep the operator's place, a different chat/search/filter starts at the top, and the Places list survives a detail hiding it on phone width. Browser-checked at 900px offsets.
129. Tablet rebuild sheet: `.wsa-shell` and `.wsa-sheet-layer` are fixed layers sized `100vw` × `100vh`/`100dvh` (never `inset: 0`), and `.wsa-sheet-actions` is sticky at the bottom. Live-checked in SillyTavern with Playwright tablet profiles: before, the sheet sat at y=−363 in iPad/Galaxy Tab portrait; after, the sheet and its buttons are fully on-screen on iPad and Galaxy Tab (both orientations), two phones and two desktop sizes, and a tap on Start Rebuild in iPad portrait completes a rebuild.
130. Live capture parity: the live capture prompt contains the exact rebuild recovery instruction once and no rebuild-only framing. Missed captures: `unrecoveredCaptureFailures` lists capture failures (including captures whose save failed or conflicted), keyed by message and lineage, cleared only by a later successful capture of that message and lineage, a completed rebuild whose operation-id start covers it, or an import/reset (never by a lone rebuild boundary row or a failed/cancelled rebuild); log trimming pins unrecovered failures; the host keeps only current assistant replies whose lineage matches and merges the saved log before a recapture; the panel shows Recapture from message N only when the prefix is provable (else Open rebuild / Full chat), hides it while a rebuild runs, and ignores repeat clicks; the host refuses a request that does not name the current earliest failure, confirms the boundary count before any write or provider call, and runs a From-message rebuild; failure rows (and recoveries while a failure is listed) save immediately and pending rows flush on hide (best effort on unload). Live-checked in SillyTavern with a stub model: a failed capture at message 4 survived a reload, Recapture re-read messages 4 and 6, the missed record appeared, and the notice stayed cleared after an immediate reload; a failure on swipe A hid behind a captured swipe B and returned after swiping back.
131. Audit batch 1: a commit after a rollback onto the journal floor keeps the floor and a later rollback of that message fails closed; a logical-path first write conflicts with an existing deterministic sidecar and uploads only after a 404; rebuild treats a no-narration assistant reply as an empty boundary without a provider call; the Spatial wire omits unsupplied optional fields, revisits/route mentions keep type, context, notes, route refs, endpoints and waypoints, and a distance-less relation mention keeps the distance mode; a full rebuild's root snapshot carries Spatial; a bulk selection drops when the row at its key changes; host source checks cover pickers before the queue, Lock/Save from canonical state, the Add place guard and the rename rules. Live-checked in SillyTavern: rename away and back (and reload) keeps records, Lock keeps coordinates, a duplicate place name is refused.
132. Audit batch 2 (`tests/audit-batch2.test.js`, relevance cases in `tests/phase3-relevance.test.js`): newest-message retrieval through the index after a long older reply; function words alone select no record or place; unsupported update anchors, duplicate-gate conversions and unknown trends keep anchors/trend while explicit clears still clear; evolution blanks keep anchors/trend and new anchors are merged; resolve-then-update and duplicate creates in one response; fenced evolution JSON; elapsed skip after a quoted mention; hidden-reply exchange boundaries and excluded-hidden rebuild windows; colon checklist bullets and the exchange character budget; Spatial injection without placeholders, no ungrounded rename, invented out-of-bounds coordinates dropped. Each fails on 0.9.0-alpha.42. Live: capture, Recapture, rebuild and reload re-run in SillyTavern with a stub model.
133. Audit batch 3 (`tests/audit-batch3.test.js`, updated cases in `tests/phase5-rebuild.test.js`): a `stale` capture is a missed capture and saves at once, `superseded` settles only its own lineage, `skipped` is still not a failure, an `applied` row followed by `not-saved` stays missed; `contentLineageKey` is unchanged by hiding/unhiding any message and changed by an edit or swipe, a later success of the same story message under a new lineage clears the failure and a repeat failure replaces it; a capture abandoned before its request records a row with the key; a getter error never breaks capture; a missing log reads as null, a corrupt one as `WORLD_STATE_JSON_INVALID`, a 503 or network error otherwise; host source checks for postponed saves, the rename guard, load retry, abandoned/compensated capture rows, the lazy key and the full reconcile before a partial rebuild. Each fails on 0.9.0-alpha.43. Live-checked in SillyTavern with a stub model: a chat switch mid-capture is offered as Recapture on return (none on alpha.43); a failure stays offered after `/hide 1` and after reopening the chat (none on alpha.43), and Recapture then completes; an edit mid-capture leaves nothing missed and the edited reply is captured; a quick user reply during a capture loses nothing; a log save during two 503 reads keeps another device's row and saves the failure after a retry; the alpha.41 Recapture and swipe scripts behave as before.
134. External audit A01-A08 (`tests/audit-alpha45.test.js`): quoted, single-quoted and planned elapsed phrases are rejected at their own offset and a meaningful skip wins over an earlier short one; host source checks for the server-authoritative past-chat rename and index resets from the cached state; `prepareWorldStateContinuity({ publishIndex: false })` leaves the shared index untouched and returns its delta; a Reality-only partial rebuild keeps a place established in its range, a Reality-only full rebuild rolls that place back with its reply, and a hide is not a branch change, a story change below the journal floor while places exist rebuilds with a `WORLD_STATE_REBUILD_SPATIAL_HISTORY_UNVERIFIED` warning, and bounding to the floor keeps the first entry after it; long and contracted dialogue, `'ll` plans and newest-message precedence; merges keep `operatorOwned`; an operator-edited place stays protected after its evidence is trimmed and after a foreign import, and older saves derive `operatorOwned`; a same-position confirmation keeps `campaign_override` and a later move is rejected. Each fails on 0.9.0-alpha.44. Live: the batch 3 missed-capture scenarios, Recapture, swipe, rename away and back, and Places lock/duplicate re-run in SillyTavern with a stub model.
135. External audit A09-A12 and rebuild continuity (`tests/audit-alpha46.test.js`, `tests/rebuild-continue.test.js`): host source checks for range-scoped rebuild staleness, panel-open log refresh, the successor-first rename, upload retry/park; 41 unrecovered failures plus 40 newer rows trim to 80 with every failure kept and older answers dropped; a parked swipe stays resumable after an earlier row is hidden (the unrelinked park does not resume). Each fails on 0.9.0-alpha.45. Live-checked in SillyTavern with a stub model: a message sent during a Full rebuild no longer cancels it and the notice clears; a second browser context clears the notice after another context's rebuild when its panel reopens (alpha.45 kept it); a park/hide/swipe-back resumes the parked reply without a new capture (alpha.45 recaptured it); two failed log uploads are retried and the failure row reaches the server (alpha.45 lost it); a missed capture survives a chat rename and reload; the alpha.44/45 live scripts behave as before.
136. External audit A13-A17 and A22-A26 (`tests/audit-alpha47.test.js`): string/null/number/[null] anchors are ignored while [] still clears; object/string/null `spatialMutations` fail the boundary; a quotation cited with its speaker frame is not promoted while a narrated event beside an unrelated reporting clause is admitted, and same-clause and trailing attributions still attribute; a reported end does not resolve an objective development; north/south gate and numbered units are not merged while restated subjects still are; a borrowed coordinate is dropped, an own or back-referenced one kept, a hypothetical tower refused; a header keeps type/context/notes; a moved place clears a contradicted direction; an override merge moves its effective-id relation. Each fails on 0.9.0-alpha.46. Live-checked in SillyTavern with a stub model returning Spatial proposals: alpha.46 gave Falcon Peak the fortress's coordinates, created the hypothetical tower, reset the fortress to landmark with empty notes on a header, and accepted a malformed container; alpha.47 does none of these and records the malformed reply as a missed capture.
137. External audit A19-A21, A27-A29 and batch 4 (`tests/audit-alpha48.test.js`): three retired neighbours no longer starve the active one-hop neighbour (indexed path); a Kesselpass Gate closure beats 600 records anchored on Gate; a Chinese pass name after 160 older Chinese characters is found (records and Places); the host relevance view keeps the end of a 5,000-character reply and stays within the 12,000-character exchange budget; a same-ID profile edited to another model changes the route fingerprint and a pinned dispatch refuses before sending, and the host model and output cap are part of it; a replace-on-innerHTML DOM keeps typed Places fields through a refresh while untouched fields show the new canonical value; a rejected save keeps the editor and its draft; composition events defer the re-render and search on the committed text; host source checks for reported action failures, the non-rethrowing queue cleanup, serialized activation and the archived-anchor save. Each fails on 0.9.0-alpha.47. Review hardening: a profile draft ends on Reset, the editor keeps the relation it opened with, a click ends a composition hold, rarest-first phrase order, a context-only word cannot starve a Places name, a nearly spent budget stays bounded, and an unreadable host model never matches. Live-checked in SillyTavern with a stub model: on alpha.47 a late mention in a long reply injected nothing, a capture refresh wiped a Places draft, saving a place related to an archived place failed with "Relative anchor not found", IME composition in the search box produced "ととり砦", and a bad import file gave no message; on alpha.48 the record is injected, the draft stays, the save succeeds, the composition commits "砦", and the import reports "bundle is not valid JSON".
138. External audit A30 and batch 5 (`tests/audit-alpha49.test.js`): two empty Places reduces over a counted 1,000-place base map read no base entry and a one-override change reads it at most once; resolving selected ids equals the full resolution for base, override, campaign and orphan-override places; a reduce and a commit share checkpoint and journal entries with their input while records stay private; trimming replaces the first journal entry and leaves the earlier state's journal untouched; shared entries reject in-place edits; source checks for the single-read boundary refresh of chats without a pointer, the key-free injection exchange, plan-lineage rebuild commits, the event-invalidated range proof, and history-free copies in capture, evolution and Places edits; 50 scroll events read no state; an identical sidecar text decodes to independent copies, keeps the owner check, and a tampered text is fully verified. Each fails on 0.9.0-alpha.48 (the review-hardening checks on the pre-review head). Live in SillyTavern with a stub model, same harness on both: a Full rebuild of 200 replies took 52.3 s on alpha.48 and 5.8 s on alpha.49; a live capture with 201 records 2,620 ms and 926 ms; a send on a 3,000-message chat 63-121 ms and 20-44 ms; the earlier live scripts behave as before.
139. Deep pass on alpha.49, data loss and host lifecycle (`tests/audit-alpha50.test.js`): a north-gate new episode stays a create beside an active south-gate record while a same-gate duplicate still merges; a Reality-only rebuild from a final user message keeps the operator's place and rolling that message back removes it; after a base-map detach a merge and a capture update address the former override by its own id while an attached map keeps the base id; re-adding an archived name at the same head yields an active place; a dropped connection on save is retried, recognized when it landed and re-sent when it did not; the place editor closes when its place is archived elsewhere; a string, null or number provider rejection keeps its text and a failure receipt; source checks for the capture start-failure row, the delayed rename-aware notice, the unheld branch event during a rebuild, identity-based history comparison, the single activation read, counting chat events first and reported base-map/override rejections. Each fails on 0.9.0-alpha.49. Live in SillyTavern with a stub model: a failed server read before a capture left no trace on alpha.49 and is a missed capture on alpha.50 (offered for Recapture once the chat moves on); a save whose connection dropped after landing was listed as not saved on alpha.49 and is applied on alpha.50; a rename showed the missing-continuity warning on alpha.49 and not on alpha.50; a swipe of a reply sent during a 150-reply rebuild held SillyTavern 15.7 s on alpha.49 and 1 ms on alpha.50 (the rebuild still completed); opening a chat read its sidecar 3 times on alpha.49 and 2 on alpha.50; the earlier live scripts behave as before.
140. Deep pass on alpha.49, capture accuracy (`tests/audit-alpha51.test.js`): "active/armed/king" excerpts no longer ground inside "inactive/unarmed/viking" while whole words and Chinese text still do; a cross-sentence rumour cannot resolve the siege and a cross-sentence herald report is not promoted, while a narrated sentence beside an unrelated rumour is admitted; multi-paragraph speech and speech after an inch mark stay dialogue; the content of a demand/order/threat is not established while "in order to" and a narrated act of demanding are; a self-closing planning tag leaves the reply; four travel/schedule/duration phrases give no elapsed hint while four real skips still do; a twice-normalized unknown amount stays null; source check for the retried background catch-up; evolution plans at most 6 targets; merged rebuild evidence is all `rebuild`. Each fails on 0.9.0-alpha.50. Existing tests for narrated extortion and dialogue-bearing rebuild evidence pass unchanged. Live in SillyTavern with a stub model returning these mutations: on alpha.50 each of items 18-21 created or resolved a record, the self-closing tag dropped the capture, and a travel time started a catch-up call; on alpha.51 none of these happen, the bridge is captured, and a real "three weeks later" still starts one. Code review hardening adds five cases, each failing on the pre-review code: a speech-act verb marks only its own clause (orders as a noun, a semicolon, a contrastive turn), a quotation wrapped onto the next line or holding an inch mark stays dialogue, a sentence sharing only a place name does not decide attribution, every speech-act verb keeps a reported summary reported, and emphasised "*After three days*", "Two days on" at a line end, and the clause rule for `extractElapsedHint` and the "after a day" day step; the background source check now requires restoring only the two catch-up fields.
141. Deep pass on alpha.49, Places accuracy (`tests/audit-alpha52.test.js`): a header repeating a locked coordinate updates the place and keeps the lock while a different position is still refused; a position-less campaign override takes a narrated position; four header forms with a coordinate beside the name give one "Old Mill" at (12, 4); a 12 km ride derives no coordinate and no straight-line relation while "as the crow flies" derives (0, 12); a near-match coordinate is stored as narrated; "Oak" does not ground in "cloak" but does as a word; a relative relation to a same-name place outside the visible set is kept; Lock then Unlock leaves an override unmoved by narration; a base place named outside the visible set is not duplicated; a reverse relation updates the existing one; archived neighbours do not crowd out an active one; base-map import keeps null/empty coordinates unknown and unlocked and accepts a repeated name; a route reaches the injection; rejections keep the model row number. Each fails on 0.9.0-alpha.51. Live in SillyTavern with a stub model: on alpha.51 a header "Old Mill [12, 4]" named the place with its coordinate, "Oak" was created from "cloak", a reverse relation was stored beside the original, and the injection showed no route line; on alpha.52 none of these happen, and a header confirming a locked place adds its evidence without a rejection. Code review hardening adds five cases, each failing on the pre-review code: a base place found by name never updates an archived override and a name two base places share is rejected; "서울" grounds with its particle while "Oak" still does not in "cloak"; a reverse "north-east" becomes southwest and a free-text direction is kept; "The winds howled" is not route wording and an unqualified restatement keeps a stored straight-line mode; repeated base names keep their ids when another row is inserted, and "Kings-Rest" matches "Kings Rest".
142. Deep pass on alpha.49, UI and relevance (`tests/audit-alpha53.test.js`): "iron " in the search box and "old " in the Places filter survive the re-render; a background refresh leaves focus and the caret in the place field being typed; a link to the oldest of 125 active records opens it in Current; Copy copies the JSON shown beside the button; declining Reset profile keeps the typed value and a saved reset clears it (and the host returns the result); a max-height media query removes the panel minimum; 300 records anchored "the shrine N" no longer crowd out the relevant record while a one-word "Will" anchor still matches; an accented text yields only bigrams with a non-ASCII letter and a French scene finds its record among 300 accented anchors; 36 resolved developments no longer use the background scan. Each fails on 0.9.0-alpha.52. Live in SillyTavern: on alpha.52 typing "iron gate" gave "irongate", a capture during a place edit took focus away, and at 800x360 the 420px panel overflowed the bottom by 70px; on alpha.53 the search reads "iron gate", typing continues in the place field at the caret after the refresh, and the panel fits the screen. Code review hardening adds cases that fail on the pre-review code: the linked out-of-list record is in the rendered list; a retired-then-re-added development leaves one background id; the bulk and scroll scopes use the cleaned query, a disabled field falls back to the search focus, and Copy carries no row number. A further case shows "Will Turner" is still found among 300 "the shrine N" anchors.
143. Deep pass on alpha.49, performance and cleanups (`tests/audit-alpha54.test.js`), asserted as counts, never timings: the Reality and Places reducers return no undo patch and still return private copies; `canonicalDomain` is still independent of its input; a Places capture with no proposals returns the state it was given; a manual edit reads each message as often as one lineage pass; the rebuild action takes one exact check when it returns; a panel click builds no more than one refresh does; the text canonicalizer, the opposite-direction table and the resume lookup each exist once, the unreachable elapsed branch and redundant routing branches are gone, and the search reports every match from one pass. Each fails on 0.9.0-alpha.53. Measured at 400 records, a 600-message chat and 2,000 places: reduce 88 to 7 ms, capture 111 to 7 ms, commit 121 to 58 ms, manual edit 311 to 95 ms, empty Places capture 722 to 0.2 ms. The Phase 8 validator builds its undo patch at the commit boundary like the runtime. Code review hardening adds five cases that fail on the pre-review code: a click after a new canonical state arrived without a refresh sends the current place; an empty Places capture given no state returns a normalized one and 'constructor'/'tostring' are not compass points; a repeated input id is read as normalization keeps it; a Places edit reads each message once, no runtime module copies a state right before normalizing it, and the undo patch is independent of its inputs; a relation shows a canonical direction from either side.
144. Deep pass on alpha.54, data loss and wrong state (`tests/audit-alpha55.test.js`, `tests/audit-alpha55-host.test.js`): a Places-on Full rebuild keeps an operator place with its locked position and still rolls it back with its message; a new episode sharing only an anchor with an unrelated active record stays a create; "Squad 12" and "Squad 14" are distinct subjects while "lasted 3 days" / "4 days" is not; rolling back a deleted place restores the original order and an older rollback still proves its boundary; a base map whose name was cut after a space reloads; overrides of same-named base places and same-named base routes keep distinct ids; injection toggles are not in the invalidation list; the Operations log persists every kept row. The host tests drive the real `index.js` in a temporary SillyTavern layout with stub host modules (`tests/host/`), one process per scenario: a missing-sidecar stand-in carries no hydrated pointer; a capture whose reply is swiped during the base-map wait is discarded; a conflict refresh adopts a lower server revision; a divergent adopted state stays dirty; a corrupt sidecar is recovery-required and a Full rebuild replaces it; a reply appended during a rebuild does not cancel it and the branch is reconciled after the rebuild; Add place refuses a folded duplicate name and a typed position becomes manual. Each fails on 0.9.0-alpha.54. Code review hardening adds cases that fail on the pre-review code: a readable sidecar of a newer schema is not replaceable (adapter and host: blocked, kept after a reset) while a damaged one is replaced only at its recorded path; a read older than the revision a conflicting write found stays a stale read; a refresh that finds the file damaged logs it and adopts a restarted readable file; counted numbers ("3 times a week", "5 silver") are quantities; an operator relation to a model place survives a Places-on rebuild that re-creates that place under a new id; such a rebuild warns when operator places predate an earlier story change; the overlay is skipped without operator entities and the adopted chat is fingerprinted once.
145. Deep pass on alpha.54, hearsay, plans and time passing (`tests/audit-alpha56.test.js`): "Without warning", "Bram swore", "All told" and a relative "who reported" clause are narration and may end a record, while "A traveler claims ..." stays reported; "Lt. Varro reported that ..." stays reported; single, curly single and 「」 quotes are dialogue and an apostrophe is not; conditional and planned claims cannot become done deeds or end a record, while a plan-worded summary is accepted; World_State planted seeds and `<think>` blocks ground nothing; "the Free States", "Holy Orders" and "land claims" do not preserve reported status and a rumour cannot end a speech-act arrangement; dialogue ending in a number closes and a quoted ship name is not dialogue; "threatened ... and burned ..." keeps the burning; a 600-character excerpt is cut on a word and grounds; `</writer_state >` closes; Japanese paraphrase, two-character anchor update and near-duplicate similarity; "rat" is not supported by "pirate"; a `/sys` narrator message is part of the next reply's exchange and no rebuild window; the new skip phrases, clause-local and case-aware modals, the older meaningful skip over a newer short span, a day step after a planned first mention, unknown vague amounts, and three background slots when the relevant developments are not due. Code review hardening adds six cases that fail on the pre-review code: narrated day steps, the noun "will" and "whether" openers are narration; prospective wording does not preserve a quoted claim; bold headings end and numbered entries stay in World_State planning sections; 北門/南門 stay apart; lower-case words and units end sentences and a capitalized hypothetical voids a skip; a shouted word is dialogue while a named ship is a name.
146. Deep pass on alpha.54, Places capture and host (`tests/audit-alpha57.test.js`): "the north wind", "the north gate" or a distance in another sentence ground no relation while "lies north of" does; a coordinate spoken across a wrapped line or in „…“ quotes and one in an uncited sentence are not narrative-explicit; narration of a base place with an archived override is rejected and a merged-away name maps to its merge target; ungrounded routeRefs are dropped and a base route name creates no campaign route; nine Places rows keep eight and the Reality record; a place moved and related in one reply is judged where it now is and a reducer rejection keeps row 0; "1,200 km" grounds 1200 (not 200) and "constructor" is no direction alias; a host-route rebuild refuses a changed model and a profile failure keeps "429 Too Many Requests"; renamed rows are relinked; source checks for the Spatial toggle index, the rebuild no-start notice, resume discard on chat leave, the registry write after a saved attach and saved-only detach success. Code review hardening adds four cases that fail on the pre-review code: a merged-away override maps to its merge target; a sentence sharing words with the claim is not cited, directions before a clause or conjunction ground while "the north and south gates" do not; a relative relation is judged after a same-reply anchor move and its reducer rejection keeps row 1; the rebuild pin equals the route snapshot's host key and a relinked row wins merges in either order.
147. Deep pass on alpha.54, panel and accessibility (`tests/audit-alpha58.test.js`, on a fake DOM that re-creates every panel control on each render): the toast rule and body class; the dialog has focus after the first render, a clicked tab keeps focus across the re-render, Escape closes the rebuild sheet and then the panel, and the markup carries no live region; emptying the inline search box keeps the search view while emptying the navigation box returns to Current; a declined archive keeps the edit form and a saved one closes it, and each Add place prompt can cancel; a free-text "upstream" relation reads "Weir is upstream of this place" from the other side and stays a selected "(as stated)" option; a resolve after positions shifted without a re-render sends the record shown with its current key; rebuild place counts are active campaign places. Each fails on 0.9.0-alpha.57. Code review hardening adds four cases that fail on the pre-review code: Escape keeps a place form with a typed name open; a record opened beyond the bounded list is resolved under its new key after positions shift; a rebuild status that goes away is not announced; source checks for the free-text orientation on save, sheet focus on open, the rendered tab and untagged focus targets.
148. Deep pass on alpha.54, performance, contract text and cleanups (`tests/audit-alpha59.test.js`, with the host scenario `tests/host/state-copies.mjs`, which counts state copies in an instrumented copy of the runtime): a saved capture makes at most six normalizations and no other copies and a user send none; a Places save fingerprints the chat once and applies each step once, and the panel reply count is memoised; relevance passes the context token sets to the overlap score; a "Will" anchor is not matched by "they will" or "Will you" but is by "ask Will"; a rebuild exchange about the miller does not reserve the recently changed bandit raids, while "It finally ends" still gets its antecedent; a derived development duplicating an existing record is rejected through the relevance index; an over-limit rebuild reads no message; snapshot tokens and dead functions are gone, record links and state comparison do not normalize; the contract text for C07, C23.1 and C24.6; extractElapsedHint rejects quoted and planned skips like the runtime detector; shared helpers are not redefined and evolution clipping keeps a small limit; a null status is accepted as not stated; World_State checklists read •, +, numbered bullets and "Offscreen"; a Reality-only rebuild accepts a missing chat and journals a Places edit made after the last reply at its own message. Each fails on 0.9.0-alpha.58 except the bare-ending antecedent, which guards existing behaviour. Code review hardening adds cases that fail on the pre-review code: a sentence-opening name ("Will nods", "Will, the ferryman") matches while a quoted question does not; a recent plague stays visible when the exchange ends it by a synonym; a numbered label ending at its colon closes a checklist section; a resolved record named after 320 other words of a long reply is still shown; a Reality-only rebuild adds no checkpoint at an unchanged trailing message; and source checks for field-wise lineage comparison, the chat-free reply-count memo and `mes`-first host text.
149. Forfeit a missed capture (`tests/audit-alpha60.test.js`, with the host scenario `tests/host/forfeit-capture.mjs`): a `forfeited` row clears the failures of its message version (also after a hide or unhide) but not another swipe's, a later failure is listed again, the row is no failure itself and is saved at once while a failure is listed; the notice shows a Forfeit button per listed message on the World view, none in the rebuild sheet or during a rebuild, and a click sends `forfeit_capture` with that message; in the host a declined confirmation keeps the failure, a message that is not listed is refused, and a confirmed forfeit clears the notice, leaves the sidecar revision and records unchanged and saves the row to the Operations log file. Each fails on 0.9.0-alpha.59. Code review hardening: a forfeit is refused at once while a rebuild runs, succeeds with a full in-memory log and an unreadable sidecar and is saved at once; 15 failures get 15 Forfeit buttons and 45 get 40 with the rest counted; the confirmation says a later rebuild still re-reads the message, and the forfeit path reads no sidecar.
150. Deep-pass data loss and wrong state (`tests/audit-alpha61.test.js`, with the host scenarios `tests/host/rename-recovery.mjs` and `tests/host/corrupt-reactivate.mjs`): a forfeit in a full Operations log is reported as clearing a listed failure and kept with it, and the trim pins a row that clears a failure still in the log; a completed rebuild clears failures from its start to its last message only, import and reset clear all; renaming a recovery-required chat writes no sidecar and the new name is recovery-required; persistence counts in-flight writes and a freshness check overlapping one reports a race; compensation records the restored revision; abandoned and branch-unavailable captures record a lineage-keyed missed capture, and a reply the state already holds is not listed; a failed conflict rehydration or a thrown rebuild ends failed; Operations-log saves, retirements and stale-ownership loads keep their rows and owner; the storage adapter checks the sanitized file, rejects another chat's file and, without Web Locks, reports a concurrent upload as a conflict; the Places index is rebuilt when the base map arrives; a damaged sidecar stays recovery-required on a second activation; a lineage-only extension keeps the resume point; a reconcile over snapshot-less checkpoints fails closed; stableStringify matches a JSON round trip; boundedText is idempotent and boundedText and boundedExcerpt never end on a lone surrogate; canonical text and the name-connector check lowercase without the locale. Each fails on 0.9.0-alpha.60. Code review hardening (`tests/host/rename-cached.mjs`, `tests/host/rename-corrupt.mjs`): a rename carries real cached continuity of a recovery-required chat and renames a damaged one without an error; a capture that throws after a chat switch is a missed capture; a kept clearing row leaves failures their stored answers; a damaged path recorded in another spelling is replaceable; an Operations-log save copies no rows.
151. Deep-pass capture firewall, wire and elapsed time (`tests/audit-alpha62.test.js`): a threat or order cited with its content creates no done deed while the act itself and a coordinated narrated act may be recorded; shouted, yelled, cried and screamed beats keep dialogue reported; a plural possessive keeps single-quoted dialogue open and 'em opens none; a sentence ends after a closing quote; "said nothing, but that night" is narration while "reported that" reports; narration repeated in a report or an "if" is narration; travel "going to" is narration and "going to burn" a plan; a name or "refuses" does not save a promoted summary; a frame attributes while "announced the curfew," and "said nothing" do not; a repeated summary word counts once; a supersede and its replacement create both apply; rows past 8 are rejected one by one and the prompt states the cap; status-only and related-only updates validate; ▪/‣ planning bullets, a stray closing think tag and a spaced World_State closing tag are handled; host rows are read mes-first; a hidden user turn is not in the capture exchange; wrapped and curly-single dialogue hides elapsed phrases; past modals, adjectives, possessed nouns and "as if" keep a skip while "could ... later" and "if" void it; an echoed day step keeps the narrator's next step; the narrated second occurrence of a phrase is found; the newest skip of a message is reported; fortnights and decades are converted. Each fails on 0.9.0-alpha.61. Code review hardening: a rumoured resolve leaves its record in the duplicate gate; dialogue opening with 'Cause or 'Round, a tag after a final "s'", a twelve-word report, "screams" and "answered the petition", a shown demand establishing a levy and a relative "that" after a threat; a narrator repeating the echoed day step counts once; rebuild windows read mes first and hidden rows are not scene context.
152. Deep-pass Places (`tests/audit-alpha63.test.js`): a base route named by its id is not replaced; a "constructor" direction is rejected without a crash; a free-text relation between positioned places is kept under a locked True North; an archived campaign place is not re-created; a relative position is not derived from an anchor the reply moves; "Millbrook lies north of Oakvale" stores the relation as south; the True North check reads an override's current coordinate; an empty relative placeholder validates; "an old man" does not select the Old Mill; "North-Road" updates "North Road"; a plain upsert at a base id and a merge into an archived place are refused; a relation id between other places is refused; a long header line grounds, a header date pair is no position while a position field is; a dropped deferred relation keeps its row; naming a plain base place logs nothing; an update whose evidence never names its place is rejected; a cut injection line never ends inside a number or bracket pair; base-map object coordinates accept numeric strings; the corpus counts active places. Each fails on 0.9.0-alpha.62.
