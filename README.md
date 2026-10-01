# World State Alpha

**A SillyTavern extension that remembers what is currently true in your story's wider world, and quietly reminds the model about it.**

Long roleplays forget things. The bridge you burned is standing again twenty messages later, the town you left under siege is suddenly calm, and the rumour you started never spreads. World State Alpha watches each reply, records the world-level changes the story actually established, keeps them in step with swipes and edits, and slips a small private note into the prompt so the model keeps the world consistent.

It is the world-level sibling of [NPC State Delta](https://github.com/kohz87/npc_state_delta):

| Extension | Answers |
|---|---|
| NPC State Delta | "What is true about *this character* right now?" |
| **World State Alpha** | "What is true about *the wider world* right now?" |

> **Status:** `0.9.0-alpha.43`, an alpha. Every feature below is implemented and covered by an automated test and validation suite, but automated tests use a simulated SillyTavern and mocked models. How well capture works with *your* model is only proven by playing. Requires SillyTavern **1.18.0+**. Licensed **GPL-3.0**.

---

## Contents

- [What it does, by example](#what-it-does-by-example)
- [Features](#features)
- [Install](#install)
- [Quick start](#quick-start)
- [Settings](#settings)
- [The World State panel](#the-world-state-panel)
- [How time moves the world](#how-time-moves-the-world)
- [Places (optional)](#places-optional)
- [Tips for better capture](#tips-for-better-capture)
- [Model calls, cost and privacy](#model-calls-cost-and-privacy)
- [Troubleshooting](#troubleshooting)
- [Limits and non-goals](#limits-and-non-goals)
- [For developers](#for-developers)

---

## What it does, by example

Your party passes through Farwick. The narrator writes that three armed men "claiming ditch-watch authority" are shaking down an alley vendor while villagers keep their heads down.

1. **After the reply, capture runs.** One background model call reads *only that exchange* and records something like:
   > *Development (emerging):* Armed men claiming ditch-watch authority are demanding a raised "ditch tax" from alley vendors; villagers avoid the lane.
2. **You leave town and travel for days.** The record stays active. It is still happening, off-screen.
3. **Story time passes.** Once the narration shows at least two days passing ("Three days later…", or "The next morning…" followed by "The following day…"), a bounded catch-up re-checks a few off-scene developments. Usually the answer is *stable*. Change needs grounded earlier evidence, never drama for its own sake.
4. **You return to Farwick.** The record is relevant again, so it goes into the private note and the model narrates a world where the shakedown is still going on, or has ended if the story established that.

Swipe, edit or delete that original reply, and the record goes away with it.

---

## Features

### World tracking
- **Automatic capture** after every assistant reply. One model call per reply, reading only that exchange (your message plus the reply), never the whole chat.
- **Two kinds of record:** *facts* (presently true: "the Northglass bridge is destroyed") and *developments* (ongoing and able to change, each with a trend: emerging, rising, stable, falling or uncertain).
- **Full lifecycle:** records are created, updated, resolved and superseded, linked as cause and effect, and each carries quoted evidence from the chat.
- **Conservative by design:**
  - Fleeting scenery, plans, options, inner monologue and one-off transactions are ignored.
  - Off-screen situations that keep going *are* captured, and so are ongoing arrangements shown through one incident (extortion, tolls, curfews, blockades).
- **A fact-check firewall** checks every model answer against the chat text:
  - Claims made only in dialogue stay attributed: "men *claiming* to be the watch demand…", never "the tax was raised".
  - Rumours are stored as rumours.
  - Lore is treated as background possibility, never as proof that something happened.

### Keeping the model consistent
- **A small private note** is injected each turn (default ≤ 800 tokens, ≤ 6 records) containing only the records relevant to the current scene. It is picked locally and fast, with no extra model call.
- **It is labelled as private world context, not character knowledge.** The model is told a character only knows remote facts if there's a plausible way for the information to reach them.

### Time and off-screen change
- **Only story time moves the world**, never the real-world clock or message count.
- **Explicit skips** ("two days later", "after three weeks") and **day-by-day narration** ("The next morning…" then "The following day…") both count once they reach **2 days**.
- **Bounded catch-up:** up to 4 in-scene and 3 off-scene developments, **one model call**, and "nothing changed" is a normal answer. See [How time moves the world](#how-time-moves-the-world).

### Places (optional, off by default)
- Remembers places the story establishes, with coordinates and how trustworthy each position is, plus routes and relative positions.
- Optional **read-only base map** import. Your campaign edits never modify the map file.
- Duplicate hints, one-click merge suggestions, and sub-places nested under their parent place in the list.

### Safe with swipes, edits and branches
- Swipe, regenerate, edit, delete and branch all **roll the world back** to match. No state from abandoned branches is left behind.
- **Swipe back freely:** returning to a reply you already had brings back exactly what it established, with no new model call. Settling on an older swipe that was never captured, or editing the latest reply, captures it after a short pause.
- **Delete and regenerate:** the deleted reply's changes are rolled back before the new reply is written, so the regenerated reply still gets World State and is captured normally.
- **Hiding messages is safe:** hiding or unhiding messages (for example `/hide 0-200` to trim context) keeps the world as it is. Hidden messages still happened in the story.
- Editing or deleting a message further back rolls the world back to that point and tells you; use **Rebuild from chat → Last messages** to recapture the later messages.
- **Fails safe:** if the state for a point in the chat can't be proven, it pauses instead of guessing.
- **One source of truth:** state lives in a per-chat file on your SillyTavern server, so desktop, phone and multiple tabs stay in sync, and an out-of-date tab can't overwrite newer data.

### Recovery and maintenance
- **Rebuild from chat:**
  - Covers the full chat, the last N messages, or starting from a given message.
  - Last N / From message need the exact state just before the start. Only the most recent 256 changes are kept, so in a long chat the rebuild sheet shows the earliest message you can start from; earlier starts need Full chat.
  - Can include hidden roleplay messages without changing the chat itself.
  - Shows progress and can be cancelled.
  - If one message fails (for example the model returns broken JSON), **Resume from message N** re-sends just that message and continues, instead of redoing the whole rebuild. It works as long as the chat and World State haven't changed since the failure.
  - The current state is only replaced after the whole rebuild succeeds.
  - **Missed captures:** if a live capture failed (timeout, provider error, broken JSON), the World view shows it with **Recapture from message N**. That runs a From-message rebuild starting at the earliest failed message, after a confirmation that says how many replies it will re-read. It never runs by itself.
- **Export / import** World State bundles, with a preview and confirmation.
- **Manual lifecycle:** mark any record resolved or superseded, with a note explaining why.
  - **Bulk:** use **Select records** on the World panel to tick many active records (or **Select all shown**, up to 100) and mark them resolved or superseded in one step with a single note. It is all-or-nothing, and one rollback undoes it.

### Interface
- **A World / Places panel** with grouped, colour-coded records, search, an Operations log and data tools. Works on desktop, tablet and phone.
- **An optional floating button** that you can drag anywhere and that remembers its spot per device.

---

## Install

**From SillyTavern (recommended)**
1. Open **Extensions** (the stacked-blocks icon) → **Install extension**.
2. Paste `https://github.com/kohz87/world_state_alpha` and install.
3. Reload SillyTavern.

**Manually**
```bash
cd SillyTavern/data/<your-user>/extensions   # or public/scripts/extensions/third-party
git clone https://github.com/kohz87/world_state_alpha
```
Then reload SillyTavern.

To update, use **Extensions → Manage extensions → Update**, or `git pull` in that folder.

It has no dependencies and works with or without NPC State Delta installed.

---

## Quick start

1. **Open a chat.** World State is per chat.
2. Check **Extensions → World State Alpha**: *Enable*, *Capture* and *Inject* are on by default.
3. *(Optional)* choose a **Connection profile** so World State's own calls use a different, cheaper or faster model than your roleplay.
4. **Play normally.** After each reply, new records appear in the panel (floating round button, bottom-left; or **Open World State** in settings).
5. **Joining an existing long chat?** World State will ask for a **Full rebuild** rather than silently starting from scratch. Use **⋯ → Rebuild from chat…**.

---

## Settings

| Setting | Default | What it does |
|---|---|---|
| Enable World State Alpha | on | Master switch. Off stops capture, injection and the floating button. |
| Capture established world changes | on | Runs capture after each assistant reply. |
| Inject private world continuity | on | Adds the private note to prompts. Also required for time-based catch-up. |
| Injection depth | 1 | Chat depth of the note (0–20). |
| Injection budget | 800 | Maximum size of the note, in estimated tokens. |
| Connection profile | *(main API)* | Optional SillyTavern Connection Profile for World State's calls. If the chosen profile is missing, it fails with a clear error and never quietly falls back to another model. |
| Enable Spatial Continuity | off | Turns on Places. |
| Inject spatial continuity | on | Adds relevant places to the note (when Places is enabled). |
| Spatial injection budget | 500 | Size limit for the places part of the note. |
| Show floating World State button | on | The draggable round button that opens the panel. |

---

## The World State panel

**World tab**
- **Filters:** *Active*, *Recently changed* and *Resolved*.
- **Active groups:** *Changed recently*, *Ongoing* and *Facts*.
- **Each row** shows a trend colour, the people and places involved, and how many messages ago it changed.
- **Click a row** to expand its state, story time, timeline, connections, quoted evidence and **Mark resolved / superseded** actions.

**Places tab** *(with Spatial on)*
- **Read view first:** position (with lock), connections, routes, and the records that mention the place.
- **Edit** switches to the editor.
- **Also here:** duplicate review and merge, and **Map settings** for the base map and coordinate profile.

**⋯ menu**
- **Rebuild from chat…**
- **Operations:** a log of every capture, catch-up and rebuild, including the model's answer and anything rejected, with the reason. It never shows prompts, reasoning or credentials.
- **Data & maintenance:** export, import and reset.
- **Map settings**

**Search** covers summaries and names across current and past records.

---

## How time moves the world

World State is **not a simulator**. Nothing changes on a timer, and nothing is invented to keep the world busy. Off-screen situations change only when the **story** shows time passing.

**What counts as time passing** (checked when you send a message):
- An explicit skip of **2 days or more**: "Three days later…", "after two weeks", "a month passed", "the following season".
- **Day-by-day narration that adds up:** "The next morning…", then later "The following day…". At most one day counts per exchange, and it triggers at 2 days.

**What doesn't count:**
- a few hours, or a single "next day";
- time inside dialogue ("she said it'll take a week");
- plans and hypotheticals ("we will leave the next morning", "if a week passes…");
- hidden messages and hidden planning blocks.

**What happens then** (one model call at most):
- Up to **4 relevant** and **3 off-scene** developments are re-checked.
- Each one comes back **stable** (the most common answer), **updated**, **resolved** or **superseded**.
- A change needs **both** the time skip **and** that development's own earlier evidence pointing that way. Time alone is never proof.
- At most one new development can be derived, and only from existing causes.

Your character hunting in the woods doesn't pause the extortion back in town. The record stays active, meaning it is still happening; it just isn't advanced without a time skip or new story evidence. When you return, or the story mentions it, it's picked up again.

---

## Places (optional)

Enable **Spatial Continuity** in settings.

- **Capture** records named, persistent places the story establishes, along with explicit positions and relations ("the ford, two miles south of Farwick").
- **Coordinates are never invented.** Positions come only from the map, from you, from exact numbers in the narration, or from calculation with a configured profile.
- **Coordinate profile** (Map settings): which axis is north, the km-per-unit scale, bounds and precision. With no profile, nothing is assumed.
- **Base map:** import a JSON file. It stays read-only, and campaign changes become per-chat overrides. Minimal shape:

```json
{
  "id": "my-realm",
  "name": "My Realm",
  "version": "1",
  "profile": { "system": "cartesian2d", "northAxis": "+y", "eastAxis": "+x", "unitKm": 5 },
  "locations": [
    { "id": "farwick", "name": "Farwick", "type": "town", "coordinate": { "x": -198, "y": 188 }, "context": "Frontier settlement.", "routeRefs": ["North Road"] }
  ],
  "routes": []
}
```

A fuller example is in [`tests/fixtures/cartesian-base-map-sample.json`](tests/fixtures/cartesian-base-map-sample.json).

---

## Tips for better capture

- **State time skips plainly.** "Three days later…" or "The next morning…" are recognised; purely implied time ("by the time the snow melted") is not.
- **Let the narration show lasting situations.** "Villagers avoid the alley" establishes an ongoing arrangement better than a single line of dialogue.
- **Narrator `<World_State>` block (optional).** If your narrator or preset writes an *Off-Screen* / *Unresolved* section, capture uses it as an advisory checklist so quieter ongoing situations aren't missed.
- **Missed something?** Check **⋯ → Operations** for that message:
  - **no mutations** means the model skipped it;
  - **rejected: source-firewall** means it stated a claim as fact.

  Then **Rebuild** with *Last N messages* to re-capture that stretch.

---

## Model calls, cost and privacy

| When | Calls |
|---|---|
| After each assistant reply | **1** capture call. It reads only that exchange; the prompt is about 1.9k tokens plus the exchange, or about 2.2k with Places. |
| When you send a message and story time has passed | **0 or 1** catch-up call, covering at most 6 developments |
| Ordinary turns | **0** extra calls for the note itself; relevance is picked locally |
| Rebuild | Only when you start it: one call per assistant reply rebuilt |

- **Which model:** calls go to your main API or the Connection Profile you choose. World State never changes your roleplay connection settings.
- **Where data lives:** state is stored as per-chat files in your SillyTavern user files (`world-state-alpha-*`). Nothing is sent anywhere else, and there is no telemetry.
- **What's logged:** the Operations log holds a bounded, sanitised summary of the last 80 operations per chat. It is saved on your SillyTavern server next to the state (`world-state-alpha-ops-*`), so it survives reloads and follows you across devices. It never records prompts, hidden reasoning, headers or credentials.

---

## Troubleshooting

| Symptom | Try |
|---|---|
| Nothing is being captured | Check *Enable* and *Capture* are on, then look at **⋯ → Operations**. A provider error or a missing connection profile shows up there. |
| "Durable World State not found" | The chat has history but no saved World State on this server. Use **Full rebuild**, or import a bundle. |
| An event was missed | See [Tips](#tips-for-better-capture), then **Rebuild → Last N messages**. |
| A merged or archived place still appears | Update to 0.9.0-alpha.29 or later. Archived places are hidden, and the list shows how many. |
| No floating button on phone/tablet | Update to 0.9.0-alpha.31 or later, and check *Show floating World State button*. It starts on the left edge. |
| The panel looks stale on another device | It refreshes at your next message or when you reopen the panel. The server copy is always authoritative. |

For a debugging snapshot, run `WorldStateAlpha` in the browser console. It is a read-only object.

---

## Limits and non-goals

- **Not a story director.** It never adds plot, drama, quests, escalation or pacing, and never moves the world for its own sake.
- **Not a map engine, calendar, economy, news or NPC simulator**, and not a replacement for lorebooks, memory extensions, NPC State Delta or your preset's reasoning.
- **Person details belong to NPC State.** World State records only world-significant facts about people (a death, an appointment, a defection), never personality, mood, appearance or relationships.
- **English-oriented time detection.** Time-skip and day-step phrases are recognised in English.
- **Alpha software.** Test suites don't prove how a particular model captures; review the Operations log if something looks off.

---

## For developers

**Requirements:** Node.js ≥ 24 for the scripts (the extension itself runs in the browser).

```bash
npm test                 # unit/integration suite
npm run validate         # design + phase 1–9 invariant validators
npm run measure:prompts  # prompt size / retrieval measurements
npm run package          # reproducible release zip + manifest in dist/
```

**Design documents**, in reading order:
1. [`AGENTS.md`](AGENTS.md): rules for contributors and coding agents
2. [`docs/core-contract.md`](docs/core-contract.md): the behaviour authority
3. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): module layout and data flow
4. [`WORKFLOW.md`](WORKFLOW.md), [`docs/WORKPLAN.md`](docs/WORKPLAN.md): process and phase history
5. [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md), [`docs/TEST_PLAN.md`](docs/TEST_PLAN.md), [`docs/RISK_REGISTER.md`](docs/RISK_REGISTER.md), [`docs/LIVE_ACCEPTANCE.md`](docs/LIVE_ACCEPTANCE.md)

Release notes are in [`CHANGELOG.md`](CHANGELOG.md).

**Core shape**
- **Records:** one generic schema with two kinds, `fact` and `development`. Historical events are evidence and provenance, not a third record kind.
- **Places:** a separate optional `spatial` namespace, never mixed into `records[]`.
- **Storage formats:** the canonical schema is version 2; the sidecar, bundle and rollback-journal envelopes are version 1. Application version bumps don't change stored formats.

**Authority boundary**

| Source | Role |
|---|---|
| Lorebook | static canon and possibilities, never rewritten by World State |
| **World State Alpha** | current dynamic world reality |
| NPC State Delta | detailed individual NPC continuity |
| Chat history / memory | historical narrative evidence |
| RP model / preset | scene reasoning and prose |

**Reference.** The design borrows architectural lessons from NPC State Delta (pinned at commit `d20bf1dd03f85fe32ab11abb0363ec32eaa66d03`, release `1.0.35`). There is no runtime dependency, and it never reads or writes Delta's data.

## License

[GPL-3.0](LICENSE)
