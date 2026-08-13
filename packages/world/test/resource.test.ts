import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import {
  WorldProjector,
  buildObservedResources,
  handleResourceConsumeCommand,
  handleResourceExtractionCommand,
  handleResourceTransferCommand,
  handleResourceProcessCommand,
  resourceConsume,
  resourceExtraction,
  resourceRegeneration,
  resourceTransfer,
  resourceProcessStart,
  resourceProcessCompletion, resourceDemandProcess,
} from "@skald/world";

function event(type: string, payload: Record<string, unknown>, timestamp = 0): DomainEvent {
  return { eventId: `test#${type}#${timestamp}`, type, schemaVersion: 1, payload, timestamp, correlationId: "test", causationId: null } as DomainEvent;
}

const definition = {
  id: "resource.blackwood_timber",
  resourceKind: "timber",
  sourceModel: "renewable",
  locationId: "blackwood_edge",
  capacityUnits: 100,
  initialStockUnits: 100,
  quality: "common",
  extractionMethods: [{ id: "manual_felling", maximumPerAction: 5, difficulty: 1 }],
  regeneration: { model: "interval", intervalWorldTime: 24, amountUnits: 2, maximumUnits: 100, blockedBy: [{ situationType: "forest_fire", scope: "same_location" }], pauseWhileBlocked: true },
  canonicalRefs: ["regions.pilot-region.history.f1"],
};

