import { describe, it, expect } from "vitest";
import {
  computeBearing,
  distanceBand,
  distanceSquared,
  elevationToMetres,
  terrainElevationAt,
} from "@skald/world";
import type { SpatialWorldProjection } from "@skald/world";

function makeSpatial(overrides?: {
  tiles?: Array<{ id: string; elevationBand: number; surface: "water" | "soil" | "rock" | "marsh" | "forest" }>;
}): SpatialWorldProjection {
  const tiles = (overrides?.tiles ?? [
    { id: "tile-0-0", elevationBand: 2, surface: "soil" as const },
    { id: "tile-1-0", elevationBand: 2, surface: "soil" as const },
    { id: "tile-2-0", elevationBand: 3, surface: "forest" as const },
    { id: "tile-3-0", elevationBand: 5, surface: "rock" as const },
  ]).map((t) => ({
    id: t.id,
    bounds: { minXMetres: 0, minYMetres: 0, maxXMetres: 250, maxYMetres: 250 },
    elevationBand: t.elevationBand,
    surface: t.surface,
    slopeBand: 1,
  }));

  return {
    region: {
      id: "test-region",
      name: "Test Region",
      version: 1,
      contentDigest: "abc",
      bounds: { minXMetres: 0, minYMetres: 0, maxXMetres: 20000, maxYMetres: 20000 },
      terrainTileSizeMetres: 250,
      simulationCellSizeMetres: 1000,
      tiles,
      cells: [],
      locations: [],
      landmarks: [],
      relations: [],
    },
    locations: new Map(),
    landmarks: new Map(),
    relations: new Map(),
    travelRelations: new Map(),
    riverProcesses: new Map(),
    riverStates: new Map(),
    crossingDefinitions: new Map(),
    crossingStates: new Map(),
  };
}

describe("visibility formulas", () => {
  it("elevationToMetres converts band to metres", () => {
    expect(elevationToMetres(0)).toBe(0);
    expect(elevationToMetres(1)).toBe(100);
    expect(elevationToMetres(5)).toBe(500);
  });

  it("distanceSquared computes squared distance", () => {
    expect(distanceSquared(0, 0, 3, 4)).toBe(25);
    expect(distanceSquared(100, 100, 100, 100)).toBe(0);
  });

  it("distanceBand classifies ranges", () => {
    expect(distanceBand(0)).toBe("near");
    expect(distanceBand(500)).toBe("near");
    expect(distanceBand(1000)).toBe("near");
    expect(distanceBand(1001)).toBe("middle");
    expect(distanceBand(3000)).toBe("middle");
    expect(distanceBand(4000)).toBe("middle");
    expect(distanceBand(4001)).toBe("far");
    expect(distanceBand(10000)).toBe("far");
  });

  it("computeBearing returns compass direction", () => {
    expect(computeBearing(0, 0, 0, -100)).toBe("север");
    expect(computeBearing(0, 0, 100, 0)).toBe("восток");
    expect(computeBearing(0, 0, 0, 100)).toBe("юг");
    expect(computeBearing(0, 0, -100, 0)).toBe("запад");
    expect(computeBearing(0, 0, 100, -100)).toBe("северо-восток");
  });

  it("terrainElevationAt returns elevation from tile", () => {
    const spatial = makeSpatial();
    expect(terrainElevationAt(125, 125, spatial)).toBe(200);
  });

  it("terrainElevationAt returns 0 outside region", () => {
    const spatial = makeSpatial();
    expect(terrainElevationAt(50000, 50000, spatial)).toBe(0);
  });
});
