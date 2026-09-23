# World State Alpha - live acceptance protocol

Status: Phase 8 live acceptance checklist. No scenario in this document is pre-marked as passed.

Deterministic tests and validators prove repository invariants. This checklist is intentionally separate because mocks cannot prove real SillyTavern event order, browser DOM behavior, provider quality/latency, storage endpoint behavior, or simultaneous extension operation.

## 1. Record the environment

Before testing, record:

- World State Alpha version and commit
- SillyTavern version
- browser / OS
- primary RP route and model
- optional World State Connection Profile and model
- NPC State Delta version if co-installed
- story-driving extensions enabled, such as Ukiyo or Megumin Suite
- whether the page is using HTTPS/localhost and whether Web Locks are available

Use a fresh test chat unless the scenario explicitly requires reload/recovery.

## 2. Minimal live scenario set

### L01. Default host route

Run one ordinary exchange with World State Alpha enabled and no dedicated Connection Profile.

Observe:

- scanner request reaches the default host route
- RP provider/model settings are not changed
- no console error occurs
- the Alpha private prompt key is independently present when relevant state exists

Record actual request count and provider duration.

### L02. Dedicated Connection Profile

Select one valid Connection Profile for World State and repeat an eligible capture.

Observe:

- scanner traffic uses the selected profile
- ordinary RP continues using its existing route
- deleting/making the selected profile unavailable fails clearly rather than silently falling back

### L03. No-change exchange

Use an exchange with no material world-state change.

Observe:

- at most one eligible capture provider call
- no canonical world mutation is admitted
- no correction/retry model call is issued merely because the provider response says no change

### L04. Direct established fact

Narratively establish one unambiguous current world fact, for example that a named canal lock has collapsed.

Observe:

- one grounded current fact is captured
- evidence points to the actual exchange
- later relevant context can retrieve/inject the fact
- unrelated context does not inject it

Do not require exact model wording or a particular anchor list.

### L05. Duplicate consolidation

Narrate the same current condition again using different wording.

Observe:

- the extension updates/consolidates where the existing duplicate gate supports it
- it does not proliferate semantically duplicate active records

### L06. Relevant five-week catch-up

First establish an active development with a continuing mechanism, then return to that same development after an explicit five-week skip.

Observe:

- relevance selects the development
- no more than one batched evolution call is issued
- no more than six combined targets are evaluated
- relevant targets retain priority and no more than four relevant targets are admitted
- the result is grounded in accepted evidence and may validly remain stable
- elapsed time alone does not force a changed outcome

Record actual evolution latency and outcome.

### L07. Background five-week catch-up

Establish several active developments in different scenes, leave them remote, then narrate a meaningful five-week skip in an unrelated scene.

Observe:

- no more than one batched evolution call is issued
- the batch may include up to three remote active developments that are not relevant to the current scene
- the combined target ceiling remains six
- remote developments may validly remain stable
- no unsupported actor action, event, escalation, or resolution is invented merely because time passed
- ordinary turns without meaningful elapsed time do not trigger background catch-up
- the same five-week skip does not trigger another remote background batch on the following turn merely because the skip text remains in the bounded exchange

This is the primary live acceptance case for 0.9.0-alpha.6 Background Development Catch-up.

### L08. Quiet relevant stability / resolution

Return to a relevant development after elapsed time without narrating a dramatic intervention.

Observe:

- a stable outcome is accepted when evidence does not justify change
- a resolution/change is accepted only when the existing causality/evidence supports it
- `lastChangedMessage` does not advance for a genuinely stable evaluation

### L09. Lore possibility trap

Add or retrieve lore saying an event historically/usually/can occur, while the current narration does not establish that event.

Observe:

- lore remains baseline/context only
- the possible event does not become current World State

### L10. Swipe / edit / delete rollback

Create a branch where an assistant message establishes a world change, then swipe or edit/delete that source so the surviving branch no longer establishes it.

Observe:

- in-flight Alpha provider work is cancelled/staled
- exact branch reconciliation removes abandoned-branch world state
- if the exact parent cannot be proven, the extension fails closed instead of guessing

### L10.1 Passive/multi-message semantic rewrite hardening

Use a chat with several assistant replies containing non-canonical planning blocks such as `<writer_state>`. Allow the host/Regex/reasoning pipeline to normalize or strip those blocks from one or more already-owned assistant messages, including an older message that is no longer the latest capture. Then cause a later exact reconciliation through ordinary continued play or an edit-event path.

