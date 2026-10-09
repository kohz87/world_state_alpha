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

Routine capture examines only the completed current assistant boundary: messages after the previous assistant response through the current assistant response, plus the minimum already-retrieved state/lore context required to interpret it. It must not use a rolling history window that includes the previous assistant turn; chronological rebuild uses the same boundary semantics. A visible narrator message (SillyTavern `/sys`, `extra.type` `narrator`) is narration inside the next reply's exchange, not a response: it neither ends an exchange nor is a capture or rebuild boundary.

Default Alpha cadence is one eligible capture after each completed assistant exchange. A duplicate receipt for an already processed raw-message boundary must not issue a second automatic request. One automatic capture provider call is permitted per eligible boundary; malformed output is not automatically repaired with a second model call.

Provider capture/rebuild/evolution output must contain exactly one JSON object. The object may be bare or enclosed by one Markdown code fence with an optional `json` language tag. Surrounding prose, multiple-object extraction, and correction retries are forbidden; malformed or structurally invalid output remains fail-closed. To keep output parseable, the capture and evolution prompts tell the model to escape every double quote inside a JSON string, including dialogue quotation marks copied into verbatim excerpts; an excerpt without its quotation marks is also accepted because excerpt grounding ignores punctuation. The prompts themselves never wrap prose examples in raw double quotes. The one exception to "no retry" is an operator-initiated resume of a failed manual rebuild (see rebuild below): it re-sends the failed boundary's unmodified request, never feeds the malformed reply back, and never happens automatically.

If no material world change is established, capture returns no mutations.

Within one capture or rebuild response, a record ended (resolved/superseded) by an earlier mutation is not changed again by a later one, and a create that duplicates another create in the same response is rejected. A create in the same response as a mutation ending a record (one the firewall admits; a rejected ending leaves its record in the duplicate gate) is never folded into that record as an update (it is the replacement, and would otherwise be lost with the ended record). On an update, omitted fields stay unchanged; an explicit empty anchor list or a null trend clears, but anchors that the firewall rejects as unsupported and unknown trend values never clear the record's existing values. Evolution may add anchors to a development but never drops the ones it already has. A hidden assistant reply still ends its exchange for live capture, as it does for default rebuild windows; an excluded-hidden rebuild never sends hidden turns as conversation.

Capture is bounded for completeness rather than ranked only by immediate PC salience. Before output, the single capture request must sweep the whole bounded current exchange for each distinct materially persistent current condition established there, up to the existing mutation cap. When a narrator-authored `<World_State>` block is present, the host may surface a bounded advisory checklist from its `Off-Screen` (also "Offscreen" or "Off screen") and `Unresolved Threads` entries, written as `-`, `*`, `+`, `•` or numbered (`1.`, `2)`) bullets (a bullet that is only a label ending at its colon, such as "1. Scene goals:", is a heading that closes the section), so less-salient persistent conditions remain visible to the same provider request. The checklist is not a second authority or a local mutation path: every proposed mutation still requires source-firewall evidence and all ordinary exclusions remain in force.

Routine capture and rebuild carry the same recovery instruction in the request next to the exchange (recover every materially persistent condition established in this exchange, including conditions already off-screen, ignored, or unrelated to the PC objective), so a live boundary is asked for exactly what a rebuild of the same boundary recovers; only rebuild adds its historical-boundary framing (no inferred evolution between boundaries, later boundaries may close earlier threads).

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

Lifecycle reconciliation is part of capture completeness. When the bounded exchange explicitly establishes that a shown active development ended, completed, failed, was eliminated, permanently ceased, or was replaced, capture must use `resolve`/`supersede` rather than leaving stale current truth active. The ending event need not itself be persistent. Silence, off-screen status, temporary absence, escape, interruption, uncertainty, scene departure, or loss of PC relevance alone is never sufficient resolution evidence.

A death, destruction, or elimination established by the current exchange ends shown active records, facts included, that depend on that person, group, or thing continuing: conditions they were running, holding, or suffering are resolved (an injury, captivity, occupation, a racket or scheme they ran). The death itself stays current authority: a shown active record describing that subject's state is updated to the new state (injured/robbed -> dead), or a fact is created for it; a death is never left only in resolved/superseded history, which injection does not surface. A merely mentioned, threatened, feared, or suspected death ends nothing. Create/update summaries state the condition that is true now (lasting injury, loss, damage, death, control), not a retelling of the incident that caused it; resolve/supersede summaries may state how the record ended. Named facts reach capture through the ordinary bounded relevance pick; the reserved lifecycle slots and the scene-context antecedent stay development-only.

A bounded already-retrieved prior-scene selector may identify an **interpretive lifecycle antecedent** when the current exchange uses an indirect reference such as “the last two” or “it finally ends.” That selector contributes record identity only, never evidence. An indirect automatic mutation may rely on it only when exactly one such active target remains after bounded selection; ambiguous antecedents fail closed. The current exchange must still establish the changed/ended/replaced state.

For provider-driven capture/rebuild, non-create mutations may target only active records. Resolved/superseded tombstones are immutable recurrence context: they may be referenced by an explicit genuinely new `create` through `newEpisodeOfRecordId`, but automatic capture/rebuild does not update, resolve, or supersede them in place.

Automatic capture/rebuild must not create a standalone record already in a terminal lifecycle state merely to preserve an event. A redundant terminal create may be deterministically consolidated into `resolve` for a sufficiently similar visible active episode; otherwise it is rejected. Any create that consolidates into a non-create mutation must pass the source firewall again against the selected active target. An explicit `newEpisodeOfRecordId` may create a new record only when no sufficiently similar recurrence is already active; otherwise it consolidates into that current recurrence. This preserves the current-reality model instead of turning `records[]` into an event log or duplicating Current.

A single shown incident may establish a persistent **arrangement** when the narration shows a group asserting control over a place, collecting levies/tolls/fees/protection payments, enforcing a blockade/curfew/checkpoint, or bystanders habitually avoiding or submitting to it. The arrangement is captured as a development even though the individual confrontation or payment is one-off. When the arrangement rests on dialogue-borne claims (a new tax, an order, claimed jurisdiction), the summary stays attributed to who is asserting or demanding it; the source firewall rejects unattributed restatements of the claim.

If several independent materially persistent conditions are established in one exchange, capture may represent each once in the same bounded request rather than stopping after the most scene-salient one.

Capture must not run global simulation or fabricate off-screen developments merely to keep the world busy.

## C07. Evolution

Deliberative evolution is targeted, not global.

Automatic evolution may run when one or more records are relevant and at least one bounded trigger justifies evaluation:

- meaningful elapsed campaign time is available for that stale relevant development
- grounded new current-exchange evidence directly affects that stale relevant development

The SillyTavern host passes no affecting evidence: a change the current exchange establishes is captured by capture, not evolution, so the host's automatic trigger is meaningful elapsed time. The affecting-evidence trigger (and the derived development it allows with one cause) is the evolution module's interface for an explicit caller that supplies grounded evidence.

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

