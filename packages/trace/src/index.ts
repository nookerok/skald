import type { BeliefModel, CausalChain, CausalStep } from "@skald/observation";

/** Builds an observer-scoped causal chain from known relation evidence only. */
export function traceBelief(model: BeliefModel, rootId: string, maxDepth = 8): CausalChain {
  const steps: CausalStep[] = [];
  const relations = model.knownRelations.filter((relation) => relation.sourceId === rootId || relation.targetId === rootId).slice(0, Math.max(0, maxDepth));
  for (const relation of relations) {
    steps.push({ fromId: relation.sourceId, toId: relation.targetId, relationType: relation.type, observedStrength: relation.observedStrength, evidenceIds: relation.evidenceIds, confidence: relation.confidence });
  }
  return Object.freeze({ rootId, steps: Object.freeze(steps), confidence: steps.length === 0 ? 0 : steps.reduce((sum, step) => sum + step.confidence, 0) / steps.length, incomplete: relations.length >= maxDepth });
}

/** Pure Trace API facade. */
export interface TraceAPI { trace(rootId: string, maxDepth?: number): CausalChain; }

/** Creates a trace API that cannot access simulation state. */
export function createTraceAPI(model: BeliefModel): TraceAPI {
  return Object.freeze({ trace: (rootId: string, maxDepth?: number) => traceBelief(model, rootId, maxDepth) });
}
