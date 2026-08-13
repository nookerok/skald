import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { SpatialWorldProjection } from "@skald/world";
import {
  buildObserverMap,
  rebuildProjection,
  buildPilotRegionBootstrapEvents,
  buildPilotRegionDefinition,
  buildSpatialWorldProjection,
  buildPilotRegionHydrographyDefinition,
  buildPilotRegionElevationDefinition,
  buildPilotRegionToponymIndex,
  buildPilotRegionSimulationDefinitions,
  buildPilotRegionContentDefinitions,
} from "@skald/world";

describe("first living region", () => {
  it("compiles the 20x20 km pilot at the accepted resolutions", () => {
    const region = buildPilotRegionDefinition();
    expect(region.bounds.maxXMetres).toBe(20_000);
    expect(region.bounds.maxYMetres).toBe(20_000);
    expect(region.tiles).toHaveLength(6_400);
    expect(region.cells).toHaveLength(400);
    expect(region.contentDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(buildPilotRegionDefinition().contentDigest).toBe(region.contentDigest);
  });

  it("contains the authored crossing, city, river and monolith relations", () => {
    const region = buildPilotRegionDefinition();
    expect(region.locations.map((location) => location.id)).toContain("river_waystation");
    expect(region.locations.map((location) => location.id)).toContain("riverwatch_city");
    expect(region.relations.map((relation) => relation.id)).toContain("river_crossing");
    expect(region.locations.map((location) => location.id)).toContain("western_cliff_waterfalls");
    expect(region.landmarks.find((landmark) => landmark.id === "western_cliff_waterfalls")?.silhouetteClass).toBe("waterfall");
    expect(region.relations.map((relation) => relation.id)).toContain("road_forest_waterfalls");
    expect(region.relations.map((relation) => relation.id)).toContain("road_waystation_waterfalls");
    expect(region.landmarks.find((landmark) => landmark.id === "suspended_monolith")?.silhouetteClass).toBe("monolith");
  });

  it("emits deterministic bootstrap facts and replays spatial truth", () => {
    const first = buildPilotRegionBootstrapEvents();
    const second = buildPilotRegionBootstrapEvents();
    expect(first).toEqual(second);
    expect(first.find((event) => event.type === "RegionDefined")).toBeTruthy();
    // Invariant-based, not count-based: the world may gain observations over
    // time (Pilot Region Living State v0.1), but the key subjects must exist.
    const observations = first.filter((event) => event.type === "SpatialObservationRecorded");
    const subjects = observations.map((e) => (e.payload as { subjectId: string }).subjectId);
    expect(observations.length).toBeGreaterThanOrEqual(4);
    expect(subjects).toContain("river_waystation");
    expect(subjects).toContain("suspended_monolith");
    expect(subjects).toContain("glass_crater");
    const projection = buildSpatialWorldProjection(first);
    const replay = buildSpatialWorldProjection([...first]);
    expect(projection.region?.contentDigest).toBe(replay.region?.contentDigest);
    expect([...projection.locations.keys()]).toEqual([...replay.locations.keys()]);
    expect([...projection.relations.keys()]).toEqual([...replay.relations.keys()]);
    expect(projection.hydrography?.watercourses.map((entry) => entry.id)).toEqual(["river_basin", "western_waterfall_channel"]);
    expect(projection.elevation?.bands.map((entry) => entry.rank)).toEqual([1, 2, 3, 4]);
    expect(projection.toponymIndex?.subjects).toHaveLength(13);
  });

  it("carries Canon provenance and excludes proposal-only seeds", () => {
    const events = buildPilotRegionBootstrapEvents();
    const genesis = events.find((event) => event.type === "CanonGenesisRecorded");
    expect(genesis?.payload).toMatchObject({ regionId: "riverwatch-basin", regionVersion: 4, compilerVersion: "pilot-region-compiler-v5", provenance: { canonicalRefs: expect.arrayContaining(["regions.pilot-region.geography.f1"]) } });
    const region = events.find((event) => event.type === "RegionDefined");
    expect((region?.payload as any).provenance.canonicalRefs).toContain("regions.pilot-region.geography.f1");
    for (const event of events.filter((entry) => entry.type !== "CanonGenesisRecorded")) expect((event.payload as any).provenance.canonicalRefs.length).toBeGreaterThan(0);
    expect(events.filter((event) => event.type === "SettlementCreated" && (event.payload as any).settlementId === "southern_borough")).toHaveLength(1);
    expect(events.filter((event) => event.type === "SpatialObservationRecorded" && (event.payload as any).subjectId === "western_cliff_waterfalls")).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain("candidate.blackwood-timber");
    expect(JSON.stringify(events)).not.toContain("hypotheses.monolith-power-source");
  });

  it("projects accepted hydrography, relative elevation and reviewed names", () => {
    const hydro = buildPilotRegionHydrographyDefinition();
    const elevation = buildPilotRegionElevationDefinition();
    const names = buildPilotRegionToponymIndex();
    expect(hydro.watercourses.map((entry) => entry.id)).toEqual(["river_basin", "western_waterfall_channel"]);
    expect(hydro.waterBodies[0]?.classification).toBe("unresolved");
    expect(hydro.wetlands).toEqual([]);
    expect(elevation.bands.map((entry) => entry.rank)).toEqual([1, 2, 3, 4]);
    expect(names.subjects).toHaveLength(13);
    expect(names.subjects.find((entry) => entry.id === "southern_borough")?.canonicalName).toBe("Южный посад");
  });

  it("exposes accepted compiled content and simulation metadata only", () => {
    const simulation = buildPilotRegionSimulationDefinitions();
    const content = buildPilotRegionContentDefinitions();
    expect(simulation).toHaveLength(8);
    expect(content).toHaveLength(3);
    expect(content).toEqual(expect.arrayContaining([expect.objectContaining({ id: "old_ruins_masonry", locationId: "old_ruins", aliases: expect.arrayContaining(["каменную кладку"]) })]));
    expect(JSON.stringify(simulation)).not.toContain("candidate.blackwood-timber");
    expect(JSON.stringify(simulation)).not.toContain("hypotheses.");
  });

  it("returns observer-scoped evidence, not the truth geometry", () => {
    const events = buildPilotRegionBootstrapEvents();
    const map = buildObserverMap(events, buildSpatialWorldProjection(events));
    expect(map.region?.name).toBe("Бассейн Речного Стража");
    const names = map.locations.map((location) => location.name);
    expect(names).toContain("Переправа у Чёрного леса");
    expect(names).toContain("Кромка Чёрного леса");
    expect(map.locations.length).toBeGreaterThanOrEqual(2);
    expect(map.routes.length).toBeGreaterThanOrEqual(2);
    expect(map.routes.some((route) => route.knowledge === "observed")).toBe(true);
    expect(map.knownArea).toEqual({
      minXMetres: 5_000,
      minYMetres: 8_500,
      maxXMetres: 9_000,
      maxYMetres: 13_000,
    });
    expect(map.landmarks.map((landmark) => landmark.name)).toContain("Парящий монолит");
    expect(map.landmarks.length).toBeGreaterThanOrEqual(1);
    // The monolith stays the first landmark and remains a glimpsed bearing.
    expect(map.landmarks[0]?.xMetres).toBeNull();
    expect(map.landmarks[0]?.bearing).toBe("северо-восток");
    expect(JSON.stringify(map)).not.toContain("tile-31-38");
    expect(JSON.stringify(map)).not.toContain("suspended_monolith");
    expect(map.knownTerrain?.length).toBeGreaterThan(0);
    expect(JSON.stringify(map.knownTerrain)).not.toContain("tile-");
    expect(map.schemaVersion).toBe(3);
    expect(map.availableDetails?.map((detail) => detail.id)).toEqual([
      "overview",
      "central-valley",
      "blackwood-crater",
    ]);
    expect(map.availableDetails?.find((detail) => detail.id === "central-valley")?.coverageBounds).toEqual({
      minXMetres: 5_000,
      minYMetres: 7_000,
      maxXMetres: 12_000,
      maxYMetres: 14_000,
    });
  });

  it("replays the observer map byte-for-byte after spatial observations", () => {
    const bootstrap = buildPilotRegionBootstrapEvents();
    const observation: DomainEvent = {
      eventId: "observe-city",
      type: "SpatialObservationRecorded",
      schemaVersion: 1,
      payload: {
        subjectKind: "location",
        subjectId: "riverwatch_city",
        knowledge: "glimpsed",
        observedAt: 12,
        confidence: 0.48,
        bearing: "северо-восток",
        observerId: "player",
      },
      timestamp: 12,
      correlationId: "replay",
      causationId: null,
    };
    const events = [...bootstrap, observation];
    const direct = buildObserverMap(events, buildSpatialWorldProjection(events), true);
    const replayedWorld = rebuildProjection(events).getSnapshot();
    expect(replayedWorld.spatial).toBeTruthy();
    const replayed = buildObserverMap(events, replayedWorld.spatial as SpatialWorldProjection, true);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(direct));
  });

  it("clips an interrupted journey to the physically traversed route prefix", () => {
    const bootstrap = buildPilotRegionBootstrapEvents();
    const spatial = buildSpatialWorldProjection(bootstrap);
    const relation = spatial.relations.get("road_city_south");
    expect(relation).toBeTruthy();
    const events: DomainEvent[] = [...bootstrap, {
      eventId: "partial-route", type: "SpatialObservationRecorded", schemaVersion: 1,
      payload: {
        subjectKind: "relation", subjectId: "road_city_south", knowledge: "observed",
        observedAt: 20, confidence: 0.75, observerId: "player", progressFraction: 0.5,
      },
      timestamp: 20, correlationId: "journey", causationId: null,
    } as DomainEvent];
    const map = buildObserverMap(events, spatial);
    const route = map.routes.find((entry) => entry.geometry?.kind === "observed_path" && entry.geometry.points.length < relation!.points.length);
    if (!route || route.geometry?.kind !== "observed_path") throw new Error("partial route geometry missing");
    expect(route.geometry.points.length).toBeLessThan(relation!.points.length);
    expect(route.geometry.points.at(-1)).not.toEqual(relation!.points.at(-1));
  });

  it("keeps hydrography observer-scoped and preserves unresolved body classification", () => {
    const bootstrap = buildPilotRegionBootstrapEvents();
    const events: DomainEvent[] = [...bootstrap, {
      eventId: "obs-river", type: "SpatialObservationRecorded", schemaVersion: 1,
      payload: { subjectKind: "relation", subjectId: "river_basin", knowledge: "observed", observedAt: 1, confidence: 0.8 },
      timestamp: 1, correlationId: "test", causationId: null,
    } as DomainEvent, {
      eventId: "obs-water", type: "SpatialObservationRecorded", schemaVersion: 1,
      payload: { subjectKind: "relation", subjectId: "southern_water_body", knowledge: "observed", observedAt: 1, confidence: 0.4 },
      timestamp: 1, correlationId: "test", causationId: null,
    } as DomainEvent];
    const map = buildObserverMap(events, buildSpatialWorldProjection(events));
    expect(map.knownWatercourses).toHaveLength(1);
    expect(map.knownWatercourses?.[0]).toMatchObject({ name: "Река из северных гор", knowledge: "observed", geometry: { kind: "observed_path" } });
    expect(JSON.stringify(map.knownWatercourses)).not.toContain("southern_water_body");
    expect(map.knownWaterBodies?.[0]).toMatchObject({ name: "Южная водная область", classification: "unresolved", classificationConfidence: 0.4, knowledge: "observed" });
  });
  it("does not invent map entries when no spatial evidence exists", () => {
    const events: DomainEvent[] = [];
    const map = buildObserverMap(events, buildSpatialWorldProjection(events));
    expect(map.region).toBeNull();
    expect(map.locations).toEqual([]);
    expect(map.landmarks).toEqual([]);
    expect(map.routes).toEqual([]);
  });
});