Duplicate candidates must consolidate by semantic equivalence plus overlapping anchors/evidence, never by title string alone. Conditions whose shared noun carries different distinguishing modifiers (a direction or ordinal word, a number, or a capitalized name: north/south gate, two named bridges, numbered units) are different subjects and are never merged, however much else they share (a new episode of one is never folded into an active record about the other). A number right after a capitalized shared noun is an identifier ("Squad 12" / "Squad 14", "Gate 3" / "Gate 5"); a number after a lowercase word, a number that counts the next word ("raid Harrow 3 times a week", "5 silver per wagon") or one followed by more digits ("3,000") is a changing quantity of one subject ("has lasted 3 days"). An active record absorbs a new episode only when the two share more than the words of their shared anchors (a plague and food riots that both name "the lower city" are unrelated); linking the episode to its own earlier record keeps the looser anchor rule. A cited excerpt must occur verbatim on word boundaries ("active volcano" is not in "inactive volcano"; scripts written without spaces are matched inside runs of letters). Attribution follows the claim, not the sentence: a cited excerpt whose substance lies inside quoted dialogue is hearsay even with its speaker frame, a reporting verb attributes its own clause, later clauses of the same sentence until a contrastive turn, and a short trailing tag; an unrelated reporting clause does not make a narrated claim hearsay. An excerpt spanning several sentences is reported only when every sentence carrying the change (sharing at least two significant words with its summary) is. A quotation stays open across a wrapped line until it closes, a blank line, or a new line opening with a quote; a quote mark after a number is an inch mark. What a narrated demand, order, threat or promise asks for (in the verb's own clause, within a few words of it) is reported, while the act of demanding itself is narration. A reported, quoted, attributed, planned or conditional account cannot resolve or supersede an established condition (a record that is itself a reported account, worded as reported, rumoured, claimed or believed, may be ended by another report; an arrangement worded as a speech act, such as men demanding a levy, may not). Reporting words count only in their reporting use: "claims" and "states" followed by what is reported, "swore" with an object, "told" outside "all told", and never "warning" ("without warning"), so ordinary narration and nouns ("the Free States", "land claims", "Holy Orders") are not hearsay; a summary is accepted as reported only by such words, a speech-act verb, or prospective wording. A reporting verb inside a relative, participial or temporal clause ("The guard, who reported the theft, now patrols ...") does not report the main clause, and a capitalized title abbreviation or initial ("Lt. Varro reported that ...") does not end its sentence, while a lower-case word or unit ("the scout said no.", "10 ft.") does. Dialogue is marked by straight or curly double quotes, 「」, 『』 and «», and by single or curly single quotes that close within their paragraph (otherwise they are apostrophes); a double quote after a digit closes open dialogue unless it follows feet ("6'2""), and a short title-cased quotation introduced as a name (the "Black Gull", a ship named "Sea Wolf") is a name, not dialogue, while a shouted word stays dialogue. The content of a demand, order, threat or promise stops at a coordinated act ("threatened the villagers and burned the granary"). A claim is prospective when it states a plan, expectation or future ("will" or "might" followed by its verb, never the noun in "against their will"; "plans to", "tomorrow"; modal verbs in lower case only) or stands in a conditional sentence or clause ("If the dam breaks tonight, ...", "Should ..."; not "Whether by luck ..."). Narrated day steps ("the next morning") are narration. Like an attributed claim, a prospective claim may establish only a summary that keeps it prospective; prospective wording never preserves a reported or quoted claim ("The king is dead and the court will choose a successor" is still promotion). An excerpt longer than the 500-character limit is cut at a word boundary. A proposed anchor is supported only as whole words of its evidence ("rat" is not in "pirate"). In scripts written without spaces (Chinese, Japanese, Thai, ...) summary support, target identification and duplicate similarity compare adjacent character pairs (at least one with an ideograph or katakana), and an anchor of two such characters is specific enough to identify its record; two summaries that differ only in a short run of direction, position or number characters ("北門" / "南門") are different subjects. Only an explicit empty anchor list clears anchors; a malformed anchor field is ignored. A threat or promise cited together with what it threatens or promises ("threatened to burn the granary", "promised the miners that ...") is reported: the act is narrated, its content is not done, unless a coordinated act follows it; a demand or order with its content stays a narrated act, since one shown demand may establish a levy or toll. Speech verbs of an action beat (shouts, shouted, yells, yelled, cried, screamed, called out, muttered, murmured, replied, exclaimed) attribute like "said"; forms that are also nouns or other verbs ("screams echoed", "answered the petition") do not, and "said nothing" reports nothing. A plural possessive ("'The soldiers' horses are gone,' ...") closes no single quote when the quotation closes later in its paragraph, and a lower-case elision in mid-sentence ("drove 'em off") opens none, while one opening a line ('Cause ..., 'Round here ...) may open dialogue. A sentence also ends after a closing quote or bracket that follows its stop. "That" is a complementizer only within twelve words of its reporting verb with no turn between, never as a demonstrative ("that night"). An earlier clause attributes a later one only as a frame (it ends with its reporting word, opens with "according to", or is a short reporting clause), never when it reports something of its own ("The captain announced the curfew, soldiers barred the gates"). A claim is reported or conditional only when every sentence stating it is, so narration repeated in a report or an "if" stays narration. "Going to" is a plan only before a verb ("going to the capital" is travel). In the summary checks, modal verbs and "hope" count in lower case only (names such as Will or Hope do not keep a summary prospective), and "refuses" is a state, not a speech act. A summary word repeated counts once toward its support. A null optional field means "not stated" like a null trend: a null status on a create is active and on an update is ignored, never a reason to fail the response. Text is folded for matching without the device's locale (a Turkish locale does not turn "I" into a dotless "ı"), and bounding a text is idempotent (trim, cut, trim) and never ends on half of an astral character such as an emoji, so a bounded summary, anchor or excerpt keeps its identity and its excerpt still grounds.

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

Maintain a reversible mutation journal and bounded checkpoints sufficient to restore proven boundaries. Recovery is exact-boundary only; approximate ancestor substitution is forbidden. A journal entry never claims an undo base below the journal floor: when a commit lands with no rollback head and an empty journal, its base is the floor or a checkpoint-proven equal state, so rolling that message back fails closed rather than keeping the message's earlier changes.

On swipe/delete/edit/truncation/branch:

- exact known boundary restore is allowed
- abandoned suffix mutations are removed
- narration-equivalent rewrites of one or more previously assistant-owned messages may rebase lineage metadata without undo replay only when durable sanitized narration fingerprints prove every changed owned row semantically equivalent; raw lineage keys are still rewritten to the live branch
- no older approximate checkpoint may substitute for a missing parent
- a checkpoint without a snapshot (an old or foreign save) is unusable: recovery fails closed instead of throwing
- SillyTavern hide/unhide flips only `is_system`; a row whose stored fingerprint is reproduced by flipping that flag back is visibility-only, not a story change, and is rebased like a narration-equivalent rewrite (hidden messages still happened; rebuild includes hidden roleplay by default)
- when a real change and visibility-only/narration-equivalent rows are reconciled together, rollback starts at the first row whose story content really changed (or where the chat got shorter); rows before it keep their state and have their lineage metadata rebased to the live keys
- a state with no journaled mutation is exact at a boundary only from the earliest on-branch checkpoint (including the root/import baseline) whose snapshot equals it; this lets deleting back past the first capture restore the baseline instead of failing closed
- an abandoned captured suffix may be parked in memory; if the live branch later reproduces its exact lineage keys (same parent chain and content, e.g. swiping back to an earlier reply) while the current canonical state is identical to the base it was abandoned from, the parked branch resumes by its own exact journal/checkpoints without a provider call; parked branches keep only their own journal entries/checkpoints after the base (resume merges the live ones back), are relinked to the live lineage keys when the same reconcile rebased earlier hidden/narration-equivalent rows, and also when a later reconcile proves such a prefix rebase below their base (their base state is compared by content, ignoring lineage keys), change only after the reconcile result is durably accepted, are never persisted, never cross chats, and a changed base or unproven restore simply declines to resume
- an undo puts a removed record, place, relation or route back at the position it held, so a rolled-back state still equals its checkpoint (undo data written before the position was recorded appends)
- if exact recovery cannot be proven, fail closed and preserve canonical state while marking targeted rebuild/rescan need
- while branch ownership is unresolved or `recoveryRequired` is set, retain state only for recovery/inspection and suppress both Reality and Spatial private continuity injection

No ghost state may survive an abandoned branch.

## C11. Persistence

One canonical per-chat state owner and one sidecar persistence boundary. A canonical mutation is not publishable merely because its sidecar write began while current: current chat/state ownership must still hold after the I/O completes. If it became stale in flight, the previously authoritative state must be compensatingly persisted before the candidate can be discarded; failed compensation blocks the chat fail-closed.

Requirements:

- strict current-schema validation during pre-1.0 development; backward compatibility begins only after an explicit compatibility floor is declared
- deterministic IDs
- revision/concurrency guard
- atomic/corruption-safe writes where host APIs allow
- checksums are taken over a canonical serialization that agrees with JSON (members whose value JSON drops are left out, array holes and such values are written as null, `toJSON` is honored), so a state checks out the same after a JSON round trip
- bounded retry/recovery snapshot (a request that got no HTTP answer, such as a dropped connection, is retried; a retried save that already landed is recognized by its revision and checksum)
- a sidecar that is damaged (not valid JSON, or a checksum that no longer matches its content) is corrupt, not missing and not fresh: the chat is recovery-required and logged, the damaged file is recorded, the cache no longer stands for any server revision (a readable file found later, a restarted revision 1 included, is adopted), and only the baseline recovery write (Full chat rebuild, import or reset) may replace it, at revision 0 against that recorded path. A readable sidecar this version cannot use (another format, envelope or schema version, such as a newer World State's, or another chat's) is never damaged: it fails closed and is never replaced
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

Shared function words (a/the/in/…) never count as overlap or candidate evidence, the bounded phrase scan reads the newest end of the recent window, and Spatial selection needs a name match or more than one shared description word. The recent window the host hands to relevance is bounded like the capture exchange (newest message first within the exchange budget; a long message keeps its start and its end), never a per-message prefix. Within the bounded candidate pool, phrases and words are looked up rarest first by the postings they would visit (longer and newer first among equals), and non-ASCII bigrams are read from the newest text, so a specific or newest mention is never crowded out by a common word. The one-hop cap counts only neighbours that can still be linked (active, extant, not already selected); retired neighbours never use it up. A multi-word anchor is indexed under its content words only, so a function word in the scene never hits every record whose anchor contains it (a one-word anchor, or one made only of function words, keeps every token, since a name may be one). A one-word anchor that is a function word ("Will", "May") matches only where the text uses it as a name: capitalized inside a sentence ("ask Will"), or opening a sentence or quotation when a comma or "!" follows it ("Will, the ferryman, waves") or a word that is not a function word follows it in a sentence that is not a question ("Will nods."); never "they will", "Will you ...?", "Will the bridge hold?" or "May the gods ...". A lower-case name that is also a function word is not recognised. The scene window is tokenised once per selection, not once per candidate. Rebuild's lifecycle reservation counts content words only (the same function-word rule), reads every word of the bounded exchange, and still reserves a development changed in the last twelve messages (an ending may name it by a synonym), after those the exchange touches; such an untouched development is the interpretive antecedent only when the exchange touches no development at all (an ending that names nothing, "it finally ends"). Non-ASCII bigrams are only the pairs that contain a non-ASCII letter, so one accented word never spends the lookup budget on plain-ASCII pairs. A development that leaves the active pool also leaves the background scan list, so it never uses a background catch-up slot. Recency alone never makes an unrelated record relevant. Resolved/superseded records are excluded from normal current-state injection. The default selected set is capped at six records.

No geographic scope hierarchy is required. No model/provider call is permitted solely to choose what to inject.

## C13. Lazy catch-up

A record may remain untouched for many messages.

