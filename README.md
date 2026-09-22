# World State Alpha

World State Alpha is a universal SillyTavern continuity extension for persistent **current world reality**.

It is the world-level conceptual sibling of NPC State Delta:

- NPC State Delta answers: "What is true about this NPC right now?"
- World State Alpha answers: "What is true about the wider world right now?"

The Reality Core models **change, not maps** and keeps its two-kind fact/development model. World State Alpha 0.9 adds an optional sibling subsystem, **Spatial Continuity**, which remembers established/generated places without turning Reality Core into a map ontology.

## Implementation status

**Phases 1-9 are implemented as candidates. Version 0.9.0-alpha.8 retains Alpha.7's recovery and authority hardening and fixes live rebuild interoperability observed with Gemini 3.7 Flash High: selected Connection Profiles accept raw OpenAI-compatible `choices[0].message.content` envelopes without consuming private reasoning; Spatial-enabled capture/rebuild prompts now include the exact Reality mutation schema; unambiguous provider aliases `category`→`kind` and `description`→`summary` are repaired before strict validation while conflicts still fail closed; grounded named places survive unsupported optional relative metadata; compositional proper-place names such as `Applecross Culvert` may be grounded when all tokens occur together in accepted evidence; and rebuild now exposes shared diagnostics plus visible start/failure/completion status with boundary/current/place counts. Connection-profile routing also accepts the raw OpenAI-compatible `choices[0].message.content` shape while ignoring `reasoning_content`. Canonical schema remains version 2; sidecar, bundle, and rollback-journal envelope formats remain version 1.**

The initial design is grounded against NPC State Delta current `main` at:

- commit: `d20bf1dd03f85fe32ab11abb0363ec32eaa66d03`
- release: `1.0.35`

Delta is a reference repository only. World State Alpha must reuse proven architectural lessons without importing NPC-specific semantics or depending on Delta at runtime.

## Core shape

The proposed Alpha core uses one generic world-record schema with only two semantic kinds:

- `fact`: a presently true world condition
- `development`: an established ongoing condition that may evolve

Historical **events are not a third durable record class**. They are evidence and mutation provenance for current records.

Spatial Continuity is separate:

- locations are not a third `records[]` kind
- base maps are read-only source geography
- campaign-generated places and overrides are per-chat durable Spatial state
- exact/derived/relative/unknown coordinates remain distinct
- no profile means no hidden Ternia scale/bounds/compass assumptions; configured Cartesian axes drive derivation
- `<writer_state>...</writer_state>` planning is never capture evidence
- Spatial is optional and disabled independently


The normal loop is:

```text
completed RP exchange
  -> compact asynchronous capture
  -> conservative canonical mutation
  -> branch-safe persistence
  -> local relevance retrieval
  -> tiny private world-state injection
  -> existing RP model / Ukiyo writes normally
```

A stale relevant development may receive bounded lazy catch-up when a valid trigger exists. Meaningful elapsed time may also admit up to three remote active developments from a bounded indexed background sample into the same evolution batch. There is no full-world simulation loop.

## Authority boundary

- Lorebook: static/baseline canon and causal possibilities
- World State Alpha: current dynamic world reality
- NPC State Delta: detailed individual NPC continuity
- Memory/chat history: historical narrative evidence
- Ukiyo/RP model: immediate scene reasoning and prose

World State Alpha never rewrites source lore and never modifies Ukiyo.

## Read first

1. `AGENTS.md`
2. `docs/core-contract.md`
3. `docs/ARCHITECTURE.md`
4. `WORKFLOW.md`
5. `docs/WORKPLAN.md`

## Repository rule

Phases 1-9 authorize the existing Reality Core/runtime plus optional Spatial Continuity. Phase 9 does not modify Megumin/Ukiyo, does not add Story Director behavior, and does not modify attached base-map source files. Canonical schema version 2 adds the durable `spatial` namespace; sidecar, bundle, and rollback-journal envelope formats remain version 1.
