import { describe, expect, it } from "vitest";
import { createExplainAPI, explainExistence } from "@skald/explain";
import type { BeliefModel } from "@skald/observation";

const model: BeliefModel = { schemaVersion: 2, observerId: "player", beliefs: new Map([[
  "ridge", { patternId: "ridge", displayName: "Ridge", currentInterpretation: "A ridge persists", confidence: 0.7, freshness: 1, supportingEvidence: [{ id: "e-1", type: "sensory", description: "A ridge", strength: 0.7, observedAt: 1, linkedObservationIds: [] }], openHypotheses: [], lastObserved: 1 },
]]), activeHypotheses: [], knownRelations: [], contradictions: [], lastUpdated: 1 };

describe("Explain Engine", () => {
  it("exposes the pure API facade", () => {
    expect(createExplainAPI(model).explainExistence("ridge").patternId).toBe("ridge");
  });

  it("returns structured factors from BeliefModel only", () => {
    const result = explainExistence(model, "ridge");
    expect(result.supportingFactors[0]?.evidenceIds).toEqual(["e-1"]);
    expect(result).not.toHaveProperty("text");
  });
});
