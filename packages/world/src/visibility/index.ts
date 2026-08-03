export type { ObserverPosition, VisibilityTarget, VisibilityResult, SpatialCandidateIndex } from "./types.js";
export { VISIBILITY_CONFIG } from "./config.js";
export { elevationToMetres, tileAtPosition, terrainElevationAt, computeBearing, distanceBand, distanceSquared } from "./terrain-height.js";
export { buildCandidateIndex, findCandidates } from "./candidate-index.js";
export { checkLineOfSight } from "./line-of-sight.js";
export { computeVisibility } from "./visibility-engine.js";
