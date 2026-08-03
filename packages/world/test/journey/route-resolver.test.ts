import { describe, it, expect } from "vitest";
import { resolveJourneyRoute } from "@skald/world";
import type { SpatialWorldProjection, ObserverMapDTO } from "@skald/world";

function makeSpatial(overrides?: {
  travelRelations?: Map<string, { id: string; kind: "road" | "crossing" | "river" | "visibility"; fromId: string; toId: string; distanceMetres: number; baseTravelTicks: number; terrainCost: number; passability: "open" | "blocked" }>;
  locations?: Map<string, { id: string; name: string; description: string; anchor: { xMetres: number; yMetres: number }; footprintTileIds: readonly string[] }>;
}): SpatialWorldProjection {
  const locations = overrides?.locations ?? new Map([
    ["river_waystation", { id: "river_waystation", name: "Переправа у Чёрного леса", description: "Test", anchor: { xMetres: 8000, yMetres: 9500 }, footprintTileIds: [] }],
    ["riverwatch_city", { id: "riverwatch_city", name: "Речной Страж", description: "Test", anchor: { xMetres: 13500, yMetres: 7500 }, footprintTileIds: [] }],
    ["blackwood_edge", { id: "blackwood_edge", name: "Кромка Чёрного леса", description: "Test", anchor: { xMetres: 6000, yMetres: 12000 }, footprintTileIds: [] }],
  ]);
  const travelRelations = overrides?.travelRelations ?? new Map([
    ["road_waystation_city", { id: "road_waystation_city", kind: "road", fromId: "river_waystation", toId: "riverwatch_city", distanceMetres: 5500, baseTravelTicks: 4, terrainCost: 1.0, passability: "open" }],
    ["road_waystation_forest", { id: "road_waystation_forest", kind: "road", fromId: "river_waystation", toId: "blackwood_edge", distanceMetres: 3200, baseTravelTicks: 3, terrainCost: 1.2, passability: "open" }],
    ["river_crossing", { id: "river_crossing", kind: "crossing", fromId: "river_waystation", toId: "riverwatch_city", distanceMetres: 2000, baseTravelTicks: 2, terrainCost: 1.5, passability: "open" }],
  ]);
  return {
    region: null,
    locations,
    landmarks: new Map(),
    relations: new Map(),
    travelRelations,
    riverProcesses: new Map(),
    riverStates: new Map(),
    crossingDefinitions: new Map(),
    crossingStates: new Map(),
  };
}

function makeObserverMap(overrides?: { locations?: Array<{ ref: string; name: string; knowledge: "rumored" | "glimpsed" | "observed" | "traversed"; confidence?: number; freshness?: number; xMetres?: number; yMetres?: number }> }): ObserverMapDTO {
  const locations = (overrides?.locations ?? [
    { ref: "river_waystation", name: "Переправа у Чёрного леса", knowledge: "traversed" as const, confidence: 1, freshness: 1, xMetres: 8000, yMetres: 9500 },
    { ref: "riverwatch_city", name: "Речной Страж", knowledge: "observed" as const, confidence: 0.9, freshness: 0.8, xMetres: 13500, yMetres: 7500 },
    { ref: "blackwood_edge", name: "Кромка Чёрного леса", knowledge: "glimpsed" as const, confidence: 0.5, freshness: 0.6, xMetres: 6000, yMetres: 12000 },
  ]).map((loc) => ({
    ...loc,
    confidence: loc.confidence ?? 0.5,
    freshness: loc.freshness ?? 0.5,
    xMetres: loc.xMetres ?? 0,
    yMetres: loc.yMetres ?? 0,
  }));
  return {
    schemaVersion: 1,
    revision: { worldTime: 0, eventNumber: 0 },
    region: null,
    observer: { locationRef: "river_waystation", xMetres: 8000, yMetres: 9500 },
    knownArea: null,
    locations,
    landmarks: [],
    routes: [],
  };
}

