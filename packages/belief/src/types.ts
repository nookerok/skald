import type { BeliefModel, Contradiction, Evidence, Hypothesis, ObservationRecord, PatternBelief, SimTime } from "@skald/observation";

/** Explicit relation used when revising a belief. */
export type BeliefRevisionRelation = "supports" | "contradicts";

/** A deterministic revision request produced from observer-visible evidence. */
export interface BeliefRevision {
  readonly patternId: string;
  readonly interpretation: string;
  readonly evidence: readonly Evidence[];
  readonly hypothesis?: Hypothesis;
  readonly relation: BeliefRevisionRelation;
  readonly at: SimTime;
}

/** Mutable-by-replacement state owned by a Belief Engine instance. */
export interface BeliefState {
  readonly schemaVersion: 1;
  readonly observerId: string;
  readonly beliefs: ReadonlyMap<string, PatternBelief>;
  readonly activeHypotheses: readonly Hypothesis[];
  readonly contradictions: readonly Contradiction[];
  readonly lastUpdated: SimTime;
}

/** Pure Belief Engine operations. */
export interface BeliefEngine {
  fromObservation(record: ObservationRecord): BeliefRevision;
  applyRevision(state: BeliefState, revision: BeliefRevision): BeliefState;
  decay(state: BeliefState, now: SimTime, freshnessWindow: number): BeliefState;
}

/** Converts a canonical BeliefModel into the engine's replaceable state. */
export function beliefStateFromModel(model: BeliefModel): BeliefState {
  return Object.freeze({
    schemaVersion: 1 as const,
    observerId: model.observerId,
    beliefs: new Map(model.beliefs),
    activeHypotheses: [...model.activeHypotheses],
    contradictions: [...model.contradictions],
    lastUpdated: model.lastUpdated,
  });
}
