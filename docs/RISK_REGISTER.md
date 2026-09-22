# World State Alpha risk register

| Risk | Failure mode | Primary mitigation | Acceptance evidence |
| --- | --- | --- | --- |
| Hallucinated world movement | Model invents off-screen changes | mutation proposal + source firewall + causal evidence + conservative evolution | lore-trap/no-change/provider tests |
| Duplicate threads | Same development stored repeatedly | normalized anchors + semantic summary/evidence overlap + deterministic consolidation | duplicate fixture |
| Stale lore overwrites state | baseline revives/reverts campaign reality | current-state authority + resolved tombstone | resurrection test |
| Branch ghosts | abandoned branch mutation survives | message-owned undo + exact lineage recovery | swipe/delete/edit tests |
| State explosion | tiny observations become records | materiality gate + derived-record cap + prefer update | long-campaign growth test |
| Injection bloat | whole DB reaches RP prompt | deterministic top-k + hard budget | 500-record test |
| Excess latency | capture/evolution delays normal RP | one bounded capture; batched triggered evolution only; local retrieval | measured TTFT/requests |
| Player-knowledge leakage | PC knows remote fact magically | explicit private-continuity header; no epistemology inference | remote-knowledge scenario |
| NPC State conflict | duplicate ownership/namespaces | strict world_state_alpha namespace + dossier boundary | co-install test |
| Provider inconsistency | model emits malformed/overcreative output | compact schema validator, retry policy bounded, reducer owns truth | multi-route acceptance |
| Thread escalation chains | each evolution spawns more developments | derived creation cap + material causal gate + no drama objective | adversarial evolution fixture |
| Wrong time inference | fictional calendar misparsed | message chronology mandatory, opaque time anchors optional | no-calendar fixture |
| Rebuild divergence | rebuild creates different current reality | bounded assistant-boundary replay through capture firewall + semantic equivalence fixtures + atomic replacement only on full success | incremental-vs-rebuild |
| Rebuild hidden simulation | recovery invents off-screen evolution not established in narration | rebuild never invokes lazy evolution; reconstruct only grounded chronological capture evidence | no-evolution rebuild fixture |
| Manual provenance drift | operator edit attaches to stale/other branch | current-head + exact-lineage guard + manual evidence + ordinary rollback journal | manual branch/head fixtures |
| Approximate rollback corruption | older snapshot used as parent | exact-boundary only, fail closed | missing-parent fixture |
| Diagnostics leak | prompts/story/credentials stored | allowlisted bounded receipts | serialization inspection |
| UI authority drift | presentation code mutates state or bypasses Phase 5 confirmation | projection-only UI + maintenance intent callbacks + static boundary validator | Phase 6 mutation-boundary tests |
| UI data leak / XSS | backend IDs, lineage, private telemetry, or executable markup reaches the panel | escaped text + human projections + diagnostic allowlist + no raw IDs in rendered HTML | hostile-markup/privacy fixture |
| UI overload | large world database creates an unusable or huge panel | hard per-view/detail caps + local bounded search projection | 1000-record UI fixture |
| Mobile unreadability | desktop panel overflows or tiny controls block maintenance/inspection | <=700px full-screen stacked layout, >=44px tabs, <=420px one-column grids | static responsive CSS tests + later live browser acceptance |
| Host namespace collision | Alpha overwrites/reads another extension's settings, prompt, DOM, global, or file | isolated `world_state_alpha` / `world-state-alpha-` namespaces + no dependency/adapters | pinned Delta coexistence/static host tests |
| Cross-chat sidecar collision | equal chat filename shares state across character/group owners | owner-qualified character/group chat key + hashed logical sidecar | host identity fixture |
| Rename identity loss | character/avatar or chat filename rename strands the old sidecar pointer and appears to reset continuity | durable owner-key migration on CHARACTER_RENAMED / CHAT_RENAMED, destination-collision fail-closed | host identity lifecycle tests |
| Deleted-name resurrection | deleted chat/group-chat/character pointer survives and is reused by a later identity/name | remove active pointer/cache ownership on delete lifecycle | host delete lifecycle tests |
| Hydration clobber | missing/corrupt durable sidecar replaced by empty state | pointer-preserving fail-closed hydration; writes blocked while hydration error exists | hydration/static transaction tests |
| Stale host completion | capture/evolution commits after chat/branch/state or routing/enablement settings changed | chat key + lineage + state epoch currentness guard + request cancellation | stale-operation/settings host checks |
| Manual/automatic write race | operator edit and capture persist competing revisions | one per-chat work queue for automatic, maintenance and Spatial manual mutations | host queue/static tests |
| Host framework creep | launcher/watchdog/commands become a second UI/runtime system | settings card + existing Phase 6 panel only; no MutationObserver/generic commands | static source validator |
| Live co-install mismatch | deterministic isolation passes but real ST/Delta event order differs | keep host shell independent and run explicit live simultaneous-install acceptance | Phase 8 live co-install run |
| Over-ontology | schema accretes genre assumptions | no mandatory typed anchors/scope; universality fixtures | schema lint |
| Incremental index drift | In-memory relevance index becomes out of sync with mutated state | `reduceMutations` computes exact `indexDelta`; incremental delta tested against fresh index | incremental update fixture |
| Compaction rollback corruption | Pruned evidence causes missing reference errors on branch swipe | `undo.evidence` retains compacted entries; undo patch restores uncompacted state | 50-step compaction rollback test |
| Non-deterministic release zip | Zip bytes vary between builds due to archive timestamps or ordering | fixed DOS timestamps (2026-01-01) and alphabetical entry sorting | package hash reproducibility test |
| Storage schema version drift | Application bugfix release accidentally changes durable format versions | decouple app version (0.9.0-alpha.3) from canonical schema 2 and sidecar/bundle/journal envelope version 1 | Phase 8/9 static version validators |


