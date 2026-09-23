# World State Alpha - agent instructions

## Authority and scope

Read in order:

1. `AGENTS.md`
2. `docs/core-contract.md`
3. `docs/ARCHITECTURE.md`
4. `WORKFLOW.md`
5. `docs/WORKPLAN.md`
6. `docs/REFERENCE_REVIEW.md`
7. `docs/TEST_PLAN.md`
8. `docs/RISK_REGISTER.md`

The user's current instruction controls scope and authorization. The core contract is the behavior authority. Architecture describes the accepted intended shape. The workplan defines implementation stages, not alternate runtime systems.

The design and runtime candidate are accepted and **Phases 1-9** are implemented. Phase 9 introduced optional Spatial Continuity in 0.9.0-alpha.1; 0.9.0-alpha.2 hardened that subsystem and its SillyTavern host lifecycle; 0.9.0-alpha.3 standardized the settings drawer; 0.9.0-alpha.4 hardened host identity/ownership and Spatial edge cases; 0.9.0-alpha.5 strengthened persistent off-screen capture completeness; 0.9.0-alpha.6 added bounded Background Development Catch-up; 0.9.0-alpha.7 hardened rebuild integrity, branch-recovery prompt quarantine, elapsed-evidence admission, Spatial authority/relation grounding, bounded tombstone admission, deterministic current-location recovery, omission semantics, disabled-Spatial preservation, and non-blocking user-send continuity scheduling; 0.9.0-alpha.8 hardened live rebuild interoperability and observability by preserving the exact Reality schema in Spatial prompts, repairing only unambiguous provider field aliases, retaining grounded named places when optional relative precision is unsupported, and exposing rebuild diagnostics/progress/completion; 0.9.0-alpha.9 accepts one provider JSON object when optionally wrapped in a single Markdown JSON/code fence while continuing to reject surrounding prose; and the current 0.9.0-alpha.10 candidate adds bounded World_State Off-Screen/Unresolved completeness hints so persistent narrated developments are not dropped merely because they are off-screen or less scene-salient. Canonical schema is version 2; sidecar, bundle, and rollback-journal envelope versions remain 1. Spatial may share per-chat persistence, branch ownership, diagnostics, provider routing, settings and UI shell, but it must not become a third Reality Core record kind, mutate base-map sources, add Story Director behavior, or modify Megumin/Ukiyo.

## Product boundary

World State Alpha maintains current dynamic world reality. It is not a Story Director, map engine, economy engine, calendar engine, NPC simulator, news simulator, quest generator, or replacement for lorebooks, Memorybook, NPC State, Ukiyo, or ordinary RP reasoning.

The product loop is:

```text
completed exchange
 -> conservative world-change capture
 -> canonical current-state mutation
 -> branch-safe persistence
 -> relevance retrieval
 -> optional bounded lazy catch-up for stale relevant developments
 -> optional bounded background catch-up for established remote active developments on meaningful elapsed-time boundaries
 -> compact private continuity injection
 -> existing RP model / Ukiyo continues normal narration
```

## Universal-model rule

Never require setting-specific ontology. In particular, do not make any of these mandatory schema concepts:

- scope
- region
- polity
- nation
- faction
- settlement
- continent
- direction
- government
- dungeon
- organization type
- fantasy calendar

The Reality Core models change, not maps. Optional Spatial Continuity may model established/generated place continuity through its separate `spatial` namespace; do not introduce geography into Reality Core `records[]`.

## Spatial subsystem rule

Spatial Continuity is optional and semantically separate from Reality Core.

- never add `location` as a Reality record kind
- never place Spatial locations/relations/routes in `records[]`
- base geography is read-only source authority; campaign overrides live only in per-chat state
- precise coordinates require trusted base/manual/narrative-explicit evidence or deterministic derivation
- route/travel distance is not straight-line displacement unless explicitly established
- True North and unit-scale derivation are determined only by an explicit coordinate profile; no profile means no hidden Ternia defaults
- `writer_state` and other planning material is never canonical evidence
- manual spatial edits use the branch journal and are campaign authority
- no full base-map/spatial scan on normal turns

## State model rule

Prefer one generic record schema with only two semantic kinds:

- `fact`: something presently true
- `development`: an established ongoing condition that can change

Do not add a durable `event` record class unless implementation evidence proves it is necessary. Historical events belong in evidence/mutation provenance and may establish or change current records.

Keep one canonical state owner, one persistence boundary, one branch/rollback owner, one model-request dispatcher, one relevance/injection owner, and one diagnostics owner.

## Authority firewall

Source precedence is semantic, not merely lexical:

- explicit current campaign evidence may establish current state
- accepted World State is current dynamic authority
- lore is baseline/static canon and causal possibility
- lore possibility is never proof of current occurrence
- stale baseline must not overwrite accepted current campaign state
- resolved/superseded records are tombstoned against passive lore resurrection
- ambiguous proposals are not permanent world facts
- no model output may create unsupported plot events

World State never rewrites source lore.

## World motion rule

Evolution may update established developments only from grounded causality. Never optimize for drama, challenge, pacing, quests, escalation, player engagement, or climax.

Passage of time alone does not require change. Quiet stability and quiet resolution are valid.

Derived developments must be conservative, deduplicated, causally grounded, and bounded. Prefer updating an existing record over creating a new one.

## Player-knowledge boundary

Stored world reality is private continuity context, not automatic player-character knowledge. Injection must say this explicitly. The extension does not itself narrate discoveries or information propagation in Alpha.

## Branch safety

Every automatic canonical mutation must be traceable to raw-message lineage and source evidence. Swipe, delete, edit, truncate, or branch changes must not leave abandoned-branch world state behind.

Recovery is exact-boundary/fail-closed. Never substitute a convenient older snapshot when the requested parent boundary cannot be proven.

## Performance rule

Normal turns must not:

- scan the full chat
- scan the full world database
- evolve every record
- inject every record
- fan out per-record model calls
- block ordinary RP on background completeness work

Use small current-exchange capture, deterministic/local relevance ranking, and bounded targeted evolution only when justified.

## NPC State coexistence

Use the `world_state_alpha` namespace for settings, storage, DOM, prompt keys, globals, bundles, diagnostics, commands, and sidecars.

Do not read or mutate NPC State Delta storage. World State may store world-significant person facts but never detailed NPC dossier ownership such as personality, speech, mood, appearance, relationship, or behavioral profile.

No installed-extension dependency on NPC State Delta is allowed.

## Reference repository rule

NPC State Delta is a reference only. The design pass is pinned to current Delta main commit `d20bf1dd03f85fe32ab11abb0363ec32eaa66d03` / release `1.0.35`.

Do not modify Delta. Do not copy its NPC semantics, relationship machinery, appearance/forms, social graph, birthdays/calendar engine, candidate admission model, cast scanning, portrait system, or accumulated migration surface.

Reuse architectural lessons only where they simplify World State.

## Development discipline

Inspect repository HEAD, working tree, remote state, and available tools before changing files.

Use isolated worktrees for implementation. Preserve unrelated work. Do not silently broaden a phase.

Before release publication, run the repository-defined validation/test/package/prompt-measurement workflow for the exact candidate. Synthetic tests do not prove live SillyTavern/provider behavior.

## Reporting

Report:

- what changed
- current phase/status
- deterministic verification performed
- live boundaries still unverified
- commit/PR when created

Do not describe design documents as a completed runtime product.
