import { describe, expect, it } from "vitest";
import { beliefModelDTOSchema, beliefModelDTOJsonSchema, parseBeliefModelDTO, parseObservationRecord } from "@skald/observation";

describe("Observation Contract v2.0", () => {
  it("validates the exact DTO boundary", () => {
    const dto = { schemaVersion: 2, observerId: "player", beliefs: [], activeHypotheses: [], knownRelations: [], contradictions: [], lastUpdated: 0 };
    expect(parseBeliefModelDTO(dto)).toEqual(dto);
    expect(() => beliefModelDTOSchema.parse({ ...dto, actualWorld: true })).toThrow();
  });

  it("validates a non-empty belief DTO including freshness", () => {
    const belief = {
      patternId: "ridge",
      displayName: "Ridge",
      currentInterpretation: "A ridge is changing.",
      confidence: 0.8,
      supportingEvidence: [],
      openHypotheses: [],
      lastObserved: 3,
      freshness: 0.5,
    };
    const dto = { schemaVersion: 2, observerId: "player", beliefs: [belief], activeHypotheses: [], knownRelations: [], contradictions: [], lastUpdated: 3 };
    expect(parseBeliefModelDTO(dto)).toEqual(dto);
  });

  it("validates an observation record payload", () => {
    const record = { id: "o-1", observerId: "player", targetId: "ridge", lens: "terrain", observedAt: 1, confidence: 0.8, freshness: 1, source: "direct", evidence: [], hypothesisIds: [], payload: { kind: "terrain", slope: 0.2 } };
    expect(parseObservationRecord(record)).toEqual(record);
  });

  it("publishes a versioned JSON Schema", () => {
    expect(beliefModelDTOJsonSchema.$schema).toContain("json-schema.org");
    expect(JSON.stringify(beliefModelDTOJsonSchema)).toContain("schemaVersion");
  });
});
