# ADR 0017: River Hydrology & Crossing Condition

Status: accepted

## Context

The pilot region has a river (`river_basin`) running from the northern mountains
through the waystation to the city, with a crossing (`river_crossing`) connecting
the waystation to the city. Currently the crossing is a static spatial relation
with `passability: "open"` set at bootstrap. There is no water level, no seasonal
variation, no dynamic crossing condition. The river is decorative geography, not
a living process.

The Spatial Movement system (ADR-0015) introduced `TravelRelation` with
`passability: "open" | "blocked"`, but passability is static. The route resolver
checks passability but nothing in the world ever changes it.

Observable defects:

- The river never changes. It is the same at T0 and T1000.
- The crossing never floods, never becomes difficult, never blocks travel.
- No spatial process runs during `TickPassed` that affects geography.
- The first living region has no "living" spatial behavior.

## Decision

Introduce a deterministic river hydrology process: a cyclic water level that
changes every tick and dynamically affects crossing passability. This is the
first living spatial process in the world.

### 1. RiverProcessDefinition

Static configuration recorded as bootstrap events:

```ts
interface RiverProcessDefinition {
  processId: string;
  watercourseId: string;
  baselineLevel: number;
  minimumLevel: number;
  maximumLevel: number;
  cycleLengthTicks: number;
  phaseOffset: number;
  riseRate: number;
  fallRate: number;
}
```

### 2. Deterministic river level

```ts
computeRiverLevel(process, worldTime): number
```

Cyclic profile: rise → high → fall → low → rise. No randomness, no weather,
no external input. Fully reproducible from Event Log.

### 3. RiverLevelChanged event

Emitted when the computed level differs from the stored state. Contains
previous and new level/band.

### 4. CrossingConditionChanged event

Emitted when crossing condition transitions: open → difficult → closed.
Thresholds are part of the crossing definition, not hardcoded in the rule.

### 5. Event chain

```
TickPassed
  → riverLevelProcess
  → RiverLevelChanged
  → crossingCondition
  → CrossingConditionChanged
  → Projection update
```

### 6. Route resolver integration

The route resolver reads `crossingStates` from spatial projection. A closed
crossing blocks the journey; a difficult crossing increases travel cost.

### 7. Observer boundary

River/crossing state changes are canonical world facts. The observer only
learns about them through direct observation, attempted travel, or proximity.
Offline ticks change the truth but not the player's knowledge.

### 8. No weather yet

This process uses a fixed cyclic profile. Future Weather/Season systems will
provide water inflow as an input, but that is a separate ADR.

## Consequences

- **File structure**: `packages/world/src/rules/river-level.ts`,
  `packages/world/src/rules/crossing-condition.ts`.
- **New types**: `RiverProcessDefinition`, `RiverState`, `CrossingState`,
  `RiverBand`, `CrossingCondition` in `region/types.ts`.
- **New events**: `RiverProcessDefined`, `RiverLevelChanged`,
  `CrossingConditionInitialized`, `CrossingConditionChanged`.
- **Tests**: deterministic profile, threshold transitions, projection replay,
  route resolver integration, observer boundary.

## Definition of Done

`TickPassed` → river level changes → crossing condition changes → route
resolver blocks difficult crossings → world time advances → offline ticks
change truth but not knowledge → replay produces identical results →
`npm run validate` passes.
