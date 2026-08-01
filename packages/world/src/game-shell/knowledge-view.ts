import type { BeliefModel } from "../observation/types.js";
import type { KnowledgeSummary } from "./types.js";
import { sanitizePlayerFacingText } from "./player-facing.js";

export function buildKnowledgeSummary(model: BeliefModel): KnowledgeSummary {
  const facts: KnowledgeSummary["facts"] = [];
  const hypotheses: KnowledgeSummary["hypotheses"] = [];
  const traces: KnowledgeSummary["traces"] = [];
  const recentEvidence: KnowledgeSummary["recentEvidence"] = [];
  for (const belief of model.beliefs.values()) {
    const item = { title: sanitizePlayerFacingText(belief.displayName), text: sanitizePlayerFacingText(belief.currentInterpretation) };
    if (belief.confidence >= 0.8) facts.push(item);
    else if (belief.confidence >= 0.6) hypotheses.push(item);
    else traces.push(item);
    for (const evidence of belief.supportingEvidence) {
      recentEvidence.push({ text: sanitizePlayerFacingText(evidence.description), worldTime: evidence.observedAt, kind: evidence.type });
    }
  }
  recentEvidence.sort((a, b) => b.worldTime - a.worldTime);
  return { facts, hypotheses, traces, recentEvidence: recentEvidence.slice(0, 5) };
}