Phase 4 uses correctness-first catch-up for existing **active developments** through two bounded candidate paths:

- stale relevant developments may qualify from a meaningful elapsed-time hint grounded to the current raw-message boundary, or grounded current-exchange evidence that directly affects that development
- stale background developments may qualify only when a meaningful elapsed-time hint exists; they are drawn from the existing active-development index and do not need to be relevant to the current scene

Ordinary relevance alone is not an evolution trigger. Background selection without meaningful elapsed time is inert. Short passage alone is not automatically meaningful. Opaque fictional time hints are allowed without requiring a calendar engine.

Narrated day steps may accumulate into meaningful elapsed time. When no explicit meaningful skip is present, the host walks the current branch's messages after the last persisted `elapsed_hint` evidence boundary (bounded to the last 40 messages). It counts at most one narrated day step (for example "the next morning", "the following day", "a day later") per user→assistant exchange, ignoring quoted, planned, hypothetical, hidden-planning and system text. Hidden rows are excluded, and a user message repeating the day step the narrator just gave counts as the same day (it uses up nothing: the narrator's next step in that exchange still counts, unless it repeats the same words, which name the same day). It fires a meaningful hint at the message that brings the running total to two days, resets after each firing and at any explicit meaningful skip, and binds the hint to that message's lineage; without that lineage it fails closed. A firing point is offered only while it lies inside the current exchange window, exactly like an explicit skip. Firing points are recomputed from messages, never stored as a counter, so branch changes cannot leave stale accumulation behind. The last persisted elapsed boundary is maintained incrementally on the relevance index from reducer deltas, so ordinary turns never scan the evidence map. An explicit meaningful skip takes precedence; a non-meaningful explicit phrase never blocks accumulation. Accumulated time has exactly the same authority as an explicit skip: permission to evaluate, never evidence of change.

Relevant developments retain priority: at most four relevant targets are admitted first. Background catch-up may fill at most three remaining slots; only relevant developments that are due (evaluated before the skip, or affected by new evidence) take a slot. The combined automatic evolution batch is capped at six developments and always uses at most one provider request.

Background candidate discovery must remain bounded and non-global. The ephemeral relevance index maintains an active-development pool during already-authorized full index construction/replacement and incremental canonical updates. On an eligible elapsed-time boundary, background catch-up examines at most 32 pool entries and never scans all World State records merely to find remote work. The same elapsed-time evidence boundary may trigger at most one background sweep; it must not drain additional remote batches on following turns merely because the original time-skip text is still inside the bounded exchange. A sweep whose evolution fails or yields nothing to save does not count: the boundary is restored and a later turn retries it. One evolution call evaluates at most as many targets as its response may carry evaluations (6).

Elapsed time is permission to evaluate, not evidence that change occurred. `stable` is a first-class outcome. A changed outcome requires either grounded current affecting evidence, or meaningful elapsed time plus prior accepted evidence from that same development.

A stable evaluation may advance `lastEvaluatedMessage` and retain elapsed/evaluation provenance, but must not advance `lastChangedMessage` when current world truth did not change. Every evaluation is asked to cite its target's elapsed/current trigger support; when a `stable` evaluation omits it, the host records that target's own trigger support as the evaluation provenance instead of rejecting the batch (the target was offered only because of that trigger, and nothing changes). Changed outcomes (update/resolve/supersede) must still cite their own trigger and causal support, and any unknown or foreign supportId still invalidates the response.

At most one derived development may be proposed per batch. It requires either at least two supplied causal target developments, or one target plus grounded current affecting evidence. Each declared cause must contribute its own non-time support; support cannot be borrowed from undeclared records. Duplicate/resolved-episode checks apply before admission; with the host's relevance index they compare only the records that share a whole anchor or a counted summary word with the proposal (active or retired, found through the index) and this batch's targets, which is every record that could score as a duplicate (spaceless-script text is still compared with every record).

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

Diagnostics never become canonical state and never store credentials, private prompts, story transcripts, transport headers, hidden/reasoning content, session identifiers, or other connection secrets. The explicit operator-only Operations inspector may retain a bounded slice of the model's extracted text response and bounded rejection JSON for debugging; this is non-canonical telemetry, never evidence/canonical authority, and is escaped before rendering. The host keeps the last 80 sanitized operations per chat (plus the pinned still-unrecovered failures, which the saved log carries too) in a separate World-State-owned server file (`world-state-alpha-ops-<chat hash>.json`, response/rejection text further capped), never in the canonical sidecar. It is loaded when the chat activates, written read-merge-write after a short quiet period under the same cross-tab writer lock as the sidecar so sessions do not erase each other's rows, flushed when a chat leaves the cache, carried to the new owner on rename, and emptied on chat deletion.

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
- no copy of the append-only history on a capture: a state copy deep-copies the canonical domain but shares lineage, rollback-journal and checkpoint entries, which are frozen and never edited in place (a changed entry is replaced)
- a boundary check of a chat with no sidecar pointer reads once (the short retry schedule stays for chats with a pointer, hydration, activation and conflict recovery); an identical sidecar text is verified once per session
- the injection view of the recent exchange needs no lineage keys and fingerprints no message

Rebuild steps reuse the plan's lineage instead of re-hashing the chat prefix; during the run the rebuild's range proof is reused until a host chat event or one second passes, and it is recomputed exactly before the result is saved or reported. The operator panel reads the chat key without copying state. The search box and Places filter keep their text as typed (matching trims it); a re-render puts focus and the caret back into the field being typed in; a record opened by link beyond the bounded list is shown in its own view; Copy copies the JSON shown beside the button; a declined or failed Reset profile keeps the typed values (the host answers whether the reset was saved); and a short landscape window fits the panel to the screen.

Manual inspect/query/correction, rebuild, and Phase 6 UI projection add no automatic normal-turn request path. UI projection/search/rendering is local and must issue zero model/provider calls. Any additional automatic request path requires explicit contract justification and measurements.

## C19. Manual controls and rebuild

Phase 5 exposes host-neutral service functions only. It does not register slash commands, menus, DOM, or SillyTavern event hooks.

Manual inspect/query is deterministic and read-only. A targeted manual correction:

- requires an existing current raw-message head
- requires the stored state lineage to agree with the current chat branch
- requires a concise operator note stored as `manual` evidence
- goes through duplicate admission, the canonical reducer, and the same branch journal
- must not advance automatic capture cadence merely because an operator corrected state

The Phase 7 panel may expose manual lifecycle intent controls for active records. `Mark resolved` and `Mark superseded` must remain thin UI intents: no canonical record ID is rendered or placed in the public UI model, the host validates the opaque row key plus visible snapshot metadata against current canonical state, requires an operator note, offers an editable history summary prefilled from the current record, requires confirmation, serializes the write on the per-chat queue, and then calls the same Phase 5 `applyManualMutation` path. Historical records do not expose these lifecycle controls. The panel may also offer a bulk select mode for the same two intents: the public payload carries only opaque row keys plus visible snapshot metadata for each selected active record (at most 100), the host validates every one exactly as for a single record and cancels the whole batch if any is stale, requires one operator note and one confirmation, leaves summaries unchanged, and commits all selected records through `applyManualLifecycleBatch` as one all-or-nothing manual boundary and one journal entry.

Reset and import are preview-then-confirm operations. Foreign import preserves current semantic meaning but clears local raw-message provenance, branch lineage, rollback history, and local evidence ownership rather than pretending another chat's chronology occurred here.

Rebuild is explicit/manual expensive recovery, never ordinary runtime and never an automatic response to incompleteness.

The Phase 5 rebuild contract is:

