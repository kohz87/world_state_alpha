# NPC State Delta reference review

Reference inspected: `kohz87/npc_state_delta` current main at `d20bf1dd03f85fe32ab11abb0363ec32eaa66d03`, release 1.0.35.

Relevant current files inspected include `AGENTS.md`, `docs/core-contract.md`, `docs/WORKPLAN.md`, `DEVELOPMENT.md`, `storage.js`, `branch.js`, `branch-core.js`, `scanner-routing.js`, `scan-context.js`, `core-mechanics.js`, `index.js`, `diagnostics-core.js`, `bundle.js`, `native-transfer.js`, runtime inventory, tests, packaging, and CI.

## Reusable directly in principle

These are architectural patterns, not source-copy instructions.

### Single-owner architecture

Delta explicitly keeps one settings owner, scanner dispatcher, state owner, persistence boundary, and evidence/injection path. World State should preserve that ownership clarity.

### Request-scoped provider routing

Delta's scanner dispatcher uses the normal host route by default and optional Connection Profiles without redirecting ordinary RP. Missing profiles fail closed rather than silently falling back. This maps cleanly to World State.

### Stale-result rejection

Delta captures chat lineage/state version before asynchronous model work and discards results when the chat or canonical state changes. World State needs the same pattern.

### Compact budgeted injection

Delta performs relevance selection first, then enforces a hard injection budget and drops lower-priority material rather than dumping the database. World State should reuse the principle, with world-record semantics.

### Durable sidecar persistence

Delta's per-chat sidecar has revision guards, writer locking, bounded retries, undurable recovery snapshots, and chat-key validation. These are strong generic persistence lessons.

### Bounded diagnostics

Delta diagnostics are explicitly non-authoritative and avoid storing prompts, transcripts, credentials, and provider transport payloads. World State keeps that boundary while Alpha.11 intentionally adds an operator-only exception for bounded extracted model response/rejection content in the ephemeral Operations inspector; prompts, headers, reasoning content, credentials and transcripts remain excluded.

### Exact-boundary branch recovery

Current Delta's rollback journal coalesces multiple mutations at the same raw message, keeps message-owned undo, and rejects approximate older-boundary recovery. This is highly relevant and should be generalized around world-record mutations.

## Reusable after generalization

### Completed-exchange scanning

Delta's normal scan is tied to completed story exchanges and raw-message boundaries. World State should retain the boundary discipline but scan for material world changes, not cast/dossier fields.

### Omission-preserves-current-state

Delta's durable fields are not erased merely because a scanner omitted them. World State should make absence non-destructive. Explicit replace/resolve/supersede actions are required.

### Current-summary versus evidence/history

Delta separates current profile summaries from longitudinal evidence. World State should adopt this more strongly: one compact current summary per record, evidence/history in backend only.

### Relevance scoring

Delta combines direct name/alias matches, semantic similarity, related entities, and recency. World State should generalize this to anchors, summary similarity, causal links, retrieved lore overlap, and recency.

### Manual rebuild/refresh separation

Delta's history-heavy operations are explicit rather than the default routine path. World State should make rebuild/manual targeted update separate from incremental capture.

### Export/import with provenance caution

Delta avoids inventing foreign message provenance across chats. World State imports likewise must not pretend source-message IDs from another campaign are local chronology.

## NPC-specific or unsuitable

Do not copy:

- NPC candidate/admission semantics
- identity promotion/alias heuristics as the world ontology
- relationship numerical scoring
- social graph ownership
- personality/speech/mannerism/behavior evolution
- appearance forms
- birthdays/calendar continuity engine
- terminal NPC death machinery as a generic world lifecycle
- portraits/image generation
- cast presence/worldActive fields
- full-cast scanning
- per-NPC backfill fan-out
- NPC-specific memory curation
- NPC stale archive/delete policies
- dossier UI structure

Person names may appear as anchors, but World State does not become a person ontology.

## Historical complexity to avoid reproducing

Delta is mature and necessarily carries a large compatibility surface. World State starts clean and should avoid:

- dozens of schema migrations before a stable minimal core exists
- separate field-specific evolution ledgers
- large monolithic runtime files
- legacy readers without demonstrated need
- auto-repair topologies that can fan out provider calls
- multiple overlapping current-state authorities
- giant scanner schemas
- provider prompt patches for individual fixtures
- unnecessary calendar/date interpretation
- title/type-specific world records

The goal is not "Delta, but for everything." It is a smaller system built with Delta's hardest-earned invariants.