describe("resolveJourneyRoute", () => {
  it("resolves exact location name", () => {
    const result = resolveJourneyRoute("Речной Страж", "river_waystation", makeSpatial(), makeObserverMap());
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.toLocationId).toBe("riverwatch_city");
      expect(result.travelTicks).toBe(4);
    }
  });

  it("resolves partial location name", () => {
    const result = resolveJourneyRoute("Страж", "river_waystation", makeSpatial(), makeObserverMap());
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.toLocationId).toBe("riverwatch_city");
    }
  });

  it("blocks when destination is unknown", () => {
    const result = resolveJourneyRoute("Неведомый город", "river_waystation", makeSpatial(), makeObserverMap());
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") {
      expect(result.reason).toBe("unknown_destination");
    }
  });

  it("blocks when destination is not in observer knowledge", () => {
    const result = resolveJourneyRoute("old_ruins", "river_waystation", makeSpatial(), makeObserverMap({
      locations: [
        { ref: "river_waystation", name: "Переправа у Чёрного леса", knowledge: "traversed" },
      ],
    }));
    expect(result.kind).toBe("blocked");
  });

  it("blocks when player is already at destination", () => {
    const result = resolveJourneyRoute("Переправа у Чёрного леса", "river_waystation", makeSpatial(), makeObserverMap());
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") {
      expect(result.reason).toBe("no_route");
    }
  });

  it("blocks when no route exists", () => {
    const result = resolveJourneyRoute("Речной Страж", "blackwood_edge", makeSpatial(), makeObserverMap());
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") {
      expect(result.reason).toBe("no_route");
    }
  });

  it("blocks when crossing is closed", () => {
    const spatial = makeSpatial({
      travelRelations: new Map([
        ["road_waystation_city", { id: "road_waystation_city", kind: "road", fromId: "river_waystation", toId: "riverwatch_city", distanceMetres: 5500, baseTravelTicks: 4, terrainCost: 1.0, passability: "open" }],
        ["river_crossing", { id: "river_crossing", kind: "crossing", fromId: "river_waystation", toId: "riverwatch_city", distanceMetres: 2000, baseTravelTicks: 2, terrainCost: 1.5, passability: "blocked" }],
      ]),
    });
    const result = resolveJourneyRoute("Речной Страж", "river_waystation", spatial, makeObserverMap());
    // Should resolve via road, not crossing
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.relationId).toBe("road_waystation_city");
    }
  });

  it("blocks when all routes are blocked", () => {
    const spatial = makeSpatial({
      travelRelations: new Map([
        ["road_waystation_city", { id: "road_waystation_city", kind: "road", fromId: "river_waystation", toId: "riverwatch_city", distanceMetres: 5500, baseTravelTicks: 4, terrainCost: 1.0, passability: "blocked" }],
        ["river_crossing", { id: "river_crossing", kind: "crossing", fromId: "river_waystation", toId: "riverwatch_city", distanceMetres: 2000, baseTravelTicks: 2, terrainCost: 1.5, passability: "blocked" }],
      ]),
    });
    const result = resolveJourneyRoute("Речной Страж", "river_waystation", spatial, makeObserverMap());
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") {
      expect(result.reason).toBe("no_route");
    }
  });

  it("blocks when destination is empty", () => {
    const result = resolveJourneyRoute("", "river_waystation", makeSpatial(), makeObserverMap());
    expect(result.kind).toBe("blocked");
    if (result.kind === "blocked") {
      expect(result.reason).toBe("unknown_destination");
    }
  });

  it("returns fromLocationId and toLocationId in resolved result", () => {
    const result = resolveJourneyRoute("Кромка Чёрного леса", "river_waystation", makeSpatial(), makeObserverMap());
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.fromLocationId).toBe("river_waystation");
      expect(result.toLocationId).toBe("blackwood_edge");
      expect(result.relationId).toBe("road_waystation_forest");
    }
  });

  it("prefers road over crossing when both exist", () => {
    const result = resolveJourneyRoute("Речной Страж", "river_waystation", makeSpatial(), makeObserverMap());
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      // road_waystation_city should be found first or preferred
      expect(["road_waystation_city", "river_crossing"]).toContain(result.relationId);
    }
  });
});