describe("resource nodes", () => {
  it("projects definition, transfers extraction into actor holdings and replays deterministically", () => {
    const projector = new WorldProjector();
    projector.apply(event("ResourceNodeDefined", definition));
    projector.apply(event("PlayerLocationChanged", { locationId: definition.locationId }));
    const request = handleResourceExtractionCommand({ type: "ResourceExtractionCommand", nodeId: definition.id, methodId: "manual_felling", requestedUnits: 12 }, "extract-1", 1);
    const produced = resourceExtraction.handle(request, projector.getSnapshot());
    expect(produced).toHaveLength(1);
    expect((produced[0]?.payload as { amountUnits: number }).amountUnits).toBe(5);
    projector.apply(request);
    projector.apply(produced[0]!);
    expect(projector.getSnapshot().resources?.states.get(definition.id)?.stockUnits).toBe(95);
    expect(projector.getSnapshot().resources?.holdings.get("player|timber|common")?.amountUnits).toBe(5);
    const replay = new WorldProjector();
    replay.apply(event("ResourceNodeDefined", definition));
    replay.apply(request);
    replay.apply(produced[0]!);
    expect(replay.getSnapshot().resources?.states.get(definition.id)).toEqual(projector.getSnapshot().resources?.states.get(definition.id));
    expect([...replay.getSnapshot().resources!.holdings]).toEqual([...projector.getSnapshot().resources!.holdings]);
  });

  it("pauses regeneration while local fire is active without catch-up", () => {
    const projector = new WorldProjector();
    projector.apply(event("ResourceNodeDefined", definition));
    projector.apply(event("PlayerLocationChanged", { locationId: definition.locationId }));
    const request = handleResourceExtractionCommand({ type: "ResourceExtractionCommand", nodeId: definition.id, methodId: "manual_felling", requestedUnits: 5 }, "extract-2", 1);
    projector.apply(request);
    projector.apply(resourceExtraction.handle(request, projector.getSnapshot())[0]!);
    const firstTick = event("TickPassed", {}, 25);
    const first = resourceRegeneration.handle(firstTick, projector.getSnapshot());
    expect(first).toHaveLength(1);
    projector.apply(first[0]!);
    projector.apply(event("SituationStarted", { situationId: "fire", type: "forest_fire", startedAt: 26, duration: 20, data: { locationId: definition.locationId } }, 26));
    const blocked = resourceRegeneration.handle(event("TickPassed", {}, 50), projector.getSnapshot());
    expect(blocked[0]?.type).toBe("ResourceRegenerationBlocked");
    projector.apply(blocked[0]!);
    projector.apply(event("SituationEnded", { situationId: "fire" }, 51));
    const resumed = resourceRegeneration.handle(event("TickPassed", {}, 74), projector.getSnapshot());
    expect(resumed).toHaveLength(1);
    expect((resumed[0]?.payload as { amountUnits: number }).amountUnits).toBe(2);
  });

  it("does not let a distant fire block a local node", () => {
    const projector = new WorldProjector();
    projector.apply(event("ResourceNodeDefined", definition));
    projector.apply(event("PlayerLocationChanged", { locationId: definition.locationId }));
    projector.apply(event("ResourceExtracted", { nodeId: definition.id, amountUnits: 5, actorId: "player" }, 1));
    projector.apply(event("SituationStarted", { situationId: "fire", type: "forest_fire", startedAt: 2, duration: 100, data: { locationId: "elsewhere" } }, 2));
    expect(resourceRegeneration.handle(event("TickPassed", {}, 25), projector.getSnapshot())[0]?.type).toBe("ResourceRegenerated");
  });

  it("returns a player-facing reason for extraction away from the resource", () => {
    const projector = new WorldProjector();
    projector.apply(event("ResourceNodeDefined", definition));
    projector.apply(event("PlayerLocationChanged", { locationId: "elsewhere" }));
    const request = handleResourceExtractionCommand({ type: "ResourceExtractionCommand", nodeId: definition.id, methodId: "manual_felling", requestedUnits: 1 }, "wrong-place", 1);
    const rejected = resourceExtraction.handle(request, projector.getSnapshot());
    expect(rejected[0]?.type).toBe("ResourceExtractionRejected");
    expect((rejected[0]?.payload as { reason: string }).reason).toBe("resource_not_here");
  });

  it("preserves quantities through transfer and explicit consumption", () => {
    const projector = new WorldProjector();
    projector.apply(event("ResourceNodeDefined", definition));
    projector.apply(event("PlayerLocationChanged", { locationId: definition.locationId }));
    const extraction = handleResourceExtractionCommand({ type: "ResourceExtractionCommand", nodeId: definition.id, methodId: "manual_felling", requestedUnits: 5 }, "extract-3", 1);
    projector.apply(extraction);
    projector.apply(resourceExtraction.handle(extraction, projector.getSnapshot())[0]!);
    const transfer = handleResourceTransferCommand({ type: "ResourceTransferCommand", fromOwnerId: "player", toOwnerId: "riverwatch-main", resourceKind: "timber", quality: "common", amountUnits: 3 }, "transfer-1", 2);
    const transferred = resourceTransfer.handle(transfer, projector.getSnapshot());
    expect(transferred[0]?.type).toBe("ResourceTransferred");
    projector.apply(transferred[0]!);
    expect(projector.getSnapshot().resources?.holdings.get("player|timber|common")?.amountUnits).toBe(2);
    expect(projector.getSnapshot().resources?.holdings.get("riverwatch-main|timber|common")?.amountUnits).toBe(3);
    const consume = handleResourceConsumeCommand({ type: "ResourceConsumeCommand", ownerId: "riverwatch-main", resourceKind: "timber", quality: "common", amountUnits: 2, reason: "heating" }, "consume-1", 3);
    const consumed = resourceConsume.handle(consume, projector.getSnapshot());
    expect(consumed[0]?.type).toBe("ResourceConsumed");
    projector.apply(consumed[0]!);
    expect(projector.getSnapshot().resources?.holdings.get("riverwatch-main|timber|common")?.amountUnits).toBe(1);
  });

  it("hides an unobserved node from the player-safe DTO", () => {
    const observedDefinition = { ...definition, id: "resource.hidden_herbs", resourceKind: "herbs", requiresObservation: true };
    const projector = new WorldProjector();
    projector.apply(event("ResourceNodeDefined", observedDefinition));
    projector.apply(event("PlayerLocationChanged", { locationId: definition.locationId }));
    expect(buildObservedResources(projector.getSnapshot())).toEqual([]);
    projector.apply(event("SpatialObservationRecorded", { subjectKind: "location", subjectId: definition.locationId, knowledge: "observed", observedAt: 1, confidence: 1, observerId: "player" }, 1));
    const dto = buildObservedResources(projector.getSnapshot());
    expect(dto[0]).toMatchObject({ name: "Травы", availability: "abundant", confidence: "probable" });
    expect(dto[0]).not.toHaveProperty("stockUnits");
    expect(dto[0]).not.toHaveProperty("nodeId");
  });

  it("rejects malformed extraction commands before state access", () => {
    const rejected = handleResourceExtractionCommand({ type: "ResourceExtractionCommand", nodeId: "", methodId: "manual_felling", requestedUnits: 1 }, "bad", 0);
    expect(rejected.type).toBe("CommandRejected");
  });

  it("runs a deterministic production process and preserves inputs until output", () => {
    const projector = new WorldProjector();
    projector.apply(event("ResourceNodeDefined", definition));
    projector.apply(event("ResourceProcessDefined", { id: "process.firewood", locationId: definition.locationId, durationWorldTime: 6, inputs: [{ resourceKind: "timber", quality: "common", amountUnits: 2 }], outputs: [{ resourceKind: "firewood", quality: "common", amountUnits: 1 }], canonicalRefs: [] }));
    projector.apply(event("PlayerLocationChanged", { locationId: definition.locationId }));
    const extraction = handleResourceExtractionCommand({ type: "ResourceExtractionCommand", nodeId: definition.id, methodId: "manual_felling", requestedUnits: 2 }, "process-extract", 1);
    projector.apply(extraction);
    projector.apply(resourceExtraction.handle(extraction, projector.getSnapshot())[0]!);
    const request = handleResourceProcessCommand({ type: "ResourceProcessCommand", processId: "process.firewood", ownerId: "player" }, "process-start", 2);
    const started = resourceProcessStart.handle(request, projector.getSnapshot());
    expect(started[0]?.type).toBe("ResourceProcessStarted");
    projector.apply(started[0]!);
    expect(projector.getSnapshot().resources?.holdings.get("player|timber|common")).toBeUndefined();
    expect(resourceProcessCompletion.handle(event("TickPassed", {}, 7), projector.getSnapshot())).toEqual([]);
    const completed = resourceProcessCompletion.handle(event("TickPassed", {}, 8), projector.getSnapshot());
    expect(completed[0]?.type).toBe("ResourceProcessCompleted");
    projector.apply(completed[0]!);
    expect(projector.getSnapshot().resources?.holdings.get("player|firewood|common")?.amountUnits).toBe(1);

  });
  it("emits shortage when a demand cannot be fulfilled", () => {
    const projector = new WorldProjector();
    projector.apply(event("ResourceDemandDefined", { id: "demand.firewood", ownerId: "riverwatch-main", resourceKind: "firewood", quality: "common", amountPerInterval: 1, intervalWorldTime: 4, canonicalRefs: [] }));
    projector.apply(event("TickPassed", {}, 4));
    const emitted = resourceDemandProcess.handle(event("TickPassed", {}, 8), projector.getSnapshot());
    expect(emitted.some((entry) => entry.type === "ResourceShortageStarted")).toBe(true);
  });
});
