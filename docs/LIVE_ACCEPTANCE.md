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
- no more than four targets are evaluated
- the result is grounded in accepted evidence and may validly remain stable
- elapsed time alone does not force a changed outcome

Record actual evolution latency and outcome.

### L07. Quiet unrelated time skip

With an existing development elsewhere, narrate a meaningful time skip in an unrelated scene.

Observe:

- unrelated dormant records are not evolved simply because time passed
- no off-screen change is invented to make the world busier

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
- import/reset publish only after durable persistence
- rebuild is never automatic
- failed/stale rebuild leaves the prior canonical state unchanged

### L13. Desktop and mobile UI

Open the World State panel at desktop width and at <=700 px mobile width.

Observe:

- all primary tabs remain usable
- details/evidence stay bounded
- raw backend IDs/lineage/credentials/provider payloads are not ordinary UI output
- touch targets and scrolling remain practical

Record screenshots/notes if useful; do not infer this PASS from CSS unit tests.

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

## 3. Contractual bounds to verify live

These are behavioral ceilings, not latency predictions:

- at most one automatic capture model call per eligible completed assistant exchange
- zero evolution model calls on an ordinary relevant turn without an evolution trigger
- at most one batched automatic evolution call when triggered
- at most four automatic evolution targets in that batch
- private injection remains within the configured hard budget, default 800 local token units
- rebuild is explicit only
- Spatial disabled adds zero Spatial injection and no second automatic capture call
- Spatial enabled still uses at most the existing one automatic capture call per eligible completed assistant exchange
- normal Spatial retrieval is bounded and does not dump/scan the complete map

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
L13 Desktop/mobile UI: PASS / FAIL / NOT RUN
L14 NPC State Delta co-install: PASS / FAIL / NOT RUN
L15 Story-prompt non-interference: PASS / FAIL / NOT RUN
L16 Live latency/request measurements: PASS / FAIL / NOT RUN
L17 Spatial base-map import: PASS / FAIL / NOT RUN
L18 Generated-place continuity/manual editing: PASS / FAIL / NOT RUN
L19 Writer-state Spatial firewall: PASS / FAIL / NOT RUN
L20 Spatial branch rollback/campaign isolation: PASS / FAIL / NOT RUN
L21 Megumin World_State spatial continuity: PASS / FAIL / NOT RUN

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
