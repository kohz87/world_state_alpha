# World State Alpha

World State Alpha is a universal SillyTavern continuity extension for persistent **current world reality**.

It is the world-level conceptual sibling of NPC State Delta:

- NPC State Delta answers: "What is true about this NPC right now?"
- World State Alpha answers: "What is true about the wider world right now?"

World State Alpha models **change, not maps**. It has no required geography, polity, faction, settlement, calendar, genre, or setting ontology.

## Implementation status

**Phases 1-8 are implemented as candidates: canonical state/rollback, immediate capture, local relevance/private injection, bounded lazy evolution, manual controls/rebuild, projection-only UI/evidence inspection, minimal isolated SillyTavern host/coexistence shell, and performance/release hardening (ephemeral relevance indexing, unreferenced evidence compaction, deterministic packaging, and live acceptance protocol). Application version is synchronized to 0.8.0-alpha.1 while persisted schema, sidecar, bundle, and journal versions remain 1.**

The initial design is grounded against NPC State Delta current `main` at:

- commit: `d20bf1dd03f85fe32ab11abb0363ec32eaa66d03`
- release: `1.0.35`

Delta is a reference repository only. World State Alpha must reuse proven architectural lessons without importing NPC-specific semantics or depending on Delta at runtime.

## Core shape

The proposed Alpha core uses one generic world-record schema with only two semantic kinds:

- `fact`: a presently true world condition
- `development`: an established ongoing condition that may evolve

Historical **events are not a third durable record class**. They are evidence and mutation provenance for current records.

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

A stale relevant development may receive one bounded lazy catch-up evaluation when meaningful elapsed time is known. There is no full-world simulation loop.

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

Phases 1-8 authorize the canonical state/rollback substrate, bounded immediate capture, deterministic local relevance/private injection, targeted lazy evolution, manual inspection/correction/transfer/rebuild services, the browser-safe projection UI/evidence inspector, the minimal World-State-only SillyTavern host shell, and performance/release hardening. Phase 8 adds ephemeral per-chat relevance indexing, candidate cap saturation (128), unreferenced evidence compaction on mutation, deterministic byte-reproducible packaging, release manifests, and the live acceptance protocol. Persisted schema, sidecar, bundle, and rollback journal versions remain 1.
