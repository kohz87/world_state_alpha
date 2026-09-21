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