| Risk | Failure mode | Mitigation | Verification |
|---|---|---|---|
| Spatial authority drift | lower-authority narration silently moves canonical/manual place | authority rank + lock checks in Spatial reducer | authority/lock tests |
| Geographic confetti | every clearing/ditch becomes durable state | named/persistent admission gate + bounded prompt | admission fixtures |
| Writer-plan contamination | hidden writer_state establishes place/route | deterministic evidence-view sanitizer before capture/rebuild | writer_state + rebuild tests |
| False precision | model invents X/Y for relative/unknown place | coordinate firewall; exact derivation only from grounded straight-line inputs | coordinate firewall tests |
| Route displacement error | winding route length treated as Cartesian delta | distanceMode separates straight_line / route / unspecified | derivation tests |
| True North drift | prose relation contradicts coordinate axes | reducer-level direction-vs-delta validation | True North tests |
| Base-map mutation | campaign edit corrupts shared registry | immutable parsed base + campaign override layer | base immutability test |
| Base-map host mismatch | host-neutral fake adapter passes while production SillyTavern import/reload cannot store or fetch the source | production storage adapter exposes and tests the JSON file API used by host-base-map | Phase 7 production-adapter test |
| Sticky base-map outage | transient source read failure is cached as permanent absence | cache successful base maps only; failed reads retry while automatic Spatial work remains fail-closed | host lifecycle/static test |
| Cross-campaign leakage | generated location appears in another chat | deterministic IDs include chat owner; Spatial lives inside per-chat sidecar | campaign isolation test |
| Dangling spatial graph | delete/merge leaves invalid relations/routes | reducer rewrites/removes graph references | merge/delete tests |
| Spatial scan regression | large base/campaign map scanned every turn | ephemeral spatial relevance index + cached base map | 1000-location measurement/test |
| Schema migration loss | 0.8 state/checkpoints fail after schema bump | strict schema1->2 normalizer; envelope versions unchanged | migration/rollback tests |
| UI authority bypass | manual editor creates impossible direction or base write | all intents pass Spatial manual reducer; base requires override | manual True North/override tests |
