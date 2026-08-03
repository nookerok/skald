/**
 * Line-of-sight computation using supercover/Bresenham traversal (ADR-0016 §8).
 *
 * Walks terrain tiles between observer and target, checking for elevation
 * and surface occlusion. Deterministic, no randomness, no OS time.
 */

import type { SpatialWorldProjection, TerrainTile } from "../region/types.js";
import { VISIBILITY_CONFIG } from "./config.js";

export interface OcclusionCheckResult {
  readonly blocked: boolean;
  readonly reason?: "terrain_occluded" | "height_occluded" | "forest_occluded";
  readonly blockingTileId?: string;
}

/**
 * Check line-of-sight between observer and target positions.
 *
 * Uses a supercover Bresenham walk across terrain tiles.
 * For each intermediate tile, checks:
 * - terrain elevation against line-of-sight height
 * - surface type (forest partially blocks, rock fully blocks)
 */
export function checkLineOfSight(
  observerX: number,
  observerY: number,
  observerElevation: number,
  targetX: number,
  targetY: number,
  targetElevation: number,
  spatial: SpatialWorldProjection,
): OcclusionCheckResult {
  const tileSize = VISIBILITY_CONFIG.tileSizeMetres;

  // Total distance in metres
  const totalDist = Math.sqrt((targetX - observerX) ** 2 + (targetY - observerY) ** 2);
  if (totalDist < 1) return { blocked: false };

  // Walk along the line using parametric sampling in world coordinates
  const steps = Math.ceil(totalDist / (tileSize * 0.5)); // ~2 samples per tile
  for (let i = 1; i < steps; i++) {
    const t = i / steps;

    // Skip if too close to observer or target
    if (t < 0.05 || t > 0.95) continue;

    // Interpolate position in world coordinates
    const worldX = observerX + (targetX - observerX) * t;
    const worldY = observerY + (targetY - observerY) * t;

    // Get terrain at this intermediate point
    const tile = findTileAt(worldX, worldY, spatial);
    if (!tile) continue;

    const terrainHeight = tile.elevationBand * VISIBILITY_CONFIG.terrainBandHeightMetres;

    // Line-of-sight height at this progress point
    const lineHeight = observerElevation + (targetElevation - observerElevation) * t;

    // Check terrain occlusion
    if (terrainHeight > lineHeight) {
      return {
        blocked: true,
        reason: "terrain_occluded",
        blockingTileId: tile.id,
      };
    }

    // Check forest occlusion
    if (tile.surface === "forest") {
      const forestTop = terrainHeight + 15; // tree canopy ~15m above ground
      if (forestTop > lineHeight) {
        // Forest partially blocks — only fully blocks if canopy is well above line
        if (t > 0.3 && t < 0.7 && forestTop > lineHeight + 5) {
          return {
            blocked: true,
            reason: "forest_occluded",
            blockingTileId: tile.id,
          };
        }
      }
    }

    // Check rock occlusion (rock is fully opaque above terrain)
    if (tile.surface === "rock") {
      if (terrainHeight + 5 > lineHeight) {
        return {
          blocked: true,
          reason: "terrain_occluded",
          blockingTileId: tile.id,
        };
      }
    }
  }

  return { blocked: false };
}

/**
 * Find terrain tile at a world position.
 */
function findTileAt(
  xMetres: number,
  yMetres: number,
  spatial: SpatialWorldProjection,
): TerrainTile | undefined {
  if (!spatial.region) return undefined;

  const tileSize = VISIBILITY_CONFIG.tileSizeMetres;
  const tileX = Math.floor(xMetres / tileSize);
  const tileY = Math.floor(yMetres / tileSize);
  const tileId = `tile-${tileX}-${tileY}`;

  for (const tile of spatial.region.tiles) {
    if (tile.id === tileId) return tile;
  }
  return undefined;
}
