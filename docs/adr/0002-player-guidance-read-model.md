# ADR 0002 — Player Guidance Read Model

Status: read-model decision retained; command-suggestion interaction mechanics
superseded by the v2 prose-intent contract below and ADR 0005 (Open Intent and
Critical Checks).

## Context

New players need help understanding the action→response→discovery loop. Two
approaches were considered:

1. A tutorial with quest-like tracking, stored as Domain Events or Projection
   state, potentially driving NPC/UI behavior.
2. A read model that observes the world state and suggests already-available
   commands, without creating any new authoritative state.

## Decision

Option 2 — a pure read-side `PlayerGuidance` — was chosen.

### Key properties

1. **Guidance is a read model.** It is fully derived from Event Log,
   ReadonlyWorld, and the derived DiscoveryJournal. It is not stored in Event
   Log, Projection, or SQLite.

2. **Phase is deterministic.** The same Event Log always produces the same
   guidance phase. No randomness, no timers, no LLM involvement.

3. **The player DTO contains prose intent examples, not commands.**
   `PlayerGuidance.schemaVersion === 2` exposes `intentExamples` derived from
   observer-safe read models and authored background context. An example is a
   sentence the player may type or adapt; it has no executable input, action
   identifier, or command dispatch semantics. The legacy `GUIDANCE_ACTIONS`
   registry remains available only to simulation/evaluation code that needs its
   internal command vocabulary.

4. **LLM is never involved.** Guidance text is compile-time static Russian
   text. No LLM call selects the phase, the text, or the suggestions.

5. **The composer remains the action boundary.** The browser renders intent
   examples as text. Only navigation entries may dispatch `skald:navigate`;
   guidance never dispatches `skald:command` and never submits player input.

6. **Browser dismissal is local Presentation state.** A dismissed phase
   key (`skald:guidance:dismissed:<phase>`) is stored in `sessionStorage` only.
   It does not affect the server DTO, does not count as "progress," and is not
   synchronized with Event Log.

7. **Onboarding does not guarantee a specific story.** A player who only
   gives social actions and waits will never see discovery-related phases.
   After 6 moves without following the discovery route, guidance transitions to
   `free_play` permanently.

8. **Guidance never blocks controls.** In every phase the player can still
   use the D-pad, social buttons, and keyboard — the guidance section is an
   additional suggestion, not a modal.

## Consequences

- New source files under `packages/world/src/guidance/`.
- New read-only HTTP endpoint `GET /api/guidance`.
- Guidance DTO included inline in command/wait responses.
- New browser module `guidance-view.js` with prose examples and navigation-only
  custom event dispatch.
- New CSS file `guidance.css`.
- No new Domain Events, Rules, Projection fields, or SQLite tables.

## Amendment 2026-08-24: observer-safe prose guidance v2

The selector now derives an immutable `ObserverGuidanceContext` from the same
observer-scoped spatial, object, contact, situation and action-capability read
models used by the map, Narrative Adapter and Game Shell. It may include only
locally observed situations, known routes at `observed` rank, known contacts,
physically accessible items with unblocked affordances, and an authored
background/entrypoint hook when that context is available. Rumored/glimpsed
routes, unknown contacts, inaccessible items and region-wide hidden facts are
not candidates. A closed crossing receives a research question rather than a
movement instruction.

Candidate order is deterministic: active situation, personal hook, observed
object, known contact, accessible affordance, known route, then navigation. At
most three stable, deduplicated examples are returned. When no grounded fact is
available the exact text is `Опиши, что хочешь осмотреть, узнать или изменить.`
and the intent-example list is empty. Guidance is read-side only: it does not
call an LLM, create Events, advance world time, mutate Projection, or replace
the internal Strategy Registry.

## Test gates

- Selector unit tests: every phase condition, allowlist check, immutability,
  deterministic replay.
- HTTP tests: 200/405, inline in command/wait, worldTime consistency, restart
  idempotency.
- Browser tests: loading/available/unavailable, button count, dispatch events,
  dismiss/reshow, stale response guard, busy-state blocking.
