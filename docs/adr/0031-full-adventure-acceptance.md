# ADR-0031: Full adventure acceptance

Status: accepted for the deterministic acceptance slice

## Context

The existing unit, Canon, simulation and eval gates prove deterministic
correctness, but they do not prove that a player can complete a coherent
adventure through the production HTTP and persistence path. A long offline
probe is not a substitute for a journey with a goal, a changed world, an
observation, a return and consequences after absence.

## Decision

The repository owns one deterministic acceptance adventure, **След старого
русла**. It runs through the same HTTP routes and SQLite runtime as the game:

```text
create living_region
  -> presence and chat
  -> rumour/evidence available to the observer
  -> choose a destination
  -> multi-tick journey
  -> weather/river change
  -> inspect a historical trace
  -> return and compare the observer map
  -> offline world ticks
  -> presence summary and acknowledgement
  -> SQLite restart and transcript replay
```

The deterministic acceptance runner may use a fixed narration provider (the
canonical presentation returned by the server). It must never depend on a live
LLM response or exact prose from an external model. Live LLM and browser
playtests remain release evidence, not a source of simulation truth.

The acceptance runner is forbidden from inserting Domain Events directly. It
may create a world, submit commands, advance offline ticks, read observer DTOs
and restart the server. Facts are proved from the persisted Event Log and
observer-scoped read models.

## Contract

The merge-blocking deterministic checks are:

- the created world is `living_region` and has a non-null map region/current
  position;
- player and master turns alternate without orphan responses or raw internal
  identifiers;
- the observer can hear/inspect an authored rumour or evidence seed without
  receiving hidden coordinates;
- each journey has request, validation, progress and completion; offline ticks
  never progress an active player journey;
- weather, river or crossing state changes during the trip;
- a discovery advances from trace to hypothesis without becoming Canon truth;
- the return changes observer-scoped map knowledge and the journal;
- offline time produces autonomous world events but no impossible personal
  observations or player movement;
- Presence contains at most three meaningful highlights and acknowledgement is
  idempotent;
- the journal remains ordered and equivalent after an SQLite restart;
- replay purity, idempotency, truth-boundary and no-duplicate-narration checks
  pass.

### Fifteen-beat conformance contract

The acceptance scenario is considered complete only when these beats are
observable through the production command/read path, in order:

1. Create or continue a `living_region` world.
2. Enter Presence and receive at most two or three useful highlights.
3. Exchange at least one player/master turn.
4. Hear an authored rumor with source and uncertainty; no exact hidden point is revealed.
5. Choose an intentional destination.
6. Start a route with a deterministic planned duration.
7. Progress through more than one travel tick without teleportation.
8. Observe weather, river or crossing conditions change.
9. Make a consequential route decision (wait, alternate, continue or return).
10. Inspect a place twice and advance a discovery from trace to hypothesis.
11. Return to the starting waystation through the same command gateway.
12. Compare observer map knowledge and fog/reveal after the return.
13. Disconnect and advance 24–48 autonomous ticks without personal observations or movement.
14. Re-enter, acknowledge Presence and observe autonomous regional consequences.
15. Restart/replay from SQLite and read one ordered, coherent chronicle with no duplicate narration.

The harness exposes `createWorld`, `continueWorld`, `enterPresence`, `say`,
`answerClarification`, observer DTO readers, `disconnect`, `advanceOffline`,
`restartServer`, `reconnect` and `acknowledgePresence` so each beat is a real
HTTP request. It paginates the Event Log for audit, but it never appends a
Domain Event itself. A fixed narration provider is used only in deterministic
CI; a live AI-DM/browser run is a separate, explicitly manual release check.
The deterministic scenario is a conformance test, not a claim that the text is
already a compelling 30–60 minute human experience. That claim additionally
requires the documented browser playtest rubric and live AI-DM smoke.

## Consequences

Adventure acceptance is a separate `packages/cli/src/acceptance` read/driver
layer. It drives existing Domain Events and read models; the authored waystation rumor is a deterministic world Rule, not a harness shortcut. The acceptance layer adds no persistence tables. The normal
`npm run validate` gate runs the deterministic acceptance; live LLM and browser
evidence are recorded separately before deployment.
