# Changelog

## 0.9.0-alpha.65 - Shared helpers and bounded per-turn work (deep pass on alpha.60)

### Fixed

- **Time passing**
  - A title or initial ("Mt.", "Lt.", "Capt.") no longer ends the sentence a time skip is judged in, so "If the scouts reach Mt. Ember, two days later we march." stays a condition instead of counting as two days passed.
- **Cleanups**
  - Helpers that had drifted into several modules now live once: bounded text, the message role and the role of a hidden row, keyed undo, token budgets, index postings, the connection-profile lookup, the evaluation boundary, the continuity icon, the list of known chats, the rebuild finish and the exchange budget.
  - Unused code is gone: the rebuild lore option, an unread link counter, a dead branch check, a duplicate failure list in the panel model and dead Places branches. Defaults are safe: a branch reconcile saves its restore unless told otherwise.
  - A save conflict is recovered once, and only a retryable error is retried.
- **Performance**
  - Capture judges every row of a response on one sanitized exchange, and pairs each text's quotes once.
  - The day-step walk judges each message text once instead of re-reading 40 messages every turn.
  - The chat guard around a save compares one chained key instead of rebuilding and comparing the chat's lineage three times.
  - A checkpoint snapshot, an export and the panel no longer normalize the state twice; panel and manual reads read it in place.
  - Rebuild reuses its plan's lineage, copies no message deeply, copies no chat prefix or Places per boundary, and checks direct address only for developments it shows.
  - The Places list (with its duplicate hints) is rebuilt only when places change, the relevance index scans the evidence once, the True North check reads only places that changed, and Places index no function words.

### Architecture

- New contract section C26 (shared helpers and bounded per-turn work). `common.js` gains `visibleRole`, `tokenBudget`, `singleLine`, `boundedInt`, `addPosting`/`deletePosting` and `keyedUndo`/`restoreKeyed`; `source-firewall.js` exports `endsSentenceAt` and `createCaptureFirewallContext`; `branch.js` exports `chatHeadKey` and `reconcileBranch` accepts a known lineage.
- No durable format changes: schema 2, sidecar, bundle and rollback-journal envelopes 1.

### Validation

- `tests/audit-alpha65.test.js` (14 tests). Full suite on Node 22 and Node 24, `npm run validate`, `npm run measure:prompts`, `npm run package`, `git diff --check`, and the live SillyTavern scripts.

## 0.9.0-alpha.64 - Relevance, evolution, rebuild, injection and panel (deep pass on alpha.60)

### Fixed

- **Relevance and evolution**
  - A one-word anchor or place name in a spaced script matches whole words only ("été" no longer matches "société", "Иван" no longer matches "Ивановке"). Chinese and Japanese still match inside text.
  - Function words no longer use up the anchor lookups unless the text uses them as names ("Will").
  - A due development is no longer dropped because non-due ones filled the four relevant slots.
  - A background catch-up that does not finish gives its slots back, so it is tried again later.
  - A `derived: null` list or a capitalized outcome ("Stable") no longer fails the whole evolution response.
  - An evolution that changes nothing no longer copies the state.
- **Rebuild and injection**
  - Rebuild lifecycle and history matching reads Chinese and Japanese text.
  - Any specific one-word anchor marks a record as addressed, not only when it is the record's only anchor.
  - An empty or tracker-only boundary no longer commits a no-op that pushes out a real checkpoint.
  - Background targets and rebuild ties sort the same on every device.
  - An unset injection budget uses the default instead of turning injection off.
  - A rebuild whose messages changed while it ran is reported as stale, with a clear reason, instead of "failed: completed".
- **Panel**
  - A double-click on Start Rebuild starts one rebuild.
  - Clearing Max boundaries or Last N keeps the default instead of sending 1.
  - Select mode ends when no active row remains.
  - Escape no longer acts on the hidden Places form or Map settings from another tab.
  - The rebuild sheet focuses its first control, not the backdrop.
  - Another record no longer expands on its own when the selected one leaves the view.
  - A place mention opens the right record even if the state changed.
  - Operations are listed newest first, an expanded row stays expanded, and the model's response keeps its line breaks.
  - Forfeit no longer waits behind provider calls and redraws the panel. It shows six buttons with "Show all", and a bad message id is no longer read as message 0.
  - The Missed captures notice is no longer a re-created live region.
  - Leaving a place form with unsaved edits asks first.
  - Copy falls back when the clipboard refuses and keeps focus.
  - A lost pointer capture ends a launcher drag.
  - A relation stored under an override's own id shows the place's name.
  - Panel name matching folds names like the Places core.
  - Panel search matches the start of words ("war" no longer finds "toward").

### Architecture

- No durable format change (schema 2; envelopes 1).
- Contract C23.1 is corrected (item 109). New C25 records the relevance, rebuild-matching and panel rules, including why rebuild keeps its own boundary-local matcher.
- ARCHITECTURE's "Operations newest first" now holds (item 110).

### Validation

- New `tests/audit-alpha64.test.js` (20 tests). The first 17 each fail on 0.9.0-alpha.63, and the 3 review-hardening tests fail on the pre-review code.
- Three older tests updated: Forfeit now shows six buttons before "Show all", the render call grew, and the maintenance entry now releases a rebuild request.
- `npm test` (732) passes on Node 22 and Node 24. `npm run validate`, `npm run measure:prompts` and `npm run package` pass.
- Live in SillyTavern, these behave as on alpha.63: the branch, rebuild, resume, hide, forfeit (now outside the chat queue), alpha.59 and alpha.57 Places scripts. They were run again after the review hardening.

### Code review hardening

- Korean one-word anchors and place names followed by a particle ("서울에서") still match.
- Rebuild matching counts only content character pairs, so one shared word plus common Japanese endings no longer marks a record as addressed. The exchange's pairs are read once per boundary, not once per record.
- Forfeit, now outside the chat queue, names the message as the live chat holds it, forfeits only a listed failure of that exact version, and is refused while a rebuild is requested.
- A second rebuild (Recapture and Resume included) is refused from the click while one is requested or running. Start Rebuild's own click guard covers only the start.
- A rebuild that finished over changed messages says so in its notice instead of "rebuild cancelled".
- The background-cursor give-back follows the host's rule (a run that changed nothing).
- The due plan is no longer computed twice.
- An empty boundary asks the Places timeline whether anything changed instead of serializing the state twice.
- Model text shown in Operations never ends on half an emoji.

## 0.9.0-alpha.63 - Places (deep pass on alpha.60)

### Fixed

- **Capture**
  - A base-map route is never replaced, even when the model names its id. An invented route id is dropped.
  - A direction such as "constructor" is rejected instead of failing the whole capture.
  - A campaign place the operator archived (not merged) is no longer re-created by narration.
  - A relative position is no longer computed from an anchor's old position when the same reply moves the anchor.
  - Directions are read the way the narration states them. "Millbrook lies north of Oakvale" stored as Oakvale-north-of-Millbrook is turned around (south).
  - An update to a place now needs evidence that names the place.
  - Naming a base-map place without an override changes nothing and no longer logs a rejection every turn.
  - A World_State header coordinate must be in the Loc part or a position field. "Date: (3, 12)" is no longer a position.
  - A long header line is cut on a word, so it still grounds.
  - A relative relation dropped because its place was not saved keeps the model's row number.
  - An empty `relative` placeholder no longer fails the whole capture.
- **Reducer and panel**
  - A free-text relation ("upriver") between two positioned places is kept under a locked True North, so the place save no longer fails.
  - The True North check uses where an override is now, not where it was before the reply.
  - Route names match like place names ("North-Road" is "North Road").
  - A plain upsert at a base-map place id is refused instead of creating a shadowing campaign place.
  - A relation id is honoured only between its own two places.
  - Merging into an archived place is refused.
- **Relevance, injection and base maps**
  - One word of a longer name no longer selects a place ("an old man" is not the Old Mill).
  - The Places corpus count means active places after a rebuild and after an update alike.
  - An injection line cut to fit the budget ends on a word, never inside a number or a coordinate pair (Reality and Places).
  - Base-map numeric strings count in `{x, y}` coordinates as they already did in `[x, y]`.

### Architecture

- No durable format change (schema 2; envelopes 1).
- The Reality and Places injections share one `fitLine`.
- Core contract C24 records the rules (items 105, 106 and 112 included).

### Validation

- New `tests/audit-alpha63.test.js` (26 tests). The first 20 each fail on 0.9.0-alpha.62, and the 6 review-hardening tests fail on the pre-review code.
- One older test changed: it expected the per-turn base-place rejection, which is now intentionally silent.
- `npm test` (712) passes on Node 22 and Node 24. `npm run validate`, `npm run measure:prompts` and `npm run package` pass.
- Live in SillyTavern, these behave as on alpha.62: the branch, rebuild, resume, hide, forfeit, alpha.59 (including the place save) and alpha.57 Places scripts. They were run again after the review hardening.

### Code review hardening

- A line whose only space is near its start (for example Japanese text) is cut where it is instead of being dropped from the injection.
- A relation addressed through its id from the other side keeps its own direction.
- Only a narrated coordinate that differs from the anchor's own counts as moving it. A restated or invented coordinate no longer blocks deriving a place's position from it.
- An archived duplicate gives way to a base-map place of the same name. A World_State header naming an archived place is no longer logged every turn.
- An update must be named by its evidence under the place's own name. Evidence about another place can no longer update or rename it.
- When one place name starts another ("Mill" and "Mill Town"), the longer name after "of" is the one meant.
- A position field before the Loc part of a header line counts.
- The True North check uses one per-batch index of current places instead of scanning all places, and the direction-form lookup lives once.

## 0.9.0-alpha.62 - Capture firewall, wire and elapsed time (deep pass on alpha.60)

### Fixed

- **Hearsay and plans**
  - A threat or promise cited together with what it threatens or promises ("threatened to burn the granary") is no longer stored as done. The act itself can still be recorded, and a narrated act after it ("... and then burned the granary") still counts. A demand or order stays a narrated act, so one shown demand can still establish a levy or toll.
  - Dialogue with an action beat ("the sentry shouted", "yelled", "cried", "screamed") stays attributed, like "said".
  - "The guard said nothing, ..." reports nothing.
  - In single-quoted dialogue, a plural possessive ("the soldiers' horses") no longer ends the quote when the quote closes later. A lower-case elision in mid-sentence ("drove 'em off") no longer starts one.
  - A sentence ends after a closing quote, so attribution no longer leaks into the next narrated sentence.
  - "That" counts as introducing a report only right after the reporting verb. "Said nothing, but that night the river flooded" is narration.
  - A clause that reports something of its own ("The captain announced the curfew, soldiers barred the gates") no longer makes the next clause hearsay. A frame such as "According to the scouts," still does.
  - A statement narrated once and repeated in a report or an "if" sentence is still narration.
  - "Going to the capital" is travel, not a plan.
  - A character named Will or Hope no longer keeps a summary "prospective", and "refuses" no longer keeps a promoted summary "reported".
  - A word repeated in a summary counts once toward its support.
- **Model output**
  - A supersede and its replacement create in one response both apply. Before, the create could turn into an update of the record being superseded and be lost with it.
  - More than 8 Reality mutations no longer fail the whole capture. Rows past 8 are rejected one by one, and the prompt states the cap.
  - An update that changes only the status or the related records is valid. Before, it failed the whole response.
- **Narration cleanup**
  - World_State planning sections now also end correctly at ▪ ‣ ◦ ● bullets, so planted seeds no longer leak into evidence.
  - A stray `</think>` after narration that an earlier closing tag already ended no longer wipes the reply. A reply that ends at its only closing tag is still treated as reasoning.
  - A spaced `</World_State >` closing tag closes the checklist and Places header blocks.
  - Capture and elapsed-time detection read a SillyTavern message's `mes` first, as branch tracking does. A stale `content` field is never captured.
  - A hidden user turn is no longer capture evidence, just like a hidden reply.
- **Elapsed time**
  - Dialogue is paired as the capture firewall pairs it: wrapped quotes, and curly-single quotes with contractions inside, are dialogue.
  - These no longer cancel a real skip: "could" or "would" after the phrase ("Three days later, she could walk"), an adjective ("the expected caravan"), a noun ("against their will"), and "as if".
  - A user repeating the narrator's day step no longer uses up the exchange's day count.
  - Each phrase is judged at its own position, not where the same words first occur.
  - The newest meaningful skip of a message is reported, not the first.
  - A fortnight or a decade given as a hint's unit is converted (two weeks, ten years).
  - Matching lowercases without the device locale throughout.

### Architecture

- No durable format change (schema 2; envelopes 1).
- The elapsed detector reuses the source firewall's dialogue pairing.
- The capture wire reports rows past the cap separately from malformed rows.
- Core contract admission, wire, planning-material and elapsed sections record the rules.

### Validation

- New `tests/audit-alpha62.test.js` (26 tests). The first 22 each fail on 0.9.0-alpha.61, and the 4 review-hardening tests fail on the pre-review code.
- `npm test` (686) passes on Node 22 and Node 24. `npm run validate`, `npm run measure:prompts` and `npm run package` pass.
- Live in SillyTavern, these behave as on alpha.61: the branch, rebuild, resume, hide, forfeit, alpha.59 and alpha.57 Places scripts. They were run again after the review hardening.

### Code review hardening

- A resolve that the firewall rejects (for example one resting on a rumour) leaves its record in the duplicate gate. A near-duplicate create then updates that record instead of creating a second one.
- A reply that ends at its only closing `</think>` stays reasoning, so planning never becomes evidence.
- The threat-and-promise rule no longer covers demands and orders, so a shown demand can still establish a levy. It also no longer catches a relative "that" ("threatened the caravan that crossed the pass").
- Speech verbs that are also nouns or other verbs are no longer attribution words, so "screams echoed", "cries" and "the council answered the petition" stay narration.
- A plural possessive keeps a single quote open only when the quote closes again later in its paragraph ("'Fetch the horses' ordered Mira." closes).
- An elision opens dialogue at the start of a line ("'Cause the duke sealed the gate,' ..."), and blocks a quote only mid-sentence in lower case.
- A reporting verb may reach its "that" across up to twelve words ("reported to the captain of the northern garrison that ...").
- A narrator repeating the exact day step the user echoed names the same day and does not count twice.
- Rebuild windows read `mes` first like live capture.
- Hidden rows are not scene context for lifecycle selection.

