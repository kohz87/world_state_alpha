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
42. No launcher/watchdog/MutationObserver or generic slash-command framework is introduced by Phase 7.
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
