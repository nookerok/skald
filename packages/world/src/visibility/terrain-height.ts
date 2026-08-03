/**
 * Terrain height computation for visibility (ADR-0016 §7).
 *
 * Converts elevationBand to metres and provides tile lookup from
 * SpatialWorldProjection.
 */

import type { SpatialWorldProjection, TerrainTile } from "../region/types.js";
import { VISIBILITY_CONFIG } from "./config.js";

/**
 * Convert an elevation band to metres.
 */
export function elevationToMetres(band: number): number {
  return band * VISIBILITY_CONFIG.terrainBandHeightMetres;
}

/**
 * Find the terrain tile at a given metric position.
 * Returns undefined if outside region bounds.
 */
export function tileAtPosition(
  xMetres: number,
  yMetres: number,
  spatial: SpatialWorldProjection,
): TerrainTile | undefined {
  if (!spatial.region) return undefined;
  const tileX = Math.floor(xMetres / VISIBILITY_CONFIG.tileSizeMetres);
  const tileY = Math.floor(yMetres / VISIBILITY_CONFIG.tileSizeMetres);
  const tileId = `tile-${tileX}-${tileY}`;
  // Search the region tiles array for this id
  for (const tile of spatial.region.tiles) {
    if (tile.id === tileId) return tile;
  }
  return undefined;
}

/**
 * Get terrain elevation in metres at a metric position.
 */
export function terrainElevationAt(
  xMetres: number,
  yMetres: number,
  spatial: SpatialWorldProjection,
): number {
  const tile = tileAtPosition(xMetres, yMetres, spatial);
  if (!tile) return 0;
  return elevationToMetres(tile.elevationBand);
}

/**
 * Compute bearing (compass direction) from observer to target.
 * Returns a Russian compass label.
 */
export function computeBearing(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): string {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const angle = Math.atan2(dx, -dy) * (180 / Math.PI);
  const normalized = ((angle % 360) + 360) % 360;

  if (normalized < 22.5 || normalized >= 337.5) return "север";
  if (normalized < 67.5) return "северо-восток";
  if (normalized < 112.5) return "восток";
  if (normalized < 157.5) return "юго-восток";
  if (normalized < 202.5) return "юг";
  if (normalized < 247.5) return "юго-запад";
  if (normalized < 292.5) return "запад";
  return "северо-запад";
}

/**
 * Compute distance band from observer to target.
 */
export function distanceBand(distanceMetres: number): "near" | "middle" | "far" {
  if (distanceMetres <= VISIBILITY_CONFIG.nearRangeMetres) return "near";
  if (distanceMetres <= VISIBILITY_CONFIG.middleRangeMetres) return "middle";
  return "far";
}

/**
 * Compute squared distance between two points.
 */
export function distanceSquared(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  return (x2 - x1) ** 2 + (y2 - y1) ** 2;
}
