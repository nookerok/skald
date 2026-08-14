import { describe, expect, it } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { RuleEngine } from "@skald/rule-engine";
import {
  WorldProjector,
  assessCapability,
  buildBeliefModel,
  createRules,
  handleCommand,
  isItemAccessible,
  type ReadonlyWorld,
} from "@skald/world";
import type { InteractionCommand } from "@skald/intent-parser";

function event(type: string, eventId: string, payload: unknown, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "test", causationId: null };
}

function objectEvent(
  id: string,
  name: string,
  state: Record<string, unknown> = {},
  metadata: Record<string, unknown> = {},
): DomainEvent {
  return event("WorldObjectPlaced", "boot-object-" + id, {
    id, name, aliases: [name], description: name, material: id === "pouch" ? "fabric" : "wood",
    locationId: "camp", integrity: 100, temperature: 20, state, ...metadata,
  }, 0);
}

function testBootstrap(): DomainEvent[] {
  return [
    event("PlayerSpawned", "boot-player", { x: 0, y: 0 }, 0),
    event("LocationDefined", "boot-location", {
      id: "camp", name: "Camp", description: "A quiet camp.",
      objectIds: ["pouch", "pebble", "torch", "grass", "crystal", "warden"], connections: {},
    }, 0),
    event("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }, 0),
    objectEvent("pouch", "pouch", { open: true, portable: true, containerCapacityMass: 5 }, { mass: 1, portable: true, containerCapacity: 5 }),
    objectEvent("pebble", "pebble", { portable: true }, { mass: 2, portable: true }),
    objectEvent("torch", "torch", { portable: true, affordances: ["ignite", "illuminate"] }, { mass: 1, portable: true, affordances: ["ignite", "illuminate"] }),
    objectEvent("grass", "dry grass", { flammable: true }),
    objectEvent("crystal", "unknown crystal", { phenomenon: true, affordances: ["experiment"] }, { affordances: ["experiment"] }),
    objectEvent("warden", "warden", {}),
  ];
}

function runtime(): { engine: RuleEngine<ReadonlyWorld>; projection: WorldProjector; bus: EventBus } {
  const projection = new WorldProjector();
  const bus = new EventBus();
  for (const bootstrap of testBootstrap()) {
    projection.apply(bootstrap);
    bus.append(bootstrap);
  }
  return { engine: new RuleEngine(createRules(), projection, bus), projection, bus };
}

function takeCommand(name: string, id: string, timestamp: number): DomainEvent {
  const command: InteractionCommand = {
    type: "InteractionCommand", verb: "take", target: { raw: name }, rawText: "take " + name,
    interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
  };
  return handleCommand(command, id, timestamp);
}

function useEvent(target: string, instrument: string, goal: string, id: string, timestamp: number, claimId?: string): DomainEvent {
  return event("ActionValidated", id, {
    originalPayload: {
      operation: "use",
      mode: "interact",
      target: { raw: target },
      instrument: { raw: instrument },
      goal,
      ...(claimId ? { claimId } : {}),
    },
  }, timestamp);
}

describe("Action Capability and Epistemic Model", () => {
  it("S1 picks up an accessible portable item and records possession", () => {
    const { engine, projection } = runtime();
    const result = engine.process(takeCommand("pebble", "s1", 1));
    expect(result.committed.map((item) => item.type)).toEqual(expect.arrayContaining(["InteractionRequested", "ItemMoved", "ItemPossessionChanged"]));
    expect(projection.getSnapshot().actionCapabilities?.placements.get("pebble")).toEqual({ kind: "carried", holderId: "player" });
    expect(projection.getSnapshot().actionCapabilities?.owners.get("pebble")).toBe("player");
  });

  it("possession law transfers a carried item to an accessible recipient", () => {
    const { engine, projection } = runtime();
    engine.process(takeCommand("pebble", "give-take", 1));
    const command: InteractionCommand = {
      type: "InteractionCommand",
      verb: "give",
      target: { raw: "pebble" },
      secondaryTarget: { raw: "warden" },
      rawText: "give pebble warden",
      interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
    };
    const result = engine.process(handleCommand(command, "give", 2));
    expect(result.committed.some((item) => item.type === "ItemPossessionChanged")).toBe(true);
    expect(projection.getSnapshot().actionCapabilities?.placements.get("pebble")).toEqual({ kind: "carried", holderId: "warden" });
    expect(projection.getSnapshot().actionCapabilities?.owners.get("pebble")).toBe("warden");
  });

  it("S2 stores and S3 retrieves an item through an open container", () => {
    const { engine, projection } = runtime();
    engine.process(takeCommand("pebble", "s2-take", 1));
    const stored = engine.process(event("ActionValidated", "s2-place", {
      originalPayload: { operation: "place", target: { raw: "pebble" }, secondaryTarget: { raw: "pouch" } },
    }, 2));
    expect(stored.committed.some((item) => item.type === "ItemMoved")).toBe(true);
    expect(projection.getSnapshot().actionCapabilities?.placements.get("pebble")).toEqual({ kind: "container", containerId: "pouch" });
    expect(isItemAccessible(projection.getSnapshot(), "player", "pebble")).toBe(true);
    const retrieved = engine.process(takeCommand("pebble", "s3-retrieve", 3));
    expect(retrieved.committed.some((item) => item.type === "ItemPossessionChanged")).toBe(true);
    expect(projection.getSnapshot().actionCapabilities?.placements.get("pebble")).toEqual({ kind: "carried", holderId: "player" });
  });

  it("closed containment is not accessible to retrieval", () => {
    const { engine, projection } = runtime();
    engine.process(takeCommand("pebble", "closed-take", 1));
    engine.process(event("ActionValidated", "closed-place", {
      originalPayload: { operation: "place", target: { raw: "pebble" }, secondaryTarget: { raw: "pouch" } },
    }, 2));
    projection.apply(event("ContainerClosed", "closed-pouch", { containerId: "pouch", subjectId: "player" }, 3));
    const result = engine.process(takeCommand("pebble", "closed-retrieve", 4));
    expect(result.committed.some((item) => item.type === "ItemMoved")).toBe(false);
    expect(projection.getSnapshot().actionCapabilities?.placements.get("pebble")).toEqual({ kind: "container", containerId: "pouch" });
  });

  it("S4 uses an instrument through affordance validation and emits outcome evidence", () => {
    const { engine, projection } = runtime();
    engine.process(takeCommand("torch", "s4-take", 1));
    const result = engine.process(useEvent("dry grass", "torch", "ignite", "s4-use", 2));
    expect(result.committed.map((item) => item.type)).toEqual(expect.arrayContaining(["ItemUsed", "ProficiencyEvidenceRecorded", "ObjectTemperatureChanged"]));
    expect(projection.getSnapshot().objects.get("grass")?.temperature).toBe(50);
  });

  it("S5 derives capability from evidence without storing a numeric proficiency level", () => {
    const { projection } = runtime();
    const before = assessCapability(projection.getSnapshot(), { subjectId: "player", affordance: "ignite", instrumentId: "torch" });
    expect(before.canPerform).toBe(false);
    projection.apply(event("ItemMoved", "evidence-move", { itemId: "torch", from: { kind: "location", locationId: "camp" }, to: { kind: "carried", holderId: "player" } }, 1));
    projection.apply(event("ProficiencyEvidenceRecorded", "evidence-1", { evidenceId: "evidence-1", subjectId: "player", affordance: "ignite", contextTags: [], outcome: "achieved" }, 2));
    const after = assessCapability(projection.getSnapshot(), { subjectId: "player", affordance: "ignite", instrumentId: "torch" });
    expect(after.canPerform).toBe(true);
    expect("skillLevel" in (projection.getSnapshot().actionCapabilities as object)).toBe(false);
    expect("proficiency" in (projection.getSnapshot().actionCapabilities as object)).toBe(false);
  });

  it("S6 conditions block an affordance instead of applying a numeric penalty", () => {
    const { engine } = runtime();
    engine.process(takeCommand("torch", "s6-take", 1));
    engine.process(event("ConditionApplied", "condition-1", {
      conditionId: "condition-1", subjectId: "player", kind: "injured-hand", blockedAffordances: ["ignite"], unavailableTechniques: [],
    }, 2));
    const result = engine.process(useEvent("dry grass", "torch", "ignite", "s6-use", 3));
    expect(result.committed.some((item) => item.type === "ActionRejected")).toBe(true);
    expect(result.committed.some((item) => item.type === "ItemUsed")).toBe(false);
  });

  it("S7 keeps knowledge independent from proficiency evidence", () => {
    const { engine, projection } = runtime();
    projection.apply(event("ItemMoved", "knowledge-move", { itemId: "torch", from: { kind: "location", locationId: "camp" }, to: { kind: "carried", holderId: "player" } }, 1));
    engine.process(event("KnowledgeAcquired", "knowledge-1", { subjectId: "player", knowledgeId: "ignite-procedure" }, 2));
    const knownOnly = assessCapability(projection.getSnapshot(), { subjectId: "player", affordance: "ignite", instrumentId: "torch", requiredKnowledgeId: "ignite-procedure" });
    expect(knownOnly.canPerform).toBe(false);
    projection.apply(event("ProficiencyEvidenceRecorded", "knowledge-evidence", { evidenceId: "knowledge-evidence", subjectId: "player", affordance: "ignite", contextTags: [], outcome: "achieved" }, 3));
    expect(assessCapability(projection.getSnapshot(), { subjectId: "player", affordance: "ignite", instrumentId: "torch", requiredKnowledgeId: "ignite-procedure" }).canPerform).toBe(true);
  });

  it("S8 retains false testimony and revises only the epistemic claim", () => {
    const { projection } = runtime();
    const before = projection.getSnapshot().objects.get("grass");
    projection.apply(event("TestimonyReceived", "testimony-1", { claimId: "claim-bridge", observerId: "player", sourceId: "npc-1", proposition: "bridge is intact" }, 1));
    expect(projection.getSnapshot().actionCapabilities?.claims.get("claim-bridge")?.status).toBe("testimony_only");
    expect(projection.getSnapshot().objects.get("grass")).toEqual(before);
    projection.apply(event("ObservationRecorded", "observation-bridge", { observerId: "player", targetId: "bridge" }, 2));
    projection.apply(event("EpistemicEvidenceRecorded", "contradiction-1", { claimId: "claim-bridge", evidenceId: "observation-bridge", relation: "contradicts" }, 2));
    const claim = projection.getSnapshot().actionCapabilities?.claims.get("claim-bridge");
    expect(claim?.status).toBe("contradicted");
    expect(claim?.evidenceIds).toEqual(["observation-bridge"]);
  });

  it("S9 observes and experiments with an unknown phenomenon through ordinary interactions", () => {
    const { engine, projection } = runtime();
    const observed = engine.process(event("EntityExamined", "phenomenon-examine", { entityId: "crystal" }, 1));
    expect(observed.committed.some((item) => item.type === "PhenomenonObserved")).toBe(true);
    const interacted = engine.process(useEvent("unknown crystal", "unknown crystal", "experiment", "phenomenon-use", 2, "phenomenon:crystal"));
    expect(interacted.committed.map((item) => item.type)).toEqual(expect.arrayContaining(["ItemUsed", "PhenomenonInteracted", "ProficiencyEvidenceRecorded", "EpistemicEvidenceRecorded"]));
    expect(interacted.committed.some((item) => item.type === "MagicSystem")).toBe(false);
    expect(projection.getSnapshot().actionCapabilities?.claims.get("phenomenon:crystal")?.status).toBe("supported");
  });

  it("routes testimony and observation evidence into the existing BeliefModel", () => {
    const { engine, projection, bus } = runtime();
    engine.process(event("RumorHeard", "testimony-pipeline", {
      rumorRef: "claim-bridge",
      observerId: "player",
      sourceLabel: "npc-1",
      text: "bridge is intact",
    }, 1));
    const observed = engine.process(event("ObjectObserved", "bridge-observation", {
      objectId: "grass",
      claimId: "claim-bridge",
      relation: "contradicts",
      observerId: "player",
    }, 2));
    expect(observed.committed.some((item) => item.type === "EpistemicEvidenceRecorded")).toBe(true);
    expect(projection.getSnapshot().actionCapabilities?.claims.get("claim-bridge")?.status).toBe("contradicted");
    const model = buildBeliefModel(bus.query(), projection.getSnapshot());
    expect(model.beliefs.get("claim:claim-bridge")?.supportingEvidence).toHaveLength(2);
    expect(model.contradictions.some((item) => item.involvedEvidenceIds.some((id) => id.includes("bridge-observation")))).toBe(true);
  });

  it("replay rebuilds the same capability projection and snapshots are immutable", () => {
    const { projection, bus } = runtime();
    const moved = event("ItemMoved", "replay-move", { itemId: "pebble", from: { kind: "location", locationId: "camp" }, to: { kind: "carried", holderId: "player" } }, 1);
    projection.apply(moved);
    const snapshot = projection.getSnapshot();
    expect(() => (snapshot.actionCapabilities?.placements as Map<string, unknown>).set("x", {})).toThrow("immutable");
    const rebuilt = new WorldProjector();
    for (const logged of [...bus.query(), moved]) rebuilt.apply(logged);
    const normalize = (view: NonNullable<ReadonlyWorld["actionCapabilities"]>) => ({
      itemDefinitions: [...view.itemDefinitions],
      placements: [...view.placements],
      owners: [...view.owners],
      conditions: [...view.conditions],
      knowledge: [...view.knowledge].map(([id, values]) => [id, [...values]]),
      proficiencyEvidence: [...view.proficiencyEvidence],
      claims: [...view.claims],
    });
    expect(normalize(rebuilt.getSnapshot().actionCapabilities!)).toEqual(normalize(snapshot.actionCapabilities!));
  });
});
