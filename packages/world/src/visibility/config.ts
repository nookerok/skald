/** Static visibility parameters (ADR-0016 §5). All magic numbers live here. */

export const VISIBILITY_CONFIG = {
  /** Height of the observer's eyes above terrain. */
  observerEyeHeightMetres: 2,

  /** Maximum range for ordinary locations and objects. */
  commonRangeMetres: 4_000,

  /** Extended range for elevated landmarks (city walls, monolith). */
  elevatedLandmarkRangeMetres: 12_000,

  /** Confidence for a glimpsed (partial) observation. */
  glimpsedConfidence: 0.35,

  /** Confidence for a fully observed target. */
  observedConfidence: 0.75,

  /** Height per elevation band unit. */
  terrainBandHeightMetres: 100,

  /** Forest opacity: 0 = transparent, 1 = fully opaque. */
  forestOpacity: 0.55,

  /** Rock opacity: fully opaque when above line of sight. */
  rockOpacity: 1,

  /** Distance band boundaries (metres). */
  nearRangeMetres: 1_000,
  middleRangeMetres: 4_000,

  /** Tile size for terrain lookup. */
  tileSizeMetres: 250,

  /** Region size for bounds checking. */
  regionSizeMetres: 20_000,
} as const;
