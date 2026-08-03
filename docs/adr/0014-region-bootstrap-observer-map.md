# ADR 0014 — Region bootstrap and observer map vertical slice

Status: accepted

## Context

ADR-0012 defined a 20×20 km pilot region but deliberately left runtime work
deferred. The project needs a replayable installation step that can seed the
region without sending omniscient geometry to the normal browser.

## Decision

1. The authored pilot definition is compiled deterministically into a
   `RegionDefined` bootstrap Event plus location and initial spatial-observation
   Events. The Event Log, not the authoring module, is the replay authority.
2. `SpatialProjector` reconstructs region truth from `RegionDefined` and keeps
   it separate from the existing gameplay `WorldProjector`.
3. `buildObserverMap` exposes only observed locations/routes and a deliberately
   approximate landmark observation. Terrain tiles, cell IDs, canonical
   coordinates of a merely glimpsed landmark, and internal IDs are omitted.
4. The `living_region` world template installs the pilot bootstrap. Existing
   templates and legacy worlds remain unchanged.
5. `GET /api/worlds/:id/map` is a read-only backend boundary. It returns the
   observer DTO and returns 405 for mutating methods.

## Scope boundary

This slice does not add travel, weather, seasons, process scheduling, fast
travel, a map renderer, or new drama Rules. The existing Consequence/Situation
engine remains the source of living-world pressure; spatial processes will be
separate later slices with their own Events and Rules.

## Acceptance

- 6,400 terrain tiles and 400 simulation cells are generated deterministically.
- Bootstrap replay produces the same region digest and relation set.
- Observer map contains the starting waystation, two observed routes and a
  monolith bearing without exact monolith coordinates or hidden tile geometry.
- New region worlds are created through the existing idempotent creation path.
- Unit and HTTP tests cover replay, non-disclosure and the read-only endpoint.
