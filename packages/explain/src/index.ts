import type { BeliefModel, ExistenceExplanation, Factor } from "@skald/observation";

function factor(description: string, strength: number, confidence: number, evidenceIds: readonly string[]): Factor {
  return Object.freeze({ description, strength, confidence, evidenceIds: [...evidenceIds] });
}

/** Generates a structured existence explanation from BeliefModel only. */
export function explainExistence(model: BeliefModel, patternId: string): ExistenceExplanation {
  const belief = model.beliefs.get(patternId);
  if (!belief) return Object.freeze({ patternId, confidence: 0, supportingFactors: [], weakeningFactors: [], criticalDependencies: [], collapseConditions: [] });
  const supportingFactors = belief.supportingEvidence.map((entry) => factor(entry.description, entry.strength, entry.strength, [entry.id]));
  return Object.freeze({
    patternId,
    confidence: belief.confidence,
    supportingFactors,
    weakeningFactors: [],
    criticalDependencies: supportingFactors.slice(0, 2),
    collapseConditions: [],
  });
}

/** Pure Explain API facade bound to one observer-scoped BeliefModel. */
export interface ExplainAPI { explainExistence(patternId: string): ExistenceExplanation; }

/** Creates an Explain API that cannot access World or Event Log. */
export function createExplainAPI(model: BeliefModel): ExplainAPI {
  return Object.freeze({ explainExistence: (patternId: string) => explainExistence(model, patternId) });
}
