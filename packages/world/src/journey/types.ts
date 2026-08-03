/** Canonical types for Spatial Movement (ADR-0015). */

export type JourneyResolution =
  | {
      readonly kind: "resolved";
      readonly relationId: string;
      readonly fromLocationId: string;
      readonly toLocationId: string;
      readonly travelTicks: number;
    }
  | {
      readonly kind: "blocked";
      readonly reason: "unknown_destination" | "no_route" | "crossing_closed" | "ambiguous" | "already_traveling";
      readonly playerText: string;
    }
  | {
      readonly kind: "ambiguous";
      readonly candidates: readonly string[];
    };
