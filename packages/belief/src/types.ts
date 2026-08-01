import type { BeliefModel, Contradiction, Evidence, Hypothesis, ObservationRecord, PatternBelief, SimTime } from "@skald/observation";
import { deepFreeze, freezeMap } from "./immutable.js";

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
  readonly schemaVersion: 2;
  readonly observerId: string;
  readonly beliefs: ReadonlyMap<string, PatternBelief>;
  readonly activeHypotheses: readonly Hypothesis[];
  readonly contradictions: readonly Contradiction[];
  readonly lastUpdated: SimTime;
  /** Stable confidence baselines used for deterministic repeated decay. */
  readonly baseConfidence?: ReadonlyMap<string, number>;
}

/** Pure Belief Engine operations. */
export interface BeliefEngine {
  fromObservation(record: ObservationRecord): BeliefRevision;
  applyRevision(state: BeliefState, revision: BeliefRevision): BeliefState;
  decay(state: BeliefState, now: SimTime, freshnessWindow: number): BeliefState;
}

/** Converts a canonical BeliefModel into the engine's replaceable state. */
export function beliefStateFromModel(model: BeliefModel): BeliefState {
  const baseConfidence = new Map<string, number>();
  for (const [patternId, belief] of model.beliefs) {
    const evidence = belief.supportingEvidence;
    const baseline = evidence.length > 0
      ? evidence.reduce((sum, item) => sum + item.strength, 0) / evidence.length
      : belief.confidence;
    baseConfidence.set(patternId, Math.max(0, Math.min(1, baseline)));
  }
  return Object.freeze({
    schemaVersion: 2 as const,
    observerId: model.observerId,
    beliefs: freezeMap(new Map(model.beliefs)),
    activeHypotheses: deepFreeze([...model.activeHypotheses]),
    contradictions: deepFreeze([...model.contradictions]),
    lastUpdated: model.lastUpdated,
    baseConfidence: freezeMap(baseConfidence),
  });
}
