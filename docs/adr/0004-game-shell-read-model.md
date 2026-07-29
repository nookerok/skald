# ADR 0004 — Game Shell Read Model

## Context

The current game screen is a functional dashboard of app.js components. The
prototype shows a unified "living world client" that integrates narrative
timeline, world context, character profile, situation awareness, activity,
knowledge and guidance into a single cohesive shell. This requires a new
backend contract that aggregates multiple existing read models.

## Decision

A pure read-side `buildGameShellSnapshot(events, world, characterProfile)`
function assembles the GameShellSnapshot DTO. It is:

- **Fully derived** from Event Log, ReadonlyWorld, CharacterProfile, and
  existing read models (TurnPresentation, DiscoveryJournal, PlayerGuidance).
- **Not a Rule** — it emits no Domain Events.
- **Not a Projection component** — it produces no stored state.
- **Not an LLM consumer** — all classification is deterministic.
- **Deterministic** — same inputs produce identical outputs.
- **Cachable** — a cached snapshot can be dropped and rebuilt without data loss.

The browser receives the pre-computed DTO and renders it. The browser never
classifies importance, visibility, causation, or knowledge stage.

### Key DTO elements

1. **CharacterView** — from `character_profiles` SQLite table (read-only).
2. **PlayerTurnView** — wraps `TurnPresentation` + `CausalStep[]` chain.
3. **SituationView** — static template adapters for `activeSituations`.
4. **AttentionView** — derived from risk_taken, consequences, discovery stage.
5. **WorldContextView** — safe summary of world state (position, relations, heat).
6. **KnowledgeSummary** — Facts/Hypotheses/Traces from DiscoveryJournal.
7. **WorldActivityItem[]** — recent background-level events with scope/origin.

### LLM boundary

LLM may rephrase text in `presentation` entries but may not select facts,
classify importance, determine scope/origin, or build causal chains.

## Consequences

- New source files under `packages/world/src/game-shell/`.
- New endpoint `GET /api/worlds/:worldId/game-shell`.
- `shellDelta` field in command/wait responses.
- No new Domain Events, Rules, or Projection fields.
- No new SQLite tables.
