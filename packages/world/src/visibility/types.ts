/** Canonical types for the Visibility Engine (ADR-0016). */

export interface ObserverPosition {
  readonly xMetres: number;
  readonly yMetres: number;
  readonly elevationMetres: number;
  readonly locationRef: string | null;
}

export interface VisibilityTarget {
  readonly ref: string;
  readonly kind: "location" | "landmark" | "route";
  readonly xMetres: number;
  readonly yMetres: number;
  readonly elevationMetres: number;
  readonly silhouette: string;
}

export type VisibilityResult =
  | {
      readonly visible: true;
      readonly knowledge: "glimpsed" | "observed";
      readonly confidence: number;
      readonly distanceBand: "near" | "middle" | "far";
      readonly bearing: string;
      readonly exactPositionAllowed: boolean;
    }
  | {
      readonly visible: false;
      readonly reason:
        | "out_of_range"
        | "terrain_occluded"
        | "height_occluded"
        | "forest_occluded";
    };

export interface SpatialCandidateIndex {
  readonly cellId: string;
  readonly locationRefs: readonly string[];
  readonly landmarkRefs: readonly string[];
}