Observe:

- visible/canonical narration is unchanged
- one or several narration-equivalent assistant raw rewrites emit passive/semantic lineage rebase diagnostics rather than rollback-journal
- the current Reality record count does not fall because of presentation-only cleanup
- after reload, the same behavior remains safe because lineage narration fingerprints are durable
- upgrading a clean Alpha.17 sidecar persists semantic lineage metadata without changing current world truth
- if an already-diverged legacy non-user lineage cannot be semantically proven, Alpha enters recovery-required state and preserves records instead of rolling them back
- a genuinely semantic assistant edit still performs exact branch rollback

### L11. Storage and reload

Create several records, note the panel state, then reload the browser or switch away and back.

Observe:

- the owner-qualified chat hydrates the same sidecar
- current state and revision/checksum survive reload
- a missing/corrupt pointed sidecar is not silently replaced with an empty one

### L12. Manual data operations

Exercise export, import, reset, and rebuild separately.

Observe:

- destructive operations require explicit confirmation
- expand one active Reality record and verify **Mark resolved** and **Mark superseded** are available; historical records expose neither button
- either manual history action requires a non-empty operator reason and a final confirmation, then immediately moves the record out of Current while retaining it under Resolved/Superseded with Manual correction evidence
- navigate or allow another write to change the selected row before committing and verify a stale row action is rejected rather than targeting a different canonical record
- import/reset publish only after durable persistence
- rebuild is never automatic
- rebuild from chat recovers materially persistent narrated off-screen developments even when later scenes never revisit them
- if an earlier reconstructed active development is explicitly ended/completed/eliminated/replaced by later narration, the rebuilt final state moves it to Resolved/Superseded instead of leaving it active
- a short implicit follow-up ending such as `the last two collapse` may close a recently reconstructed development when the shown lifecycle candidate plus current exchange make the ending grounded; mere disappearance/escape/uncertainty must remain active
- with **Include hidden chat messages** enabled, deliberately hidden user/assistant RP can be reconstructed without visibly unhiding the messages, saving the chat, or changing their hidden state afterward
- hidden tool/system/UI rows remain excluded even when hidden-message scanning is enabled
- disabling the option excludes both hidden user and hidden assistant rows
- rebuild does not replay hidden background evolution between narrated boundaries
- failed/stale rebuild leaves the prior canonical state unchanged

### L13. Desktop / tablet / mobile UI

Open the World State panel at representative desktop (>=1100 px), tablet landscape (768-1099 px), tablet portrait (<768 px), and mobile (<600 px) widths.

Observe:

- desktop Reality views use flat disclosure rows without nested-card clutter; expanding any record reveals anchors, timeline, evidence and connections inline
- tablet landscape keeps an adaptive split; tablet portrait uses list -> detail navigation rather than squeezed columns
- mobile exposes Current / Places / Ops / More bottom navigation and a full-height rebuild sheet
- record disclosures, Places detail, and Operations JSON viewers scroll internally without page-wide horizontal overflow
- ordinary views hide raw backend IDs/lineage/prompts/headers/reasoning/credentials; only explicit Operations expansion shows bounded escaped model response/rejection content
- touch controls remain >=44 px and safe-area padding works on phone layouts

Record screenshots/notes at each width; do not infer this PASS from CSS unit tests.

### L14. NPC State Delta co-install

Run the same chat with NPC State Delta installed.

Observe:

- settings, prompt keys, DOM, globals, sidecars, and diagnostics remain independent
- Alpha does not read or mutate Delta dossier state
- both extensions can process the same RP exchange without corrupting each other

The deterministic compatibility fixture is pinned to Delta 1.0.35. If testing another Delta version, record that version explicitly.

### L15. Ukiyo / Megumin / story-prompt non-interference

Enable the story-driving extension(s) normally used for RP.

Observe:

- their settings/prompt markers remain unchanged
- World State does not mutate or inherit their private story-driving instructions
- captured evidence comes from allowed narrative/current-world sources, not hidden story planning

### L16. Live request and latency measurements

Across at least ten representative exchanges, record:

- RP TTFT baseline with World State disabled
- RP TTFT with World State enabled
- capture provider call count and duration
- evolution provider call count and duration when triggered
- local retrieval/injection duration if instrumented
- injection token estimate/size
- sidecar size after the run

