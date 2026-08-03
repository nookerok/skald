/**
 * Visibility Engine — pure read-side computation (ADR-0016).
 *
 * Computes what an observer can see from a given position using terrain data,
 * landmark elevation and distance. Does not write Domain Events, does not
 * create Rules, does not modify Projection.
 */

import type { SpatialWorldProjection } from "../region/types.js";
import type { ObserverPosition, VisibilityTarget, VisibilityResult } from "./types.js";
import { VISIBILITY_CONFIG } from "./config.js";
import { computeBearing, distanceBand, distanceSquared, terrainElevationAt } from "./terrain-height.js";
import { checkLineOfSight } from "./line-of-sight.js";
import { buildCandidateIndex, findCandidates } from "./candidate-index.js";

/**
 * Pure visibility engine. Computes visibility results for all spatial targets
 * from the observer's current position.
 */
export function computeVisibility(
  observer: ObserverPosition,
  spatial: SpatialWorldProjection,
): Map<string, VisibilityResult> {
  const results = new Map<string, VisibilityResult>();

  if (!spatial.region) return results;

  // Determine effective range based on observer elevation
  const maxRange = VISIBILITY_CONFIG.elevatedLandmarkRangeMetres;

  // Build candidate index and find nearby targets
  const index = buildCandidateIndex(spatial);
  const candidates = findCandidates(
    observer.xMetres,
    observer.yMetres,
    maxRange,
    index,
    spatial,
  );

  for (const target of candidates) {
    const result = computeTargetVisibility(observer, target, spatial);
    results.set(target.ref, result);
  }

  return results;
}

/**
 * Compute visibility for a single target.
 */
function computeTargetVisibility(
  observer: ObserverPosition,
  target: VisibilityTarget,
  spatial: SpatialWorldProjection,
): VisibilityResult {
  const distSq = distanceSquared(
    observer.xMetres,
    observer.yMetres,
    target.xMetres,
    target.yMetres,
  );
  const dist = Math.sqrt(distSq);
  const band = distanceBand(dist);
  const bearing = computeBearing(
    observer.xMetres,
    observer.yMetres,
    target.xMetres,
    target.yMetres,
  );

  // Determine max range for this target type
  const isElevatedLandmark = target.kind === "landmark" &&
    (target.silhouette === "monolith" || target.silhouette === "mountain" ||
     target.silhouette === "city" || target.silhouette === "ruin" ||
     target.elevationMetres > 50);
  const effectiveRange = isElevatedLandmark
    ? VISIBILITY_CONFIG.elevatedLandmarkRangeMetres
    : VISIBILITY_CONFIG.commonRangeMetres;

  // Range check
  if (dist > effectiveRange) {
    return { visible: false, reason: "out_of_range" };
  }

  // Elevation: observer eye height + terrain
  const observerElevation = observer.elevationMetres + VISIBILITY_CONFIG.observerEyeHeightMetres;
  const targetElevation = target.elevationMetres + terrainElevationAt(
    target.xMetres,
    target.yMetres,
    spatial,
  );

  // Line-of-sight check
  const los = checkLineOfSight(
    observer.xMetres,
    observer.yMetres,
    observerElevation,
    target.xMetres,
    target.yMetres,
    targetElevation,
    spatial,
  );

  if (los.blocked) {
    return { visible: false, reason: los.reason ?? "terrain_occluded" };
  }

  // Classify observation quality based on distance and target type
  // Within common range → fully observed
  if (dist <= VISIBILITY_CONFIG.commonRangeMetres) {
    return {
      visible: true,
      knowledge: "observed",
      confidence: VISIBILITY_CONFIG.observedConfidence,
      distanceBand: band,
      bearing,
      exactPositionAllowed: true,
    };
  }

  // Beyond common range but within elevated landmark range → glimpsed
  // Elevated targets are partially visible as silhouettes
  if (isElevatedLandmark && dist <= VISIBILITY_CONFIG.elevatedLandmarkRangeMetres) {
    return {
      visible: true,
      knowledge: "glimpsed",
      confidence: VISIBILITY_CONFIG.glimpsedConfidence,
      distanceBand: band,
      bearing,
      exactPositionAllowed: false,
    };
  }

  // Non-elevated target beyond common range but within max range
  // Still glimpsed if line of sight is clear
  return {
    visible: true,
    knowledge: "glimpsed",
    confidence: VISIBILITY_CONFIG.glimpsedConfidence,
    distanceBand: band,
    bearing,
    exactPositionAllowed: false,
  };
}

export { buildCandidateIndex, findCandidates } from "./candidate-index.js";
export { computeBearing, distanceBand, distanceSquared, terrainElevationAt } from "./terrain-height.js";
export { checkLineOfSight } from "./line-of-sight.js";
export { VISIBILITY_CONFIG } from "./config.js";
