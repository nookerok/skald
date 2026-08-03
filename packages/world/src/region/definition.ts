import type {
  RegionDefinition,
  RegionLandmark,
  RegionLocation,
  SimulationCell,
  SpatialBounds,
  SpatialPoint,
  SpatialRelation,
  TerrainSurface,
  TerrainTile,
} from "./types.js";

export const PILOT_REGION_ID = "riverwatch-basin";
export const PILOT_REGION_SIZE_METRES = 20_000;
export const PILOT_TILE_SIZE_METRES = 250;
export const PILOT_CELL_SIZE_METRES = 1_000;

function bounds(x: number, y: number, size: number): SpatialBounds {
  return { minXMetres: x, minYMetres: y, maxXMetres: x + size, maxYMetres: y + size };
}

function point(xMetres: number, yMetres: number): SpatialPoint {
  return { xMetres, yMetres };
}

function surfaceFor(x: number, y: number): { surface: TerrainSurface; elevationBand: number; slopeBand: number } {
  const riverX = 9_500 + Math.round(Math.sin(y / 1_850) * 1_100);
  const inRiver = Math.abs(x - riverX) <= 220;
  const inMarsh = y < 3_000 && x > 5_000 && x < 14_000;
  const inForest = x < 7_000 && y > 4_000;
  const inMountains = y > 16_000 || (x > 15_000 && y > 10_000);
  const inCrater = (x - 3_800) ** 2 + (y - 4_200) ** 2 < 1_300 ** 2;
  if (inRiver) return { surface: "water", elevationBand: 1, slopeBand: 1 };
  if (inMarsh) return { surface: "marsh", elevationBand: 2, slopeBand: 1 };
  if (inCrater || inMountains) return { surface: "rock", elevationBand: inMountains ? 5 : 3, slopeBand: inMountains ? 5 : 3 };
  if (inForest) return { surface: "forest", elevationBand: 3, slopeBand: 2 };
  return { surface: "soil", elevationBand: 2, slopeBand: 1 };
}

function buildTiles(): TerrainTile[] {
  const tiles: TerrainTile[] = [];
  for (let y = 0; y < 80; y += 1) {
    for (let x = 0; x < 80; x += 1) {
      const px = x * PILOT_TILE_SIZE_METRES;
      const py = y * PILOT_TILE_SIZE_METRES;
      const terrain = surfaceFor(px + 125, py + 125);
      tiles.push({ id: `tile-${x}-${y}`, bounds: bounds(px, py, PILOT_TILE_SIZE_METRES), ...terrain });
    }
  }
  return tiles;
}

function buildCells(): SimulationCell[] {
  const cells: SimulationCell[] = [];
  for (let y = 0; y < 20; y += 1) {
    for (let x = 0; x < 20; x += 1) {
      const neighbours: string[] = [];
      if (x > 0) neighbours.push(`cell-${x - 1}-${y}`);
      if (x < 19) neighbours.push(`cell-${x + 1}-${y}`);
      if (y > 0) neighbours.push(`cell-${x}-${y - 1}`);
      if (y < 19) neighbours.push(`cell-${x}-${y + 1}`);
      cells.push({ id: `cell-${x}-${y}`, bounds: bounds(x * 1_000, y * 1_000, 1_000), neighbourIds: neighbours });
    }
  }
  return cells;
}

const LOCATIONS: readonly RegionLocation[] = [
  { id: "river_waystation", name: "Переправа у Чёрного леса", description: "Небольшой путевой двор у реки и кромки леса.", anchor: point(8_000, 9_500), footprintTileIds: ["tile-31-38", "tile-32-38"] },
  { id: "riverwatch_city", name: "Речной Страж", description: "Город за стенами, где сходятся торговые дороги.", anchor: point(13_500, 7_500), footprintTileIds: ["tile-53-29", "tile-54-29", "tile-53-30", "tile-54-30"] },
  { id: "blackwood_edge", name: "Кромка Чёрного леса", description: "Дорога исчезает среди тёмных елей.", anchor: point(6_000, 12_000), footprintTileIds: ["tile-23-47"] },
  { id: "old_ruins", name: "Развалины на уступе", description: "Каменные остатки над долиной, занесённые травой.", anchor: point(16_000, 14_000), footprintTileIds: ["tile-63-55"] },
  { id: "glass_crater", name: "Стеклянная впадина", description: "Круглая чаша земли, где камень блестит после дождя.", anchor: point(3_800, 4_200), footprintTileIds: ["tile-14-16"] },
  { id: "high_pass", name: "Северный перевал", description: "Каменный проход под снегом и облаками.", anchor: point(12_000, 18_000), footprintTileIds: ["tile-47-71"] },
];

const LANDMARKS: readonly RegionLandmark[] = [
  { id: "riverwatch_city", name: "Речной Страж", description: "Городская стена и башни над рекой.", anchor: point(13_500, 7_500), elevationMetres: 40, silhouetteClass: "city" },
  { id: "glass_crater", name: "Стеклянная впадина", description: "Тёмный круг в лесной кромке.", anchor: point(3_800, 4_200), elevationMetres: 20, silhouetteClass: "crater" },
  { id: "old_ruins", name: "Развалины на уступе", description: "Одинокие камни на восточном уступе.", anchor: point(16_000, 14_000), elevationMetres: 190, silhouetteClass: "ruin" },
  { id: "suspended_monolith", name: "Парящий монолит", description: "Тёмный силуэт, иногда видимый над северными облаками.", anchor: point(11_000, 18_000), elevationMetres: 1_400, silhouetteClass: "monolith" },
];

const RELATIONS: readonly SpatialRelation[] = [
  { id: "road_waystation_city", kind: "road", fromId: "river_waystation", toId: "riverwatch_city", label: "Дорога к Речному Стражу", points: [point(8_000, 9_500), point(10_500, 8_500), point(13_500, 7_500)] },
  { id: "road_waystation_forest", kind: "road", fromId: "river_waystation", toId: "blackwood_edge", label: "Лесная дорога", points: [point(8_000, 9_500), point(7_000, 10_500), point(6_000, 12_000)] },
  { id: "road_city_ruins", kind: "road", fromId: "riverwatch_city", toId: "old_ruins", label: "Восточный тракт", points: [point(13_500, 7_500), point(15_000, 10_500), point(16_000, 14_000)] },
  { id: "river_crossing", kind: "crossing", fromId: "river_waystation", toId: "riverwatch_city", label: "Переправа", points: [point(8_000, 9_500), point(9_500, 9_400), point(10_000, 9_000)] },
  { id: "river_basin", kind: "river", fromId: "high_pass", toId: "riverwatch_city", label: "Река из северных гор", points: [point(12_000, 18_000), point(10_500, 13_000), point(9_500, 9_000), point(13_500, 7_500)] },
];

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

export function buildPilotRegionDefinition(): RegionDefinition {
  const base = { id: PILOT_REGION_ID, name: "Бассейн Речного Стража", version: 1, bounds: bounds(0, 0, PILOT_REGION_SIZE_METRES), terrainTileSizeMetres: PILOT_TILE_SIZE_METRES, simulationCellSizeMetres: PILOT_CELL_SIZE_METRES, tiles: buildTiles(), cells: buildCells(), locations: LOCATIONS, landmarks: LANDMARKS, relations: RELATIONS };
  const digest = fnv1a(JSON.stringify(base));
  return Object.freeze({ ...base, contentDigest: digest });
}