Do not use a predetermined PASS threshold for TTFT or provider latency in this first acceptance run. Report the measured delta and any visible interaction impact. Synthetic repository wall times are not substitutes for these live numbers.

### L17. Spatial base-map import

Enable Spatial Continuity and import the supplied `Ternia_Map_Registry_v0.9.10_Runtime_Retrieval_Acceptance_Hardening.json`.

Observe:

- the source file remains unchanged
- the Spatial panel reports the Ternia profile and base-map version
- known base anchors appear with canonical coordinates
- North = +Y and East = +X; scale is 5 km/unit
- base locations are read-only until Create Campaign Override
- reloading the chat restores the same base-map reference without reparsing/scanning it every turn

### L18. Generated-place continuity and manual editing

In narration, establish a durable named local place not present in the base registry, for example a named inn/ford/camp near an established anchor.

Observe:

- it is captured once as campaign Spatial state
- vague relative placement remains relative/unknown rather than receiving fabricated X/Y
- a grounded straight-line distance may deterministically derive coordinates
- a route/travel distance alone does not derive Cartesian displacement
- revisit the place after several exchanges and verify its coordinate/relative relation does not drift
- use the Spatial panel to edit name/type/context/authority/lock/relative relation/route association
- archive, merge duplicate, and create a campaign override in separate checks

### L19. Writer-state Spatial firewall

Use an RP response where `<writer_state>...</writer_state>` plans a location/route that the visible narration does not establish.

Observe:

- raw chat still contains the writer_state block
- branch/swipe ownership still fingerprints the raw message
- Reality Core and Spatial capture do not persist the planned location/route
- a subsequent visible narration establishing the same place may persist it normally
- explicit rebuild behaves the same way

### L20. Spatial branch rollback and campaign isolation

Campaign A: generate a named place, then swipe/edit/delete the source message.
Campaign B: use the same base Ternia map but establish a different local place, including optionally the same generated name.

Observe:

- Campaign A rolls Spatial state back with the exact branch
- stale provider completion cannot re-add the abandoned place
- Campaign B has its own generated Spatial state/IDs
- neither campaign modifies the shared base source or leaks generated places into the other

### L21. Megumin / World_State spatial continuity

With Megumin Suite/Ukiyo enabled normally, enter/revisit a generated or overridden location.

Observe:

- World State Alpha injects only a compact relevant Spatial block, not the whole map
- Megumin settings/prompts remain untouched
- Megumin `Loc: [Place | Region | coordinate]` may consume the continuity naturally through the RP prompt
- established coordinate/orientation does not drift across later scenes
- PC narration does not gain remote/private geography merely because Alpha stores it

### L22. Persistent off-screen capture completeness

Use one assistant response that establishes at least two independent current conditions:

1. an ongoing condition the PC sees but deliberately leaves unresolved, such as market carters extorting traders in town
2. a separate PC-adjacent condition in the destination scene, such as a concealed animal sounder/hazard

Then move the PC away from the first condition.

Observe:

- the capture request remains one provider call
- the persistent ignored condition is admitted as its own active `development`
- the destination fact/development may also be captured in the same response
- the ignored development remains stored after the PC leaves even when it is no longer injected into the unrelated current scene
- PC proximity, current objective, or intervention are not used as reasons to omit the established condition
- notice-board jobs, planted seeds, CYOA options, inner chatter, inventory/skill blocks, or mere plans do not become Reality records unless visible narration separately establishes their underlying condition
- no off-screen event that was absent from narration is invented

This is the primary live acceptance case for 0.9.0-alpha.5.

### L23. Alpha.7 audit hardening

Run these focused live checks against 0.9.0-alpha.7:

- force a rebuild provider timeout/cancel on the first and a later chunk; the prior canonical state must remain intact and the UI must not report success
- trigger a deep edit/swipe for which exact rollback proof is unavailable; retained recovery state may remain inspectable, but neither Reality nor Spatial abandoned-state continuity may reach the RP prompt
- place `Five weeks later` only in writer/timer/planning text and separately say `I will return next week`; neither case may trigger catch-up, while explicit narrated passage such as `Five weeks later, the caravan returns` may
- with a locked/base location attached, narrate a conflicting coordinate during rebuild; provider narration must not shadow the base location
- disable Spatial, run a Reality rebuild, then re-enable Spatial; the saved profile, base attachment and campaign locations must still exist
- use the exact Applecross Culvert `World_State` header with `[31.4, 163.6]`; successful model output that omits the coordinate or returns `spatialMutations:[]` must still recover one Applecross Culvert at that coordinate through the normal Spatial reducer
- narrate two unknown-coordinate places without direction/distance, while the provider proposes an exact relation; unsupported precision must not be stored
- run with deliberately slow background catch-up and compare user-send/RP preparation timing; `MESSAGE_SENT` must not remain open for provider latency, and the later result must appear only after serialized durable commit

