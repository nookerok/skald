import { describe, expect, it } from "vitest";
import { beliefStateFromModel, createBeliefEngine, createBeliefRevision } from "@skald/belief";
import type { BeliefState } from "@skald/belief";
import type { Evidence } from "@skald/observation";
import type { ObservationRecord } from "@skald/observation";

const evidence: Evidence = { id: "e-1", type: "sensory", description: "A trace", strength: 0.8, observedAt: 1, linkedObservationIds: ["o-1"] };
const record: ObservationRecord = { id: "o-1", observerId: "player", targetId: "trace", lens: "emergence", observedAt: 1, confidence: 0.8, freshness: 1, source: "direct", evidence: [evidence], hypothesisIds: [], payload: { kind: "emergence", stage: "nascent", stability: 0.2, persistence: 0.2, recovery: 0.5, entropy: 0.8, identityConfidence: 0.8, spiritPotential: 0 } };
const emptyState: BeliefState = { schemaVersion: 2, observerId: "player", beliefs: new Map(), activeHypotheses: [], contradictions: [], lastUpdated: 0 };

describe("Belief Engine", () => {
  it("converts an observer model into engine state", () => {
    expect(beliefStateFromModel({ schemaVersion: 2, observerId: "player", beliefs: new Map(), activeHypotheses: [], knownRelations: [], contradictions: [], lastUpdated: 0 }).observerId).toBe("player");
  });

  it("runs observation -> evidence -> belief", () => {
    const engine = createBeliefEngine();
    const state = engine.applyRevision(emptyState, engine.fromObservation(record));
    expect(state.beliefs.get("trace")?.supportingEvidence).toHaveLength(1);
  });

  it("keeps internal target IDs out of player-facing belief text", () => {
    const engine = createBeliefEngine();
    const revision = engine.fromObservation({ ...record, hypothesisIds: ["h-1"] });
    expect(revision.interpretation).not.toContain(record.targetId);
    expect(revision.hypothesis?.statement).not.toContain(record.targetId);
    const state = engine.applyRevision(emptyState, createBeliefRevision(record.targetId, "A visible interpretation", [evidence], 2, "contradicts"));
    expect(state.contradictions[0]?.description).not.toContain(record.targetId);
  });

  it("decays confidence without deleting evidence", () => {
    const engine = createBeliefEngine();
    const state = engine.applyRevision(emptyState, engine.fromObservation(record));
    const decayed = engine.decay(state, 11, 10);
    expect(decayed.beliefs.get("trace")?.confidence).toBe(0);
    expect(decayed.beliefs.get("trace")?.supportingEvidence).toHaveLength(1);
  });

  it("decay is idempotent at the same time and does not compound across calls", () => {
    const engine = createBeliefEngine();
    const state = engine.applyRevision(emptyState, engine.fromObservation(record));
    const first = engine.decay(state, 6, 10);
    const repeated = engine.decay(first, 6, 10);
    const later = engine.decay(first, 7, 10);
    expect(first.beliefs.get("trace")?.confidence).toBeCloseTo(0.4);
    expect(repeated.beliefs.get("trace")?.confidence).toBeCloseTo(0.4);
    expect(later.beliefs.get("trace")?.confidence).toBeCloseTo(0.32);
  });

  it("keeps decay idempotent for beliefs without supporting evidence", () => {
    const engine = createBeliefEngine();
    const state = beliefStateFromModel({
      schemaVersion: 2,
      observerId: "player",
      beliefs: new Map([["silent", {
        patternId: "silent",
        displayName: "\u041d\u0430\u0431\u043b\u044e\u0434\u0430\u0435\u043c\u043e\u0435 \u044f\u0432\u043b\u0435\u043d\u0438\u0435",
        currentInterpretation: "An unverified interpretation.",
        confidence: 0.8,
        supportingEvidence: [],
        openHypotheses: [],
        lastObserved: 1,
        freshness: 1,
      }]]),
      activeHypotheses: [],
      knownRelations: [],
      contradictions: [],
      lastUpdated: 1,
    });
    const first = engine.decay(state, 6, 10);
    const repeated = engine.decay(first, 6, 10);
    expect(first.beliefs.get("silent")?.confidence).toBeCloseTo(0.4);
    expect(repeated.beliefs.get("silent")?.confidence).toBeCloseTo(0.4);
  });

  it("deep-freezes nested evidence, hypotheses and contradiction identifiers", () => {
    const engine = createBeliefEngine();
    const recordWithHypothesis = { ...record, hypothesisIds: ["h-1"] };
    const state = engine.applyRevision(emptyState, engine.fromObservation(recordWithHypothesis));
    const belief = state.beliefs.get("trace")!;
    expect(() => (belief.supportingEvidence as Evidence[]).push(evidence)).toThrow();
    expect(() => (belief.openHypotheses as unknown[]).push({})).toThrow();

    const contradictory = engine.applyRevision(emptyState, createBeliefRevision("trace", "trace", [evidence], 2, "contradicts"));
    expect(() => (contradictory.contradictions[0]!.involvedEvidenceIds as string[]).push("e-2")).toThrow();
  });

  it("retains explicit contradictions", () => {
    const engine = createBeliefEngine();
    const state = engine.applyRevision(emptyState, createBeliefRevision("trace", "trace", [evidence], 2, "contradicts"));
    expect(state.contradictions).toHaveLength(1);
  });
});
