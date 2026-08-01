import type { LensId, ObservationContext, ObservationRecord, ObserverId, PatternId } from "./types.js";

/** Ordered stages in the Observation Engine skeleton. */
export type ObservationStageId = "can-perceive" | "distance" | "occlusion" | "weather" | "prior-knowledge" | "culture";

/** Immutable input shared by every independent observation stage. */
export interface ObservationStageInput {
  readonly targetId: PatternId;
  readonly observerId: ObserverId;
  readonly lens: LensId;
  readonly context: ObservationContext;
  readonly facts: Readonly<Record<string, unknown>>;
}

/** Result returned by one stage without embedding simulation logic. */
export interface ObservationStageResult {
  readonly status: "continue" | "blocked";
  readonly facts: Readonly<Record<string, unknown>>;
  readonly observation?: ObservationRecord;
  readonly reason?: string;
}

/** A composable stage in the observation pipeline. */
export interface ObservationStage {
  readonly id: ObservationStageId;
  run(input: ObservationStageInput): ObservationStageResult;
}

/** Final result of a configurable pipeline run. */
export interface ObservationPipelineResult {
  readonly status: "complete" | "blocked";
  readonly input: ObservationStageInput;
  readonly observation: ObservationRecord | null;
  readonly blockedBy?: ObservationStageId;
  readonly reason?: string;
}

/** A configurable sequence of independent observation stages. */
export interface ObservationPipeline {
  readonly stages: readonly ObservationStage[];
  run(input: ObservationStageInput): ObservationPipelineResult;
}

/** Creates a pass-through stage for wiring a later implementation. */
export function createObservationStage(id: ObservationStageId): ObservationStage {
  return Object.freeze({
    id,
    run: (input: ObservationStageInput): ObservationStageResult => ({ status: "continue", facts: input.facts }),
  });
}

function gateStage(id: ObservationStageId, blocked: (facts: Readonly<Record<string, unknown>>) => string | null): ObservationStage {
  return Object.freeze({
    id,
    run: (input: ObservationStageInput): ObservationStageResult => {
      const reason = blocked(input.facts);
      return reason ? { status: "blocked", facts: input.facts, reason } : { status: "continue", facts: input.facts };
    },
  });
}

/** Blocks facts explicitly marked as outside the observer's perception. */
export const canPerceiveStage = gateStage("can-perceive", (facts) => facts.canPerceive === false ? "observer cannot perceive target" : null);
/** Blocks facts whose supplied distance exceeds the observer's range. */
export const distanceStage = gateStage("distance", (facts) => {
  const distance = facts.distance;
  const maxDistance = facts.maxDistance;
  return typeof distance === "number" && typeof maxDistance === "number" && distance > maxDistance ? "target is out of range" : null;
});
/** Blocks facts explicitly marked as occluded. */
export const occlusionStage = gateStage("occlusion", (facts) => facts.occluded === true ? "target is occluded" : null);
/** Blocks facts explicitly hidden by weather. */
export const weatherStage = gateStage("weather", (facts) => facts.weatherBlocked === true ? "weather blocks observation" : null);
/** Pass-through stage for prior knowledge. */
export const priorKnowledgeStage = createObservationStage("prior-knowledge");
/** Pass-through stage for cultural interpretation. */
export const cultureStage = createObservationStage("culture");

/** Creates the canonical six-stage order with no simulation behavior. */
export function createObservationPipeline(stages: readonly ObservationStage[] = [
  canPerceiveStage, distanceStage, occlusionStage, weatherStage, priorKnowledgeStage, cultureStage,
]): ObservationPipeline {
  const configured = Object.freeze([...stages]);
  return Object.freeze({
    stages: configured,
    run(input: ObservationStageInput): ObservationPipelineResult {
      let current = input;
      let observation: ObservationRecord | null = null;
      for (const stage of configured) {
        const result = stage.run(current);
        observation = result.observation ?? observation;
        current = { ...current, facts: Object.freeze({ ...result.facts }) };
        if (result.status === "blocked") {
          return Object.freeze({ status: "blocked", input: current, observation, blockedBy: stage.id, ...(result.reason ? { reason: result.reason } : {}) });
        }
      }
      return Object.freeze({ status: "complete", input: current, observation });
    },
  });
}
