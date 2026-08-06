import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import {
  buildObserverMap,
  buildPilotRegionBootstrapEvents,
  buildPilotRegionDefinition,
  buildSpatialWorldProjection,
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
    expect(map.landmarks.map((landmark) => landmark.name)).toContain("Парящий монолит");
    expect(map.landmarks.length).toBeGreaterThanOrEqual(1);
    // The monolith stays the first landmark and remains a glimpsed bearing.
    expect(map.landmarks[0]?.xMetres).toBeNull();
    expect(map.landmarks[0]?.bearing).toBe("северо-восток");
    expect(JSON.stringify(map)).not.toContain("tile-31-38");
    expect(JSON.stringify(map)).not.toContain("suspended_monolith");
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
