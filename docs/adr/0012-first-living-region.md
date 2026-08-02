# ADR 0012 — First living region and observer-scoped map

Status: accepted

## Context

SKALD needs a first 20×20 km pilot region containing a principal city,
villages, roads, rivers, forests, mountains, ruins, a crater and a suspended
monolith. Treating the supplied panorama as a level image or sending complete
geometry to the browser would create a second source of truth and make the
player omniscient.

The runtime already defines Event Log authority, Projection Purity,
observer-scoped Belief, Presence Reconstruction and `WorldId = save slot`.
Worldbuilding documents accept a pilot region only through a dedicated
vertical-slice mapping.

## Alternatives

1. Store a mutable map JSON beside the Event Log. Rejected: second truth and
   non-replayable geography.
2. Send the complete truth map to the browser and cover it with fog. Rejected:
   hidden facts reach an untrusted normal renderer.
3. Simulate only cells near the player. Rejected: player proximity would decide
   whether the world exists.
4. Make all 6,400 terrain tiles equally detailed every tick. Rejected as the
   only scaling strategy; it does not support continent growth.
5. Use an immutable authored region pack directly at runtime. Rejected as
   canonical state: replay would require an external fact bundle.

## Decision

1. The authored region pack is a build-time input. A deterministic compiler
   emits bootstrap Domain Events; after initialization the Event Log alone is
   sufficient to replay region truth.
2. Backend spatial truth is a discardable `SpatialWorldProjection`.
3. Normal UI receives only `ObserverMapDTO`, derived through Observation and
   Belief. Unknown canonical geometry is never sent and masked client-side.
4. The pilot uses 250 m terrain tiles and 1 km simulation cells as initial
   calibration, plus vector roads/rivers/footprints.
5. Simulation prioritization is process-driven. Player presence changes
   observation/render detail only, never world evolution.
6. Dormant cells use deterministic aggregate Rules and catch-up. Operational
   scheduling cannot select domain outcomes.
7. Location labels such as city/village/ruin are observer-facing or governed
   read queries, not permanent RPG classes.
8. Fog is evidence quality and freshness: unknown, rumored, glimpsed,
   observed, traversed and familiar aspects may coexist or become stale.
9. Discovery remains a read model. No `DiscoveryUnlocked` Event or stored
   `discovered` flag is added.
10. The monolith is a physical landmark subject to visibility Rules, never a
    quest objective or unconditional HUD marker.
11. Fast travel is not teleportation. Any later journey acceleration must
    advance time and execute all due Rules.
12. ADR-0003 remains unchanged. Creating a save initializes an isolated copy
    of the already-authored pilot world; it does not generate geography.
13. The current runtime has no World Clock, weather, seasons or death model.
    This ADR does not invent their facts or UI; each requires a later slice.

The complete proposal is `docs/LIVING_WORLD_REGION_ARCHITECTURE.md`.

## Consequences

- Initial bootstrap can be large and requires explicit replay/performance
  budgets on Orange Pi.
- Spatial truth and observer knowledge require separate builders and DTO tests.
- The concept-art panorama cannot be used directly as an in-game omniscient
  map.
- Region expansion is append-only: new regions are integrated by Events and
  old geography is never edited retroactively.
- No runtime Events, Rules, Projection fields, SQLite tables or UI are added by
  this documentation-only decision.
