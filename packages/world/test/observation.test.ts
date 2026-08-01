import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import { rebuildProjection } from "../src/projection.js";
import { buildBeliefModel, buildDiscoveryJournalFromBeliefModel, createObservationAPI, serializeBeliefModel } from "../src/observation/index.js";

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

  it("applies event-time observation gates without using final player location", () => {
    const events = [
      event("PlayerLocationChanged", "move-old", 1, { locationId: "old", locationName: "Old place" }),
      event("EntityExamined", "old-exam", 2, { entityId: "old-place", locationId: "old", description: "Old evidence." }),
      event("PlayerLocationChanged", "move-new", 3, { locationId: "new", locationName: "New place" }),
      event("EntityExamined", "left-behind", 4, { entityId: "left-behind", locationId: "old", description: "Left behind." }),
      event("EntityExamined", "blocked-exam", 5, { entityId: "hidden", canPerceive: false, description: "Hidden evidence." }),
    ];
    const model = buildBeliefModel(events, rebuildProjection(events).getSnapshot());
    expect(model.beliefs.get("old-place")).toBeDefined();
    expect(model.beliefs.get("left-behind")).toBeUndefined();
    expect(model.beliefs.get("hidden")).toBeUndefined();
  });

  it("does not let hidden discovery evidence elevate the visible stage", () => {
    const events = [
      event("ObservationUpdated", "risk-1", 1, { key: "risk_taken", delta: 1 }),
      event("ConsequenceFired", "hidden-echo", 2, { consequenceType: "audacity", canPerceive: false }),
    ];
    const model = buildBeliefModel(events, rebuildProjection(events).getSnapshot());
    const belief = model.beliefs.get("discovery:risk_draws_attention");
    expect(belief).toBeDefined();
    expect(belief!.supportingEvidence).toHaveLength(1);
    expect(belief!.confidence).toBeCloseTo(0.42);
  });

  it("derives grid distance from historical positions for heat visibility", () => {
    const events = [
      event("PlayerSpawned", "spawn", 0, { x: 0, y: 0 }),
      event("HeatRadiated", "near-heat", 1, { x: 1, y: 0, delta: 1 }),
      event("HeatRadiated", "far-heat", 2, { x: 10, y: 0, delta: 1 }),
    ];
    const model = buildBeliefModel(events, rebuildProjection(events).getSnapshot());
    const belief = model.beliefs.get("heat:heat:nearby");
    expect(belief).toBeDefined();
    expect(belief!.supportingEvidence).toHaveLength(1);
    expect(belief!.supportingEvidence[0]!.id).toBe("evidence:near-heat");
  });

  it("updates observer position before applying visibility to following events", () => {
    const events = [
      event("PlayerSpawned", "spawn", 0, { x: 0, y: 0 }),
      event("MovementSucceeded", "long-move", 1, { x: 10, y: 0 }),
      event("HeatRadiated", "local-heat", 2, { x: 10, y: 0, delta: 1 }),
    ];
    const model = buildBeliefModel(events, rebuildProjection(events).getSnapshot());
    expect(model.beliefs.get("heat:heat:nearby")).toBeDefined();
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

  it("does not expose hidden roots or causal children through trace", () => {
    const events = [
      event("EntityExamined", "visible-root", 1, { entityId: "ridge", description: "A ridge is visible." }),
      event("ConsequenceFired", "hidden-child", 1, { consequenceType: "secret", canPerceive: false }, "turn-1", "visible-root"),
    ];
    const api = createObservationAPI(events, rebuildProjection(events).getSnapshot());
    const visibleTrace = api.trace("visible-root", "player", 4);
    const hiddenTrace = api.trace("hidden-child", "player", 4);
    expect(visibleTrace.steps).toHaveLength(0);
    expect(hiddenTrace.steps).toHaveLength(0);
    expect(hiddenTrace.incomplete).toBe(true);
  });

  it("traces public observation record IDs without parsing target strings", () => {
    const events = [
      event("MoveRequested", "move-root", 1, {}),
      event("MovementSucceeded", "move-visible", 1, { locationId: "ridge:north", locationName: "North ridge" }, "turn-1", "move-root"),
    ];
    const api = createObservationAPI(events, rebuildProjection(events).getSnapshot());
    const record = api.observe("location:ridge:north", "player", "terrain");
    expect(record).not.toBeNull();
    const trace = api.trace(record!.id, "player");
    expect(trace.rootId).toBe(record!.id);
    expect(trace.incomplete).toBe(false);
  });

  it("does not expose a scheduled consequence as player belief", () => {
    const events = [event("ConsequenceCreated", "scheduled", 1, { id: "audacity@turn-1", type: "audacity", expiresAt: 6 })];
    const model = buildBeliefModel(events, rebuildProjection(events).getSnapshot());
    expect(model.beliefs.size).toBe(0);
    expect(serializeBeliefModel(model).beliefs).toEqual([]);
  });

  it("uses player-readable labels for internal observation keys", () => {
    const events = [event("ObservationUpdated", "risk-1", 1, { key: "risk_taken", delta: 1 })];
    const belief = buildBeliefModel(events, rebuildProjection(events).getSnapshot()).beliefs.get("observation:risk_taken");
    expect(belief?.displayName).toBe("\u0422\u0440\u0435\u0432\u043e\u0436\u043d\u044b\u0439 \u0441\u043b\u0435\u0434");
    expect(belief?.currentInterpretation).not.toContain("risk_taken");
  });

  it("fails closed for unsupported observer identities", () => {
    const events = [event("EntityExamined", "exam-other", 1, { entityId: "hidden", description: "A fact." })];
    const world = rebuildProjection(events).getSnapshot();
    const model = buildBeliefModel(events, world, "other");
    expect(model.beliefs.size).toBe(0);
    const api = createObservationAPI(events, world, "other");
    expect(api.listObservable("other")).toEqual([]);
    expect(api.trace("exam-other", "other").steps).toEqual([]);
  });

  it("projects discoveries from beliefs without source event identifiers", () => {
    const events = [event("ObservationUpdated", "risk-1", 1, { key: "risk_taken", delta: 1 })];
    const model = buildBeliefModel(events, rebuildProjection(events).getSnapshot());
    const journal = buildDiscoveryJournalFromBeliefModel(model);
    expect(journal.cards[0]?.discoveryId).toBe("risk_draws_attention");
    expect(journal.cards[0]?.evidence[0]?.sourceEventIds).toEqual([]);
  });

  it("rejects a non-monotonic event log", () => {
    const events = [
      event("SoundProduced", "sound-2", 2, { source: "east" }),
      event("SoundProduced", "sound-1", 1, { source: "west" }),
    ];
    expect(() => buildBeliefModel(events, rebuildProjection([]).getSnapshot())).toThrow("Non-monotonic");
  });
});

