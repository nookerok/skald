import { describe, it, expect } from "vitest";
import { checkLineOfSight } from "../../src/visibility/line-of-sight.js";
import type { SpatialWorldProjection } from "../../src/region/types.js";

function makeSpatial(tiles: Array<{ id: string; elevationBand: number; surface: "water" | "soil" | "rock" | "marsh" | "forest" }>): SpatialWorldProjection {
  const terrainTiles = tiles.map((t) => {
    // Parse tile coordinates from id like "tile-1-0"
    const match = t.id.match(/tile-(\d+)-(\d+)/);
    const tx = match ? parseInt(match[1]!, 10) : 0;
    const ty = match ? parseInt(match[2]!, 10) : 0;
    return {
      id: t.id,
      bounds: { minXMetres: tx * 250, minYMetres: ty * 250, maxXMetres: (tx + 1) * 250, maxYMetres: (ty + 1) * 250 },
      elevationBand: t.elevationBand,
      surface: t.surface,
      slopeBand: 1,
    };
  });

  return {
    region: {
      id: "test",
      name: "Test",
      version: 1,
      contentDigest: "x",
      bounds: { minXMetres: 0, minYMetres: 0, maxXMetres: 20000, maxYMetres: 20000 },
      terrainTileSizeMetres: 250,
      simulationCellSizeMetres: 1000,
      tiles: terrainTiles,
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

describe("checkLineOfSight", () => {
  it("clear path on flat terrain → not blocked", () => {
    const spatial = makeSpatial([
      { id: "tile-0-0", elevationBand: 1, surface: "soil" },
      { id: "tile-1-0", elevationBand: 1, surface: "soil" },
      { id: "tile-2-0", elevationBand: 1, surface: "soil" },
    ]);
    const result = checkLineOfSight(125, 125, 102, 625, 125, 102, spatial);
    expect(result.blocked).toBe(false);
  });

  it("high terrain between observer and target → terrain_occluded", () => {
    const spatial = makeSpatial([
      { id: "tile-0-0", elevationBand: 1, surface: "soil" },
      { id: "tile-1-0", elevationBand: 10, surface: "rock" },
      { id: "tile-2-0", elevationBand: 1, surface: "soil" },
    ]);
    const result = checkLineOfSight(125, 125, 102, 625, 125, 102, spatial);
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("terrain_occluded");
  });

  it("observer and target at same tile → not blocked", () => {
    const spatial = makeSpatial([
      { id: "tile-0-0", elevationBand: 2, surface: "soil" },
    ]);
    const result = checkLineOfSight(100, 100, 202, 150, 150, 202, spatial);
    expect(result.blocked).toBe(false);
  });

  it("target higher than terrain → not blocked", () => {
    const spatial = makeSpatial([
      { id: "tile-0-0", elevationBand: 1, surface: "soil" },
      { id: "tile-1-0", elevationBand: 1, surface: "soil" },
      { id: "tile-2-0", elevationBand: 1, surface: "soil" },
    ]);
    // Target at 500m elevation, terrain at 100m — line clears terrain
    const result = checkLineOfSight(125, 125, 102, 625, 125, 500, spatial);
    expect(result.blocked).toBe(false);
  });
});
