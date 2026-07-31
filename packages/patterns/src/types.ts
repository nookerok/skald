/** A simulation timestamp used by the pattern ontology. */
export type SimTime = number;

/** Stable identifier for a pattern. */
export type PatternId = string;

/** Stable identifier for the observer whose boundary is applied. */
export type ObserverId = string;

/** Supported ontology families for patterns. */
export type PatternKind =
  | TerrainPatternKind
  | EcologyPatternKind
  | RelationPatternKind
  | EmergencePatternKind
  | HistoryPatternKind
  | PredictionPatternKind;

/** A terrain or geography pattern. */
export interface TerrainPatternKind {
  readonly family: "terrain";
  readonly subtype: "landform" | "climate" | "hydrology";
}

/** An ecology or living-world pattern. */
export interface EcologyPatternKind {
  readonly family: "ecology";
  readonly subtype: "productivity" | "diversity" | "pressure" | "recovery";
}

/** A relation pattern between two observable identities. */
export interface RelationPatternKind {
  readonly family: "relations";
  readonly subtype: "supports" | "feeds" | "threatens" | "depends" | "enables" | "constrains";
}

/** A pattern describing an emerging or collapsing phenomenon. */
export interface EmergencePatternKind {
  readonly family: "emergence";
  readonly subtype: "nascent" | "emerging" | "stable" | "collapsing";
}

/** A historical pattern reconstructed from retained evidence. */
export interface HistoryPatternKind {
  readonly family: "history";
  readonly subtype: "scar" | "transition" | "recurrence";
}

/** A trajectory pattern that remains explicitly probabilistic. */
export interface PredictionPatternKind {
  readonly family: "prediction";
  readonly subtype: "trajectory" | "risk" | "opportunity";
}

/** Lifecycle states shared by every pattern. */
export type PatternLifecycleState =
  | "latent"
  | "observed"
  | "emerging"
  | "stable"
  | "weakening"
  | "dissolved";

/** A lifecycle value with the time of its last transition. */
export interface PatternLifecycle {
  readonly state: PatternLifecycleState;
  readonly changedAt: SimTime;
  readonly version: number;
}

/** The spatial, temporal and observer boundary of a pattern. */
export interface PatternBoundary {
  readonly observerId: ObserverId;
  readonly visibility: "visible" | "partial" | "occluded" | "unknown";
  readonly locationId?: string;
  readonly radius?: number;
  readonly fromTime?: SimTime;
  readonly toTime?: SimTime;
}

/** Stable identity and ontology classification for a pattern. */
export interface PatternIdentity {
  readonly id: PatternId;
  readonly label: string;
  readonly kind: PatternKind;
  readonly createdAt: SimTime;
}

/** The complete ontology record; it contains no simulation behavior. */
export interface Pattern {
  readonly identity: PatternIdentity;
  readonly boundary: PatternBoundary;
  readonly lifecycle: PatternLifecycle;
  readonly definitionVersion: "1.0";
}

/** A lifecycle transition request. */
export interface PatternLifecycleTransition {
  readonly from: PatternLifecycleState;
  readonly to: PatternLifecycleState;
  readonly at: SimTime;
}
