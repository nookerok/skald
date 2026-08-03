/**
 * Spatial candidate index for visibility queries (ADR-0016 §12).
 *
 * Groups locations and landmarks by simulation cell for efficient
 * nearby-target lookup. Rebuilt from SpatialWorldProjection; never
 * sent to browser.
 */

import type { SpatialWorldProjection, RegionLocation, RegionLandmark } from "../region/types.js";
import type { VisibilityTarget } from "./types.js";
import { VISIBILITY_CONFIG } from "./config.js";

interface CellBucket {
  readonly cellId: string;
  readonly locations: RegionLocation[];
  readonly landmarks: RegionLandmark[];
}

/**
 * Build a cell-based index of spatial targets.
 */
export function buildCandidateIndex(
  spatial: SpatialWorldProjection,
): Map<string, CellBucket> {
  const buckets = new Map<string, CellBucket>();

  if (!spatial.region) return buckets;

  const cellSize = spatial.region.simulationCellSizeMetres;

  for (const location of spatial.locations.values()) {
    const cellId = cellIdForPoint(location.anchor.xMetres, location.anchor.yMetres, cellSize);
    let bucket = buckets.get(cellId);
    if (!bucket) {
      bucket = { cellId, locations: [], landmarks: [] };
      buckets.set(cellId, bucket);
    }
    bucket.locations.push(location);
  }

  for (const landmark of spatial.landmarks.values()) {
    const cellId = cellIdForPoint(landmark.anchor.xMetres, landmark.anchor.yMetres, cellSize);
    let bucket = buckets.get(cellId);
    if (!bucket) {
      bucket = { cellId, locations: [], landmarks: [] };
      buckets.set(cellId, bucket);
    }
    bucket.landmarks.push(landmark);
  }

  return buckets;
}

/**
 * Find candidate targets within a given radius of an observer position.
 */
export function findCandidates(
  observerX: number,
  observerY: number,
  radiusMetres: number,
  index: Map<string, CellBucket>,
  spatial: SpatialWorldProjection,
): VisibilityTarget[] {
  if (!spatial.region) return [];

  const cellSize = spatial.region.simulationCellSizeMetres;
  const radiusCells = Math.ceil(radiusMetres / cellSize) + 1;
  const observerCellX = Math.floor(observerX / cellSize);
  const observerCellY = Math.floor(observerY / cellSize);

  const candidates: VisibilityTarget[] = [];
  const seen = new Set<string>();

  for (let dx = -radiusCells; dx <= radiusCells; dx++) {
    for (let dy = -radiusCells; dy <= radiusCells; dy++) {
      const cx = observerCellX + dx;
      const cy = observerCellY + dy;
      const cellId = `cell-${cx}-${cy}`;
      const bucket = index.get(cellId);
      if (!bucket) continue;

      for (const location of bucket.locations) {
        if (seen.has(`loc:${location.id}`)) continue;
        const dist = Math.sqrt(
          (location.anchor.xMetres - observerX) ** 2 +
          (location.anchor.yMetres - observerY) ** 2,
        );
        if (dist <= radiusMetres) {
          seen.add(`loc:${location.id}`);
          const tile = spatial.region.tiles.find((t) =>
            t.id === location.footprintTileIds[0],
          );
          candidates.push({
            ref: location.id,
            kind: "location",
            xMetres: location.anchor.xMetres,
            yMetres: location.anchor.yMetres,
            elevationMetres: tile ? tile.elevationBand * VISIBILITY_CONFIG.terrainBandHeightMetres : 0,
            silhouette: "location",
          });
        }
      }

      for (const landmark of bucket.landmarks) {
        if (seen.has(`landmark:${landmark.id}`)) continue;
        const dist = Math.sqrt(
          (landmark.anchor.xMetres - observerX) ** 2 +
          (landmark.anchor.yMetres - observerY) ** 2,
        );
        if (dist <= radiusMetres) {
          seen.add(`landmark:${landmark.id}`);
          candidates.push({
            ref: landmark.id,
            kind: "landmark",
            xMetres: landmark.anchor.xMetres,
            yMetres: landmark.anchor.yMetres,
            elevationMetres: landmark.elevationMetres,
            silhouette: landmark.silhouetteClass,
          });
        }
      }
    }
  }

  return candidates;
}

function cellIdForPoint(xMetres: number, yMetres: number, cellSize: number): string {
  const cx = Math.floor(xMetres / cellSize);
  const cy = Math.floor(yMetres / cellSize);
  return `cell-${cx}-${cy}`;
}
