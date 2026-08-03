# ADR 0015: Spatial Movement & Abstract Travel Time

Status: accepted

## Context

The first living region (ADR-0012/0014) defines 6 locations and 5 spatial
relations (3 roads, 1 crossing, 1 river) in a 20×20 km pilot area. The
`SpatialWorldProjection` holds geography as backend truth; the
`ObserverMapDTO` exposes only evidence-scoped knowledge to the browser. But
**movement between locations is instant**: the legacy `interactionMovement`
rule checks `location.connections` and emits `PlayerLocationChanged` without
any time cost, travel ticks or intermediate world-state changes.

This means:
- Walking 5.5 km along a road takes the same zero time as crossing a room.
- No Consequences, Situations or heat rules fire during travel.
- The world does not change while the player moves.
- There is no journey state: the player is either Here or There.

The existing `SpatialRelation` has `kind`, `fromId`, `toId`, `label` and
`points` but no `distanceMetres`, `baseTravelTicks`, `terrainCost` or
`passability`. The region compiler emits `LocationDefined` with verb-keyed
`connections` (e.g. `{ enter: "tower_entrance" }`) — a location-graph model
that does not carry travel parameters.

Observable defects of the status quo:

- Movement is a teleport with narrative dressing.
- The world clock does not advance during travel.
- Crossing a river and walking a road are identical.
- Dynamic conditions (flood, fire, road damage) cannot block or slow travel.
- The player never experiences the journey as part of the world.

## Alternatives

1. **Extend `InteractionVerb` with a `travel` verb.** Dropped: movement
   through space is a different domain from observing/inspecting/touching
   objects. It has its own pipeline, its own projection state and its own
   tick budget. Mixing it into the interaction pipeline would conflate two
   unrelated concerns.

2. **Instant travel with N narrative ticks.** Dropped: skips intermediate
   world-state changes. A flood that rises during travel must be observable
   at arrival, not fabricated by Narrative.

3. **Client-side route calculation.** Dropped: reveals the full route graph
   to the browser. Violates observer-scoped fog of war (ADR-0012 §9).

4. **Fast travel.** Dropped: the spec explicitly forbids it for v1. The
   player must experience the journey.

5. **Separate TravelEngine outside RuleEngine.** Dropped: violates the
   invariant that all gameplay logic lives inside Rules
   (ARCHITECTURE.md §2.3).

## Decision

Introduce Spatial Movement: a dedicated journey pipeline that converts free-
text travel intent into multi-tick world progression. Movement is NOT a new
InteractionVerb; it is a separate `JourneyIntent` command type with its own
Domain Events, Rules and Projection state.

### 1. JourneyIntent (command side, never persisted)

```ts
interface JourneyIntent {
  readonly type: "JourneyIntent";
  readonly destination: IntentReference;  // as the player named it
  readonly routeHint?: IntentReference;   // "по лесной дороге", "через переправу"
  readonly rawText: string;
  readonly interpretation: InterpretationMeta;
}
```

Produced by the parser for Russian/English travel verbs. Consumed by the
Command Handler, which emits `JourneyRequested` (the first Domain Event).

### 2. TravelRelation (derived from bootstrap events)

```ts
interface TravelRelation {
  readonly id: string;
  readonly kind: "road" | "crossing" | "river" | "visibility";
  readonly fromId: string;
  readonly toId: string;
  readonly distanceMetres: number;
  readonly baseTravelTicks: number;
  readonly terrainCost: number;
  readonly passability: "open" | "blocked";
}
```

`TravelRelation` is a derived view over `SpatialRelation` + bootstrap
`TravelMetadataAttached` events. The existing `SpatialRelation` type is not
modified; `RegionDefinition.relations` stays as-is.

### 3. Journey pipeline

```
Player text
  ↓
Intent Parser
  ↓
JourneyIntent (transient, never persisted)
  ↓
Command Handler (structural: known type + non-empty destination)
  ↓
JourneyRequested (first Domain Event)
  ↓
duration_check (validation gate, sole owner)
  ↓ JourneyValidated | ActionRejected
journey.validate (validation rule)
  ↓ JourneyStarted | JourneyBlocked
journey.start (consequence phase)
  ↓ JourneyState created + TickPassed × N
TickPassed × N → normal world pipeline (heat, consequences, situations)
  ↓ after last tick
PlayerLocationChanged + JourneyCompleted
```