- plan the selected chat range in bounded chronological assistant-completed exchange windows using original global message IDs
- explicit rebuild may include hidden roleplay through an immutable virtual view, enabled by default but operator-toggleable; the stored chat array, `is_system` flags, DOM visibility, saves, and lineage fingerprints remain untouched
- in live capture a hidden row is no evidence nor scene context, a hidden user turn no more than a hidden reply, and every row's text is read from its `mes` first, as lineage reads it, in live capture and rebuild windows alike (a stale `content` left on a host row is never captured); in a rebuild that includes hidden messages, hidden user rows may be virtually restored as user evidence; hidden assistant rows require conservative ordinary-assistant markers, while genuine system/tool/UI messages remain system and are excluded
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
- a boundary whose assistant reply has no narration left after sanitization (empty, image-only, or only planning/tracker blocks) is an empty boundary: it is committed without a provider call, exactly as live capture skips it
- otherwise allowlist only explicit successful capture boundary outcomes (`applied` / `no-change`); timeout, cancellation, skipped/unexpected outcomes, stale scope, malformed response, provider failure, or supporting-context failure discard the entire candidate
- a genuine boundary failure (not cancellation or stale scope) leaves an in-memory, never-persisted resume point: the candidate accepted before the failed boundary plus the run's snapshot token and plan key (start, boundary limit, hidden inclusion, window lineage); the processed count is derived from the plan, never trusted. Only an explicit operator **Resume** that names the failed message consumes it, re-sending the failed boundary's unmodified request and continuing; a repeated or late request for an older failure cannot consume a newer point. It is refused before any reconcile, status, or provider side effect unless the canonical state and exact chat lineage still match the failed run's snapshot and the rebuild settings (plan, Spatial enablement, bootstrap mode, connection route) are unchanged, so one rebuild never mixes models. The connection route is fingerprinted, not just named: the selected profile's full settings (and every boundary of the run is pinned to that signature, as it is to the host connection and model of that same snapshot when no profile is selected and the model can be read), or for the host connection its API, chat-completion source or text-completion type, and model (an unreadable model never matches), plus the output cap. It is consumed only when the resumed run actually starts, so a temporary no-call refusal (for example an unavailable base map) keeps it. Any new canonical state, a new rebuild, import, reset, a completed rebuild, or leaving the chat discards it; the chat merely growing (a lineage-only forward extension) does not. A rebuild that throws past its own handling, or whose conflict rehydration fails, ends as failed rather than staying running. A resumed run reports whole-rebuild totals (earlier segments plus its own)
- a live capture boundary whose latest attempt failed (provider error, timeout, malformed response, a failure thrown before capture could start, such as a failed server read or branch restore, unless that reply was swiped or edited meanwhile, abandoned as `stale` by a chat switch or setting change, a capture queued behind other work or a settling swipe/edit capture that a chat switch abandoned before it started (also when a step before the start then fails) (recorded `stale` with the keys of the message as it was when the reply arrived, unless the cached state already holds that reply), a capture dropped because the branch could not be proven (`WORLD_STATE_CAPTURE_BRANCH_UNAVAILABLE`), or any outcome other than `applied`/`no-change`/`superseded`/`skipped`) and that was never recovered is offered as **Recapture from message N**. A capture whose own message was swiped, edited or deleted before it finished is recorded as `superseded`, which settles that version only; a capture dropped after its result, or written and then compensated, is recorded as a failure. Recovery is derived only from the non-canonical Operations log and is keyed by message and lineage key; capture rows that can list or clear a failure also carry a hide-insensitive lineage key (the lineage chain with every hidden flag ignored), used only to match Operations-log rows so hiding or unhiding an earlier message neither hides nor strands a failure, never for branch ownership: a later successful capture of the same message and lineage (or the same hide-insensitive key), a completed rebuild whose range covers it, from its start to the last message it read (a reply added and missed while the rebuild ran stays listed; a completed rebuild also drops parked branches), or an import/reset clears it; a capture whose sidecar save fails or is discarded by a revision conflict is recorded as a failure; only messages that are still assistant replies (hidden or not) on the current chat with a matching lineage or hide-insensitive key are listed; a partial rebuild proves its prefix after a full branch reconcile, never the tail-only fast path; a saved Operations log that cannot be read (anything but missing or corrupt) is never treated as empty: the save is postponed and retried, a rename leaves its rows in place, and a failed load is retried; a failed upload is retried the same way (a cached chat's retry is a pending timer flushed on leave/hide; rows still unsaved after the retries are parked and merged back on that chat's next load or save); a rename clears the old log only after the new owner's log durably holds its rows; log trimming never drops a still-unrecovered failure row, nor a recovery row that clears a failure still in the log (dropped together, the server's copy of the failure would come back on the next save; such a row is kept without taking a stored answer from a failure), pinning at most the 400 rows of the earliest failed messages (Recapture starts at the earliest one; older pinned rows drop their stored model answer), a rename's log migration never holds two log locks at once and follows chained renames to the live owner, and the saved log is merged again before a recapture starts. Recapture is a From-message rebuild starting at the earliest listed failure, confirmed before any write (including the branch sync), with every rebuild guarantee (exact prefix or refusal, atomic replacement, resumable failure); the request must name that current earliest failure, it never runs automatically, and it is not a correction retry. When the exact prefix is no longer journaled the panel points to Full chat instead. Instead of recovering it, the operator may **Forfeit** a listed missed capture (one message at a time, up to the 40 earliest listed, outside the rebuild sheet; refused at once while a rebuild runs, never queued behind it): after the saved log is merged and the message is confirmed to be still listed, and after a confirmation, the host records a `forfeited` capture row for that message's current lineage and hide-insensitive keys (from the live chat when the cached lineage does not cover it). It clears that version's failures exactly as a successful capture would (a later failure of that version is listed again, another swipe's failure is not touched), is saved at once, and changes no World State: what the reply established stays uncaptured unless the operator adds it by hand, though a later Recapture or rebuild that covers the message still re-reads it. It reads and writes only the Operations log, so it needs no sidecar read and works while a baseline is required. A failure row, and a recovery row while a failure is listed (judged before the row is recorded, so a trim cannot hide the failure it clears), is saved at once rather than after the log's quiet period; a log save that overlaps the chat leaving the cache saves the rows it started with and does not mark the cleared chat loaded; a deleted chat's log clear is retried, and a retry never revives a rename target renamed or deleted since; a start at message 0 is a clean-root rebuild and therefore always provable
- a structurally malformed Reality or Spatial mutation row inside an otherwise valid envelope invalidates the rebuild boundary (an update carrying only a status or related records is well formed); a row past the per-response cap (8 Reality, 8 Places rows, both stated in the prompt) is rejected on its own and never fails the boundary; semantic admission rejections such as duplicate/resurrection blocking may still produce a valid no-change boundary
- a Reality-only rebuild preserves the disabled Spatial namespace instead of interpreting disabled extraction as deletion, and keeps its rollback ownership: each Spatial change from the original journal is replayed at the first rebuilt boundary at or after the message that made it (changes after the chat's first real story change are not replayed; hide/unhide and narration-equivalent rewrites are not story changes), so partial rebuilds keep changes in their range and rollback undoes places with their reply (changes made after the last assistant boundary, or in a range with none, are committed at the chat's last message, where they were made, never folded into the earlier reply, and nothing is committed there when no change was made; a missing chat is an empty one); places held before the journal floor bound the rebuilt journal to that floor; when the story changed at or below the floor while places existed, Reality is still rebuilt, the places held at the floor are kept, and the operator is warned that some may belong to an abandoned branch
- atomically replace canonical state only after the complete chronological pass succeeds
- support controlled semantic comparison between incremental and rebuilt current state even when evidence source classes differ

Normal runtime must never depend on recurring rebuilds.

## C20. Ukiyo / story-driving CoT boundary

World State does not modify Ukiyo, Megumin Suite Beta, Writer's Mind, or the RP CoT.

World State Alpha may consume narrative produced by an RP model using a story-driving CoT such as Writer's Mind, but those instructions are not inherited by capture or evolution. Rebuild reuses the capture firewall and likewise does not inherit story-driving instructions.

Story-driving principles such as autonomous world motion, scene variation, chance, escalation, or avoiding stagnation are narration concerns and are not evidence that a world change occurred.

World State records or evolves state only from its own grounded evidence and causal contract.

