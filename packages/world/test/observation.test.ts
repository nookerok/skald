import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import { rebuildProjection } from "../src/projection.js";
import { buildBeliefModel, createObservationAPI, serializeBeliefModel } from "../src/observation/index.js";

function event(type: string, eventId: string, timestamp: number, payload: Record<string, unknown> = {}, correlationId = "turn-" + timestamp, causationId: string | null = null): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId, causationId };
}

describe("Observation & Belief read model", () => {
  it("builds beliefs from observed evidence, never exposes world maps", () => {
    const events = [event("EntityExamined", "exam-1", 3, { entityId: "cart", name: "cart", description: "A cart bears fresh marks." })];
    const model = buildBeliefModel(events, rebuildProjection(events).getSnapshot());
    const belief = model.beliefs.get("cart");
    expect(belief?.currentInterpretation).toContain("fresh marks");
    expect(belief?.supportingEvidence[0]?.type).toBe("sensory");
    expect(JSON.stringify(model)).not.toMatch(/actual|true|real/i);
  });

  it("creates a strengthening hypothesis after repeated evidence", () => {
    const events = [
      event("ObservationUpdated", "o-1", 1, { key: "risk_taken", delta: 1 }),
      event("ObservationUpdated", "o-2", 2, { key: "risk_taken", delta: 1 }),
    ];
    const model = buildBeliefModel(events, rebuildProjection(events).getSnapshot());
    expect(model.activeHypotheses.length).toBeGreaterThanOrEqual(1);
    expect(model.activeHypotheses).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "strengthening", targetId: "observation:risk_taken" }),
    ]));
  });

  it("decays freshness without deleting old evidence", () => {
    const events = [
      event("EntityExamined", "exam-1", 1, { entityId: "stone", description: "A stone is warm." }),
      event("TickPassed", "tick-1", 20, { delta: 1 }),
    ];
    const model = buildBeliefModel(events, rebuildProjection(events).getSnapshot());
    const belief = model.beliefs.get("stone");
    expect(belief).toBeDefined();
    expect(belief!.supportingEvidence).toHaveLength(1);
    const record = createObservationAPI(events, rebuildProjection(events).getSnapshot()).observe("stone", "player", "emergence");
    expect(record?.freshness).toBe(0);
  });

  it("keeps contradictions visible", () => {
    const events = [
      event("ObservationUpdated", "o-1", 1, { key: "signal", delta: 1 }),
      event("ObservationUpdated", "o-2", 2, { key: "signal", delta: -1 }),
    ];
    const model = buildBeliefModel(events, rebuildProjection(events).getSnapshot());
    expect(model.contradictions).toHaveLength(1);
    expect(model.contradictions[0]!.involvedEvidenceIds).toEqual(["evidence:o-1", "evidence:o-2"]);
  });

  it("blocks runtime mutation of the belief map", () => {
    const events = [event("SoundProduced", "sound-1", 1, { source: "ridge", kind: "bird" })];
    const model = buildBeliefModel(events, rebuildProjection(events).getSnapshot());
    expect(() => (model.beliefs as Map<string, unknown>).set("x", {})).toThrow("immutable");
  });

  it("serializes map beliefs to a JSON-safe DTO", () => {
    const events = [event("SoundProduced", "sound-1", 1, { source: "ridge", kind: "bird" })];
    const model = buildBeliefModel(events, rebuildProjection(events).getSnapshot());
    const dto = serializeBeliefModel(model);
    expect(Array.isArray(dto.beliefs)).toBe(true);
    expect(JSON.parse(JSON.stringify(dto)).beliefs).toHaveLength(1);
  });

  it("enforces observer scope and exposes history/explanation/trace", () => {
    const events = [
      event("MoveRequested", "move-1", 1, {}),
      event("MovementSucceeded", "move-2", 1, { locationId: "ridge", locationName: "Ridge" }, "turn-1", "move-1"),
    ];
    const world = rebuildProjection(events).getSnapshot();
    const api = createObservationAPI(events, world);
    expect(api.observe("ridge", "other", "terrain")).toBeNull();
    expect(api.observe("location:ridge", "player", "terrain")?.payload.kind).toBe("terrain");
    expect(api.queryHistory("location:ridge", "player")).toHaveLength(1);
    expect(api.explainExistence("location:ridge", "player").supportingFactors).toHaveLength(1);
    expect(api.trace("move-1", "player", 4).rootId).toBe("move-1");
  });

  it("rejects a non-monotonic event log", () => {
    const events = [
      event("SoundProduced", "sound-2", 2, { source: "east" }),
      event("SoundProduced", "sound-1", 1, { source: "west" }),
    ];
    expect(() => buildBeliefModel(events, rebuildProjection([]).getSnapshot())).toThrow("Non-monotonic");
  });
});

