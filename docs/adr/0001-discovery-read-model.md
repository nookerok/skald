# ADR 0001 — Discovery Read Model

## Context

The game needs to present the player with discovered knowledge about world laws.
This is a pure read-side concern: the knowledge already exists as Domain Events
(Observations, Consequences, Situations); it just needs to be surfaced.

Two approaches were considered:

1. A read model derived from historical Domain Events (deterministic, pure,
   no new Event types)
2. A write-side model where discoveries are stored as Domain Events (would
   require new Event types and Rules)

## Decision

Option 1 — readonly derived model from Event Log — was chosen.

The Discovery Journal is a **read model**:

- It is derived entirely from `app.bus.query()` (canonical Event Log).
- It is **not** written to Event Log, Projection, or any SQLite table.
- The Builder does **not** emit Domain Events and does **not** mutate any state.
- The result is deterministic for the same Event Log and the same `definitions`
  version.
- LLM is **never** involved in stage classification or evidence selection.
- The browser receives a pre-computed DTO; it does **not** compute stages.

This is consistent with:
- Authority Hierarchy (ARCHITECTURE.md §6): Event Log → Projection → Rules.
  Discovery sits at the same level as Narrative: read-side, non-authoritative,
  derived.
- Projection Purity (ARCHITECTURE.md §9.6): the Discovery DTO is not a source
  of truth. Delete it, replay the log, and the result is identical.

### Key properties

1. **Stages are monotonic.** In an append-only log, a DiscoveryCard can only
   progress trace → hypothesis → discovered. It never regresses.

2. **Definitions are static code.** Each DiscoveryDefinition is a pure,
   compile-time unit. No runtime definition generation. Changing a definition
   may change the historical presentation of discoveries but does **not**
   change the world state.

3. **Evidence links to Events.** Each `DiscoveryEvidence` carries
   `sourceEventIds` referencing the canonical Event Log. No new storage.

4. **No percentage, no progress bar, no locked cards.** The UI shows only
   discoveries with at least one piece of evidence. Undiscovered laws are not
   listed.

5. **Player-authored hypotheses are out of scope for UX-2.** The spec is an
   automated pipeline, not a creative tool.

## Consequences

- New source files under `packages/world/src/discovery/`.
- New read-only HTTP endpoint `GET /api/discoveries`.
- New browser tab "Открытия" with discovery-view.js.
- Definitions are the only place where Domain Event → Discovery evidence
  mapping lives. This is intentional: it keeps the mapping explicit and
  reviewable.
- If a new Domain Event should drive a discovery, only the definition file
  changes — no Rule, no Projection, no Event Schema evolution.

## Test gates

- Builder unit tests: empty log, trace, hypothesis, discovered stages;
  immutability of inputs; frozen result; monotonic timestamps; sourceEventIds.
- HTTP tests: GET returns 200; POST returns 405; restart returns identical DTO;
  endpoint does not mutate Event Log.
- Browser tests: module served; empty state; stage labels; evidence expands;
  evidence links to Journal; card selection persists across reload.
