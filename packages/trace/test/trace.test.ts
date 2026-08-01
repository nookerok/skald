import { describe, expect, it } from "vitest";
import { createTraceAPI, traceBelief } from "@skald/trace";
import type { BeliefModel } from "@skald/observation";

const model: BeliefModel = { schemaVersion: 2, observerId: "player", beliefs: new Map(), activeHypotheses: [], knownRelations: [{ sourceId: "ridge", targetId: "river", type: "feeds", observedStrength: 0.6, confidence: 0.8, trend: "stable", discoveredAt: 1, evidenceIds: ["e-1"] }], contradictions: [], lastUpdated: 1 };

describe("Trace Engine", () => {
  it("exposes the pure API facade", () => {
    expect(createTraceAPI(model).trace("ridge").steps).toHaveLength(1);
  });

  it("traces only observer-visible relations", () => {
    expect(traceBelief(model, "ridge").steps[0]).toMatchObject({ fromId: "ridge", toId: "river", relationType: "feeds" });
    expect(traceBelief(model, "unknown").incomplete).toBe(false);
  });
});