Writer State, narrative plans, Story Director output, anticipated events, consequence timers, arc/scene planning, and spatial hypotheses are not canonical World State evidence. Before Reality Core capture, Spatial capture, rebuild, elapsed-time detection, or evidence validation evaluates assistant narration, planning-only tagged blocks are removed from the evidence view only (a self-closing planning tag removes only the tag, and a closing tag may carry spaces before its '>', for `World_State` too). Model reasoning blocks (`<think>`, `<thinking>`, `<reasoning>`, and reasoning ending at a lone closing tag whose opening tag was in the prefill, which is the last closing tag that narration follows, so a stray closing tag after narration that an earlier tag ended removes only itself; a reply that ends at its only closing tag is reasoning with no narration) are removed the same way, as are the planning sections of a `World_State` block (planted seeds, consequence timers, arc and scene phase, CYOA, inner chatter, inventory, skills); its Off-Screen and Unresolved entries stay (a section ends at the next heading, plain or bold; numbered entries and every bullet style the checklist reads, `- * + • ‣ ◦ ▪ ●`, are entries, not headings). Raw chat storage, raw-message ownership, lineage fingerprints, and branch history remain unchanged. Elapsed-time catch-up additionally requires an established chronology transition: system messages, quotations, hypotheticals, future plans/appointments, and bare prospective `next ...` phrases are not elapsed evidence; nor are travel times, schedules and durations ("a week on foot", "leaves after two weeks", "kills after three days"): "N units on" counts only when it ends its phrase or line and "after N units" (and the "after a day" day step) only when it opens its sentence or clause, emphasis or an opening quote allowed. An unknown amount stays unknown. Every elapsed phrase is judged at its own position (never where the same words first occur) with its full sentence and any quotation around it (dialogue is paired exactly as the source firewall pairs it: across a wrapped line until it closes, in every quote style, with single and curly-single quotes counting only when they close, so a contraction's apostrophe ends nothing; `'ll` is prospective), so rejecting one phrase never strips the context of a later one. The newest meaningful skip in the exchange decides (within a message, the last one), and a later short span ("An hour later") never cancels it; with none, the newest short span is reported (a development evaluated at a skip is not due again, so re-detecting it never re-fires). A modal, planning word or "if" voids a phrase only in the phrase's own clause ("would" and "could" only before the phrase, since they also narrate the past; a participle after a determiner, "the expected caravan", is an adjective; "their will" and "all their might" are nouns; "as if" and "even if" state no condition) (a fronted time phrase belongs to the clause it introduces) or when its sentence opens with a condition or "Hypothetically", and "will" counts in lower case only (a character named Will does not; capitalized "Could" or "Hypothetically" still count). Recognised skips include "had/has passed", "gone by", "elapsed", plural units without an amount ("Weeks later", "Months passed"), numbers up to the hundreds ("Twenty years later"), fortnights and decades (two weeks and ten years, also when a hint is normalized), and "the next/following <unit>"; a bare "next <unit>" stays prospective. "A few", "several" and "many" are unknown amounts. Each day step is judged where it stands, so a prospective first mention does not hide a real step later in the same message. Accepted elapsed support retains a bounded surrounding narrative sentence rather than only the matched time phrase.

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
- UI namespace/classes remain isolated under World State Alpha; the only host-element rule is that the host's own toasts are raised above the panel while it is open (a body class the host shell sets and clears), so a panel error is never hidden behind it
- the panel is a modal dialog for keyboard and screen-reader users: it takes focus when it opens, a re-render keeps focus on the control that had it (or returns it to the dialog), Tab and Shift+Tab stay inside the top layer (controls inside a closed disclosure are not stops), Escape closes the innermost layer (a menu, the rebuild sheet, the place form, Map settings) and then the panel, but never a form holding unsaved edits (only its own Cancel does), a newly opened rebuild sheet takes focus, and status changes (a rebuild's phase, a missing baseline) are announced through one persistent live region outside the re-rendered markup
- emptying the search view's own search box keeps the search view (it is the only search box on phones); emptying the navigation search returns to the records
- record rows are keyed by position (the public model carries no record ids), so a click is read against the rows and tab last rendered and carried to the same record (by content, among all records) in the current state; one no longer there is not acted on
- a rebuild reports the active campaign places it holds, never archived or base-map places

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

The host uses an owner-qualified per-chat key so equal chat filenames belonging to different characters/groups cannot share World State storage. A tiny sidecar pointer may live under World State's own extension settings; canonical bulk state remains in the World State sidecar. Canonical hydration must wait for SillyTavern host readiness rather than treating DOM readiness as storage readiness. A missing-continuity or corrupt-sidecar stand-in held while recovery is required carries no hydrated revision or pointer, so it can never be written over the server file as if it were the hydrated state. If the pointer is missing or has stale revision/checksum metadata, the host retries and may recover the same owner-qualified sidecar from its deterministic World-State-only host path, then rechecks provisional fresh hydration after extension settings finish loading. SillyTavern character/chat renames must migrate that ownership key without exposing a fresh empty continuity state: renaming a chat that still needs recovery and holds only an empty stand-in (no baseline, a missing or damaged sidecar; a damaged source is reported, never thrown) writes nothing for the new name, which stays recovery-required (its Operations log follows the rename), while a cache holding real continuity (a sidecar that became unreachable) is carried to the new name as before; a damaged sidecar stays recovery-required on every activation rather than becoming a load error; `CHARACTER_RENAMED_IN_PAST_CHAT` must rebase only proven lineage metadata for the renamed messages rather than treating a host cosmetic name rewrite as a story branch. Chat/group-chat/character deletion must resolve the exact owner or fail closed, persist a lifecycle ownership tombstone, and neutralize the retired sidecar to empty continuity when possible so later identity/filename reuse or a settings-save crash cannot resurrect unrelated state. Sidecar writes for the same target are serialized before revision check/upload, using the browser Web Locks API when available and an in-process queue otherwise. The revision check reads exactly the file the upload replaces (the sanitized name under `/user/files/`, whatever form the pointer path took, and a recorded damaged path is compared in that same form), and a file that belongs to another chat is never replaced. Without Web Locks (an insecure context such as plain HTTP on a LAN) another tab can pass the same check in between; the write then reads its upload back and reports a revision conflict when the file no longer holds its body, which narrows but does not close that window. A freshness check that overlaps one of this session's own sidecar writes reports a race instead of adopting what it read, and a stale write's compensation is recorded as this session's revision. A load overtaken by an ownership change leaves the newer load's result alone. Ownership epochs invalidate stale hydration/write completions across rename/delete transitions. A reachable pointer/sidecar failure or an established chat with no reachable sidecar is never converted into ordinary fresh continuity. Automatic capture/injection and ordinary writes pause; only Full chat rebuild, bundle import, or explicit reset may establish a replacement baseline. A different SillyTavern backend is not assumed to share the original backend's `/user/files` store. On the same backend, the `/user/files/world-state-alpha-*` sidecar is the canonical authority across tabs, browsers, desktop, and mobile. A hydrated in-memory state is only a disposable working copy and its presence never proves freshness. The host retains the sidecar revision/checksum that produced that working copy, rechecks durable authority at meaningful lifecycle/mutation/resume boundaries without permanent polling, and replaces derived caches when a newer durable revision is observed. Canonical writes use the revision token owned by the hydrated working copy rather than a possibly newer settings pointer, so stale cached state cannot borrow another session's revision and overwrite it. A revision conflict rejects the stale writer and rehydrates the durable server state, even when the server's revision is lower than the one this session held (the file was replaced, for example by another device's recovery), as long as the read is not older than the revision the conflicting write found; a read older than that is still ignored as a stale read. An adopted server state whose lineage is not a prefix of the local chat, nor the local chat of it, keeps the branch dirty and its private injection cleared until a reconcile proves the branch. If that newer sidecar is a strict continuation of a locally stale SillyTavern chat, World State fails continuity closed until the host chat catches up rather than reconciling the durable state backward. A strict continuation whose tail lineage key equals the tail this session last proved against its own loaded chat is instead a local truncation (delete, or the delete half of a regenerate) and rolls back normally before SillyTavern builds the next prompt; the proven tail is in-memory, per chat, and cleared with the chat's runtime state. For canonical mutations, the host persists the candidate sidecar before publishing that candidate into the in-memory canonical cache, and derived indexes are published with it: background evolution never publishes its record changes into the shared relevance index before its save succeeds, and whenever its result is not saved (stale, conflict, error, or a chat change) the index is rebuilt from the state cached afterwards (the prior state, or the newer server state a conflict hydrated), so its catch-up cursor never skips unsaved work. A cosmetic past-chat rename rebases and writes the recovered server sidecar with its own revision, never a cached copy with a newer revision token.

Normal lifecycle ownership:

- completed assistant message -> reconcile exact branch -> at most one eligible capture request -> canonical reducer result -> branch journal ownership -> sidecar persistence
- user message before the next generation -> hydrate/prepare from the last durably committed branch-safe state -> compact private injection immediately -> serialize optional provider-backed meaningful elapsed-time/background catch-up on the existing chat writer queue for later injections
- chat load/change -> cancel World State in-flight work, hydrate, reconcile current owned state one activation at a time per chat (a chat hydrated by this activation is not read from the server again; the missing-continuity warning waits briefly and is dropped when a rename of that chat is being migrated, since the host reloads a renamed chat before announcing the rename) (overlapping load events never race their own restore writes; activation does not wait on the writer queue, so a long rebuild never holds back the reloaded chat), then refresh only the World State prompt/UI
- edit/delete/swipe lifecycle -> synchronously mark the branch dirty, clear the latest passive-capture compatibility token, advance the state epoch/cancel World State requests, then run exact `reconcileBranch`; narration-equivalent passive host rewrites may still rebase when no explicit branch event was observed; while a manual rebuild runs, the host is not held for it: the branch stays dirty (no World State injection) and the reconcile runs after the rebuild
- presentation-only assistant rewrites -> durable lineage role + sanitized narration fingerprints may prove one or many changed historical assistant rows narration-equivalent and rebase owned lineage metadata without undoing canonical state; the latest captured boundary also receives one bounded O(1) raw-fingerprint watch so delayed host normalization cannot hide behind a newer unchanged tail
- semantic assistant edits, user edits, swipes, deletes, and truncations -> use ordinary exact rollback when the change is proven
- a swipe to an already generated reply, a swipe deletion, or an edit of the latest reply changes the visible reply without `MESSAGE_RECEIVED`; when the change is at the latest message and not failed closed, the host schedules one ordinary capture of that reply after a short settle delay (browsing swipes cancels it, overswipe generation is left to `MESSAGE_RECEIVED`, and a resumed parked branch already owns the boundary so capture is skipped); a change further back rolls later messages away and tells the operator that only an explicit rebuild recaptures them
- character/chat rename -> migrate the owner-qualified World State key and pointer only after the new owned sidecar is durably written, carrying the server sidecar (authoritative over this session's cache). The destination may be replaced only when it holds nothing to protect (still the retired revision, or an empty state, for example written by the renamed chat's own activation); any other destination continuity refuses the migration. Every sidecar write, a chat's first write included, is revision-checked against the stored file and never overwrites it blindly; host historical-name rewrites rebase proven lineage keys without rolling current world truth backward
- chat/group-chat/character delete -> resolve exact owner ownership, neutralize the retired sidecar when possible, persist a lifecycle tombstone, then remove active pointer/cache ownership; ambiguity preserves data fail-closed
- routing/enablement setting changes -> advance the state epoch and cancel matching provider work before new settings take effect; the two injection toggles only change what is injected and cancel nothing; a Spatial toggle that loads the base map indexes the state cached once it has loaded
- a rebuild that cannot start because its range or state changed while the base map loaded says so; leaving a chat discards its failed rebuild's resume point
- a Connection Profile request failure keeps the provider's own error text (rate limit, authentication) in its message
- a character rename that rewrites message names moves the Operations-log rows of those messages (lineage and hide-insensitive keys) to the new keys, so a missed capture stays listed; a moved row is stamped and wins every later merge, so another session's older copy never puts it back
- importing a base map registers it for other chats only after it is attached and saved (a declined or failed import changes nothing), and detaching reports success only after the save
- import, reset and Full chat rebuild -> after the replacement is saved, reconcile the branch once more (persisting a restore it needs) before the prompt is rebuilt, so a chat edited while it ran is never injected from the replaced state

All asynchronous provider-backed work is guarded by current chat identity, exact raw-message lineage, and local state epoch; a capture takes that guard before it waits on anything (a base-map load included), so a swipe during the wait discards it. Host ownership-changing operations additionally use an ownership epoch so stale hydration or persistence completion cannot repopulate a renamed/deleted owner. Provider currentness is rechecked across persistence: a candidate that becomes stale during sidecar I/O is compensated with the previously authoritative state before publication. Stale completion is otherwise discarded. A manual rebuild works on a frozen copy of the chat as it was when it started (a resume on the exact range of the failed run) and is guarded by that range's lineage: messages appended, swiped, regenerated or deleted after the range while it runs (the operator keeps playing) neither make it stale nor cancel its provider calls, and their replies are captured live after it is saved; any change inside the range, an explicit invalidation (settings, ownership), a chat switch, or new canonical state (another device's save) still stops it. New canonical state means a change of the canonical domain: a lineage-only forward extension (a reply appended after the range) is not one. Opening the panel merges the saved Operations log again (rate-limited), so a missed capture another device or tab recovered is not offered here. Provider-backed automatic work and operator maintenance/Spatial mutations for one chat are serialized through the same per-chat work queue. Automatic assistant capture must not keep SillyTavern's awaited `MESSAGE_RECEIVED` render/save event open. Provider-backed continuity/evolution must likewise not keep the awaited `MESSAGE_SENT` preparation path open: that event publishes only the last durably committed safe state for the current generation, then queues remote completeness work whose committed result is eligible for later injections.

The host calls `setExtensionPrompt` only for `world_state_alpha_private_continuity`, SYSTEM / `IN_CHAT`, at the configured shallow depth. Disabling, leaving a chat, or failing hydration clears only that World State key. The host never mutates global RP provider/model/preset settings.

Phase 7 mounts the existing Phase 6 panel through one World-State-owned root and a small, natively collapsible settings card. Since 0.9.0-alpha.30 it may also mount a single World-State-owned floating button (`launcher.js`: movable, per-browser `localStorage` position, left-side default, toggled by the `showLauncher` setting) that only opens the existing panel. It does not add a watchdog/MutationObserver framework, cross-extension launcher coordination, or a generic slash-command surface. Maintenance remains a host projection over Phase 5 services:

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

State copies are bounded per boundary and never scale with chat length: an ordinary capture that is saved copies the state six times (the reducer's private copy, the commit's copy, the commit's checkpoint snapshot, and the save's validation, verification and cache copies; only the frozen history entries are shared), and a user turn whose continuity needs no evolution copies it not at all; an evolution run that changes nothing (skipped, stale, failed or an invalid response) returns the state it was given, so a user turn copies the state only when evolution applies a change. The commit reads the state before the change in place (undo patches copy what they keep) and returns its own copy without copying it again; a writer checking revisions and checksums reads a verified sidecar without copying it; a reconcile that only extends or re-proves the lineage compares the lineage entries' fields and the recovery status, not the whole domain. Evolution with no derived development reduces once. The journal's undo patch is built only at the commit boundary, and a Places pass with nothing to apply is skipped (a capture with no Places proposals copies no Places state). A manual edit reads the state in place, reuses the lineage its boundary check computed for the commit, and a Places save applies each of its steps once on one chat fingerprint. A rebuild refuses a chat over its boundary limit before it reads, hashes or copies a message, and hashes the chat once for its plan, its resume check and its range proof. The panel recounts assistant replies only after a chat event, another chat, or a second. A rebuild takes one exact range check when it returns, and again after its save. Panel clicks read the model of the last render only while canonical state is still the object it was built from (a state that arrived without a refresh is read afresh); the host re-validates every action against canonical state. No runtime path copies a state right before normalizing it.

### C23.2 Indexed relevance bound

The Phase 8 index is ephemeral and non-canonical. It must not be serialized or treated as source authority.

Normal indexed retrieval must not iterate the complete record corpus, the complete exact-anchor dictionary, or every posting list. Query terms drive bounded posting-list lookups. Posting traversal and candidate scoring have hard deterministic caps. Exact/anchor evidence receives priority over weak common summary-token evidence before candidate truncation.

Once admitted to the candidate set, active records use the existing relevance scoring and one-hop expansion rules. A separate ephemeral bounded tombstone posting index may surface at most a tiny resolved/superseded admission slice to ordinary capture so recurrence can pass the existing new-episode/resurrection gate; tombstones remain excluded from current-state injection. A non-indexed compatibility path may remain for host-neutral/manual regression use, but the real normal-turn host path supplies the index.

Full index rebuild is restricted to hydration and whole-state replacement/recovery paths. Routine canonical mutations update the cached index using small non-persisted reducer deltas. Incremental refresh must preserve generic persisted relation edges as well as causedBy/affects adjacency.

### C23.3 Evidence compaction

After successful canonical mutation, live `state.evidence` may contain only evidence still referenced by retained records. Unreferenced evidence is pruned deterministically.

Compaction must preserve exact rollback. Undo data must retain any removed evidence necessary to restore a prior proven boundary. Persisted schema/sidecar/bundle/journal format versions remain unchanged.

### C23.4 Version and package reproducibility

For the Phase 8 / 0.8 release, application version was `0.8.0-alpha.1` and all persisted format versions were 1. Phase 9 intentionally bumps only the canonical state schema to version 2 because durable Spatial state is added. The 0.9.0-alpha.7 through 0.9.0-alpha.21 hardening releases change no envelope/schema format version: sidecar, bundle, and rollback-journal envelope formats remain version 1 and canonical schema remains version 2.

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

Spatial Continuity is disabled independently by default and is setting-agnostic. The durable profile is generic Cartesian 2D metadata: north/east axes, unit scale, optional bounds, decimal precision, and True North lock.

Coordinate Profile authority is explicit. If a base map is attached, its profile is authoritative and operator editing is disabled until detach. Without a base map, the campaign profile is manual/operator-editable. The runtime must use the same effective profile for capture, injection, relation validation, deterministic derivation, and UI projection.

A campaign with Spatial enabled but no configured profile may still retain named places, explicit coordinates, and relative-only relations. It must not inherit a hidden unit scale, bounds, or True North transform. Scale-based coordinate derivation requires an explicit profile with a positive unit scale; locked direction validation requires an explicit profile. The declared north/east axes are part of the math rather than decorative metadata.

Changing manual profile math (orientation, unit scale, bounds, or decimal precision) invalidates coordinates whose authority is `derived`. After explicit operator confirmation those coordinates are cleared atomically to unknown in the same journaled profile mutation. Manual, narrative-explicit, campaign-override, and base-canonical coordinates are never cleared merely because profile math changed.

Route, road, river, and sea-lane geometry may curve. Route/travel length is not Cartesian displacement unless accepted evidence explicitly establishes straight-line/direct displacement. A distance is straight-line only where the sentence stating it says so ("as the crow flies", "straight line", "direct distance"); a ride, walk, march or road length in that sentence is route travel, and a model's straight-line label never promotes an unqualified distance. An unqualified restatement of the same distance keeps the relation's established mode.

### C24.2 Base map versus campaign state

Read-only base geography uses one canonical base-map document shape: optional source metadata, optional Cartesian `profile`, `locations[]`, and optional `routes[]`. A null or empty coordinate value is unknown (never the origin), and a base place without a known position is unknown and unlocked rather than a locked base-canonical point. Places without ids may share a name; later places of a repeated name are told apart by their order among the places of that name, so adding, removing or moving other rows never re-keys them (ids remain the stable identity). Routes without ids are told apart the same way. Bounding a stored text field is idempotent (trim, cut, trim), so a stored map re-parses to its own digest; a stored map whose own content still matches the pointer's digest loads even if an earlier release computed that digest differently. Overrides of two base places with the same name get distinct ids. World/setting name and source version never select parser behavior. Derived base-map/location/route identity is independent of source version so ordinary source revisions do not orphan campaign overrides; the content digest still changes when source content changes.

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

A locked or higher-authority coordinate may not be silently moved by lower authority. Authority protects a known position: a narrated confirmation of the same position (a locked one included) adds its evidence and permitted metadata and keeps the stronger authority, and a place with no position (a position-less campaign override included) may receive a grounded coordinate. Unlocking a manual coordinate explicitly permits a later grounded higher-ranked observation to correct it; manual edits of a campaign override (Lock, Unlock, Save) keep its campaign-override authority, so unlocking an override never makes it movable by narration. Provider-authored rebuild mutations are narrative authority, not operator authority, and therefore obey the same base-map, lock, coordinate-rank, and manual-metadata restrictions as automatic capture. Provider response extraction may unwrap a standard text envelope such as `choices[0].message.content`, but hidden/reasoning fields are never capture output. Provider wire compatibility may repair only deterministic, unambiguous field-name aliases whose values preserve the canonical meaning (currently `category` -> `kind` and `description` -> `summary`). Canonical and alias fields that conflict remain structurally invalid; compatibility repair must be counted in bounded diagnostics and must not weaken atomic rebuild failure. Connection-profile transport extraction may accept either an already-extracted text/content string or the raw OpenAI-compatible `choices[0].message.content` field; hidden `reasoning_content` is never capture evidence or output.

Precise X/Y must never be invented merely because a location exists. Relative-only and unknown are valid durable states. A narrative-explicit coordinate is stored as narrated: the nearest narrated pair within the profile's precision step, never the model's own numbers.

Deterministic derivation is allowed only from a known anchor plus grounded direction and grounded straight-line/direct distance under an explicit configured profile with a positive unit scale. Cardinal and diagonal vectors use that profile's declared north/east axes and unit scale. Vague distance and route/travel distance do not yield exact coordinates.

When True North is locked, any stored compass direction whose endpoints both have known coordinates must agree with the coordinate delta, read where the places are now (an override created or moved earlier in the same batch included); a free-text direction ("upriver") has no delta to contradict and is kept. Direct relation proposals use the same grounding policy as relative-location proposals: accepted narration must ground the endpoint identities and any direction, numeric distance, or distance meaning that is persisted. Unsupported precision is removed or rejected rather than canonicalized. For an otherwise grounded proper named location, failure of optional relative-position metadata may drop only that unsupported relation while retaining the location with unknown position; generic scenery does not receive this salvage.

### C24.4 Admission and evidence firewall

Generated-location admission is conservative. A place may be retained when grounded evidence establishes at least one durable signal such as a proper name, explicit position/coordinate, revisit, persistent infrastructure/resource/NPC association, route-landmark role, material consequence, or explicit manual creation. Generic unnamed scenery is not durable geography.

Spatial automatic capture shares the existing eligible Reality capture request. It may add a bounded `spatialMutations` envelope to that response, but it does not create a second automatic provider call.

Every automatic Spatial mutation passes its own source/evidence firewall and reducer. A present but non-array `spatialMutations` is malformed output and fails the boundary. A coordinate is narrative-explicit only in a cited sentence that names its own place (its full name or every distinctive name word, or a sentence that refers straight back to it, "It sits at ...", right after a cited sentence naming it), never from another place's sentence, an uncited sentence, or quoted dialogue (paired like the Reality firewall's: across wrapped lines and in every quote style). A relation's direction and distance are likewise read only in cited, non-dialogue sentences naming one of its places, the compass word used as a direction ("north of", "lies north", "due north", "12 km north", "to the north, where ...", "northward"; never "the north wind" or "the north gate"); a sentence counts as cited only when part of the claim lies in it or it lies in the claim, never for merely sharing words with it, and a thousands separator belongs to its number ("1,200 km" is 1200). Route names a place lies on (`routeRefs`) are kept only when its evidence names them. A relation is judged against the coordinates after this response's places are saved, so a place moved and related in one reply is judged where it now is; a new place whose own narrated position contradicts its stated direction from an anchor this reply does not move is rejected with it. At most 8 Places rows are read per response (the prompt states the cap); a row past it is rejected on its own and never fails the response, and every rejection, the reducer's included, carries the model's row number. Narration naming a base place whose campaign override the operator archived, or a campaign place the operator archived (not merged; a base-map place of that name is still that place), neither updates nor re-creates it (a header naming it is not logged each turn), a merged-away duplicate's name (`mergedInto`, recorded by the merge), and a base place whose override was merged away, mean the place it was merged into, and narrating a base-map route's name, or naming its id, never creates a campaign route that would replace it (a route id the campaign does not hold is dropped); places whose every grounding sentence proposes building or imagining them ("if we built ... it would") are not created, while conditional travel to a narrated place is not hypothetical. A deterministic header supplement emits only what the header establishes, so an existing place keeps its type, context and notes. When a place (including a base-map place through a new override) moves under a locked True North, a stored compass direction its coordinates contradict is cleared (its distance stays); free-text directions are left alone, and an automatic move that would contradict an operator-owned or manually evidenced direction is rejected instead. Merging a place moves every relation and route endpoint addressed by the source's stored or effective (overridden base) id to the target's effective id. An override answers to its base id only while that base place exists (assumed while a base map is attached but unavailable); once the map is detached or replaced without it, the override is addressed by its own id. Detaching, re-attaching or replacing the base map moves relation and route endpoints between an override's base id and its own id accordingly (an attach without the new map at hand moves nothing). A new place never reuses a stored place's id. A multi-token proper generated place name may be admitted compositionally only when every normalized name token occurs together in one accepted evidence claim; this is a bounded grounding rule, not fuzzy name inference. A generated name grounds only as whole words where words are space-separated without attached particles (Latin, Greek, Cyrillic, Armenian, Georgian letters and digits: "Oak" is not in "cloak"); Korean particles, Arabic/Hebrew prefixes and scripts written without spaces may attach to its edge. A coordinate written beside a header name ("Old Mill [12, 4]") is not part of the name. A narrated place that matches a base-map place by name is that place even outside the visible set (looked up through a per-map name index, never a scan), so it is not duplicated as a campaign place; a name several base places share is rejected as ambiguous, and an archived or merged override is never updated by narration. A Places relevance index built while the base map was not at hand (a failed load, another device's newly attached map) is rebuilt once the map is, so base places reach capture and injection. Name matching folds case and punctuation the same way in capture and the reducer. A relative relation links to the place its new name was saved as, including a same-name place matched outside the visible set; one whose place was not saved is reported, never dropped silently. A direction is read the way the narration states it: in "<direction> of <place>" the place after "of" is the reference point, so a relation or relative position proposed the other way round takes the opposite compass point (where one name starts the other, the longer one standing there is meant); a relative position is never derived from an anchor the same reply moves (a narrated coordinate that differs from its own; restating it moves nothing); a direction that is not a compass point or a known free-text form ("constructor") grounds nothing; an update needs evidence naming the place it updates by its own name (evidence about another place never updates or renames it); naming a plain base place (no override) changes nothing and logs no rejection; an empty relative placeholder states no position; a `World_State` header coordinate counts in the Loc part, an unlabelled field after it, or an axis or position field anywhere on the line ("Date: (3, 12)" is no position) and its claim is cut on a word. A relation stated in reverse ("Oakvale lies west of Millbrook" for Millbrook east of Oakvale) updates the existing relation with the opposite direction instead of adding a second one ("north-east" is northeast; a free-text direction has no opposite and stays a relation of its own). Spatial rejections carry the model's own row number, unshifted by invalid rows or header supplements. `writer_state`, planning blocks, anticipated events, and model-only hypotheses are not evidence. Rebuild uses the same sanitized evidence view. Within the bounded current exchange only, deterministic parsing may supplement a successful model response from an explicit `World_State` current-location header by proposing the named place and unambiguous same-header X/Y pair through the ordinary Spatial admission/reducer path. It may merge with a matching model proposal, but ambiguous/conflicting associations fail closed; it never directly writes state or bypasses base-map authority, currentness, journaling, rollback, or Spatial disablement.

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

Unsaved form edits (a place being edited, the Coordinate Profile) survive any re-render of the panel; a rejected or failed save keeps the form open with them, and they end when the form closes or the profile is saved or reset. A field the host controls (a base-map profile) always shows the host's value. The place editor keeps the relation it opened with; if that relation disappears, its fields describe a new relation and no other relation is replaced. A relation the form shows unchanged is left untouched on save, and a changed one keeps its other place by id, so a place related to an archived place can still be saved. The panel is never re-rendered while an input method is composing text (a click on another control ends that hold); the search runs on the committed text. A panel action that fails reports the error to the operator. A declined, rejected or failed Archive, Merge or Delete keeps the edit form and its unsaved edits (only a saved one closes it), and Add place stops at any cancelled prompt. A free-text relation direction ("upstream") cannot be reversed: it is shown as stated, read from the place it was stated for, and stays a choice in the edit form so a save never erases it; saved unchanged from the other place, it keeps its stored orientation.

Manual spatial edits journal through the ordinary raw-message boundary owner. Base entries remain read-only until the user creates an override (a plain upsert at a base id is refused rather than shadowing it). A relation id names that relation only between its own two places (addressed from its other side, it is read from its own side); a merge never targets an archived place; route names fold like place names. Base-map numeric strings are numbers in both coordinate forms. In injection, a line cut to the budget ends on a word when that keeps most of it (a line whose only space is near its start is cut where it is), never inside a number or a coordinate pair. A place needs a name match, two distinct shared words, or a whole-name phrase to be selected (one word of a longer name is not enough), and the Places corpus counts active places however the index was built. Operator-authored location metadata, relations, and route semantics are campaign authority: automatic capture may attach confirming evidence and grounded additive route associations, but it may not rewrite those manual semantics. That authority is recorded on the entity (`operatorOwned`) rather than inferred from bounded evidence, so evidence trimming or a foreign import (which relabels evidence) never returns it to the model; states saved before the flag existed derive it from manual evidence, and a merge carries it to the surviving place or relation. A same-position coordinate confirmation may add evidence but never replaces a stronger coordinate authority. Panel name checks (Add place refusing an existing name, finding a place by name, merge suggestions) fold names exactly as the Places core does ("Kings Rest" is "Kings-Rest"). A position the operator types becomes manual authority unless the operator chose another authority.

### C24.6 Branch, migration, import/export and rebuild

Canonical schema version 2 adds the durable `spatial` namespace. Pre-1.0 persistence validates the current schema only (C11): schema version 1 is not migrated, and a schema-1 sidecar, bundle or checkpoint fails closed like any other unusable version. Sidecar format, bundle format, and rollback-journal format remain version 1.

Spatial undo data participates in the same branch journal and checkpoints as Reality Core. Swipe/delete/edit/branch reconciliation must restore both subsystems to the same proven boundary. Stale provider completion is rejected by the existing host currentness guard.

Export/import carries campaign Spatial state. Foreign import clears false local spatial message/lineage provenance. Base-map source files remain separate read-only references identified by campaign `baseMapRef`; foreign import preserves source identity/digest but clears the machine-local source path so the target host must rebind or reattach the read-only source.

Explicit rebuild reconstructs generated Spatial state from the same chronological sanitized evidence stream when Spatial reconstruction is enabled, retains the attached base-map reference/profile, and atomically replaces state only after complete success. A Reality-only rebuild preserves the disabled Spatial sibling wholesale rather than treating disabled extraction as deletion. A rebuild with Places on rebuilds model places from the narration and replays the operator-owned places, relations and routes of the original journal at the boundaries where they appeared (an operator place replaces a same-name model place, whose relations and routes move to it), so an operator's place is never lost to a rebuild and still rolls back with its message. An operator relation or route whose other end is a model place keeps it: the place the rebuild re-created under that name, otherwise the original place carried over. When operator places held before the journal floor cannot be placed because the story changed at or below it, the rebuild keeps them, bounds its journal at the floor and warns, as a Reality-only rebuild does; with no operator entities in the history nothing is overlaid.

### C24.7 Bounded retrieval and private injection

Normal turns must not scan every campaign location, the complete base map, every route/polyline, or the full chat. A capture resolves only the places it changed (an empty batch reads no base entry), through a base-map id index built once per base map.

Spatial relevance uses an ephemeral per-chat index and bounded candidates. Normal private injection is a compact continuity block containing only the relevant current place/coordinate/context, a few directly linked/relevant places, and useful route/connection information. Neighbour linking counts only active places not already selected (archived neighbours never use a slot), and the routes of the top place are shown with their type, the shown places they connect, and their context, within the budget. It is private continuity, not automatic PC knowledge.

Spatial injection does not modify Megumin Suite. It supplies authoritative continuity through World State Alpha's existing private prompt so Megumin/RP narration can keep its own scene/world-state presentation.

### C24.8 No Story Director

Spatial Continuity does not plan arcs, invent places for drama, escalate conflicts, generate quests, avoid stagnation, shape scenes, or simulate a map. It remembers and deterministically relates established geography only.

## C25. Relevance, rebuild matching and panel

- A one-word record anchor or place name matches inside a run of letters only in a script written without spaces or with attached particles (Chinese, Japanese, Thai, Korean); in other scripts (accented Latin and Cyrillic included) it matches whole words. Function words take an anchor-lookup slot only where the text uses them as names.
- Relevant developments are filtered to those due before the four relevant slots are taken. A catch-up run that does not complete (stale, failed or invalid) gives its background slots back, so they are tried again on a later turn. A null `derived` list and a capitalized outcome are valid evolution output.
- Rebuild keeps its own lifecycle and history matcher (boundary-local, over the records of the rebuild candidate), built on the relevance module's normalizer, stopwords and name rules: it reads Chinese and Japanese text through spaceless anchors and shared content character pairs (kana-only pairs never count), with the exchange's pairs read once per boundary, and any specific one-word anchor addresses a record. An empty or tracker-only boundary commits only when replayed Places change there. Sorting uses code-unit order, the same on every device.
- An unset injection budget (null or blank) is the default budget. A rebuild that completed over messages changed while it ran is reported as stale (nothing replaced), not as failed, and the notice says so. A second rebuild (Recapture and Resume included) is refused from the click while one is requested or runs.
- Panel: search matches the start of words; Start Rebuild starts one rebuild per click and a blank number field keeps its default; Select mode ends when no active row remains; Escape closes the Places form or Map settings only on the Places tab; the rebuild sheet focuses its first control; a selected record that leaves the view leaves nothing expanded; a place mention opens the same record in the current state; Operations are newest first, stay expanded across re-renders and keep the model's whitespace; Forfeit runs outside the chat queue (it names the message as the live chat holds it, forfeits only a listed failure of that very version, and is refused while a rebuild is requested or runs), redraws the panel, shows six buttons with "Show all", sits in a group (the panel's one live region announces), and names only an integer message; leaving a place form with unsaved edits asks first; Copy falls back when the clipboard refuses and returns focus; a lost pointer capture ends a launcher drag; a relation stored under an override's own id names its place; panel name matching folds like the Places core.

## C26. Shared helpers and bounded per-turn work

- A helper used by more than one module lives once in `common.js` (or in the module that owns its rule, exported): bounded text, the message role and the visible role of a SillyTavern row (a hidden row is system), keyed undo, token budgets and index postings. The elapsed detector judges a phrase in the sentence the source firewall would cut (`endsSentenceAt`): a full stop after a title ("Mt.", "Lt.") does not end it, while a lone capital ("plan B.") does, so two real sentences are never joined. Host rows are read `mes` first. A lineage a caller supplies to `reconcileBranch` is used only when it fits the chat (length and last fingerprint).
- Per-turn work stays bounded and is not repeated: the capture firewall builds one context (sanitized exchange and record lookups) per response, quote spans are paired once per text, the accumulated day-step walk judges each message text once, the head guard compares the chained lineage key of the last message, a checkpoint snapshot copies an already-normalized domain, an export normalizes once, and panel and manual reads read a normalized state in place (returning copies).
- Rebuild reuses the plan's lineage for every boundary and for a partial rebuild's prefix proof, copies messages shallowly, and judges direct address only for the developments it shows. The panel's Places projection is reused while the Places content and base map are unchanged. The True North consistency pass reads only the places its own pass changed.

## C27. Subject identity, edit bases and ownership transitions

- A create becomes an update of an existing record only when both name the same subject: when each summary names someone or something (a capitalized word inside a sentence, a possessive owner, or the summary's first word unless it is shaped like a common noun: a plural or an abstract-noun ending) that the other never mentions in its summary or anchors, they are different subjects, however much else they share. Uncertain identity keeps records apart.
- A Places or Coordinate Profile save carries the canonical values its form was opened on (kept across re-renders; re-based after a refused save). Only fields changed from what the form showed are saved; every other field keeps its current value. A changed field that another device changed meanwhile to something else is refused, nothing is saved, and the panel shows the current values. A position is typed only when it differs from what the form showed; a touched position is written whole and conflicts with a position, authority or lock changed elsewhere.
- A rename or delete whose identity was taken over by a newer transition stops: best-effort cleanup never swallows that, and both identities are re-checked before the durable settings change; after it, the Operations log still moves and runtime state changes only for identities no newer transition owns. A retired Operations log is emptied only while its identity is still retired.
- A chat identity that needs recovery is recorded durably in host settings (`recoveryRequiredChats`) when a recovery-required chat is renamed; a readable sidecar under it does not clear the requirement; only a recovery write (Full chat rebuild, import or reset) does, replacing exactly the revision of the file it reads. Hidden roleplay turns count as existing history. Evidence maps are read by own key only, and `__proto__` is not an evidence id.
- An injection line is cut to the longest useful length that fits. An unset, null, blank or below-one saved budget is the default.

## C28. Places geometry, operator intent and provenance

- A place a reply moves is found the way its rows are: by id, or by name among the visible places, the campaign's active places, a merged-away name's merge target and the base map (at its effective position). No position is derived from an anchor the same reply moves, whether the move names it by id or by name.
- A narrated coordinate belongs to a place only where the narration states it for that place: in a cited sentence naming it and, when the sentence holds several coordinate pairs, the pair nearest to where the place is named (for a sentence referring back, the pair nearest its start). A pair that cannot be tied to the place gives it nothing.
- An operator's archive or merge is operator intent on the archived or merged-away place: it records the operator's evidence, which makes that place operator-owned (a merge target stays the model's, so narration keeps updating it). A rebuild that re-extracts Places retires the model's copy of that name and points its relations and routes at the archived place or at the place it was merged into.
- A derived development keeps the historical evidence of its causes (with its original source class) as its own, so later evolution has the causal premises it was derived from. Elapsed time stays a trigger, never occurrence evidence.
- Route waypoints are place ids and must name visible established places, like endpoints: a list naming another place is not applied (a new route keeps its known waypoints, an existing route keeps its own). One "related" relationship between two records is one link; a repeat on a later message adds none (links saved before are loaded as they are, since checkpoints recorded them). A merge that collapses two relations keeps both relations' evidence.

## C29. Bounded storage, polarity, epistemic status and causal recovery

- Every sidecar and Operations-log request, and its body read, finishes within a deadline the extension sets (30 seconds for a read; 60 for an upload plus a second per 50 KB, at most ten minutes). On expiry it is aborted, its writer lock is released and it fails retryable; a timed-out upload's outcome is unknown, so a retry reads the file back first and recognises its own body instead of writing twice.
- Capture refuses a create or update whose cited clauses (subordinate and relative clauses split apart), wherever they carry every content word of the summary, all state it with the opposite polarity, and refuses an ending whose every claim says the record's condition continues (a continuation word beyond those the record's summary uses) with the record's own polarity. A paraphrase that does not carry every word is never refused on wording alone.
- Evolution keeps the epistemic status capture enforced: an update may not turn hearsay (a report or rumour, not a narrated speech act) into an established fact without confirming current evidence, and an established condition is not resolved or superseded on hearsay or planned support alone; such an evaluation is recorded as stable and the rest of its batch stands. A development derived only from hearsay or plans must keep that status. Quiet stability and a rumour that stays reported remain valid.
- Missed-capture recovery follows causality, not device clocks: each Operations row records the session that wrote it, and a recovery row names the failures it cleared when it was recorded. A failure is named by its session, operation id and time; a named failure is recovered whatever its timestamp. A capture recovery clears an unnamed failure only from its own session (one clock) or from rows written before sessions were recorded; a rebuild, import or reset clears every earlier failure of its range.