### 4. Route resolution (server-only)

```ts
resolveJourneyRoute(intent, world, spatial, observerMap): JourneyResolution
```

- Resolves destination from observer-scoped knowledge (no hidden geometry).
- Checks passability of the route relation.
- Returns resolved / blocked / ambiguous.
- Unknown destination → `blocked` with player-friendly text.
- Never reveals unknown locations.

### 5. JourneyState (Projection)

```ts
interface JourneyState {
  readonly journeyId: string;
  readonly relationId: string;
  readonly fromLocationId: string;
  readonly toLocationId: string;
  readonly startedAt: number;
  readonly plannedTicks: number;
  readonly elapsedTicks: number;
  readonly status: "active" | "completed" | "blocked";
}
```

Stored in `world.journeys` map. `world.activeJourneyId` tracks the current
journey. Survives restart via Event Log replay.

### 6. Multi-tick progression

`JourneyStarted` emits N individual `TickPassed { delta: 1 }` events, each
processed by the full rule engine pipeline. This ensures:
- Consequence rules fire on each tick.
- Situation rules advance during travel.
- Heat, relations and all other world processes continue.
- The journey is not a black box but a sequence of normal world ticks.

### 7. Active journey blocks new commands

While `world.activeJourneyId !== null`, `duration_check` rejects new player
commands with `ActionRejected(reason: "traveling")`. The player cannot
observe, inspect or interact during travel — they are walking.

### 8. Dynamic passability

Crossings and roads can change passability via:
- `CrossingConditionChanged` (e.g., flood raises river level)
- `RoadConditionChanged` (e.g., fire blocks road)
- `RouteBlocked` / `RouteReopened` (explicit)

These are emitted by consequence/situation rules and change
`TravelRelation.passability` in the spatial projection.

### 9. Backward compatibility

Legacy grid worlds (old_tower, crossroads, legacy) continue to work.
`physicsMovement` and `interactionMovement` rules handle those worlds.
The journey pipeline only activates for worlds with
`SpatialWorldProjection` (living_region). The `duration_check` gate
distinguishes between `InteractionRequested` (existing path) and
`JourneyRequested` (new path).

### 10. Parser integration

Russian stems for travel: идти, пойти, направиться, добраться, перейти,
двигаться, отправиться, выбраться. English: go, walk, travel, head, move to.
These produce `JourneyIntent`. Route hints: по дороге, через переправу,
лесной дорогой.

### 11. API contract

```
POST /api/worlds/:id/command → response gains journey: JourneyDTO
GET  /api/worlds/:id/journey → JourneyDTO (200) or 405
```

JourneyDTO carries status, from/to names, elapsed/total ticks, narrative
text. No internal IDs.

### 12. UI

Free-text only. No D-pad, no route buttons, no progress bar, no ETA.
Narrative text during travel: "Путь продолжается… Мир успевает измениться
вокруг тебя." On arrival: "Ты достиг {destination}."

## Consequences and gates

- **File structure**: new `packages/world/src/journey/` directory with
  `types.ts`, `route-resolver.ts`, `dto.ts`; new rules in
  `packages/world/src/rules/journey-*.ts`; parser additions in
  `packages/intent-parser/src/`; projection extensions in
  `packages/world/src/projection.ts`; event types in
  `packages/world/src/event-types.ts`.
- **Tests**: parser forms (RU/EN), route resolver (exact/alias/ambiguous/
  unknown/blocked/open), journey rules (pipeline/block/tick), projection
  (replay/restart), HTTP (200/409/400/405), dramaturgy (consequence firing
  during ticks).
- **Backward compatibility**: legacy worlds unaffected; journey only
  activates for worlds with spatial relations.

## Definition of Done

«Идти к Речному Стражу» проходит через единый pipeline, реально продвигает
`worldTime`, запускает Consequences/Situations, приводит игрока к известной
локации, корректно восстанавливается после restart, не раскрывает неизвестную
геометрию и не добавляет в UI кнопок маршрута. Существующие grid-миры
продолжают работать без изменений.