## 0.9.0-alpha.61 - Data loss and wrong state (deep pass on alpha.60)

### Fixed

- **Missed captures**
  - A capture, forfeit or rebuild recovery is saved at once even when the Operations log is full. It is kept with the failure it clears, so a saved copy of that failure can no longer come back.
  - A completed rebuild clears only the missed captures in its own range. A reply added and missed while it ran stays listed.
  - A reply whose capture was abandoned because you switched chats is listed as a missed capture. This covers a capture waiting behind other work and a swipe or edit still settling. A reply the state already holds is not listed.
  - A reply that was not captured because its branch could not be proven is also listed.
- **Operations log**
  - A log save that overlaps the chat leaving memory still saves its rows.
  - A deleted chat's log clear is retried, so a new chat that reuses its name cannot inherit its rows.
  - A retried rename never revives a chat renamed or deleted since.
- **Renames and recovery**
  - Renaming a chat that still needs recovery no longer writes an empty World State file for the new name. The new name stays recovery-required until a Full chat rebuild, an import or a reset, and its Operations log follows the rename.
  - A damaged World State file stays recovery-required each time the chat is opened, instead of turning into "could not load this chat state".
  - A load overtaken by a rename or delete no longer undoes the newer load.
- **Saving across sessions**
  - A freshness check that overlaps this session's own save no longer takes that save for another device's. Before, it could cancel requests or a running rebuild, or list a saved capture as missed.
  - After a stale save is undone, the restored revision counts as this session's own.
  - The revision check reads exactly the file the upload replaces, and a file that belongs to another chat is never replaced.
  - Without Web Locks (SillyTavern over plain HTTP on a LAN), a save reads its upload back. If another tab wrote in between, it reports a revision conflict instead of losing an update. This narrows that window but does not close it.
- **Rebuild**
  - A rebuild whose conflict recovery fails, or that throws, ends as failed instead of staying running. Before, it blocked Forfeit and new rebuilds until a reload.
  - A failed rebuild's Resume point survives new messages being added; it is still discarded by new World State.
- **Places**
  - A Places index built before the base map loaded is rebuilt once the map is available. Base places are no longer missed or duplicated.
- **State handling**
  - A checkpoint without a snapshot, from an old or foreign save, now fails recovery closed instead of throwing.
  - Checksums agree with JSON, so a state carrying an undefined field no longer fails its own checksum.
  - Text matching lowercases without the device locale. Under a Turkish locale, "I" now matches the same as elsewhere.
  - Bounding text is idempotent and never cuts an emoji in half, so excerpts cut at their limit still ground.

### Architecture

- No durable format change (schema 2; envelopes 1).
- The diagnostics store reports to the host whether a recorded row clears a listed failure, judged before the trim.
- The two Places copies of the text-bounding helper are replaced by the shared one in `common.js`.
- Core contract C19 and the host, persistence, recovery, admission and Places sections record the rules.

### Validation

- New `tests/audit-alpha61.test.js` (20 tests), with host scenarios `tests/host/rename-recovery.mjs`, `tests/host/corrupt-reactivate.mjs`, `tests/host/rename-cached.mjs` and `tests/host/rename-corrupt.mjs`. Each of the first 16 tests fails on 0.9.0-alpha.60. The review-hardening tests and their two rename scenarios fail on the pre-review code.
- `npm test` (660), `npm run validate`, `npm run measure:prompts` and `npm run package` pass on Node 22 and Node 24 (CI). Node 24 provides `navigator.locks`, so the tests of the no-Web-Locks path hide it explicitly (`tests/web-locks.mjs`).
- Live in SillyTavern, these behave as on alpha.60: the branch, rebuild, resume, hide, forfeit, alpha.59 and alpha.57 Places scripts. They were run again after the review hardening.

### Code review hardening

- Renaming a recovery-required chat writes nothing only when it holds no continuity of its own. When the World State file was briefly unreachable, the cached continuity still moves to the new name instead of being dropped.
- A chat whose World State file is damaged can be renamed without an error, and stays recovery-required.
- A capture that fails after you switched chats, before it started, is listed as a missed capture.
- A kept clearing row no longer takes a stored model answer away from a missed capture.
- A damaged file recorded under another spelling of its path can still be replaced by a Full chat rebuild, import or reset.
- The Places index remembers its base map by digest, so it never holds an evicted map in memory.
- An Operations-log save no longer deep-copies every row.
- The freshness check drops a redundant counter: a write that finished during the read has already changed the settings pointer.
- Kept as is:
  - Without Web Locks, the read-back cannot catch a concurrent writer that uploads and reads back first. The contract says this narrows the window and does not close it.
  - The capture handler keeps a shallow copy of the chat array, which is only references, not message reads or hashing. It is the only record of the message keys if a chat switch empties the array.

## 0.9.0-alpha.60 - Forfeit a missed capture

### Added

- **Forfeit a missed capture without a rebuild.** The Missed captures notice on the World view now has a Forfeit button for each listed message, next to Recapture.
  - After a confirmation, that message is no longer listed as a missed capture. A later Recapture or rebuild that covers it still re-reads it.
  - World State does not change: whatever that reply established stays uncaptured unless you add it by hand.
  - Forfeit applies to that version of the message only. A new swipe or edit of it is captured as usual, and a later failure of the same version is listed again.
  - The decision is saved to the chat's Operations log at once, so it holds after a reload and on other devices.
  - It is not offered inside the rebuild sheet, and it is refused while a rebuild runs.
  - Up to 40 messages get a Forfeit button; any beyond those appear once earlier ones are forfeited or recovered.

### Architecture

- The forfeit is a `forfeited` capture row in the non-canonical Operations log, bound to the message's lineage and hide-insensitive keys. It clears failures the way a successful capture does. No World State or durable format change (schema 2; envelopes 1).
- Core contract C19 records the rule.

### Validation

