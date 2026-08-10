import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import {
  WorldProjector,
  handleResourceExtractionCommand,
  resourceExtraction,
  resourceRegeneration,
} from "@skald/world";

function event(type: string, payload: Record<string, unknown>, timestamp = 0): DomainEvent {
  return {
    eventId: `test#${type}#${timestamp}`,
    type,
    schemaVersion: 1,
    payload,
    timestamp,
    correlationId: "test",
    causationId: null,
  } as DomainEvent;
}

const definition = {
  id: "resource.blackwood_timber",
  resourceKind: "timber",
  locationId: "blackwood_edge",
  capacityUnits: 100,
  initialStockUnits: 100,
  quality: "common",
  extractionMethods: [{ id: "manual_felling", maximumPerAction: 5, difficulty: 1 }],
  regeneration: { intervalWorldTime: 24, amountUnits: 2, maximumUnits: 100, blockedBy: ["forest_fire"] },
  canonicalRefs: ["regions.pilot-region.history.f1"],
};

describe("resource nodes", () => {
  it("projects definition, clamps extraction and replays stock deterministically", () => {
    const projector = new WorldProjector();
    projector.apply(event("ResourceNodeDefined", definition));
    const world = projector.getSnapshot();
    const request = handleResourceExtractionCommand({ type: "ResourceExtractionCommand", nodeId: definition.id, methodId: "manual_felling", requestedUnits: 12 }, "extract-1", 1);
    const produced = resourceExtraction.handle(request, world);
    expect(produced).toHaveLength(1);
    expect((produced[0]?.payload as { amountUnits: number }).amountUnits).toBe(5);
    projector.apply(request);
    projector.apply(produced[0]!);
    expect(projector.getSnapshot().resources?.states.get(definition.id)?.stockUnits).toBe(95);
    const replay = new WorldProjector();
    replay.apply(event("ResourceNodeDefined", definition));
    replay.apply(request);
    replay.apply(produced[0]!);
    expect(replay.getSnapshot().resources?.states.get(definition.id)).toEqual(projector.getSnapshot().resources?.states.get(definition.id));
  });

  it("regenerates from world time and pauses while a blocking situation is active", () => {
    const projector = new WorldProjector();
    projector.apply(event("ResourceNodeDefined", definition));
    const request = handleResourceExtractionCommand({ type: "ResourceExtractionCommand", nodeId: definition.id, methodId: "manual_felling", requestedUnits: 5 }, "extract-2", 1);
    projector.apply(request);
    projector.apply(resourceExtraction.handle(request, projector.getSnapshot())[0]!);
    const blockedTick = event("TickPassed", {}, 25);
    expect(resourceRegeneration.handle(blockedTick, projector.getSnapshot())).toHaveLength(1);
    projector.apply(event("SituationStarted", { situationId: "fire", type: "forest_fire", startedAt: 2, duration: 100, data: {} }, 2));
    expect(resourceRegeneration.handle(blockedTick, projector.getSnapshot())).toEqual([]);
    projector.apply(event("SituationEnded", { situationId: "fire" }, 26));
    const resumed = resourceRegeneration.handle(event("TickPassed", {}, 50), projector.getSnapshot());
    expect(resumed).toHaveLength(1);
    expect((resumed[0]?.payload as { amountUnits: number }).amountUnits).toBe(4);
  });

  it("rejects malformed extraction commands before state access", () => {
    const rejected = handleResourceExtractionCommand({ type: "ResourceExtractionCommand", nodeId: "", methodId: "manual_felling", requestedUnits: 1 }, "bad", 0);
    expect(rejected.type).toBe("CommandRejected");
  });
});
