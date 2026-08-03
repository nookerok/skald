# ADR 0016: Visibility & Observer Line of Sight

Status: accepted

## Context

The first living region (ADR-0012/0014) defines 6,400 terrain tiles (250×250 m)
with elevation bands, slope bands and surface types (water, soil, rock, marsh,
forest), 400 simulation cells (1 km), 6 locations, 4 landmarks and 5 spatial
relations. The `SpatialWorldProjection` holds geography as backend truth; the
`ObserverMapDTO` exposes only evidence-scoped knowledge to the browser.

Currently `buildObserverMap()` uses only pre-recorded `SpatialObservationRecorded`
events — the bootstrap writes initial observations and the map never changes based
on where the player actually is. There is no line-of-sight computation, no terrain
occlusion, no distance-based visibility. A player in a valley sees the same map as
a player on a mountain top.

Observable defects of the status quo:

- Map content is static after bootstrap.
- Elevation, terrain surface and distance have no effect on what the observer sees.
- The monolith is always `glimpsed` regardless of observer position.
- No mechanism to discover new locations by travelling to higher ground.

## Decision

Introduce a deterministic visibility engine as a pure read-side function. It
computes what an observer can see from a given position using terrain data,
landmark elevation and distance. It does not write Domain Events, does not create
Rules and does not modify Projection.

### 1. Pure read-side function

```
visibilityEngine.compute(observer, targets, spatial): VisibilityResult[]
```

- Reads: `SpatialWorldProjection` (tiles, locations, landmarks), observer
  position, observer history.
- Writes: nothing. Returns results only.
- No `EventBus.append()`, no `activeSituations.set()`, no `ConsequenceCreated`.

### 2. VisibilityResult

```ts
type VisibilityResult =
  | { visible: true; knowledge: "glimpsed" | "observed"; confidence: number;
      distanceBand: "near" | "middle" | "far"; bearing: string;
      exactPositionAllowed: boolean; }
  | { visible: false; reason: "out_of_range" | "terrain_occluded" |
      "height_occluded" | "forest_occluded"; };
```

### 3. Static configuration

All magic numbers live in a single `config.ts`:

- `observerEyeHeightMetres: 2`
- `commonRangeMetres: 4_000`
- `elevatedLandmarkRangeMetres: 12_000`
- `glimpsedConfidence: 0.35`
- `observedConfidence: 0.75`
- `terrainBandHeightMetres: 100`
- `forestOpacity: 0.55`
- `rockOpacity: 1`

### 4. Line-of-sight algorithm

Supercover/Bresenham traversal of terrain tiles between observer and target.
For each intermediate tile:
- Compute terrain elevation at that point.
- Check surface type (forest partially occludes, rock fully occludes above
  line of sight).
- Compare terrain height against the line-of-sight height at that distance.
- Return first blocking factor.

### 5. Distance bands

- 0–1 km: `near`
- 1–4 km: `middle`
- 4+ km: `far`

Elevated landmarks extend range to 12 km. The suspended monolith can be
glimpsed from far away but only as a silhouette.

### 6. Knowledge classification

- **observed**: within range, no occlusion, confidence ≥ 0.7. DTO contains
  exact position.
- **glimpsed**: partially visible (elevated, beyond normal range, through thin
  forest). DTO contains bearing and distance band but null coordinates.
- **hidden**: out of range, fully occluded, or no observer position. Object
  absent from DTO.

### 7. Integration with ObserverMapDTO

`buildObserverMap()` gains an optional visibility engine parameter. When
provided, it computes visibility for all spatial targets from the observer's
current position and merges results with existing `SpatialObservationRecorded`
evidence. The freshest observation wins.

### 8. Observer history

Each online `PlayerLocationChanged` defines an observer position. Visibility
is computed for the current position. Past positions are replayed from the
Event Log — no new Events are created.

Offline movement (`payload.playerOffline === true`) does not create visibility
observations.

### 9. Backward compatibility

When no visibility engine is provided, `buildObserverMap()` falls back to the
existing static-observation behavior. Legacy worlds without spatial relations
are unaffected.

### 10. Performance

Spatial candidate index groups landmarks/locations by simulation cell.
Query: observer cell → nearby cells within visibility radius → candidates →
distance check → line-of-sight check. No full-region scan per request.

## Consequences

- **File structure**: `packages/world/src/visibility/` with `types.ts`,
  `config.ts`, `terrain-height.ts`, `candidate-index.ts`, `line-of-sight.ts`,
  `visibility-engine.ts`, `index.ts`.
- **Tests**: distance/bearing formulas, terrain occlusion, forest/rock
  behavior, observed/glimpsed/hidden classification, replay equality,
  observer-map integration, no internal-ID leaks.
- **No new Domain Events or Rules**: visibility is read-side only.

## Definition of Done

The player in a valley sees nearby locations; the monolith is hidden or
glimpsed only as a silhouette. On higher ground the monolith becomes
`glimpsed` or `observed`. The map DTO contains only observer evidence, never
hidden geometry. Replay and restart produce identical results. Offline ticks
do not reveal the world. `npm run validate` passes.
