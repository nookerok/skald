import { describe, expect, it } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { RuleEngine } from "@skald/rule-engine";
import {
  WorldProjector,
  buildMasterTurnSceneContext,
  createRules,
} from "@skald/world";
import type { TurnProposalV2 } from "@skald/intent-parser";
import { validateMasterTurnPlan } from "../src/runtime/master-turn-validator.js";
import { executeMasterTurnPlan } from "../src/runtime/master-turn-executor.js";

function campEvent(type: string, eventId: string, payload: unknown, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "test", causationId: null };
}

function campObject(id: string, name: string, state: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}): DomainEvent {
  return campEvent("WorldObjectPlaced", "boot-object-" + id, {
    id, name, aliases: [name], description: name, material: "wood",
    locationId: "camp", integrity: 100, temperature: 20, state, ...metadata,
  }, 0);
}

function bootCamp() {
  const projection = new WorldProjector();
  const bus = new EventBus();
  const events: DomainEvent[] = [
    campEvent("PlayerSpawned", "boot-player", { x: 0, y: 0 }, 0),
    campEvent("LocationDefined", "boot-location", {
      id: "camp", name: "Лагерь", description: "Тихий лагерь у реки.",
      objectIds: ["pouch", "torch"], connections: {},
    }, 0),
    campEvent("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }, 0),
    campObject("pouch", "сумка", { open: true, portable: true, containerCapacityMass: 5 }, { mass: 1, portable: true, containerCapacity: 5 }),
    campObject("torch", "факел", { portable: true, affordances: ["ignite", "illuminate"] }, { mass: 1, portable: true, affordances: ["ignite", "illuminate"] }),
  ];
  for (const bootstrap of events) {
    projection.apply(bootstrap);
    bus.append(bootstrap);
  }
  const engine = new RuleEngine(createRules(), projection, bus);
  return { engine, projection, events };
}

function torchTarget() {
  const { engine, projection, events } = bootCamp();
  const world = projection.getSnapshot();
  const scene = buildMasterTurnSceneContext(events, world);
  const torch = scene.context.visibleObjects.find((object) => object.label === "факел");
  if (!torch) throw new Error("placed torch is not visible in the camp scene");
  return {
    engine,
    projection,
    events,
    world,
    scene,
    target: { role: "target" as const, observerRef: torch.observerRef, surface: torch.label },
  };
}

describe("master turn mixed execution", () => {
  it("executes one primary with a post-action question and a deferred clause", () => {
    const { engine, projection, events, world, scene, target } = torchTarget();
    const validated = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "mixed",
        primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваю факел" },
        supportingClauses: [{ kind: "deferred_action", summary: "осмотреть лагерь" }],
        target: { ...target },
        question: { queryId: "visible_scene" },
        referents: [{ ...target }],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "осматриваю факел и лагерь, что я вижу?",
    });
    expect(validated.status).toBe("accepted");
    if (validated.status !== "accepted") return;

    const result = executeMasterTurnPlan(validated.plan, scene, {
      engine,
      projection,
      events,
      worldId: "camp-test",
    });

    expect(result.status).toBe("executed");
    if (result.status !== "executed") return;
    expect(result.executed).toBe(true);
    expect(result.actionRejected).toBe(false);
    // Exactly one primary command root; the deferred action never runs.
    expect(result.commandEvents.filter((event) => event.type === "InteractionRequested")).toHaveLength(1);
    expect(result.commandEvents.some((event) => JSON.stringify(event.payload).includes("лагерь") && event.type === "InteractionRequested")).toBe(false);
    // At most one game tick for the whole mixed turn.
    expect(result.revisionAfter.worldTime - result.revisionBefore.worldTime).toBeLessThanOrEqual(1);
    expect(result.tickEvents.filter((event) => event.type === "TickPassed")).toHaveLength(1);
    // The question is answered, the deferred clause is preserved verbatim.
    expect(result.inquiryAnswer?.queryId).toBe("visible_scene");
    expect(result.inquiryAnswer?.answer.length).toBeGreaterThan(0);
    expect(result.deferred).toEqual([{ text: "осмотреть лагерь", reason: "secondary_action" }]);
    expect(result.postEvents.length).toBe(events.length + result.commandEvents.length + result.tickEvents.length);
  });

  it("answers the question from post-action state when the primary is rejected", () => {
    const { engine, projection, events } = bootCamp();
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const validated = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "mixed",
        primaryIntent: { kind: "journey", destination: { role: "destination", surface: "Неведомые земли" }, sourceText: "иду" },
        supportingClauses: [],
        question: { queryId: "visible_scene" },
        referents: [],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "иду в неведомые земли, что я вижу?",
    });
    expect(validated.status).toBe("accepted");
    if (validated.status !== "accepted") return;

    const result = executeMasterTurnPlan(validated.plan, scene, {
      engine,
      projection,
      events,
      worldId: "camp-test",
    });

    expect(result.status).toBe("executed");
    if (result.status !== "executed") return;
    expect(result.executed).toBe(true);
    expect(result.actionRejected).toBe(true);
    expect(result.commandEvents.map((event) => event.type)).toContain("JourneyBlocked");
    // The blocked journey moves nothing, but the question survives on actual post-state.
    const committed = [...result.commandEvents, ...result.tickEvents];
    expect(committed.some((event) => event.type === "PlayerLocationChanged")).toBe(false);
    expect(result.inquiryAnswer?.queryId).toBe("visible_scene");
  });

  it("answers inquiry-only plans without changing the world", () => {
    const { engine, projection, events } = bootCamp();
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const validated = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "inquiry",
        primaryIntent: { kind: "inquiry", queryId: "visible_scene", sourceText: "что я вижу" },
        supportingClauses: [],
        referents: [],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "что я вижу?",
    });
    expect(validated.status).toBe("accepted");
    if (validated.status !== "accepted") return;

    const before = projection.getSnapshot();
    const result = executeMasterTurnPlan(validated.plan, scene, {
      engine,
      projection,
      events,
      worldId: "camp-test",
    });

    expect(result.status).toBe("executed");
    if (result.status !== "executed") return;
    expect(result.executed).toBe(false);
    expect(result.commandEvents).toEqual([]);
    expect(result.tickEvents).toEqual([]);
    expect(result.inquiryAnswer?.queryId).toBe("visible_scene");
    const after = projection.getSnapshot();
    expect(after.eventNumber).toBe(before.eventNumber);
    expect(after.time).toBe(before.time);
  });

  it("executes nothing for a stale plan", () => {
    const { engine, projection, events } = bootCamp();
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const torch = scene.context.visibleObjects.find((object) => object.label === "факел");
    if (!torch) throw new Error("placed torch is not visible in the camp scene");
    const validated = validateMasterTurnPlan({
      proposal: {
        schemaVersion: 2,
        kind: "action",
        primaryIntent: { kind: "interaction", verb: "observe", sourceText: "осматриваю" },
        supportingClauses: [],
        target: { role: "target", observerRef: torch.observerRef, surface: torch.label },
        referents: [{ role: "target", observerRef: torch.observerRef, surface: torch.label }],
      } as TurnProposalV2,
      scene,
      world,
      rawText: "осматриваю факел",
    });
    expect(validated.status).toBe("accepted");
    if (validated.status !== "accepted") return;

    projection.apply(campEvent("TickPassed", "tick-away", { delta: 5 }, 5));
    projection.apply(campEvent("PlayerLocationChanged", "move-away", { locationId: "far-away" }, 6));
    const before = projection.getSnapshot();
    const result = executeMasterTurnPlan(validated.plan, scene, {
      engine,
      projection,
      events,
      worldId: "camp-test",
    });

    expect(result.status).toBe("stale");
    if (result.status !== "stale") return;
    expect(result.question.length).toBeGreaterThan(0);
    const after = projection.getSnapshot();
    expect(after.eventNumber).toBe(before.eventNumber);
    expect(after.time).toBe(before.time);
  });
});