Record provider/model, timeout configuration, actual RP TTFT/request timing, and whether the recovered Applecross location survives reload/rollback. Deterministic tests establish the contract; this case remains the live SillyTavern/browser/provider acceptance boundary.

### L24. Alpha.8 live rebuild interoperability

Using the same provider/model that produced the live rebuild failure, reset a populated chat and run Rebuild from Chat. Verify:

- a raw OpenAI-compatible provider envelope is reduced to `choices[0].message.content`; `reasoning_content` does not enter the capture parser
- the rebuild immediately shows a started notification with the number of assistant boundaries
- a provider response using `category:"development"` and `description:"..."` is repaired to canonical `kind`/`summary`, but conflicting canonical/alias values fail closed
- Current repopulates after full success
- Brackenford, North Road, Northgate Stockyard, and Applecross Culvert can repopulate from the demonstrated live payload
- unsupported optional relative metadata does not erase an otherwise grounded named place
- Diagnostics retains per-boundary rebuild rows plus a final rebuild summary with safe failure/success detail, alias repair count, and processed/total boundaries
- success notification reports boundary progress and resulting Current/Places counts; failure notification reports the failed message boundary and safe bounded reason
- reload confirms the rebuilt state was persisted durably

### L25. Alpha.9 fenced final rebuild response

Run a five-boundary rebuild where the first four provider replies are bare JSON and the fifth reply is the same single JSON object wrapped in a `json` Markdown code fence.

Pass criteria:

- exactly five provider requests are made
- all five boundaries are reported in rebuild diagnostics
- the fifth response is parsed without a correction retry
- the rebuild completes rather than atomically reverting the first four boundaries
- Current and Places reflect the full five-boundary chronology after durable persistence
- adding any prose before or after the fence still fails closed and leaves prior canonical state unchanged

### L26. Alpha.10 structured completeness checklist

Use the Brackenford scene containing visible market shakedown prose plus `<World_State>` `Off-Screen` and `Unresolved Threads` entries for the same extortion. Run Reset -> Rebuild from Chat with the normal Gemini profile.

Pass criteria:

- the rebuild request contains a bounded structured current-state completeness checklist
- the checklist contains the extortion current-state entry even in a long assistant message
- Planted Seeds, Consequence Timers, Arc/Scene Phase, CYOA, inner chatter, writer planning, and inventory/skill state are not promoted into that checklist
- the provider proposes the ongoing extortion as a `development` unless an equivalent visible current record already exists
- the ordinary source firewall still requires grounded narration/World_State evidence before admission
- Diagnostics shows a nonzero `State checklist` count for the affected rebuild boundary
- Current retains the extortion development after the later boar-only boundaries complete

### L27. Alpha.11 responsive Operations and rebuild controls

Use a chat with existing canonical state plus enough history for multiple rebuild boundaries.

Pass criteria:

- Rebuild works over the existing state without running Clear first; canonical state remains visible/authoritative until successful persistence
- Full chat rebuild is available after Reset
- Last N / From message succeeds only when exact canonical prefix history is provable; after Reset a nonzero start fails before any provider call with an explicit Full-chat instruction
- maximum assistant-boundary input can be raised above the default up to the hard 4096 ceiling
- progress visibly updates boundary/current/place/provider counts while the rebuild is running
- Cancel aborts the active provider request promptly rather than waiting behind the rebuild queue, and failed/cancelled rebuild leaves canonical state unchanged
- Operations lists newest entries first and each capture/rebuild/evolution row can expand bounded response/rejection content
- model response inspection never includes provider transport headers, `reasoning_content`, session IDs, prompts, story transcript, API keys or credentials
- Data separates Export/Import, Recovery/Rebuild, and a visible Danger zone for Clear World State
- desktop/tablet/mobile layouts satisfy L13

### L28. Alpha.12 flat disclosure workspace

Open Current, Recent, Resolved, Operations, and Data on desktop/tablet/mobile.

