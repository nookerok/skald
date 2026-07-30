# ADR 0002 — Player Guidance Read Model

Status: read-model decision retained; suggestion-button interaction mechanics
superseded by ADR 0005 (Open Intent and Critical Checks).

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

3. **Suggestions come from a static allowlist.** The `GuidanceActionId` enum
   maps to registered `move`, `wait`, `give` commands and `navigate` targets.
   The selector cannot suggest arbitrary strings.

4. **LLM is never involved.** Guidance text is compile-time static Russian
   text. No LLM call selects the phase, the text, or the suggestions.

5. **Player confirms every action.** A suggestion button dispatches a
   `skald:command` custom event which flows through the existing `handle()`
   path (idempotency key, pending state, retry, timeout, reconciliation).

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
- New browser module `guidance-view.js` with custom event dispatch.
- New CSS file `guidance.css`.
- No new Domain Events, Rules, Projection fields, or SQLite tables.

## Test gates

- Selector unit tests: every phase condition, allowlist check, immutability,
  deterministic replay.
- HTTP tests: 200/405, inline in command/wait, worldTime consistency, restart
  idempotency.
- Browser tests: loading/available/unavailable, button count, dispatch events,
  dismiss/reshow, stale response guard, busy-state blocking.
