import { describe, expect, it } from "vitest";
import { beliefStateFromModel, createBeliefEngine, createBeliefRevision } from "@skald/belief";
import type { BeliefState } from "@skald/belief";
import type { Evidence } from "@skald/observation";
import type { ObservationRecord } from "@skald/observation";

const evidence: Evidence = { id: "e-1", type: "sensory", description: "A trace", strength: 0.8, observedAt: 1, linkedObservationIds: ["o-1"] };
const record: ObservationRecord = { id: "o-1", observerId: "player", targetId: "trace", lens: "emergence", observedAt: 1, confidence: 0.8, freshness: 1, source: "direct", evidence: [evidence], hypothesisIds: [], payload: { kind: "emergence", stage: "nascent", stability: 0.2, persistence: 0.2, recovery: 0.5, entropy: 0.8, identityConfidence: 0.8, spiritPotential: 0 } };
const emptyState: BeliefState = { schemaVersion: 1, observerId: "player", beliefs: new Map(), activeHypotheses: [], contradictions: [], lastUpdated: 0 };

describe("Belief Engine", () => {
  it("converts an observer model into engine state", () => {
    expect(beliefStateFromModel({ schemaVersion: 1, observerId: "player", beliefs: new Map(), activeHypotheses: [], knownRelations: [], contradictions: [], lastUpdated: 0 }).observerId).toBe("player");
  });

  it("runs observation -> evidence -> belief", () => {
    const engine = createBeliefEngine();
    const state = engine.applyRevision(emptyState, engine.fromObservation(record));
    expect(state.beliefs.get("trace")?.supportingEvidence).toHaveLength(1);
  });

  it("decays confidence without deleting evidence", () => {
    const engine = createBeliefEngine();
    const state = engine.applyRevision(emptyState, engine.fromObservation(record));
    const decayed = engine.decay(state, 11, 10);
    expect(decayed.beliefs.get("trace")?.confidence).toBe(0);
    expect(decayed.beliefs.get("trace")?.supportingEvidence).toHaveLength(1);
  });

  it("retains explicit contradictions", () => {
    const engine = createBeliefEngine();
    const state = engine.applyRevision(emptyState, createBeliefRevision("trace", "trace", [evidence], 2, "contradicts"));
    expect(state.contradictions).toHaveLength(1);
  });
});