- New `tests/audit-alpha60.test.js` (4 tests, each failing on 0.9.0-alpha.59; the fourth and the scenario's rebuild, full-log and unreadable-sidecar steps also fail on the pre-review code) and host scenario `tests/host/forfeit-capture.mjs`.
- Live in SillyTavern, with a capture failure forced on message 2:
  - the notice offered "Forfeit without recovering: Message 2";
  - declining the confirmation kept it listed;
  - accepting cleared the notice and showed "Missed capture of message 2 forfeited. World State is unchanged.";
  - the record count stayed at 2, and the notice stayed cleared after a page reload.
- The branch, resume and hide live scripts give the same results as on alpha.59.

### Code review hardening

- Forfeit no longer reads or refreshes the World State file. It touches only the Operations log, so an unreachable sidecar or a hydration error no longer blocks it or drops it silently.
- It is saved at once even when the in-memory log is full. Recording it could trim away the failure it cleared, which left the save to the log's quiet period.
- It is refused at once while a rebuild runs instead of waiting behind the rebuild.
- A failure listed without a cached lineage for its message can be forfeited (the live chat identifies the message).
- Forfeit buttons cover up to 40 listed messages, not just the 12 the notice names.
- The confirmation says a later Recapture or rebuild covering the message still re-reads it.
- One helper merges the saved Operations log before Recapture and Forfeit, and one outcome set decides which capture rows clear a failure.

## 0.9.0-alpha.59 - Performance, contract text and cleanups (deep pass on alpha.54)

### Fixed

- **State copies:** a saved capture copies the state 6 times instead of 12, and a user turn that needs no evolution copies it not at all (it made 5 copies).
  - The commit reads the state before the change in place and returns its own copy without copying it again.
  - Saving reads a verified sidecar without copying it when it only checks revisions and checksums.
  - A reconcile that only extends the lineage compares the lineage, not the whole state.
  - Evolution that evaluates nothing returns the state as it is, and evolution with no derived development reduces once.
  - Manual edits read the state in place; a Places save applies each step once and fingerprints the chat once (it applied the location step twice and fingerprinted up to four times).
- **Relevance:**
  - The scene window is tokenised once per selection instead of once per candidate (137 ms to 8 ms for a 12,000-character window and 400 records).
  - A one-word anchor that is a function word ("Will", "May") matches only where it is used as a name ("ask Will"), not the modal ("they will") or a question ("Will you ...?").
  - Rebuild's lifecycle reservation no longer counts function words as shared topic, and a development changed recently is reserved only for an exchange that shares a word with it, or for an ending that names nothing ("it finally ends").
- **Full scans:**
  - Evolution's derived-development duplicate check compares only the records that could be duplicates (found through the relevance index), plus the batch's targets.
  - Places capture matches names through one map per capture instead of scanning every place for every proposal.
  - The panel recounts assistant replies only after a chat event or a second, not on every refresh.
- **Rebuild:** a chat over the boundary limit is refused before any message is read, hashed or copied, and a rebuild hashes the chat once for its plan, resume check and range proof (it hashed it about five times).
- **Smaller fixes:**
  - A null `status` in a capture response means "not stated" (like a null trend) instead of failing the whole response.
  - World_State checklists read `•`, `+` and numbered bullets and an "Offscreen" or "Off screen" heading.
  - A Reality-only rebuild no longer throws on a missing chat.
  - A Places edit made after the last assistant reply is journaled at its own message in a Reality-only rebuild, not folded into the reply before it, so deleting that message still undoes it.

### Architecture

- **Contract corrections:**
  - C23.1 states the copies a capture actually makes instead of "one copy per mutation".
  - C24.6 says schema 1 is not migrated (pre-1.0 persistence accepts the current schema only, as C11 says).
  - C07 says the SillyTavern host passes no affecting evidence, so its automatic evolution trigger is meaningful elapsed time.
  - C12 adds the function-word anchor rule and the rebuild lifecycle rule; C13 records the derived-duplicate pool, C06 the null status and checklist bullets, and C19 the trailing Places edits.
- **Cleanup:**
  - Removed unused code: `cloneForExport`, `querySpatialLocations`, `inspectSpatialLocation`, `straightLineDistance`, `unitsToKm`, `scoreRecordRelevance`, `containsWriterState`, `extractWriterStateBlocks`, `CAPTURE_DEFAULT_INTERVAL`, the sanitizer re-export, the capture and evolution snapshot tokens nothing read, the Places `relationsChanged`/`routesChanged` flags, an always-empty rejection list, an unreachable recovery reset and an unreachable rebuild confirmation (the rebuild sheet is the confirmation).
  - `extractElapsedHint` now runs the runtime detector on one text, so its tests test the code the extension runs.
  - New `common.js` holds the helpers that had drifted between modules (copy, bounded strings, message text and role, clipping); evolution's clipping gains capture's small-limit guard, and evolution uses the shared duplicate threshold.
- No durable format change (schema 2; envelopes 1).

### Validation

- New `tests/audit-alpha59.test.js`: 18 tests, 15 failing on 0.9.0-alpha.58 (the bare-ending antecedent and synonym tests guard existing behaviour). The 2 review-hardening tests, the synonym test and the review cases added to the relevance and checklist tests fail on the pre-review code. New host scenario `tests/host/state-copies.mjs` counts state copies in an instrumented copy of the runtime.
- Measured on alpha.58 against alpha.59:

| Check | alpha.58 | alpha.59 |
|---|---|---|
| Copies per saved capture (host scenario) | 8 normalizations + 4 copies | 6 normalizations |
| Copies per user send | 2 normalizations + 3 copies | 0 |
| Relevance, 12,000-character window, 400 records | 137 ms | 7.6 ms |
| Message reads before refusing an over-limit rebuild (40 messages) | 160 | 0 |
| Live: "They will leave at dawn" injects the ferryman anchored "Will" | Yes | No |
| Live: "ask Will about the crossing" injects him | Yes | Yes |
| Live: Places save with a relation | Saved, one journal entry | Saved, one journal entry |

- The branch, rebuild, resume, hide and Places live scripts give the same results as on alpha.58.

### Code review hardening

- A name that opens a sentence is matched again ("Will nods and pushes off."), as is a name followed by a comma or "!" ("Will, the ferryman, waves"). A question opening a quotation ("She asked, \"Will you take us across?\"") and "Will the bridge hold?" are not. A lower-case "will" is never read as the name.
- A recently changed development stays visible to rebuild even when the exchange is about another development, so an ending that names it by a synonym ("the sickness finally breaks" for a plague) can still close it. Only its marking as the interpretive antecedent is withheld while the exchange touches another development.
- Rebuild's lifecycle and history checks read every word of the bounded exchange. They read only the first 256 distinct words, so a long reply's last paragraph was missed.
- A numbered label that ends at its colon ("1. Scene goals for next reply:") closes a World_State checklist section instead of becoming an entry.
- A Reality-only rebuild commits after the last reply only when a place changed there. A no-op commit added a checkpoint and evicted an older one.
- A lineage-only reconcile compares lineage entries field by field instead of stringifying each one.
- The panel's reply-count memo no longer holds the previous chat in memory.
- Host messages are read `mes` first again (`hostMessageText`, also used for lineage fingerprints), so a stale `content` field is never read instead.
- The shared support stopword set is no longer presented as frozen.

## 0.9.0-alpha.58 - Panel and accessibility (deep pass on alpha.54)

### Fixed

- **Errors:** SillyTavern's toasts now show above the open panel. Every panel error used to render underneath it.
- **Keyboard and screen readers:**
  - the panel takes focus when it opens;
  - a click or key press keeps focus on its control across re-renders (focus used to drop to the page body), and focus returns to the dialog when its control is gone;
  - Tab and Shift+Tab stay inside the panel or the rebuild sheet;
  - Escape closes the menu, rebuild sheet, place form or Map settings, and then the panel;
  - status changes are announced through one persistent live region instead of regions recreated on every render.
- **Phones:** clearing the search no longer hides the only search box or closes the keyboard.
- **Places editing:**
  - Declining Archive, Merge or Delete inside the edit form no longer closes it or drops unsaved edits.
  - Add place can be cancelled at any of its prompts; it no longer fills in defaults instead.
  - A free-text relation direction ("upstream") is shown as stated from the other place, and saving the form no longer deletes it.
- **Records:** after a state change that was not re-rendered (for example while an input method was composing), a click on a record row now acts on the record shown, not on whatever record that position now holds.
- **Rebuild:** the "N places" count no longer includes archived or base-map places.

### Architecture

- Core contract C21 and C24.5 record these rules. No durable format change (schema 2; envelopes 1).
- The panel's key handler listens on the window in the capture phase only while the panel is open, so the page's own handlers cannot swallow Escape or Tab.

### Validation

- New `tests/audit-alpha58.test.js`, on a small fake DOM that re-creates every panel control on each render: 7 tests, each failing on 0.9.0-alpha.57, plus 4 review-hardening tests that fail on the pre-review code.
- Live in SillyTavern (Chromium), alpha.57 against alpha.58:

| Check | alpha.57 | alpha.58 |
|---|---|---|
| Focus on open | SillyTavern's chat box | Panel |
| Focus after clicking the Places tab | Page body | That tab |
| Tab presses out of 40 that left the panel | 27 | 0 |
| Escape | Did nothing | Closed the panel |
| Error toast | Hidden behind the panel | On top |
| Phone search after clearing | 0 boxes visible | Box visible and focused |
| Rebuild sheet just opened | — | Has focus; Escape closes the sheet, then the panel |

- The panel (alpha.53), Add place, branch and Places scripts give the same results as on alpha.57.

### Code review hardening

- Saving a place whose free-text relation was stated from the other place keeps the relation's direction. A changed distance no longer flips which place is upstream.
- Escape never closes a place form or Map settings that holds unsaved edits.
- A newly opened rebuild sheet takes focus. It used to stay on the opener, now under the sheet's backdrop.
- A record opened by link beyond the bounded list is found again after positions shift.
- A click is read against the tab that is actually drawn.
- A rebuild status that goes away (after a reset) is not announced.
- Focus also stays on controls without a panel attribute (an Operations summary, a JSON block) across background re-renders.
- One shared active-place count serves both the rebuild progress and the result.
- Add place drops its redundant checks.

## 0.9.0-alpha.57 - Places capture and host (deep pass on alpha.54)

### Fixed

- **Places grounding:**
  - A relation's direction and distance are read only in the cited sentences that name its places. The compass word must be used as a direction, so "the north wind" elsewhere in the reply (or "the north gate") no longer grounds "north" and no longer derives an exact coordinate.
  - "1,200 km" is read as 1200, not 200.
  - A coordinate counts only in a cited sentence, as the contract says (or in an "It sits at …" sentence right after one).
  - A coordinate spoken across a wrapped line or in „…“ quotes is dialogue, not narrative-explicit.
  - Route names on a place are kept only when the narration names them.
- **Duplicates and retired places:**
  - Narrating a base place whose override the operator archived no longer creates a duplicate campaign place.
  - The old name of a merged-away duplicate now means the place it was merged into, instead of re-creating it.
  - Narrating a base-map route's name no longer replaces that route (type and endpoints lost) in injection.
- **Places responses:**
  - More than 8 Places rows no longer fails the whole response, Reality records included. Rows past the cap are rejected one by one, and the prompt states the cap.
  - A place moved and related in the same reply is judged where it now is under a locked True North.
  - Reducer-stage rejections carry the model's row number.
  - A manual relation with the direction "constructor" no longer crashes the reducer.
- **Host:**
  - Toggling Spatial indexes the state as it is once the base map has loaded, so a place captured meanwhile is injected.
  - A rebuild on the host connection is pinned to the model it started with. Switching models mid-rebuild fails that boundary (resumable) instead of mixing two models' extractions.
  - A character rename no longer drops earlier missed captures from Recapture.
  - A failed Connection Profile call keeps the provider's error text (429, authentication…).
  - Start Rebuild says why it did not start if the chat changed while the base map loaded.
  - Leaving a chat discards its failed rebuild's resume point.
  - A declined or failed base-map import no longer changes which map other chats use.
  - Detach reports success only once it is saved.

### Architecture

- Core contract C19, C22 and C24.4 record these rules.
- Places gain an optional `mergedInto` field, written when a place is merged away. It is optional in schema 2, and envelopes stay at 1.

### Validation

- New `tests/audit-alpha57.test.js` (11 tests, plus 4 review-hardening tests that fail on the pre-review code).
- Two older source checks were updated: the rebuild route expression is now `pinnedHostRoute(routeFingerprint)`, and the base-map registry write is now inside the saved attach.
- Live in SillyTavern (stub provider), alpha.56 against alpha.57:
  - a "north" relation cited from "The north wind howls … Oakvale stands near Millbrook, some 1,200 km away" was stored as north/200 on alpha.56; alpha.57 stores no relation;
  - a reply with nine Places rows kept none of them on alpha.56 and keeps the first eight on alpha.57.
- The branch, Places, Add place, narrator and Resume scripts give the same results as on alpha.56.

### Code review hardening

- A base place whose override was merged away now maps to the merge target instead of being rejected as archived.
- Sharing a few words with the cited claim no longer makes a sentence cited, so a distance, direction or coordinate from an uncited sentence is not borrowed.
- A direction before a comma clause or a conjunction ("to the north, where …", "north while …") is grounded again. "The north and south gates" no longer is.
- A rebuild's host-model pin comes from the same route snapshot Resume compares, and the model reading is shared with the fingerprint.
- A missed-capture row moved by a rename is stamped, so another session's older copy no longer reverts it on save.
- A relative relation from a place moved in the same reply is judged after the move, and its rejection carries the row number. A narrated position that contradicts its own stated direction is still rejected.
- Narration sentences are computed once per message, and the claim is normalized once per evidence item.

## 0.9.0-alpha.56 - Hearsay, plans and time passing (deep pass on alpha.54)

### Fixed

- **Narration read as hearsay:**
  - "Without warning", "All told", "Bram swore", "the Free States", "land claims" and "Holy Orders" are narration again. Before, they blocked creates and resolutions, so stale conditions stayed active.
  - Reporting words count only in their reporting use: "claims" and "states" followed by what is reported, and "swore" with an object.
  - A reporting verb in a relative or temporal clause ("The guard, who reported the theft, now patrols …") no longer reports the main clause.
  - A narrated act after "and" ("threatened the villagers and burned the granary") is no longer read as only threatened.
  - A quoted name ("the "Black Gull" anchors …") is not dialogue.
  - Dialogue ending in a number ("The toll is now 20") closes, so the rest of the paragraph is narration.
- **Hearsay read as narration:**
  - "Lt. Varro reported that the fort has fallen" stays reported: a title or initial no longer ends the sentence.
  - Single quotes, curly single quotes and 「」『』«» are dialogue. A single quote counts only when it closes in the same paragraph, so apostrophes are not dialogue.
  - A summary that merely contains "States", "orders" or "claims" as a noun no longer counts as keeping a claim reported.
  - A rumour can no longer end an arrangement worded as a speech act ("men demanding a levy").
- **Plans and conditions:**
  - "If the dam breaks tonight, the valley will flood" no longer becomes "the valley has flooded".
  - "Tomorrow the duke plans to march" no longer becomes a done deed.
  - A planned or conditional claim may only establish a summary that keeps it a plan. It never ends a record.
- **Evidence:**
  - The planning sections of a `World_State` block (Planted Seeds, timers, phases and similar) and `<think>`/`<reasoning>` blocks are no longer evidence.
  - A closing tag with a space (`</writer_state >`) no longer strips the whole reply.
  - An excerpt over 500 characters is cut at a word boundary, so it still grounds.
  - Anchors must be whole words ("rat" is not in "pirate").
- **Chinese and Japanese:**
  - a summary may paraphrase its excerpt;
  - updates with two-character anchors are accepted;
  - near-duplicates merge.
  
  All three compare adjacent character pairs.
- **Narrator messages:** a visible `/sys` narrator message no longer ends the exchange, so the user's action before it is captured with the reply that follows. This applies to live capture and rebuild alike.
- **Time passing:**
  - "Two weeks had passed", "Weeks later", "Months passed", "Twenty years later", "A fortnight later" and "The next month, …" are recognised.
  - A modal or "if" counts only in the time phrase's own clause. Modals count in lower case only, so a character named Will no longer cancels a skip.
  - A later "An hour later" no longer cancels an earlier "Three weeks later".
  - A planned first mention no longer hides a real day step later in the same message.
  - "Several" and "many" stay unknown amounts instead of 3 and 5.
  - Background catch-up fills all three slots when relevant developments were already evaluated at that skip.

These are wording heuristics. Where they conflict, this release keeps plans and rumours out of current state rather than risk admitting them as fact.

### Architecture

- Core contract C06 (capture boundary), C08, C13 (time and background slots) and C20 (planning and reasoning material) record these rules. No durable format change (schema 2; envelopes 1).
- The sanitizer now strips more, so the stored narration fingerprint of a reply containing reasoning or `World_State` planning lines changes. This matters only when such a reply is rewritten: it is then rolled back instead of rebased. The same was true in alpha.55, where the rewrite itself changed the fingerprint.

### Validation

- New `tests/audit-alpha56.test.js` (17 tests, plus 6 review-hardening tests that fail on the pre-review code).
- One alpha.45 assertion now expects the older meaningful skip to win over a later short span.
- Live in SillyTavern (stub provider), alpha.55 against alpha.56: after "I sneak into the Vault of Kings" and `/sys The alarm Bell rings across the Vault.`, the next reply's capture request now holds both. On alpha.55 it held neither.
- The branch, hide, partial rebuild, Resume and Places scripts give the same results as on alpha.55.

### Code review hardening

- "The next morning", "tonight", "against their will" and "Whether by luck or design" no longer mark narration as a plan; "will" and "might" count only before their verb.
- Prospective wording keeps only planned or conditional evidence prospective: "The king is dead and the court will choose a successor" no longer promotes a quoted claim.
- A bold `**Off-Screen:**` heading ends a planning section, and numbered entries (`1. Duke: …`) stay inside it, so seeds no longer leak and Off-Screen lines are no longer dropped.
- "北門" and "南門" (north and south gate) stay different subjects in the character-pair duplicate check.
- Only capitalized titles and initials continue a sentence ("the scout said no." and "10 ft." end it). Capitalized "Hypothetically" and "Could" still void a time skip.
- A short quoted name needs a naming word before it ("the", "a ship named"), so a shouted word stays dialogue.
- Spatial capture uses the same sentence splitter as the firewall.

## 0.9.0-alpha.55 - Data loss and wrong state (deep pass on alpha.54)

Each fix has a regression test that fails on 0.9.0-alpha.54.

### Fixed

- **Sidecars and the server:**
  - a chat whose sidecar is missing or unreadable no longer holds a stand-in with the hydrated revision, so it can never be saved over the server file;
  - a corrupt sidecar is now recovery-required, and a Full chat rebuild, import or reset can replace it (before, the chat stayed blocked: every replacement write failed on the undecodable file);
  - after a revision conflict the server state is adopted even if its revision is lower than ours (another device's recovery started the file over);
  - an adopted server state whose messages diverge from this chat keeps the branch dirty and clears the injection until a reconcile proves it.
- **Capture and rebuild currentness:**
  - a capture takes its currentness guard before it waits for the base map, so a swipe during that wait discards it instead of committing it to the new reply;
  - a reply appended while a rebuild runs (the operator keeps playing) no longer cancels the rebuild as "new canonical state";
  - after an import, reset or Full chat rebuild the branch is reconciled again, so a chat edited meanwhile is not injected from the replaced state;
  - toggling Reality or Places injection no longer cancels a running rebuild and in-flight captures.
- **Operations log:** every kept row is saved, pinned old failures included; before, only the newest 80 were saved, so older missed captures were lost on reload.
- **Places:**
  - a rebuild with Places on keeps the places, relations and routes the operator added, at the boundary where they appeared (before, they were all gone);
  - rolling back a deleted place, record, relation or route puts it back where it was, so the state still matches its checkpoint and an older rollback no longer fails closed;
  - Add place refuses "Kings Rest" when "Kings-Rest" exists (it overwrote that place's type and dropped its locked position), and merge suggestions and name lookups fold names the same way;
  - a position typed in the place editor becomes manual authority rather than keeping a relative or unknown label.
- **Duplicates:**
  - a new episode of a resolved record is no longer absorbed by an unrelated active record that merely shares an anchor ("The plague has returned to the lower city" replaced the active food riots record);
  - "Squad 12" and "Squad 14" are different subjects, while "has lasted 3 days" / "4 days" is still one.
- **Base maps:**
  - a map whose name or version was cut right after a space reloads (re-parsing trimmed it again, the digest no longer matched and the map never loaded);
  - overrides of two base places with the same name get separate ids (the second was dropped);
  - two routes with the same name and no id no longer fail the import.

### Architecture

- Core contract C08, C10, C11, C17, C22, C24.2, C24.5 and C24.6 record these rules. No durable format change (schema 2; envelopes 1). The corrupt-sidecar replacement is a revision-0 write checked against the recorded corrupt file, never a blind overwrite.

### Validation

- New `tests/audit-alpha55.test.js` (pure modules) and `tests/audit-alpha55-host.test.js`. The host tests run each scenario in its own process on a new harness (`tests/host/`): it copies the runtime into a temporary SillyTavern layout with stub host modules and drives the real `index.js` through mocked files, events and fetches.
- Three older source checks were updated: the Operations log saves `allRecords`, the rebuild's range check reads the canonical generation, and the scheduled-recovery window was widened for the new hydration path.
- Live in SillyTavern (stub provider), alpha.54 against alpha.55:
  - adding "Kings Rest" next to a locked "Kings-Rest" inn: alpha.54 overwrote it as a landmark with no position; alpha.55 refuses with a toast and keeps the inn at 10,20, manual and locked;
  - a Full chat rebuild with Places on: alpha.54 left 0 places; alpha.55 keeps Kings-Rest unchanged.
- The branch, hide, partial rebuild, Resume, parked-branch, Places and batch scripts give the same results as on alpha.54.

### Code review hardening

- Only a damaged sidecar (not valid JSON, or a checksum that no longer matches) counts as corrupt. A readable file this version cannot use, such as one written by a newer World State on another device, fails closed as before and is never replaced. A recovery replaces only the file recorded as damaged.
- A refresh that finds the file damaged is logged, and drops the cached revision so a readable file found later (another device's recovery, restarted at revision 1) is adopted. A later readable file clears the damage mark.
- After a write conflict, a lower server revision is adopted only if it is not older than the revision the conflicting write found. A lagging read is still ignored.
- A number that counts something ("raid Harrow 3 times a week", "5 silver per wagon", "3,000 soldiers") is a quantity, so a changed count is still one subject; "Squad 12" / "Squad 14" stay two.
- A rebuild with Places on keeps the far end of an operator relation or route: the model place the rebuild re-created under that name (it can get a new id), or the original place.
- That rebuild warns and bounds its journal when operator places predate an earlier story change, like the Places-off rebuild. With no operator entities in the history, the overlay is skipped.
- An adopted server state fingerprints the open chat once for both branch checks.

## 0.9.0-alpha.54 - Performance and cleanups (deep pass on alpha.49)

Each change has a regression test that fails on 0.9.0-alpha.53. Costs are tested as counts (copies, reads, model builds), never as timings.

### Performance

Measured at 400 records, a 600-message chat and 2,000 places, before → after:

| Path | alpha.53 | alpha.54 |
|---|---|---|
| Reality reducer (one capture) | 88 ms | 7 ms |
| Capture response processing | 111 ms | 7 ms |
| Commit boundary | 121 ms | 58 ms |
| Manual edit | 311 ms | 95 ms |
| Places capture with no proposals | 722 ms | 0.2 ms |
| Places reducer, empty batch | 435 ms | 35 ms |

- **Records:** the reducer copied the state twice and built an undo patch nobody read. Normalizing is already a private copy, and the journal's undo patch is built only when the change is committed. The canonical-domain view and the commit no longer copy twice either.
- **Places:** the reducer copied the whole Places state twice and built an unused undo patch, and a capture ran it twice even with nothing to apply. A capture without Places proposals now copies nothing.
- **Capture, manual edits and rebuild:**
  - capture no longer adds another full copy after the reducer;
  - a manual edit fingerprints the chat once instead of twice;
  - the end of a rebuild checks its range once instead of up to four times (the fourth check could never fail and is gone);
  - a panel click reuses the model already on screen instead of building it again.

### Cleanups

- One text canonicalizer (in `hash.js`) replaces seven identical copies across modules.
- One opposite-direction table is shared by the Places core and the panel.
- The rebuild's resume entry is looked up once.
- Removed:
  - two routing branches that did the same thing;
  - an unreachable elapsed-time branch;
  - the second pass of the record search.

### Architecture

- Core contract C23.1 records the copy, fingerprint and range-check bounds. No behaviour or durable format change (schema 2; envelopes 1).

### Validation

- New `tests/audit-alpha54.test.js`. Three source checks were updated for the renamed resume variable and the single exact check. The Phase 8 validator now builds its undo patch at the commit boundary, like the runtime.
- Live in SillyTavern: the branch, hide, partial rebuild, Resume, Recapture, missed-capture, parked-branch, Places, panel and rename scripts give the same results as on alpha.53.

### Code review hardening

- A panel click reuses the rendered model only while canonical state is still the object it was built from. If another device's state arrived without a panel refresh, the click reads it afresh, so no stale place name or type goes back to the host.
- A capture with no Places proposals still returns a normalized Places state when given none.
- The Places reducer reads its input as normalization keeps it: the first entry of a repeated id, with a normalized coordinate.
- The opposite-direction table has no prototype, so a stored direction such as "constructor" is never treated as a compass point.
- Places edits fingerprint the chat once, like Reality edits.
- No state is copied right before it is normalized, anywhere: the cache, the sidecar write, the panel model, branch restores and rebuild.
- The undo patch reads both sides without copying them first.
- A relation now shows a canonical direction from either side ("ne" reads northeast and southwest).
- Manual edits no longer copy the chat array they don't read.

## 0.9.0-alpha.53 - UI and relevance (deep pass on alpha.49)

Each fix was reproduced first and has a regression test that fails on 0.9.0-alpha.52.

### Fixed

- **Multi-word searches could not be typed.** The search box and the Places filter dropped a trailing space on every keystroke, so "iron gate" became "irongate". The text is now kept as typed; matching still ignores outer spaces.
- **Panel refreshes took focus away.** A capture finishing, or each step of a rebuild, rebuilt the panel and dropped focus from the field you were typing in. Focus and the caret now return to the same field.
- **A link to a record beyond the first 120 rows opened the wrong record.** The record now opens in its own tab, shown at the end of the list.
- **Copy JSON could copy another operation.** It now copies the JSON shown beside the button.
- **Cancelling Reset profile threw away typed values.** They are now dropped only once a reset is saved.
- **On a landscape phone the panel overflowed the screen.** At 800x360 the 420px panel lost its bottom 70px. A short window now fits the panel to the screen.
- **Function words in multi-word anchors flooded relevance.** With 300 records anchored "the shrine N", a clearly relevant record was never chosen, because "the" in the scene matched all of them first.
- **One accented letter broke relevance in French or Spanish chats.** The lookup budget went to plain-ASCII letter pairs ("de", "on"), so nothing was found.
- **Resolved developments used up background catch-up slots.**

### Architecture

- Core contract updated in the relevance and operator-panel sections. No durable format change (schema 2; envelopes 1).

### Validation

- New `tests/audit-alpha53.test.js`; each case fails on the previous release. Two older tests were updated: a profile reset now clears the draft only when the host reports it saved, and a source check accepts the trimmed search in the scroll key.
- Live in SillyTavern. On alpha.52:
  - typing "iron gate" gave "irongate";
  - a capture during a place edit took focus away;
  - at 800x360 the panel overflowed by 70px.

  On alpha.53 the search reads "iron gate", typing continues in the place field at the caret after the refresh, and the panel fits the screen.
- Not verified: real mobile devices and on-screen keyboards, and screen readers.

### Code review hardening

- A linked record beyond the first 120 rows is now actually shown in the list and opened; before, only its detail was computed.
- The background scan list drops a repeated id too, so it can no longer stay longer than the pool and compact on every update.
- Typing a second space between words no longer ends bulk-select mode or resets the list's scroll position.
- When the field being typed in is re-rendered disabled (a rebuild starts, a base map locks the profile), focus falls back to the search box instead of being lost.
- Finding a linked record's tab reads only that record's status, instead of building the whole panel model a second time.
- The Copy button no longer carries a row number.
- Checked and left as is: a first name that is also a function word ("Will" in "Will Turner") is no longer indexed as an anchor word. A multi-word anchor scores only when all its words are in the scene, so "Will" alone never selected that record (on alpha.52 either), and "Will Turner" still does.

## 0.9.0-alpha.52 - Places accuracy (deep pass on alpha.49)

Each fix was reproduced first and has a regression test that fails on 0.9.0-alpha.51.

### Fixed

- **A locked place rejected every header that repeated its position.** "Loc: Applecross Culvert | ... | [31.4, 163.6]" for a locked culvert was rejected each turn ("cannot overwrite locked coordinate"), so its evidence and routes never updated. A confirmation of the same position now updates the place and keeps the lock.
- **A campaign override without a position could never get one.** Its override authority outranked any narrated coordinate, even though it had none to protect.
- **A coordinate beside the header name became part of the name.** "Loc: Old Mill [12, 4]" created a place called "Old Mill [12, 4]", and a new one for every new position.
- **A ride distance became an exact coordinate.** "A 12 km ride north" derived Millbrook at exactly (0, 12) when the model labelled the distance straight-line. A distance is now straight-line only with straight-line wording ("as the crow flies"); rides, walks and marches are route travel.
- **A near-match coordinate kept the model's numbers.** With a precision step of 5, "The Old Mill sits at [10, 20]" stored the model's (14.6, 15.2). The narrated pair is stored.
- **Short invented names grounded inside other words.** "Oak" was created from "cloak".
- **A relation was dropped silently** when its new place matched an existing place outside the visible set by name. It is now linked to that place; a relation whose place could not be saved is reported.
- **Lock then Unlock made an override movable.** Manual edits turned its override authority into an unlocked manual coordinate that narration could move.
- **A base-map place outside the visible set was duplicated** as a campaign place when the narration named it.
- **A relation stated in reverse was added a second time.** "Oakvale lies west of Millbrook" next to "Millbrook is east of Oakvale" now updates the one relation.
- **Archived neighbours crowded out active ones in Places** (the A19 fix, applied to records only until now).
- **Base-map import:** `[null, null]` coordinates became a locked point at the origin; two places with the same name and no ids failed the whole import; places without coordinates were shown locked.
- **Routes never reached the prompt**, although retrieval found them. The top place's routes are now shown with their type, connected places and context.
- **Spatial rejections pointed at the wrong row** in the Operations log after an invalid row or a header supplement.

### Architecture

- Core contract updated in C24.1-C24.4 and C24.7. No durable format change (schema 2; envelopes 1).

### Validation

- New `tests/audit-alpha52.test.js`; each case fails on the previous release.
- Live in SillyTavern with a stub model. On alpha.51:
  - the header "Old Mill [12, 4]" named the place with its coordinate;
  - "Oak" was created from "cloak";
  - a reverse relation was stored beside the original;
  - the injection had no route line.

  On alpha.52 none of these happen, and a header confirming a locked place adds its evidence without a rejection.
- Not verified: a real model, and base maps larger than the test fixtures. Names in languages that attach suffixes to Latin-script words (Hungarian, Finnish, Turkish) must still appear in their bare form to ground.

### Code review hardening

- A base-map place found by name never sends narration to an archived or merged override of it, and a name that several base places share is rejected as ambiguous instead of picking the first.
- Whole-word name matching applies to Latin, Greek, Cyrillic, Armenian and Georgian words and to numbers, so Korean names with particles ("서울에") and Arabic or Hebrew names with prefixes still ground.
- A reverse relation with "north-east" is read as northeast; a free-text direction ("upriver") has no opposite and is kept as its own relation instead of being dropped.
- Distance wording is read from the sentence that states the distance ("The winds howled" elsewhere is not a route), and a restatement without wording keeps the relation's established straight-line or route mode.
- Repeated base-map names without ids are numbered by their order among places of that name, so inserting or removing other rows does not re-key them; the check is linear.
- Capture and the reducer match place names the same way (case and punctuation folded), so "Kings-Rest" finds "Kings Rest".
- One distance-mode rule and one list of coordinate patterns are shared by every caller; the direction aliases come from the core.

## 0.9.0-alpha.51 - Capture accuracy (deep pass on alpha.49)

Each fix was reproduced first and has a regression test that fails on 0.9.0-alpha.50.

### Fixed

- **Quoted text matched inside words.** "inactive volcano" grounded "active volcano", "unarmed guards" grounded "armed guards", "old viking" grounded "king is dead". An excerpt must now match whole words; Chinese, Japanese and similar text still matches inside runs of letters.
- **A rumour cited across two sentences could end a real condition.** "The tavern is loud. A drunk trader says the siege of Karsk is over" resolved the siege. A multi-sentence excerpt now counts as reported when every sentence about the change is reported. Narration of the change itself (a carter shaking down a farmer) still counts.
- **Dialogue was read as narration** when a quotation continued into the next paragraph, or after an inch mark like 6'2". A quotation now stays open across a wrapped line until it closes, a blank line, or a new line opening with a quote; a quote mark after a number is an inch mark.
- **Demands became facts.** "The duke's men demand that every vendor pay a doubled levy" created "every vendor pays a doubled levy". What is demanded, ordered, threatened or promised is now reported. The act of demanding is still narration, so an extortion shown in the scene is still captured.
- **A self-closing tag wiped the reply.** `<writer_state mode="x" />` stripped everything after it, so the capture was skipped.
- **Travel times counted as time passing.** "A week on foot", "three days on horseback", "leaves after two weeks of waiting" and "kills after three days" triggered catch-up. "Two days on, …" and "After three days, …" still count.
- **A skip without an amount reached the model as zero days.**
- **A failed background catch-up was never retried** for that time skip.
- **An evolution asking for 7–8 developments always failed** after the model call. It now asks for at most the 6 the response may carry.
- **Merged rebuild evidence was labelled as live narration.**

### Architecture

- Core contract updated for each rule above. No durable format change (schema 2; envelopes 1).

### Validation

- New `tests/audit-alpha51.test.js`; each case fails on the previous release. The existing extortion and dialogue-evidence tests pass unchanged.
- Live in SillyTavern with a stub model returning these mutations. On alpha.50:
  - the "active volcano", the cross-sentence rumour, the quotation that ran on to the next paragraph and the levy demand each created or resolved a record;
  - the self-closing tag dropped the capture;
  - a travel time started a catch-up call.

  On alpha.51 none of these happen, the bridge is captured, and "three weeks later" still starts catch-up.
- Not verified: a real model. Attribution and elapsed rules are wording heuristics; how they fare in real play remains to be seen.

### Code review hardening

- A demand, order or threat marks only what it governs: the same clause, within four words of the verb. "Under the captain's orders, the bridge burned" and "The inn offers no rooms; the city is under quarantine" stay narration.
- A quotation wrapped onto the next line stays dialogue, and so does an inch mark inside a quotation.
- A sentence that shares only a place name with the summary no longer counts as "about the change", so "Smoke rises above Karsk" cannot make a rumour that the siege is over into narration.
- Summaries such as "the guards are demanding a toll" keep their reported status; a test now checks that every demand/order/threat verb is also a reported-information word.
- "*After three days*" in emphasis and "Two days on" at the end of a line or before an ellipsis count as time passing. The opening-of-clause rule for "after N days" now applies everywhere elapsed time is read, including "after a day" day steps, so "kills after a day" is not a day step.
- A failed background catch-up puts back only its catch-up position instead of rebuilding the whole relevance index.

## 0.9.0-alpha.50 - Data loss and host lifecycle (deep pass on alpha.49)

Each fix was reproduced first and has a regression test that fails on 0.9.0-alpha.49.

### Fixed

- **A new episode could overwrite a record about something else.** "The north gate is barricaded again" (a new episode of the resolved north-gate record) replaced the active south-gate record. The new-episode path now keeps different subjects apart, like the plain create path.
- **A Reality-only rebuild could delete your manual places.** A rebuild whose range had no assistant reply (for example From the last user message) dropped places added in that range. They are now kept, and rolling that message back still removes them.
- **Merging places after detaching the base map broke their relations.** Relations, the True North check and the Places search index still used the detached base id. A former override is now addressed by its own id once its base place is gone. Detaching, re-attaching or replacing a base map now moves relation and route endpoints to match, and merging never splits the target's relations across two ids.
- **"Added location" sometimes added nothing.** Re-adding a name you archived at the same point in the chat reused the old place's id, and the new place was dropped. A new place now always gets an unused id.
- **Some failed captures were never offered for Recapture.** If the server read failed or the branch restore threw an error before capture started, the reply was dropped with only a console message. It is now a missed capture, unless the reply was swiped or edited in the meantime. A branch that can't be proven still asks for a rebuild, as before.
- **A dropped connection during a save was not retried.** A save that reached the server was listed as not saved; one that did not was never retried. Both are now retried, and a save that already landed is recognized.
- **Renaming a chat showed a "rebuild, import or reset" warning.** SillyTavern reloads a renamed chat before announcing the rename. On opening a chat the warning now waits 5 seconds and is dropped while a rename is migrated. A send or capture still warns at once.
- **The place editor could switch places under you.** If the place you were editing was archived or rolled back elsewhere, the form edited another place. It now closes.
- **Swipe, Regenerate and edits waited for a running rebuild to finish.** SillyTavern waits for World State before it swipes, regenerates or saves an edit. During a rebuild World State now answers at once: the prompt carries no World State until the rebuild is done and the chat is reconciled.
- **Every turn compared two whole states, history included.** Shared history is now compared by identity.
- **Opening a chat read its sidecar twice.** A chat just loaded is not read again; a chat with no sidecar no longer waits through the retries twice.
- **The rebuild's edit counter ran late.** It is now counted before any handler that can wait.
- **Some Places actions still failed silently.** Import base map, Detach and Create campaign override now say why they were rejected.
- **A plain-text provider error became a confusing TypeError.** It now keeps its text and receipt.

### Architecture

- Core contract updated for each rule above. No durable format change (schema 2; envelopes 1).

### Validation

- New `tests/audit-alpha50.test.js`; each case fails on the previous release.
- Live in SillyTavern with a stub model, alpha.49 vs alpha.50:

| Scenario | alpha.49 | alpha.50 |
|---|---|---|
| Server read fails before a capture | reply silently lost | missed capture, offered for Recapture once the chat moves on |
| Connection drops after a save landed | listed as not saved | applied |
| Rename a chat with history | missing-continuity warning | no warning |
| Swipe a reply sent during a 150-reply rebuild | SillyTavern held 15.7 s | 1 ms; rebuild still completes |
| Open a chat | 3 sidecar reads | 2 |

- Not verified: a real model; the merge, place-id and editor fixes beyond unit tests; a real dropped mobile connection (simulated with a reset connection).

## 0.9.0-alpha.49 - Performance (audit A30, batch 5)

Each fix was reproduced first, with an operation count or an identity check, and has a regression test that fails on 0.9.0-alpha.48.

### Fixed

- **A30 - An empty Places capture walked the whole base map twice.** With a 1,000-place map, every capture cloned 2,000 base places even when nothing changed. A capture now resolves only the places it changed, through an id index built once per base map; an empty capture reads no base entry.
- **Each capture copied the whole state, history included, several times.** The rollback journal (up to 256 undo patches) and checkpoints (up to 48 full snapshots) were deep-copied on every reduce and commit. Copies now share these entries, which are frozen and replaced rather than edited. At 300 records the reduce and commit step went from about 740 ms to about 20 ms. Capture, evolution and Places-edit copies now skip the history too.
- **Each capture verified the same sidecar text three times.** The boundary refresh reads back the last upload, and the write re-checks that same server text before replacing it. A text is now verified once; callers still get their own copy.
- **Chats without a sidecar waited for retries on every send.** Each boundary check ran the startup retry schedule (three reads, about 0.4 s of waiting). A chat with no sidecar pointer now reads once; chats with a pointer keep the short retries.
- **Every send re-read the whole chat.** The injection view computed lineage keys for the new message by fingerprinting every message, then discarded them. It now computes none.
- **Rebuild re-hashed the chat at every step.** Each boundary re-hashed the chat prefix, and each currentness check hashed the chat again. Steps now reuse the plan's lineage. The range check is reused until a chat event or a second passes, and is exact before saving or reporting.
- **Scrolling the panel copied the state on every scroll event.** It reads only the chat key now. The public `getState` also copies once instead of twice.

### Code review hardening

- Chats that have a sidecar keep the short read retries, so one transient miss can't mark the sidecar missing.
- The send fix computes no lineage keys at all, rather than extending a lineage whose earlier messages might have changed.
- Any edit, swipe, delete or send invalidates the rebuild's reused range check at once.
- Capture, evolution and Places edits no longer copy the history either.
- The root checkpoint is replaced rather than edited.
- Shared history entries are frozen, so a future in-place edit fails loudly instead of corrupting other copies.

### Architecture

- Core contract updated in the performance and Spatial retrieval sections. No durable format change (schema 2; envelopes 1).

### Validation

- New `tests/audit-alpha49.test.js`; each case fails on the previous release.
- Live in SillyTavern with a stub model, alpha.48 vs alpha.49 under the same harness:
  - Full rebuild of 200 replies: 52.3 s vs 5.8 s.
  - A live capture with 201 records: 2,620 ms vs 926 ms.
  - A send on a 3,000-message chat: 63-121 ms vs 20-44 ms.

  The alpha.44-48 live scripts behave as before.
- Not verified:
  - the retry change, live: the harness could not reproduce a chat with no sidecar, so it is covered by a source check;
  - a real 1,000-place base map in SillyTavern (covered by the counting test);
  - timings on a phone.

## 0.9.0-alpha.48 - Relevance, Resume and panel robustness (audit A19-A21, A27-A29, batch 4)

Each fix was reproduced first and has a regression test that fails on 0.9.0-alpha.47. A18 was already fixed in alpha.45, and the batch 4 "stale records after a save conflict" item was fixed by A02.

### Fixed

- **A19 - Resolved neighbours used up the linked-record slots.** A relevant record whose first three linked records were resolved linked nothing, so its active neighbour was dropped. Only active neighbours now count towards the cap.
- **A20 - A common word crowded out a specific match.** With 600 records about "Gate", a mention of "the Kesselpass Gate" never reached scoring. Longer phrases and rarer words are now looked up first, for records and for Places.
- **A21 - The end of a long reply was ignored when choosing what to inject.** Each message was cut to its first 3,500 characters. The view is now bounded like capture's: newest message first, and a long message keeps its start and its end.
- **A27 - A background refresh wiped Places edits.** A capture finishing while you edited a place reset every field. Fields you changed now stay; untouched fields show the new value. A rejected save also keeps the editor open with your changes.
- **A28 - Resume could mix models.** Editing the selected connection profile to another model between a failed rebuild and Resume went unnoticed. Resume now compares the profile's full settings (or the host connection's API and model) and the output cap.
- **A29 - A newest Chinese (or other non-Latin) name was missed after a long earlier passage.** Character pairs are now read from the newest text first.
- **Typing Japanese, Chinese or with Android GBoard in the search box broke the text.** The panel re-rendered mid-composition, giving results like "ととり砦". It now waits for the committed text.
- **A place related to an archived place couldn't be saved.** Saving failed with "Relative anchor not found". An unchanged relation is now left as it is, and a changed one keeps its other place.
- **Failed import, reset and Places actions said nothing.** A bad import file only logged "Uncaught (in promise)". These now show an error.
- **Two overlapping chat-load events could clear continuity for a turn.** Both wrote the same restore and the second hit its own conflict. Chat loads for the same chat now run one at a time.

### Code review hardening

- Phrases are also looked up rarest first, so a common two-word anchor cannot use up the budget before a rare name; for Places a word counts its description matches too.
- The relevance view reuses capture's bounding, including its guard for a nearly spent budget.
- A saved or reset Coordinate Profile drops its draft, and a field set by a base map always shows the map's value.
- The place editor keeps the relation it opened with, so a relation changed by a capture meanwhile is never deleted by the save.
- A tap on another control while a keyboard is composing re-renders the panel at once.
- Resume with the host connection also compares the chat-completion source or text-completion type; a model it cannot read never matches.
- Chat loads wait only for each other, not for a running rebuild.

### Architecture

- Core contract updated for relevance, the Resume route fingerprint, chat loading, and panel drafts and errors. No durable format change (schema 2; envelopes 1).

### Validation

- New `tests/audit-alpha48.test.js`; each case fails on the previous release.
- Live in SillyTavern with a stub model. On alpha.47:
  - a late mention in a long reply injected nothing;
  - a capture refresh wiped a Places draft;
  - the archived-anchor save failed;
  - IME composition produced "ととり砦";
  - a bad import gave no message.

  On alpha.48 none of these happen. The alpha.44-47 live scripts behave as before.
- Not verified: Resume with a real connection profile (the stub model replaces the dispatcher), and real Japanese/Chinese IMEs or GBoard on a phone. The IME check used Chromium's input-method API on desktop. The overlapping chat-load race is covered by a source check only.

## 0.9.0-alpha.47 - Admission and Places grounding (audit A13-A17, A22-A26)

Each fix was reproduced first and has a regression test that fails on 0.9.0-alpha.46.

### Fixed

- **A13 - A malformed anchor field erased a record's anchors.** Anchors sent as a string, null, a number or `[null]` were read as "clear". They are now ignored; only an explicit empty list clears.
- **A14 - A malformed place-changes field let a rebuild "succeed" without places.** `spatialMutations` as an object, string or null was treated as "no changes". The reply now fails like any other malformed output, and live it shows up under Missed captures.
- **A15 - Who said it was judged by the sentence, not the claim.**
  - A quotation cited together with "A trader says," was promoted to fact. It now stays reported.
  - A narrated event sharing a sentence with an unrelated "a trader said ..." clause was treated as hearsay. It is now a fact.
- **A16 - A rumour could end a real condition.** "A traveler claims the strike ended" resolved the strike. A reported account now can't resolve or supersede an established condition without narrated confirmation.
- **A17 - Different things with the same words were merged.** "The north gate is sealed" and "the south gate is sealed" became one record. Different directions, numbers or names on the same noun now keep them apart.
- **A22 - A place could take another place's coordinates.** A coordinate now counts only in a sentence that names that place (or "It sits at ..." right after it), and never from dialogue.
- **A23 - A hypothetical place became real.** "If we built Moonspire Tower at [40, 40], it would ..." created the tower. Hypothetical or proposed places are no longer created.
- **A24 - A World_State location header wiped place details.** It reset the type to "landmark" and blanked context and notes. It now only confirms the place and its position.
- **A25 - A moved place kept a direction that contradicted it.** After a coordinate correction under a locked True North, "Tower is north of Anchor" stayed beside coordinates that say east. The contradicted direction is now cleared; the distance stays.
- **A26 - Merging an overridden map place left its relations behind.** Relations and routes now follow the merge.

### Code review hardening

- Duplicate gate: only ordinals count as distinguishing numbers, a capital at the start of a sentence is not a name, and common words such as "high", "old" or "new" no longer split records.
- Attribution: "tell", "explain", "mention", "whisper", "inform" and "insist" are reporting verbs, and a claim inside "X said that ..." stays reported even when the claim itself is unquoted.
- Place coordinates: a sentence binds a coordinate to a place only when it carries the full name or every distinctive name word ("the Peak" no longer binds to Falcon Peak), and dialogue is skipped without breaking a `"X": 12, "Y": 45` header.
- Hypothetical places: only building or imagining a place counts ("if we reach Falcon Peak" no longer blocks a narrated peak), and a place is skipped only when every sentence grounding it is hypothetical.
- Contradicted directions: only compass directions are checked, a base-map place moved through a new override is covered, and an automatic move that would contradict an operator-set direction is rejected rather than clearing it.

### Architecture

- Core contract updated for each rule above. No durable format change (schema 2; envelopes 1).

### Validation

- New `tests/audit-alpha47.test.js`; each case fails on the previous release.
- Live in SillyTavern with a stub model that returns place proposals. On alpha.46:
  - Falcon Peak took the fortress's coordinates;
  - the hypothetical tower was created;
  - a header reset the fortress's type and notes;
  - a malformed reply passed.
  
  On alpha.47 none of these happen. The alpha.44-46 live scripts behave as before.
- Not verified: a real model. The attribution and duplicate rules are wording heuristics; how often they help or misfire with a real model remains to be seen in play.

## 0.9.0-alpha.46 - Missed captures recovery path (audit A09-A12) and rebuilds that survive play

Each fix was reproduced first and has a regression test that fails on 0.9.0-alpha.45.

### Fixed

- **Chatting during a rebuild cancelled it** (reported in play). Any new message stopped a running rebuild or Recapture, so a missed capture stayed listed even though later replies were captured. A rebuild now stops only if a message inside its own range is swiped, edited, deleted or hidden. Messages you send meanwhile are captured right after it finishes.
- **Another device kept asking you to Recapture.** A recovery made on one device or tab now clears the notice on the others when you open the panel.
- **A09 - Renaming a chat could lose a missed capture.** The old log was emptied before the new name's log was saved. It is now cleared only after the new log is saved.
- **A10 - A failed log upload lost its rows.** An upload error was only logged. It is now retried, the retry is flushed when you leave the chat or hide the page, and rows that still can't be saved are kept and saved on the chat's next load.
- **A11 - More than 40 missed captures could drop the oldest one,** so Recapture started too late. Unrecovered failures are now kept (up to 400, earliest first); older ones drop the stored model answer.
- **A12 - Hiding an earlier message lost a parked swipe.** After you swiped away from a captured reply and hid an earlier message, swiping back re-ran the capture instead of restoring that reply's state, including your manual corrections. It now restores it.
- **Hardened after code review of this release.**
  - Swiping, regenerating or deleting the newest reply during a rebuild no longer cancels it either.
  - The rebuild reads a frozen copy of the chat, so a reply still streaming is never pulled into it, and Resume after you keep playing works.
  - A hide reconciled together with a swipe back still restores the parked reply.
  - Two renames in opposite directions can no longer lock up the Operations log, and quick chained renames (A to B to C) carry missed captures to the final name.
  - An unexpected error while saving the log is retried instead of being lost.
  - Pinned missed captures are bounded: in a flood of failures the earliest are kept, since Recapture starts there.

### Architecture

- Core contract updated: range-scoped rebuild staleness, panel-open log refresh, retried uploads, successor-first log rename, unbounded failure pinning, parked-branch relink and content-based park comparison. No durable format change (schema 2; envelopes 1).

### Validation

- New `tests/audit-alpha46.test.js` and `tests/rebuild-continue.test.js`; each case fails on the previous release.
- Live in SillyTavern with a stub model:
  - chatting during a Full rebuild;
  - a second browser context;
  - park, hide and swipe back;
  - two failed log uploads;
  - a rename with a missed capture, then reload.
  
  Each behaves as described, and alpha.45 showed each bug. The alpha.44/45 live scripts behave as before.
- Not verified: a real model, or two real devices.

## 0.9.0-alpha.45 - External audit: high-priority findings A01-A08

Fixes for the eight high-priority findings of an external audit of alpha.44. Each was reproduced first and has a regression test that fails on 0.9.0-alpha.44.

### Fixed

- **A01 - Renaming a character could erase another device's newer save.** The past-chat rename kept this session's older copy but wrote it with the server's newer revision. It now rewrites the server's copy.
- **A02 - After a save conflict, injection kept describing the discarded state.** The search index was rebuilt from the state the conflict had just discarded, so a record another device resolved kept being injected. Indexes are now rebuilt from the state that is actually loaded.
- **A03 - A partial rebuild with Places turned off deleted places from its range.** A place saved after the rebuild's start message was lost.
- **A04 - After a rebuild with Places turned off, swiping a reply kept its place.** The rebuild moved all places into its starting point without their history, so rollback could no longer remove them.
  - Both are fixed the same way: with Places off, a rebuild now replays each saved place change at the reply where it happened. Rollback undoes places with their reply, and partial rebuilds keep them.
  - If the chat changed before the oldest saved change while places exist, the rebuild stops and explains, instead of keeping places that may belong to the abandoned branch.
- **A05 - A background catch-up could reach the next prompt before it was saved.** Evolution updated the shared index first. It now publishes only after the save succeeds.
- **A06 - Your manual place edits lost their protection over time.** Protection came from a "manual" evidence entry, which is trimmed after enough later mentions and relabelled on import. Places, relations and routes now remember operator authorship on the entry itself. Older saves derive it from their manual evidence.
- **A07 - Confirming a place's position downgraded its authority.** A narrated confirmation of the same coordinates replaced a stronger authority, so a later narration could move a protected place. It now only adds evidence.
- **A08 - Quoted time could count as elapsed time** (a regression from alpha.43). After rejecting one quoted phrase, the next one was checked without its opening quote, so `"Two weeks later or after three months, we return."` counted as three months passing. Every phrase is now judged in place, with its full quote and sentence; single-quoted dialogue counts too.
- **A18 (fixed along with A08) - A short time skip hid a longer one.** "Two hours later … Five weeks later …" now counts the five weeks.
- **Hardened after code review of this release.**
  - Hiding an earlier message no longer counts as a branch change for a rebuild with Places off. Before, places created after the hidden message were dropped.
  - When the story changed before the oldest saved change, the rebuild no longer refuses. It rebuilds Reality, keeps the places it had, and warns you to review them, so your main recovery path is never blocked.
  - The reply right after the oldest saved change can still be swiped after such a rebuild.
  - The Places-off rebuild now replays only place changes, so a chat without places does no extra work.
  - A catch-up that couldn't be saved no longer marks its time skip as done, so it is retried.
  - A speech longer than 600 characters no longer shifts which text counts as quoted.
  - Single-quoted dialogue with a contraction ("we'll") is still dialogue, and "we'll" counts as a plan.
  - The newest message's time phrase still decides, so an older skip never re-fires over it.
  - Merging an operator-edited place keeps its protection.

### Architecture

- Core contract updated: Reality-only rebuild Spatial ownership, `operatorOwned` authority, same-position confirmations, derived-index publication after save and after conflicts, server-authoritative past-chat rename, offset-anchored elapsed detection. Canonical schema stays 2, with one optional field on Spatial entities; sidecar, bundle and journal envelopes stay 1.

### Validation

- New `tests/audit-alpha45.test.js`; each case fails on the previous release (the review cases fail on the first alpha.45 draft).
- Live in SillyTavern with a stub model: the alpha.44 missed-capture scenarios, Recapture, swipes, renaming a chat away and back, and Places lock/duplicate all behave as before.
- Not verified: a real model, two real devices, or a live save conflict.

## 0.9.0-alpha.44 - Audit batch 3: Missed captures gaps

Fixes from the whole-codebase audit for the Missed captures feature (alpha.41). Each was reproduced first and has a regression test that fails on 0.9.0-alpha.43.

### Fixed

- **Switching chats mid-capture lost that reply silently.** The capture was logged as "stale", which counted as never attempted, so the reply was never captured or offered. It is now listed under **Missed captures** when you come back.
  - A capture whose own reply you swiped, edited or deleted before it finished is settled instead, because that version is gone and the new one is captured on its own.
  - A capture abandoned before its request was even sent is logged too.
- **A save undone by a mid-save chat switch looked done.** The capture had already logged "applied", so nothing listed it. A capture dropped after its result, or saved and then rolled back because the chat changed, is now a missed capture.
- **Hiding or unhiding an earlier message dropped an existing missed capture.** Hiding changes every later message's lineage key, so the failure no longer matched. Capture rows that matter for recovery now also carry a key that ignores hidden flags, so the failure stays listed and a later capture still clears it. A hidden failed reply itself stays listed.
- **Recapture after a hide refused to start.** The partial rebuild checked only the newest message, missed the hide, and then could not prove its own starting point. It now reconciles the whole branch first.
- **A failed Operations log read could erase other devices' rows.** Any read error was treated as an empty log, and the next save wrote this session's rows over the file.
  - A save now waits and retries instead; only a missing or corrupt file counts as empty.
  - A rename leaves unread rows in the old file.
  - A failed load is retried.
- **Hardened after code review of this batch.**
  - The hide-insensitive key is checked against the messages as they were when the capture began, so an earlier message edited mid-capture never makes an abandoned version look current.
  - A "superseded" row settles only its own capture attempt. An earlier failure of the same reply, for example one you swiped away from and back to, stays listed, and log trimming keeps it.
  - A capture's success row still carries its key while the saved log is loading, so a failure loaded afterwards is still cleared.
  - Stale rows from releases before lineage was recorded are still ignored.
  - A postponed log save is flushed when you leave the chat or hide the page. Rows whose save never succeeds are kept and saved the next time that chat's log loads.
  - A rename retries an unread log before giving up.
  - A slow failed load no longer cancels a newer one.
  - The panel computes missed-capture keys in one pass and remembers them.

### Architecture

- Core contract updated: `stale` captures count as missed, `superseded` settles one version, a hide-insensitive Operations-log key (never used for branch ownership), a full reconcile before a partial rebuild, and no overwrite of an unreadable log. Canonical schema stays 2; sidecar, bundle and journal envelopes stay 1. The Operations log rows gain one optional field.

### Validation

- New `tests/audit-batch3.test.js` and updated Missed captures cases; each fails on the previous release.
- Live in SillyTavern with a stub model:
  - a chat switch mid-capture is offered as Recapture on return;
  - a failure survives `/hide 1` and reopening the chat, and Recapture then completes;
  - an edit mid-capture leaves nothing missed;
  - a quick reply during a capture loses nothing;
  - a log save during two failed reads keeps another device's row.
  - On alpha.43 the first two showed nothing to recapture.
- Not verified with a real model or across two real devices.

## 0.9.0-alpha.43 - Audit batch 2: capture and injection quality

Fixes from the whole-codebase audit, each reproduced first and covered by a regression test that fails on 0.9.0-alpha.42.

### Fixed

- **Injection ignored the newest message.** Retrieval only used the first 96 words of the recent window, which runs oldest-first, so a record named only in your latest message was often not even a candidate. The newest end of the window is now used, for records and Places.
- **Common words made unrelated things "relevant".** Shared words like "a", "the", "in" counted as matches, so unrelated records and places filled the injection slots. Function words are now ignored, and a place needs a name match or more than one shared description word.
- **Updates erased a record's details by accident.**
  - an update whose proposed anchors were all unsupported wiped the record's anchors;
  - a redundant create turned into an update reset the development's trend;
  - an unknown trend word (for example "worsening") cleared the trend;
  - an evolution reply with empty optional fields wiped anchors and trend, and could replace anchors outright. Evolution can now only add anchors.
  - An explicit empty anchor list or `null` trend from capture still clears, as before.
- **One reply could rewrite history.** A reply that resolved a record and then updated it ("still holds firm") rewrote the resolved record; the later change is now refused. Two near-identical creates in one reply no longer become two records; the second is merged into the first, keeping its extra anchors and evidence.
- **Evolution rejected a reply in a ```json code block**, which capture already accepts, and lost that elapsed-time catch-up.
- **A time skip was missed** when the same phrase first appeared in dialogue (`"Two weeks later is too late," she said. Two weeks later, …`).
- **Hidden messages.** Live capture re-read user turns that a hidden reply had already answered; it now treats a hidden reply as the end of its exchange, like rebuild. A rebuild with hidden messages excluded no longer sends hidden user turns.
- **Capture prompt details.** World_State checklist bullets containing a colon ("- The Iron Watch: …") were dropped; the 12,000-character exchange budget could be overrun by about 58%.
- **Places.**
  - Injection could show the literal words "target"/"known anchor" for a relation to a place not shown; such relations are now left out, and road distances say "by route".
  - Capture could rename a place to a name never narrated.
  - An invented out-of-bounds coordinate threw away an otherwise valid new place; the coordinate is now dropped instead.
- **Hardened after code review of this batch.**
  - a bold label bullet (`- **Location:** …`) still ends the checklist section;
  - a record anchored on a name made of function words ("The Who") is still found;
  - the newest matching phrase is preferred when the recent window is long;
  - evolution anchors are merged with the record's existing anchors, keeping their order;
  - ignoring function words no longer inflates the overlap score of short records;
  - a relation is never shown to a place that was dropped for lack of budget;
  - a real time skip later in a message is still found after an earlier dialogue match.

### Architecture

- Core contract updated: one-object envelope rule now covers evolution; relevance ignores function words and reads the newest window; in-response ended-record and duplicate rules; update omission/clear semantics; hidden-reply boundaries. Canonical schema stays 2; sidecar, bundle and journal envelopes stay 1.

### Validation

- New `tests/audit-batch2.test.js` and relevance cases; each fails on the previous release.
- Live in SillyTavern with a stub model: capture, a failed capture, Recapture, rebuild and reload still behave as before. How these changes affect capture quality with a real model remains to be seen in play.

## 0.9.0-alpha.42 - Audit batch 1: data safety

Fixes from a whole-codebase audit, each reproduced first and covered by a regression test.

### Fixed

- **Rollback could keep abandoned changes.** After a delete rolled back exactly to the oldest kept change, a new change at that message (for example a manual resolve) recorded an undo base one message too early. Swiping or deleting that message then kept its old captures. Such an entry now never claims a base below the journal floor, so that rollback fails closed (asks for a rebuild) instead.
- **A chat's first save could overwrite another device's World State.** The first write of a chat skipped the server's revision check. It is now checked like every other write; a newer server copy wins and is loaded.
- **Renaming a chat could lose progress.** A rename moved this session's cached copy even when the server held a newer one (for example from your phone), then retired the newer one. The server copy is now what moves. Renaming a chat back to an earlier name was refused and left the chat empty; it now works.
- **Rebuild and Recapture failed forever on an empty reply.** An assistant reply with no narration (empty, image-only, or only `<writer_state>`/tracker blocks) made every rebuild through it fail, and Resume failed again. Such a reply is now passed over without a model call, as live capture already did.
- **Places data was wiped:**
  - the Lock button erased a place's X/Y;
  - each automatic revisit reset a place's type, description and notes, and mentioning a known road erased its endpoints and waypoints;
  - a mention of a known relation without a distance relabelled a road distance as an unqualified one;
  - Save on an unchanged place could downgrade its coordinate authority;
  - Add place with an existing name silently overwrote that place; it is now refused.
- **A full rebuild's starting snapshot lacked Places,** so a later rollback to the start wiped all places and the coordinate profile.
- **Bulk select could resolve the wrong records** when World State was replaced while rows were ticked. Selections are now pinned to the exact row ticked and dropped if it changes.
- **Import could freeze a chat.** The file picker opened from inside the chat's work queue; if it opened late it never opened and all World State work for that chat waited forever. Import and base-map import now pick the file first.

- Hardening from code review:
  - a first write is locked and checked as the physical file it uploads to, and a retried write that already landed is recognised instead of reported as a conflict;
  - a rename destination counts as empty only with no records, places, routes, relations, profile or base map;
  - Add place still allows a campaign place that shares a base-map name (only campaign places are ever overwritten);
  - rebuild uses capture's own skip rule for empty replies.

### Architecture

- Core contract updated for the journal-floor rule, empty rebuild boundaries, and rename/first-write rules. Canonical schema stays 2; sidecar, bundle and journal envelopes stay 1.

### Validation

- Added regressions for each fix (journal floor, first-write conflict, empty boundary, Spatial wire/relations, root checkpoint, bulk drift via the real controller, and host source checks for pickers, Places lock/save/add and renames). Each new behavioural test fails on the previous code.
- Live-checked in SillyTavern: renaming a chat away and back (and reloading) keeps its records; Lock keeps a place's coordinates; adding a duplicate place name is refused; a new chat's first capture still saves.

## 0.9.0-alpha.41 - Live capture catches what rebuild catches

### Fixed

- **Live capture now asks for what rebuild recovers.** Rebuild's request carried a line next to the exchange that live capture never got: *recover every materially persistent condition established in this exchange, including conditions that were already off-screen, ignored, or unrelated to the PC objective*. So a rebuild of the same exchange found conditions the live scan had missed. Both now send that sentence word for word; rebuild keeps only its "historical boundary" framing. The capture prompt grows by about 190 characters.
- The Operations log could lose recent rows on reload: it saved only after 1.5 s of quiet, and every new row restarted the wait. A failed capture now saves at once (and so does its recovery while a failure is listed), and pending rows are flushed when the page is hidden, for example when a phone or tablet switches apps. The flush on unload is best effort.

### Added

- **Recapture failed messages.** A live capture that failed (timeout, provider error, broken JSON) was marked done and never read again. The World view (and the rebuild sheet) now lists such messages under **Missed captures** with **Recapture from message N**.
  - It runs a From-message rebuild starting at the earliest failed message, after a confirmation that names the failed messages and how many replies it will re-read. It never runs by itself.
  - Every rebuild guarantee applies: the exact state before that message or a refusal, atomic replacement, and Resume if a reply fails.
  - A failure clears when that message is later captured successfully, a completed rebuild covers it, or World State is imported or reset. Only messages that are still assistant replies in the current chat are listed.
  - If the history before the failure is no longer journaled, the notice points to a Full chat rebuild instead.
- Import and reset now leave a row in the Operations log.
- Hardening from code review:
  - a capture whose World State save failed, or was discarded by a newer save from another session, is recorded as a failure instead of looking recovered;
  - failures are tracked per message *and* swipe: another swipe's capture does not clear one, and swiping back to the failed swipe lists it again;
  - trimming the 80-row Operations log never drops a still-unrecovered failure, so a long rebuild or busy session cannot erase it;
  - before a recapture the saved log is re-read, so a failure another device already recovered is not re-run;
  - the confirmation comes before anything is written, including the branch sync;
  - ordinary successful captures keep the quiet-period save (no extra write per turn), and failure detection reads a light view of the log instead of copying it;
  - a failure at message 0 is recoverable (it restarts from a clean root); inside the rebuild sheet there is no redundant Open rebuild button.

### Architecture

- Missed captures are derived only from the non-canonical Operations log; canonical schema stays 2 and sidecar, bundle and journal envelopes stay 1. Core contract updated for capture/rebuild instruction parity and Recapture failed messages.

### Validation

- Added regressions for prompt parity, failure detection and recovery (successful recapture, covering/non-covering rebuilds, import/reset, unsaved captures, swipes, timestamp order), pinning in log trimming, the panel notice and button states, the host guard and confirmation order, and which rows save at once.
- Live-checked in SillyTavern with a stub model: a failed capture at message 4 survived an immediate reload, Recapture re-read messages 4 and 6, the missed record appeared, and the notice stayed cleared after another immediate reload. A failure on swipe A was hidden while a captured swipe B was shown and listed again after swiping back to A. How much the prompt change improves capture with a real model remains to be seen in play.

## 0.9.0-alpha.40 - Rebuild window on tablets

### Fixed

- The Rebuild from Chat window now appears correctly on tablets. In portrait (screens narrower than 1000px) it was drawn mostly above the top of the screen.
  - Cause: SillyTavern sets `html { transform: translateZ(0) }`, and below 1000px its mobile layout fixes `<body>`, so `<html>` becomes a zero-height containing block for fixed elements. The panel shell and the rebuild sheet layer used `inset: 0` and collapsed to a sliver.
  - Both layers now size from the viewport (`100vw` × `100dvh`), so the host's styles cannot collapse them.
- The rebuild window's Cancel / Start Rebuild row stays pinned to the bottom, so landscape tablets reach it without scrolling.
- Hardening from code review:
  - the pinned row spans the sheet's full width with a top border, so scrolled content no longer shows around or under it;
  - focused fields scroll clear of the pinned row;
  - the home-indicator (safe-area) padding applies only to the phone bottom-sheet layout;
  - both layers share one viewport-sizing rule, and the regression checks every rule for them, media queries included.

### Architecture

- UI-only CSS change. Canonical schema stays 2; sidecar, bundle and journal envelopes stay 1.

### Validation

- Added a regression for the viewport-sized fixed layers (every rule, media queries included) and the sticky action row with scroll padding.
- Confirmed in SillyTavern that the document itself never scrolls (`body` is `overflow: hidden`) at tablet, phone and desktop sizes, and that a focused field near the bottom is not covered by the pinned row.
- Live-checked in SillyTavern with Playwright tablet profiles: iPad and Galaxy Tab in both orientations, two phones and two desktop sizes all show the full window; a tap on Start Rebuild in iPad portrait completes a rebuild. iPadOS Safari on real hardware remains unverified.

## 0.9.0-alpha.39 - Keep list scroll position

### Fixed

- Selecting, expanding or bulk-ticking a record no longer jumps the World list back to the top. The panel re-renders its whole HTML on every click, which reset the scroll; it now remembers scroll offsets from real scroll events and restores them.
- The offset is kept per list identity (chat, tab, search and place filter), so a different chat, search or filter still starts at the top, and switching back restores the earlier position.
- On phone layouts the Places list keeps its position while a place detail hides it, and returns to it on Back.
- The place detail pane, map settings and rebuild sheet keep their own scroll too, so panel refreshes (for example rebuild progress) no longer snap them to the top.

### Architecture

- UI-only change. Canonical schema stays 2; sidecar, bundle and journal envelopes stay 1.

### Validation

- Added regressions for the scroll memory (identity-keyed, bounded, ignores bad values) and its render/event wiring.
- Reproduced in Chromium (a list scrolled to 900px reset to 0 on a row click, in normal and select mode) and confirmed it now stays at 900; also confirmed another chat starts at the top and restores on return, and the Places list restores after opening and closing a detail at phone width. Real SillyTavern remains unverified live.

## 0.9.0-alpha.38 - Bulk resolve and supersede

### Added

- **Bulk manual lifecycle.** The World panel (Active, Recent and Search views) has a **Select records** mode. Tick active records or use **Select all shown** (first 100), then **Mark resolved** or **Mark superseded** to move them all to history at once. Records already in history cannot be selected.
- One operator note and one confirmation cover the whole selection; the confirmation previews the first five summaries. Summaries stay unchanged in bulk.
- The batch is all-or-nothing and is one manual boundary with one journal entry, so a rollback undoes it as a unit. Every record gets the same manual evidence note as a single action.
- The host validates every selected record exactly as it does for one (identity, still active, summary and change point unchanged); one stale record cancels the whole batch and asks the operator to reselect.

- Hardening from code review:
  - bulk mode and its selection end whenever the tab or search text changes, and the action only sends rows currently shown, so records the operator cannot see are never changed;
  - selection checkboxes announce their state to screen readers.

### Architecture

- New `applyManualLifecycleBatch` in `manual.js` shares the single-record boundary, lineage and reducer path. Core contract lifecycle-control paragraph amended. Canonical schema stays 2; sidecar, bundle and journal envelopes stay 1.

### Validation

- Added regressions for the batch (one boundary, evidence, all-or-nothing rejections, bounds), the panel rendering and controls, and the host validation wiring.
- Drove the panel in Chromium: select, toggle, Select all, and the bulk action payload reaching the host handler. Real SillyTavern persistence and the browser prompt/confirm dialogs remain unverified live.

## 0.9.0-alpha.37 - Resume a failed rebuild

### Added

- **Resume from message N.** When a rebuild boundary genuinely fails (for example a provider reply corrupted by a stray token), World State now keeps the progress up to the failed boundary in memory. The failure notice and the rebuild sheet offer **Resume from message N**, which re-sends that message's request and continues. Earlier messages are not redone, so a glitch late in a long rebuild no longer costs the whole run.
- Resume is safe by construction:
  - it re-sends the failed boundary's unmodified request and never feeds the malformed reply back (not a correction retry);
  - it only happens when the operator presses Resume, never automatically;
  - it is refused before any provider call if the chat, the canonical World State, or the rebuild settings changed since the failure;
  - replacement stays atomic: canonical state changes only after every boundary succeeds;
  - the resume point is never persisted and is dropped by a new rebuild, import, reset, a completed rebuild or leaving the chat.
- Cancelled or stale rebuilds offer no resume.
- Hardening from code review:
  - the resume point binds the rebuild plan, and its processed count is derived rather than trusted;
  - a Resume must name the failed message, and repeat clicks are ignored while it runs, so a later failure always needs a fresh decision;
  - a stale snapshot or a changed connection profile is refused before any reconcile, status or provider side effect, so a rebuild never mixes models;
  - the point is consumed only when the resumed run actually starts, so a temporary refusal such as a missing base map keeps it;
  - any new canonical state drops it and hides the button;
  - the resumed run gets its own operation id;
  - totals cover the whole rebuild.

### Architecture

- Core contract C06 amended: an operator-initiated rebuild resume is the one explicit exception to "no retry". Canonical schema stays 2; sidecar, bundle and journal envelopes stay 1.

### Validation

- Added regressions for:
  - the rebuild resume point;
  - resuming with the identical failed-boundary request, calling only the failed and later boundaries, and converging with an uninterrupted full rebuild;
  - a stale resume refused with zero calls;
  - no resume after stale or cancelled runs;
  - host wiring, in memory only;
  - the panel Resume button and sheet notice.
- Live SillyTavern 1.19 with a stubbed model: a stray-token glitch at message 6 failed the rebuild after 4 calls, and Resume finished all 6 boundaries with 3 more calls instead of a 6-call re-run.


## 0.9.0-alpha.36 - Keep model JSON parseable around dialogue

### Fixed

- **Malformed capture replies aborted rebuilds.** A rebuild failed at 18/26 boundaries with `capture response is not valid JSON: Expected ',' or ']' after array element`. Because a rebuild is atomic, one bad reply discarded every earlier boundary and its calls. The most common cause of this error is a verbatim dialogue excerpt copied with raw double quotes, which ends the JSON string early.
- The capture prompt, which rebuild uses too, now tells the model to escape every double quote inside a JSON string, including dialogue quotation marks copied into verbatim excerpts. An excerpt without its quotation marks is also accepted, because excerpt grounding already ignores punctuation.
- The evolution prompt gets the same rule for its free-text reasons and summaries.
- The capture prompt no longer shows one of its own examples wrapped in raw double quotes, which modelled the habit it forbids.
- The reply in the reported failure was actually corrupted by a stray token (`]偏}`), not a quote. This change cannot prevent that kind of provider glitch: such output is still rejected whole. A way to resume a failed rebuild from the failed boundary is a separate, larger change.

### Architecture

- Core contract C06 records the parseability guidance. Malformed output stays fail-closed: no repair, no correction retry. Canonical schema stays 2; sidecar, bundle and journal envelopes stay 1.

### Validation

- Added regressions for:
  - the capture and evolution prompt rules, including no raw-quoted prose example;
  - a dialogue excerpt with its quotation marks escaped or left out still grounding and being accepted;
  - a reply with a raw unescaped dialogue quote being rejected;
  - the live stray-token reply being rejected.
- The prompt regression fails on the previous code; the others pass both ways.
- Hardening from code review: prefer escaping so excerpts stay verbatim, add the evolution rule and the raw-quote rejection test, remove the raw-quoted example, and drop a redundant "nothing outside the object" sentence.


## 0.9.0-alpha.35 - A death ends the records that depended on it

### Fixed

- **Deaths left older records active.** A character's earlier incident ("Mistress Vena was knocked unconscious… her coin was stolen…") and a gang's racket stayed active after the story established that Vena and Clara were found dead and Bran's crew were killed. Capture was told to resolve only what was "explicitly ended" and to supersede only what was "explicitly replaced". Nothing covered deaths, and a record written as a past event looked permanently true to the model.
- The capture prompt now says that a death, destruction, or elimination established by the current exchange ends shown active records, facts included, that depended on that person, group, or thing continuing:
  - it resolves conditions they were running, holding or suffering (an injury, captivity, occupation, or a racket or scheme they ran);
  - the death itself stays current: the model updates a record describing the person's state to the new state (injured or robbed → dead), or creates a fact for it. It is never left only in resolved/superseded history, which the private note does not include;
  - a merely mentioned, threatened, feared or suspected death still ends nothing.
- The per-request lifecycle check now covers facts as well as developments and names death or elimination explicitly.
- Capture is asked to write create/update summaries as the condition that is true now (lasting injury, loss, damage, death, control) rather than a retelling of the incident. Resolve/supersede summaries may still say how a record ended.
- Hardening from code review: an earlier draft also let named facts compete for the two reserved lifecycle slots. That was reverted before release, because it broke indirect endings ("It is finally over.") and crowded out weakly matched developments. Named facts already reach capture through the ordinary relevance pick.

### Architecture

- Core contract C06 records the death/elimination rule, the keep-the-death-current requirement and present-condition summaries. The source firewall is unchanged: every resolve, supersede or update still needs a current-exchange excerpt that names its target. Canonical schema stays 2; sidecar, bundle and journal envelopes stay 1.

### Validation

- Added regressions for:
  - the system-prompt and per-request lifecycle rules;
  - all Grey Post records reaching capture through the production relevance pick;
  - a Grey Post death exchange accepted to update Vena's and Clara's facts to dead (still active) and resolve Bran's racket.
- The prompt regression fails on the previous code. The visibility and acceptance regressions pass both ways, which shows the reducer, firewall and relevance pick already allowed this; the gap was the prompt.
- Existing records already written as past events are not rewritten automatically. Close them from the panel or run Rebuild from chat.


## 0.9.0-alpha.34 - Stable catch-up no longer rejected for missing support

### Fixed

- **Lazy and background evolution rejected all-stable answers.** The evolution prompt said only a *changed* outcome must cite supportIds, but the response check required every evaluation, stable included, to cite its elapsed/current trigger. A correct answer such as three `stable` evaluations with `supportIds: []` therefore failed as `WORLD_STATE_EVOLUTION_WIRE_INVALID`. The provider call was wasted, nothing was recorded, and because `lastEvaluatedMessage` never advanced, the same targets could be re-requested on the following turns.
- The prompt now asks every evaluation, stable included, to cite the trigger supportId shown for its target.
- When a `stable` evaluation still omits it, the host records that target's own trigger support (the elapsed hint or the current evidence it was selected for) as the evaluation provenance. The summary and `lastChangedMessage` stay unchanged, `lastEvaluatedMessage` advances, and the target is not re-offered at the same boundary.
- Changed outcomes (update/resolve/supersede) must still cite their own trigger and causal support, and an unknown or foreign supportId still invalidates the whole response.

### Architecture

- Core contract C13: a stable evaluation's provenance may be its target's own trigger; changed outcomes are unchanged. Canonical schema stays 2; sidecar, bundle and journal envelopes stay 1.

### Validation

- Added regressions:
  - the live all-stable `supportIds: []` response, with no repeat evaluation at the same boundary;
  - a stable result on a direct-evidence trigger;
  - changed outcomes with empty support and a stable result citing foreign support, both still rejected;
  - the prompt wording.
- The three behaviour/prompt regressions fail on the previous `evolution.js`; the strictness regression passes both ways.


## 0.9.0-alpha.33 - World State survives swipes, deletes, regenerates and hidden messages

### Fixed

- **Delete and regenerate.** A local tail delete, including the delete half of Regenerate, left the chat a strict prefix of the stored lineage. That looked identical to "another device is ahead", so continuity failed closed. The regenerated reply was written without World State, the deleted reply's records stayed, and the new reply was not captured. The host now remembers the chat tail this session proved against its own loaded chat. A stored state ending at that tail, with the chat now shorter, rolls back normally before SillyTavern builds the next prompt. A tail this session never proved still fails closed as host-chat-behind, both in reconciliation and in the server refresh check.
- **Swiping back.** Returning to an already captured reply dropped what it established, because an existing swipe fires no `MESSAGE_RECEIVED`. Abandoned captured branches are parked in memory (8 per chat, current chat only, never persisted). They resume through their own journal/checkpoints, with no model call, only when the returning messages reproduce the parked lineage keys on a byte-identical base state.
- **Uncaptured swipes and edits.** A settled swipe to an existing reply that was never captured, a swipe deletion, or an edit of the latest reply is now captured after a 900 ms debounce. Browsing swipes cancels the pending capture, overswipe generation is left to `MESSAGE_RECEIVED`, and a change further back warns that later messages need Rebuild from chat.
- **Deleting back past the first capture.** With nothing journaled this failed closed and froze continuity. An unjournaled state is now exact from the earliest on-branch checkpoint (root or import baseline) whose snapshot equals it. An unjournaled change with no matching checkpoint still fails closed.
- **Hidden messages.** SillyTavern's hide/unhide flips only `is_system` and fires no event. The next full reconcile (reload, swipe, delete) treated every hidden user row as an edit and rolled back or failed closed from the first one, after which only Full chat rebuild worked. A row whose stored fingerprint is reproduced by flipping `is_system` back is now visibility-only and rebased with its state kept.
- **Rollback start.** When a real change is reconciled together with visibility-only or narration-equivalent rows, rollback starts at the first real change and the proven prefix is rebased.
- **Operations log.** The log lived only in browser memory and vanished on reload. The last 80 operations per chat now persist in a separate `world-state-alpha-ops-<chat hash>.json` server file, never the canonical sidecar. It is restored on chat activation and saved read-merge-write after a short quiet period, carried across rename and emptied on delete.
- **Partial rebuild in long chats.** A partial rebuild that starts before the kept journal now names the earliest message it can prove, and the rebuild sheet shows that start in long chats.
- **Hardening from code review:**
  - A branch parked in the same reconcile as a hide is relinked to the live lineage keys, so swiping back after a hide still resumes it.
  - The park list changes only after the reconcile result is durably accepted, so a stale write can no longer consume a park.
  - Parks keep only their own journal entries and checkpoints, and resume merges back the live ones. The base-state hash is computed only after the cheap lineage checks pass.
  - An unjournaled state is compared with checkpoint snapshots without cloning the whole state.
  - Emptying the journal by rollback keeps its floor, so trimmed history is never advertised as rebuildable. A checkpoint restore sets the floor to its own boundary.
  - The partial-rebuild error only blames journal trimming when the start really is before the kept journal.
  - Operations log saves are serialized with the same cross-tab Web Locks writer lock as the sidecar and read the server file once. A chat leaving the cache flushes its pending rows, and a deleted chat's log is never written again by late operations.

### Validation

- Added branch regressions for delete-to-greeting, the imported-baseline cut, unjournaled fail-closed, swipe-back resume, park guards, hide/unhide, and hide combined with a real edit.
- Added a seeded randomized swipe/delete/regenerate/evolution/hide test compared against a from-scratch replay. It uses a well-mixed generator, and its tests fail on both the previous branch code and the release.
- Added host regressions for the local-truncation proof, parked-branch wiring, debounced branch capture and Operations log persistence.
- Added a partial-rebuild earliest-start regression and a rebuild-sheet hint test.
- Verified live in SillyTavern 1.19 with a stubbed model:
  - Regenerate keeps World State injected, removes the deleted reply's record and captures the new reply.
  - Deleting the last exchange rolls back.
  - Swiping back resumes with zero calls, and a never-captured swipe is captured.
  - A delete right after reload rolls back.
  - After `/hide 0-4` plus a swipe, the release dropped all 5 records and failed closed; with this change the records survive, the Operations log survives reload, and Last messages / From message rebuilds complete.
- Canonical schema stays 2; sidecar, bundle and journal envelopes stay 1.


## 0.9.0-alpha.32 - Day-by-day time adds up

### Added

- Day-by-day narration now adds up for background catch-up. Previously a single "two days later" woke off-scene developments, but the same two days told as "The next morning…" then "The following day…" never did, because each step alone is under the 2-day threshold and steps did not accumulate.
- When no explicit skip is present, `detectAccumulatedDayStepHint` walks the current branch's messages after the last recorded elapsed catch-up (40-message lookback) and counts at most one narrated day step per exchange. Recognised steps include "the next/following day/morning/dawn/evening/night", "next morning", "the morning/day after", "a day later", "after a day" and "a day passed". Quoted dialogue, plans ("will", "'ll", "tomorrow"), hypotheticals ("if"), hidden planning blocks and system messages never count.
- At two days it produces one meaningful hint bound to the message that completed the second day, then restarts the count. An explicit skip resets it too. Firing points are recomputed from the messages rather than stored, so swipes, deletes and branches cannot leave a stale counter.
- Hardening from code review:
  - Hidden rows never count, and a user message restating the morning the narrator just described is the same day.
  - Dialogue is stripped before matching, so single-quoted plans don't count and a quoted first mention can't hide later narration.
  - A hint without raw-message lineage fails closed.
  - A firing point is only offered while it is inside the current exchange window, so a failed or interrupted catch-up can't re-arm it for dozens of turns.
  - A non-meaningful explicit phrase ("a day later", "an hour later") no longer blocks accumulation.
  - The walk is skipped when there are no active developments.
  - The last recorded catch-up boundary is kept incrementally on the relevance index from reducer deltas, so ordinary turns never scan the evidence map.
  - Elapsed regexes are compiled once.

### Architecture

- Accumulated time has exactly the authority of an explicit skip: permission to evaluate (up to 4 relevant + 3 background developments, one call), never evidence of change. Core contract C13, architecture and test plan are updated.

### Validation

- Added regressions for accumulation, the per-exchange cap, the quoted/planned/hypothetical/hidden/system filters, restart after the recorded catch-up and after explicit skips, determinism across later boundaries, the lookback bound, host wiring, and an end-to-end case. In that case three narrated mornings wake background catch-up for an unrelated extortion record, a "stable" result is recorded at the firing message, and the count then restarts.


## 0.9.0-alpha.31 - Mobile button placement and arrangement capture

### Fixed

- The floating World State button was off-screen on phones and tablets. SillyTavern puts a transform on `<html>` (a Chrome flicker fix), which makes `<html>` the containing block for `position: fixed` elements, and on screens up to 1000px it makes `<body>` `position: fixed`, so `<html>` collapses to 0px tall. The button's CSS `top: 50%` then resolved to 0 and its `translateY(-50%)` pushed it above the screen (y = -23). The default spot is now computed in viewport pixels by `launcher.js` (bottom-left above 1100px, left edge mid-height at or below) and re-placed on resize until the operator drags it.

### Validation

- Reproduced and verified in a real SillyTavern 1.19.0 install (Chromium): before the fix the button sat at y = -23 on tablet and phone; after it is on-screen and topmost at 1280x800, 820x1180, 1180x820 and 390x844, a touch drag moves it, the spot survives a reload, and a tap fires the open handler.
- Added regressions for the pixel default and mount/resize placement.

### Capture

- Ongoing arrangements shown through a single incident, such as extortion, levies, tolls, protection payments, checkpoints, curfews or blockades, are now explicitly in scope for capture. Previously the instruction to ignore "one-off transactions" and "isolated claims" let a model skip a scene like armed men shaking down a lane vendor while villagers avoid the alley.
- Capture is told to keep dialogue-borne claims attributed ("men claiming ditch-watch authority are demanding a raised levy"). The source firewall already rejects unattributed restatements such as "the ditch tax was raised by the bailiff", and that rejection is unchanged.
- The same instructions apply to chronological rebuild, which reuses the capture prompt. The capture prompt grows by about 800 characters (~200 tokens) per call.
- Added a regression using the reported alley scene: an attributed summary is applied and an unattributed one is rejected. Live model behaviour still depends on the provider and is not proven by these synthetic checks.


## 0.9.0-alpha.30 - Floating World State button

### Added

- Optional floating World State button (`launcher.js`) that opens the existing panel. Drag it anywhere with mouse or touch; the position is remembered per browser (`localStorage` key `world_state_alpha_launcher_position_v1`). It defaults to the left side (bottom-left on desktop, left edge mid-height on narrow screens) so it does not sit on launchers that use the bottom-right corner. The "Show floating World State button" setting (default on) controls it, and it is also hidden while World State itself is disabled.
- Resizes (window resize, on-screen keyboard) clamp the button on screen without overwriting the saved spot, so it returns when the viewport grows back. Bounds use the layout viewport, so pinch-zoom does not trap it. A drag interrupted by `pointercancel` keeps its position.
- The button stacks above the chat but below SillyTavern's menus, drawers, top bar, and popups, and below the World State panel.
- Mounting the button can never block chat hydration; a failure is logged and the button is skipped.

### Architecture

- The Phase 7 "no launcher" gate is narrowed to one World-State-owned, opener-only button. It has no knowledge of other extensions, no DOM observer or polling, no shared dock, and no durable-state involvement. The watchdog/MutationObserver, cross-extension coordination, and slash-command gates remain, and the Phase 7 coexistence scan now also covers `launcher.js`.

### Validation

- Added launcher regressions: viewport clamping, namespaced and tolerant position storage, click-to-open, drag suppresses the click and saves, resize never persists, `pointercancel` keeps the dragged spot, remount replaces the open handler, idempotent mount/destroy, stacking below host UI, hidden-when-disabled and hydration-safe wiring, and no observer or foreign-extension references. The host coexistence test no longer bans the word "launcher"; its NPC State/Ukiyo/Megumin, MutationObserver, and slash-command bans are unchanged.
- No canonical schema, sidecar, bundle, or rollback-journal changes.


## 0.9.0-alpha.29 - Places duplicate merge repair

### Fixed

- Merging or archiving a place now removes it from the Places list. Archived places were already excluded from Spatial injection, but the panel still listed them, so a successful merge looked like it had done nothing and the duplicate flag stayed. Place counts, duplicate flags, and relative-anchor suggestions also ignore archived places, and the list notes how many are hidden. An archived campaign override of a base-map place stays listed (marked Archived) so the override can still be deleted to restore the base place.
- The merge prompt pre-fills the flagged duplicate partner, lists suggested targets first, and reports how many candidates exist beyond the listed twelve. Suggestions are passed by campaign id, so same-named or whitespace-variant partners resolve unambiguously and base-map-only partners are never offered as targets.
- Place selection keys are derived from the location id rather than list position, so archiving, merging, or a change rehydrated from another session can no longer re-point a kept selection or open edit form at a different place.
- Relative-anchor resolution on save ignores archived places.
- Rejected merge, archive, coordinate-lock, and delete actions now show the reducer's reason instead of failing silently.

### Validation

- Added regressions that run a real merge and check the resulting panel (list, counts, duplicate flags, id-based suggestions, stable selection), plus an archived base-map override case. Both fail against the alpha.28 panel.
- No canonical schema, sidecar, bundle, or rollback-journal changes.


## 0.9.0-alpha.28 - Operator panel redesign

### Changed

- The World State panel now has a compact header (one Rebuild icon, a `⋯` menu, and Close), two primary tabs (World / Places), and a records search field. Operations, Data & maintenance, and map settings moved into the `⋯` menu (bottom-nav More on phones).
- Current / Recent / Resolved are one World view with an Active / Recently changed / Resolved filter. Active records are grouped into Changed recently, Ongoing, and Facts.
- Record rows drop the redundant kind/status chips and bold summaries in favour of a trend-coloured stripe and glyph, anchor tags (place-shaped anchors get a pin), and a relative message age. Expanded rows show state, story time, timeline, anchors, connections, quoted evidence, and the existing manual lifecycle actions.
- Places opens a read view first (position with lock toggle, sub-place count, connections, routes, world-state records that mention the place, provenance) and switches to the editor only on Edit. The coordinate lock is a real switch instead of an unstyled checkbox. Base map and Coordinate Profile controls moved into a collapsible map-settings strip.
- Places lists nest sub-places under a parent place when the name extends the parent's name at a word boundary, and flag possible duplicates (same name, same point with shared name words, or one name's words contained in the other's). Both are display-only; nothing is persisted and merging stays explicit.
- A status bar shows continuity health, the last capture message, and the private-continuity reminder.
- Panel CSS was consolidated into one pass, scoped element resets stop SillyTavern theme styles (heading rules, checkbox appearance) leaking into the panel. Place connection rows give the other place's bearing as seen from the selected place.

### Validation

- Updated the Spatial edit-surface regression for the read/edit split and added projection/render regressions for grouping, place nesting, duplicate flags, place mentions, and the header menu.
- No canonical schema, sidecar, bundle, rollback-journal, or host-action changes.


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
