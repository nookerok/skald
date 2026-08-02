# SKALD — First Living Region Architecture

Status: accepted architecture proposal; runtime implementation is deferred to
explicit vertical slices.

This document defines how the first 20×20 km pilot region becomes part of the
living-world simulation. It does not install a map engine merely by existing.
Every runtime field, Event, Rule, Projection and DTO described as proposed still
requires a focused implementation ADR and tests.

The supplied concept art is a visual-direction reference only. It suggests a
river basin, a walled city, forests, mountains, ruins, a crater and a suspended
monolith. It is not authoritative geography and must not be shipped as an
omniscient player map.

## 1. Product statement

The map is not a level and not a catalog of content. It is two related,
strictly separated projections:

1. `SpatialWorldProjection` — backend truth reconstructed from the Event Log.
2. `ObserverMapDTO` — what a particular observer currently believes about
   space, reconstructed through Observation and Belief.

The normal player UI never reads `SpatialWorldProjection` directly.

```text
Region bootstrap Events + later Domain Events
                    |
                    v
          SpatialWorldProjection
                    |
          Observation Engine
                    |
                    v
      BeliefModel + ObserverMap builder
                    |
                    v
             ObserverMapDTO
                    |
                    v
              Player map UI
```

The player does not generate a world. A new isolated world/save is initialized
from the accepted pilot-region bootstrap and already contains its geography,
history and ongoing processes before the observer enters it. This preserves
ADR-0003: `WorldId` is still an isolated save slot, not a shared MMO world.

## 2. Authority and storage classes

### 2.1 Canonical facts recorded as Events

The Event Log must be sufficient to replay the region. Proposed bootstrap
facts include region identity and bounds, terrain/simulation-cell definitions,
authored topological relations, locations, landmarks, roads, rivers, crossings,
initial structures and environmental processes.

A build-time region compiler may read an authoring bundle, but its runtime
output is a deterministic batch of bootstrap Domain Events. The authoring
bundle is not read as a second source of truth after initialization. The
bootstrap batch records a content digest for audit and reproducibility.

### 2.2 Dynamic canonical facts

Dynamic facts are appended as normal Domain Events, for example road or bridge
condition changes, floods, fires, vegetation growth, settlement change,
construction, migration, weather fronts and long-lived Situations. These names
are proposal vocabulary, not installed Event types.

### 2.3 Derived and operational state

Discardable Projections compute current terrain, traversal cost, route graph,
line-of-sight, landmark visibility, settlement/environment summaries, active
spatial processes and observer knowledge. Cached tiles, snapshots, visibility
masks and simulation cursors are not canonical.

Operational data may include projection snapshots, region indexes, render
caches and observer checkpoints. It must be disposable and never decide a game
outcome. Private map annotations require a later ADR and are not world facts.

## 3. Conceptual model

```text
World
  └─ Region[1..N]
       ├─ RegionBounds
       ├─ TerrainTile[0..N]
       ├─ SimulationCell[1..N]
       ├─ Location[0..N]
       ├─ Landmark[0..N]
       ├─ SpatialRelation[0..N]
       │    ├─ RoadSegment
       │    ├─ WatercourseSegment
       │    ├─ Crossing
       │    └─ VisibilityRelation
       └─ SpatialProcess[0..N]

Observer
  └─ ObserverMapDTO
       ├─ KnownArea
       ├─ KnownLocation
       ├─ KnownRoute
       ├─ KnownLandmark
       ├─ RumoredArea
       └─ PlayerAnnotation (future, non-authoritative)
```

Space is not only Cartesian containment. Roads, rivers, passes, sight lines
and travel relations are first-class relations between spatial subjects. This
matches the relation-first ontology without installing a generic graph engine.

## 4. Proposed data contracts

These are design shapes, not current exported interfaces.

```ts
interface RegionDefinition {
  readonly id: string;
  readonly version: number;
  readonly contentDigest: string;
  readonly bounds: {
    readonly originXMetres: number;
    readonly originYMetres: number;
    readonly widthMetres: number;
    readonly heightMetres: number;
  };
}

interface TerrainTile {
  readonly id: string;
  readonly regionId: string;
  readonly bounds: SpatialBounds;
  readonly elevationBand: number;
  readonly surface: "water" | "soil" | "rock" | "marsh" | "forest";
  readonly slopeBand: number;
}

interface SimulationCell {
  readonly id: string;
  readonly regionId: string;
  readonly bounds: SpatialBounds;
  readonly neighbourIds: readonly string[];
}

interface LocationDefinition {
  readonly id: string;
  readonly regionId: string;
  readonly anchor: SpatialPoint;
  readonly footprintTileIds: readonly string[];
  readonly relations: readonly SpatialRelationRef[];
}

interface LandmarkDefinition {
  readonly id: string;
  readonly regionId: string;
  readonly anchor: SpatialPoint;
  readonly elevationMetres: number;
  readonly silhouetteClass: string;
}
```