Pass criteria:

- header shows the continuity icon + `World continuity` title and no `World State Alpha` eyebrow
- each Reality record expands inline to anchors, timeline, evidence, connections, and change reason without opening a separate nested detail card
- collapsed records do not render hidden evidence/detail content until expanded
- Operations rows remain expandable and expose bounded model response/rejection JSON with copy controls
- rebuild status appears as a floating toast that does not shift the tab row or body layout and can be dismissed independently of cancelling a running rebuild
- mobile rebuild toast sits above bottom navigation rather than covering it
- scrollbar arrow buttons are absent while list/body/code scrolling remains functional
- Data/maintenance sections use flatter separators and no nested dashboard-card stack

## 3. Contractual bounds to verify live

These are behavioral ceilings, not latency predictions:

- at most one automatic capture model call per eligible completed assistant exchange
- zero evolution model calls on an ordinary relevant turn without an evolution trigger
- at most one batched automatic evolution call when triggered
- at most six automatic evolution targets in that batch, with at most four relevant-priority targets and at most three background-fill targets
- private injection remains within the configured hard budget, default 800 local token units
- rebuild is explicit only
- Spatial disabled adds zero Spatial injection and no second automatic capture call
- Spatial enabled still uses at most the existing one automatic capture call per eligible completed assistant exchange
- normal Spatial retrieval is bounded and does not dump/scan the complete map
- provider-backed catch-up does not hold awaited MESSAGE_SENT preparation open; its result is eligible only after serialized durable commit

## 4. Results template

```text
World State Alpha live acceptance
Build/commit:
World State Alpha version:
SillyTavern version:
Browser / OS:
Primary RP route/model:
World State Connection Profile:
NPC State Delta version:
Other story extensions:
Web Locks available: yes/no

L01 Default host route: PASS / FAIL / NOT RUN
L02 Connection Profile: PASS / FAIL / NOT RUN
L03 No-change exchange: PASS / FAIL / NOT RUN
L04 Direct established fact: PASS / FAIL / NOT RUN
L05 Duplicate consolidation: PASS / FAIL / NOT RUN
L06 Relevant five-week catch-up: PASS / FAIL / NOT RUN
L07 Quiet unrelated time skip: PASS / FAIL / NOT RUN
L08 Quiet relevant stability/resolution: PASS / FAIL / NOT RUN
L09 Lore possibility trap: PASS / FAIL / NOT RUN
L10 Swipe/edit/delete rollback: PASS / FAIL / NOT RUN
L11 Storage/reload: PASS / FAIL / NOT RUN
L12 Manual data operations: PASS / FAIL / NOT RUN
L13 Desktop/tablet/mobile UI: PASS / FAIL / NOT RUN
L14 NPC State Delta co-install: PASS / FAIL / NOT RUN
L15 Story-prompt non-interference: PASS / FAIL / NOT RUN
L16 Live latency/request measurements: PASS / FAIL / NOT RUN
L17 Spatial base-map import: PASS / FAIL / NOT RUN
L18 Generated-place continuity/manual editing: PASS / FAIL / NOT RUN
L19 Writer-state Spatial firewall: PASS / FAIL / NOT RUN
L20 Spatial branch rollback/campaign isolation: PASS / FAIL / NOT RUN
L21 Megumin World_State spatial continuity: PASS / FAIL / NOT RUN
L22 Persistent off-screen capture completeness: PASS / FAIL / NOT RUN
L23 Alpha.7 audit hardening: PASS / FAIL / NOT RUN
L24 Alpha.8 live rebuild interoperability: PASS / FAIL / NOT RUN
L25 Alpha.9 fenced final rebuild response: PASS / FAIL / NOT RUN
L26 Alpha.10 structured completeness checklist: PASS / FAIL / NOT RUN
L27 Alpha.11 responsive Operations/rebuild controls: PASS / FAIL / NOT RUN
L28 Alpha.12 flat disclosure workspace: PASS / FAIL / NOT RUN

Measured:
RP TTFT baseline:
RP TTFT with Alpha:
TTFT delta:
Capture calls / average / p95 duration:
Evolution calls / average / p95 duration:
Injection size/tokens:
Local retrieval/injection time:
Sidecar bytes:
Spatial enabled: yes/no
Base map / version:
Spatial locations (base/campaign):
Spatial injection size/tokens:
Spatial capture calls added beyond normal capture:

Failures / observations:
```
