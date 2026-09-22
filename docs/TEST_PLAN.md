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
30. Ordinary rendered UI contains no raw record IDs, evidence IDs, lineage keys, rollback internals, prompts, transcripts, credentials, or provider payloads.
31. A 1000-record backend still yields bounded Current / Recent / Resolved / Search UI lists.
32. Desktop and <=700px / <=420px responsive rules keep the UI readable without requiring backend internals.
33. Owner-qualified host identity keeps equal chat filenames under different characters/groups separate.
34. Host sidecar upload uses the World State filename namespace, revision checks the existing pointer, and persists the actual server-returned path.
35. Hydration failure with an existing pointer fails closed and never overwrites durable state with a fresh empty state.
36. Assistant lifecycle performs at most one eligible capture request and journals/persists only if its chat/lineage/epoch guard remains current.
37. User lifecycle performs local relevance/injection and only one batched lazy-evolution request when an existing Phase 4 trigger is justified.
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
48. Live acceptance verification is governed by [LIVE_ACCEPTANCE.md](file:///C:/AI-Agent/worktrees/504dbad2-phase8-release-hardening/docs/LIVE_ACCEPTANCE.md).

## Additional safety tests

- model output references unknown record ID -> reject
- update omits existing anchors -> omission is non-destructive unless explicit replacement semantics allow
- malformed JSON -> no mutation
- timed-out request -> no mutation
- stale request completes after branch change -> discard
- duplicate assistant receipt -> no duplicate capture
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
- rebuild provider fails on a later chunk -> original canonical state unchanged
- rebuild currentness changes mid-run -> discard whole candidate
- rebuild passive duplicate of resolved episode -> reject
- rebuild explicit new related episode -> create new record, retain tombstone
- empty UI search -> no accidental whole-database dump
- malicious HTML in summary/anchor/evidence/diagnostic fields -> escaped text only
- UI maintenance click -> emits caller action intent only; no direct reset/import/rebuild/storage mutation
- diagnostics with prompt/story/credential extras -> unexpected fields dropped before display
- UI projection over 1000 records -> hard list/detail caps remain enforced
- UI source imports provider/Node/host lifecycle APIs -> validation failure
- same chat filename under two character owners -> different Alpha chat keys and sidecars
- same chat filename under group vs character -> different Alpha chat keys and sidecars
- server-side sidecar revision differs from pointer -> conflict before upload
- server upload returns a non-logical path -> pointer stores returned path, not guessed filename
- existing sidecar pointer GET/parse fails -> no empty replacement write
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
69. Base source remains immutable and campaign overrides remain per-chat.
70. Route draw/path geometry is never treated as straight-line displacement.

Manual/UI:

71. Spatial panel exposes add/save/authority/lock/archive/delete/merge/override/relative/distance/route fields.
72. Delete removes dangling relations/route references.
73. Merge rewires relations/routes and archives the duplicate source.
74. Base location is read-only until Create Campaign Override.
75. Provenance/evidence is visible without exposing mutable canonical references.

Performance/injection:

76. Disabled Spatial produces no Spatial injection and no extra provider call.
77. Reality + Spatial extraction shares one eligible capture request.
78. 1000-location campaign/base projection retrieves a bounded candidate subset.
79. Injection remains budgeted and does not dump the map.
80. Normal turns do not reparse the base source or scan every route/polyline.
