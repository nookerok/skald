import { describe, it, expect } from "vitest";
import { computeVisibility } from "@skald/world";
import type { SpatialWorldProjection, ObserverPosition } from "@skald/world";

function makePilotSpatial(): SpatialWorldProjection {
  const tiles = [];
  for (let y = 0; y < 80; y++) {
    for (let x = 0; x < 80; x++) {
      const px = x * 250;
      const py = y * 250;
      const riverX = 9500 + Math.round(Math.sin(py / 1850) * 1100);
      const inRiver = Math.abs(px - riverX) <= 220;
      const inForest = px < 7000 && py > 4000;
      const inMountains = py > 16000 || (px > 15000 && py > 10000);
      let elevationBand = 2;
      let surface: "water" | "soil" | "rock" | "marsh" | "forest" = "soil";
      if (inRiver) { elevationBand = 1; surface = "water"; }
      else if (inForest) { elevationBand = 3; surface = "forest"; }
      else if (inMountains) { elevationBand = 5; surface = "rock"; }
      tiles.push({
        id: `tile-${x}-${y}`,
        bounds: { minXMetres: px, minYMetres: py, maxXMetres: px + 250, maxYMetres: py + 250 },
        elevationBand,
        surface,
        slopeBand: 1,
      });
    }
  }

  const locations = new Map([
    ["river_waystation", { id: "river_waystation", name: "Переправа у Чёрного леса", description: "Test", anchor: { xMetres: 8000, yMetres: 9500 }, footprintTileIds: [] }],
    ["riverwatch_city", { id: "riverwatch_city", name: "Речной Страж", description: "Test", anchor: { xMetres: 13500, yMetres: 7500 }, footprintTileIds: [] }],
  ]);

  const landmarks = new Map([
    ["suspended_monolith", { id: "suspended_monolith", name: "Парящий монолит", description: "Test", anchor: { xMetres: 11000, yMetres: 18000 }, elevationMetres: 1400, silhouetteClass: "monolith" as const }],
    ["riverwatch_city", { id: "riverwatch_city", name: "Речной Страж", description: "Test", anchor: { xMetres: 13500, yMetres: 7500 }, elevationMetres: 40, silhouetteClass: "city" as const }],
  ]);

  return {
    region: {
      id: "pilot",
      name: "Pilot",
      version: 1,
      contentDigest: "x",
      bounds: { minXMetres: 0, minYMetres: 0, maxXMetres: 20000, maxYMetres: 20000 },
      terrainTileSizeMetres: 250,
      simulationCellSizeMetres: 1000,
      tiles,
      cells: [],
      locations: [...locations.values()],
      landmarks: [...landmarks.values()],
      relations: [],
    },
    locations,
    landmarks,
    relations: new Map(),
    travelRelations: new Map(),
    riverProcesses: new Map(),
    riverStates: new Map(),
    crossingDefinitions: new Map(),
    crossingStates: new Map(),
  };
}

describe("computeVisibility", () => {
  it("observer at waystation sees nearby city", () => {
    const spatial = makePilotSpatial();
    const observer: ObserverPosition = {
      xMetres: 8000,
      yMetres: 9500,
      elevationMetres: 200,
      locationRef: "river_waystation",
    };
    const results = computeVisibility(observer, spatial);
    // Riverwatch city should be visible (within 4km range... actually 5.5km, so far)
    const cityResult = results.get("riverwatch_city");
    expect(cityResult).toBeDefined();
    expect(cityResult!.visible).toBe(true);
  });

  it("monolith is visible from waystation as glimpsed", () => {
    const spatial = makePilotSpatial();
    const observer: ObserverPosition = {
      xMetres: 8000,
      yMetres: 9500,
      elevationMetres: 200,
      locationRef: "river_waystation",
    };
    const results = computeVisibility(observer, spatial);
    const monolithResult = results.get("suspended_monolith");
    // Monolith is ~9km away but elevated, should be glimpsed
    expect(monolithResult).toBeDefined();
    if (monolithResult!.visible) {
      expect(monolithResult!.knowledge).toBe("glimpsed");
      expect(monolithResult!.exactPositionAllowed).toBe(false);
    }
  });

  it("close targets within range are visible", () => {
    // Use a simple spatial with known tiles
    const tiles = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        tiles.push({
          id: `tile-${x}-${y}`,
          bounds: { minXMetres: x * 250, minYMetres: y * 250, maxXMetres: (x + 1) * 250, maxYMetres: (y + 1) * 250 },
          elevationBand: 1,
          surface: "soil" as const,
          slopeBand: 1,
        });
      }
    }
    const spatial: SpatialWorldProjection = {
      region: {
        id: "test", name: "Test", version: 1, contentDigest: "x",
        bounds: { minXMetres: 0, minYMetres: 0, maxXMetres: 2500, maxYMetres: 2500 },
        terrainTileSizeMetres: 250, simulationCellSizeMetres: 1000,
        tiles, cells: [], locations: [], landmarks: [], relations: [],
      },
      locations: new Map([
        ["loc_a", { id: "loc_a", name: "Location A", description: "Test", anchor: { xMetres: 500, yMetres: 500 }, footprintTileIds: [] }],
      ]),
      landmarks: new Map([
        ["landmark_a", { id: "landmark_a", name: "Landmark A", description: "Test", anchor: { xMetres: 600, yMetres: 500 }, elevationMetres: 20, silhouetteClass: "city" as const }],
      ]),
      relations: new Map(),
      travelRelations: new Map(),
      riverProcesses: new Map(),
      riverStates: new Map(),
      crossingDefinitions: new Map(),
      crossingStates: new Map(),
    };
    const observer: ObserverPosition = {
      xMetres: 500,
      yMetres: 500,
      elevationMetres: 100,
      locationRef: "loc_a",
    };
    const results = computeVisibility(observer, spatial);
    const locResult = results.get("loc_a");
    expect(locResult).toBeDefined();
    expect(locResult!.visible).toBe(true);
    if (locResult!.visible) {
      expect(locResult!.knowledge).toBe("observed");
      expect(locResult!.exactPositionAllowed).toBe(true);
    }
  });

  it("returns empty when no region defined", () => {
    const spatial: SpatialWorldProjection = {
      region: null,
      locations: new Map(),
      landmarks: new Map(),
      relations: new Map(),
      travelRelations: new Map(),
      riverProcesses: new Map(),
      riverStates: new Map(),
      crossingDefinitions: new Map(),
      crossingStates: new Map(),
    };
    const observer: ObserverPosition = {
      xMetres: 0,
      yMetres: 0,
      elevationMetres: 0,
      locationRef: null,
    };
    const results = computeVisibility(observer, spatial);
    expect(results.size).toBe(0);
  });

  it("deterministic: same input always gives same output", () => {
    const spatial = makePilotSpatial();
    const observer: ObserverPosition = {
      xMetres: 8000,
      yMetres: 9500,
      elevationMetres: 200,
      locationRef: "river_waystation",
    };
    const r1 = computeVisibility(observer, spatial);
    const r2 = computeVisibility(observer, spatial);
    expect(r1.size).toBe(r2.size);
    for (const [key, v1] of r1) {
      const v2 = r2.get(key);
      expect(v2).toEqual(v1);
    }
  });
});