`city`, `village`, `ruin`, `temple`, `camp` and `port` are not immutable RPG
classes. A location has identity and relations; settlement/city/ruin status is
derived by governed queries from population, structures, activity and history.

## 5. Pilot-region spatial resolution

The 20×20 km region uses two resolutions:

- `TerrainTile`: 250×250 m, 80×80, 6,400 tiles, for terrain, visibility and
  rendering inputs.
- `SimulationCell`: 1×1 km, 20×20, 400 cells, for process scheduling and
  causal neighbourhoods.

Vector relations describe roads, rivers, settlement footprints and passes.
These values are MVP calibration parameters, not player-nearby special cases.

## 6. Spatial simulation

The world must not stop outside the camera or observer radius. Simulation
resolution may vary, but domain outcomes remain deterministic.

Cells form a derived scheduling view:

- `hot`: an active Situation or process is due now;
- `warm`: causally adjacent to a hot cell, route dependency or approaching
  environmental front;
- `dormant`: evaluated through deterministic aggregate Rules and catch-up.

Player presence may increase observation/render detail but never decides
whether processes exist or progress. Operational workers may prioritize cells,
but cannot select outcomes. If batching changes an outcome, batching is game
logic and must be represented by deterministic Rules and explicit Events.

Processes cross cells only through declared relations:

```text
Rain front -> river catchment -> water level -> crossing condition
Fire -> neighbouring vegetation -> smoke visibility -> observed landmark
Bridge loss -> route reachability -> trade flow -> settlement consequence
```

There is no global `updateEveryNPC()` loop. Situations and aggregate flows are
the scalable unit.

## 7. First entry experience

The production flow reuses Presence Reconstruction:

```text
Known Worlds
  -> connect to the pilot world
  -> reconstruct observer memory (missing on first contact)
  -> sensory presence montage
  -> focus on one immediate, observable tension
  -> explicit "I am here" acknowledge
  -> free-text composer unlocked
```

There is no difficulty selection, seed, generator or quest briefing. World
creation initializes an isolated Event Log from the accepted region bootstrap.
The montage may state only observable facts and must not explain the monolith,
reveal distant cities or summarize hidden events.

## 8. Start location

The preferred start is a small river crossing or waystation at the boundary
between forest and open valley, approximately 5–8 km from the principal city.
It provides one safe shelter, a road toward the city, a less certain trail into
forest/ruins, a mutable crossing, partial sight of the monolith and conflicting
local rumours. It offers several legible directions without an action menu and
does not expose the region's most consequential locations.

## 9. Observer-scoped fog of war

Fog is not a truth mask stored in World Projection. It is absence, quality and
freshness of observer evidence.

```text
unknown   -> no DTO entry
rumored   -> indirect claim, approximate area, uncertain
glimpsed  -> distant direct evidence, incomplete outline
observed  -> directly seen from a valid viewpoint
traversed -> observer movement proves a route/area was occupied
familiar  -> repeated direct evidence; mutable details still decay
```

These are not one unconditional monotonic ladder. `traversed` is biographical,
while road condition, ownership, population and weather become stale
independently. Rumours may be contradicted and familiarity is not omniscience.

Reveal algorithm:

1. Resolve observer position and sensory modality from canonical Events.
2. Compute deterministic visibility using terrain, elevation, distance,
   occlusion and existing environmental facts.
3. Produce Observation Records for visible subjects only.
4. Merge evidence in BeliefModel with confidence, freshness and contradiction.
5. Build `ObserverMapDTO` from BeliefModel/current observations.
6. Omit unknown shapes; never send the truth map and hide it in CSS.

SKALD has no accepted death/continuity model. This proposal does not invent one.
A future character cannot inherit private knowledge without an observable
in-world carrier and a separate ADR.

## 10. Discovery and Biography

Discovery remains the read model accepted by ADR-0001. The map does not append
`DiscoveryUnlocked` or store `discovered: true`.

Future spatial Events may record entering a location, traversing a route,
observing a landmark or receiving testimony/a physical map. Discovery and
Observer Map builders classify that evidence. Biography derives causal chains,
not a checklist of icons:

```text
followed smoke
  -> reached ridge
  -> saw the monolith against the storm
  -> used its bearing to find the river crossing
```

## 11. The suspended monolith

The monolith is a physical landmark, never a quest or unconditional HUD marker.
Rules determine visibility from elevation, terrain, distance, smoke/cloud and
future light laws. An observation gives an approximate bearing and silhouette,
not exact coordinates or meaning. Cultural interpretations may contradict each
other; Narrative/LLM never decides what the monolith truly is.

## 12. Exploration scale and calibration

Initial targets:

- road walking: approximately 4–5 km per in-world hour;
- rough terrain: 2–3 km per in-world hour;
- marsh, steep mountain or dense ruin: 0.5–1.5 km per in-world hour;
- common direct visibility: 1–4 km, terrain/weather dependent;
- elevated landmark visibility: potentially region-wide, never guaranteed;
- several meaningful observations per travelled kilometre, not map markers.

Current `worldTime` is an abstract tick. These cannot become runtime constants
until a World Clock ADR defines tick duration and travel-time Rules.

## 13. Player map contract

The map may show observed terrain silhouettes with uncertain edges, traversed
routes, observed locations/landmarks, approximate rumours, confidence,
freshness, contradictions and the observer's own available position.

It must not show undiscovered geometry hidden only by CSS, exact rumour
coordinates, hidden Situations, canonical settlement classes without evidence,
quest markers, completion percentages or internal IDs.

The full concept-art panorama may be used for marketing/developer reference.
If adapted in-game, it must be reconstructed through `ObserverMapDTO` and
cannot reveal the full region.

## 14. Travel acceleration

Teleport-style fast travel is rejected. A later `JourneyIntent` may compress a
known journey only if endpoints and route are known, canonical time advances,
all due Rules execute and observable interruptions stop the abstraction. This
is simulation compression and requires a separate ADR.

## 15. Living map

Truth changes with Domain Events; the observer map changes only when evidence
reaches the observer.

| World change | Truth projection | Player map |
|---|---|---|
| bridge collapses | route blocked | unchanged until seen/reported |
| road floods | traversal cost changes | stale/contradicted old belief |
| farm burns | structure changes | smoke may be visible first |
| settlement grows | query changes | gradual evidence |
| forest is cut | terrain cover changes | viewpoint-dependent evidence |
| army moves | aggregate process moves | traces/rumours only |

## 16. Time, seasons and weather

The current runtime has heat and abstract ticks but no accepted World Clock,
season or weather law. The UI must not infer them from concept art.

Future order: World Clock -> solar/light visibility -> weather fronts as
Situations -> hydrology consequences -> seasonal vegetation/travel/settlement.
Every layer remains Event/Rule/Projection driven and observer scoped.

## 17. Persistence and replay

Canonical: region/bootstrap definition Events and later world-changing Domain
Events. Derived/disposable: spatial Projection, route/visibility indexes,
Observer Map caches, render tiles and snapshots. Operational: world metadata,
observer checkpoint and future private annotations.

Replay from the Event Log must reproduce region truth without the original
authoring bundle.

## 18. Streaming and continent expansion

The first implementation remains one region. Scaling uses region-scoped
spatial Events, partitionable derived projections, cross-region relations,
dormant region summaries and lazy observer DTO construction — never lazy world
existence. Content expansion appends region-integration bootstrap Events and
never edits old geography retroactively.

The hundredth region must reuse Region, SimulationCell, spatial relation and
observer-knowledge contracts unchanged.

## 19. Developer tools

Trusted-LAN Diagnostics may expose region/cell boundaries, scheduling tiers,
truth versus observer evidence, routes/crossings, causal traces, future weather
fronts, governed query scores and timing metrics. Diagnostics is read-only and
none of these fields may leak into the normal Player Map DTO.

## 20. Performance requirements

Provisional Orange Pi MVP budgets:

- region bootstrap/replay under 10 s before HTTP readiness;
- spatial Rule evaluation p95 under 50 ms per world tick;
- observer-map API p95 under 250 ms warm and 750 ms cold;
- compressed known-region DTO under 250 KiB;
- player-map pan/zoom 60 fps desktop, 30 fps minimum mobile;
- one loaded-region spatial working set under 256 MiB;
- no full-region scan in a normal command path without benchmark evidence.

These are acceptance budgets, not permission to weaken simulation truth.

## 21. Vertical-slice implementation order

1. Region compiler -> bootstrap Events -> replayable spatial Projection.
2. One location, road, crossing and monolith visibility relation.
3. Movement/travel time across spatial relations.
4. Observer visibility and minimal `ObserverMapDTO`.
5. First-entry flow at the river waystation.
6. One living spatial process: water changes bridge/road condition.
7. Discovery/Biography evidence from traversal/landmark observation.
8. Read-only player map renderer.
9. Developer overlays and Orange Pi performance calibration.
10. Additional processes/locations, then another region.

Each slice states consumed Events/read models, created Domain Events and proves
Projection Purity, observer non-disclosure and deterministic replay.

## 22. Acceptance criteria

- spatial Projection replay is identical;
- the browser cannot obtain unknown canonical geometry;
- hidden bridge collapse changes truth but not player knowledge;
- later observation can contradict a stale route;
- offline time advances processes without granting observations;
- the monolith provides an observed bearing without becoming a marker;
- no process pauses merely because the player is distant;
- no LLM generates geography, visibility, facts or discoveries;
- another region can be added without changing first-region contracts;
- validation, long-run calibration and real browser QA pass.
