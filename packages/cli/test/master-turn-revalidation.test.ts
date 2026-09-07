import { describe, expect, it } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { RuleEngine } from "@skald/rule-engine";
import {
  WorldProjector,
  buildMasterTurnSceneContext,
  createRules,
  handleCommand,
} from "@skald/world";
import type { InteractionCommand } from "@skald/intent-parser";
import type { ValidatedMasterTurnPlan } from "../src/runtime/master-turn-validator.js";
import { revalidateMasterTurnPlan } from "../src/runtime/master-turn-revalidation.js";

function campEvent(type: string, eventId: string, payload: unknown, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "test", causationId: null };
}

function campObject(id: string, name: string, state: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}): DomainEvent {
  return campEvent("WorldObjectPlaced", "boot-object-" + id, {
    id, name, aliases: [name], description: name, material: "wood",
    locationId: "camp", integrity: 100, temperature: 20, state, ...metadata,
  }, 0);
}

function campBootstrap(): DomainEvent[] {
  return [
    campEvent("PlayerSpawned", "boot-player", { x: 0, y: 0 }, 0),
    campEvent("LocationDefined", "boot-location", {
      id: "camp", name: "Лагерь", description: "Тихий лагерь.",
      objectIds: ["pouch", "torch"], connections: {},
    }, 0),
    campEvent("LocationDefined", "boot-grove", {
      id: "grove", name: "Роща", description: "Тихая роща.",
      objectIds: [], connections: {},
    }, 0),
    campEvent("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }, 0),
    campObject("pouch", "сумка", { open: true, portable: true, containerCapacityMass: 5 }, { mass: 1, portable: true, containerCapacity: 5 }),
    campObject("torch", "факел", { portable: true, affordances: ["ignite", "illuminate"] }, { mass: 1, portable: true, affordances: ["ignite", "illuminate"] }),
  ];
}

function bootCamp() {
  const projection = new WorldProjector();
  const events: DomainEvent[] = [...campBootstrap()];
  for (const bootstrap of events) projection.apply(bootstrap);
  return { projection, events };
}

function observePlan(
  surface: string,
  revision: { readonly worldTime: number; readonly eventNumber: number },
  focus: ValidatedMasterTurnPlan["focus"] = [],
): ValidatedMasterTurnPlan {
  return {
    contextRevision: revision,
    kind: "action",
    execution: {
      intent: {
        type: "InteractionCommand",
        verb: "observe",
        target: { raw: surface },
        rawText: "осматриваю",
        interpretation: { source: "llm", confidence: 1, ambiguities: [] },
      },
    },
    postActionInquiry: null,
    metaInquiry: null,
    deferredClauses: [],
    focus,
  };
}

describe("master turn queue revalidation", () => {
  it("stays fresh on an unchanged revision without touching the model", () => {
    const { projection, events } = bootCamp();
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const torch = scene.context.visibleObjects.find((object) => object.label === "факел");
    if (!torch) throw new Error("placed torch is not visible in the camp scene");
    const plan = observePlan(torch.label, { worldTime: world.time, eventNumber: world.eventNumber }, [
      { observerRef: torch.observerRef, surface: torch.label, kind: "target" },
    ]);

    const result = revalidateMasterTurnPlan({ plan, scene, world });

    expect(result).toEqual({ status: "fresh" });
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("rechecks an intact target after an unrelated tick", () => {
    const { projection, events } = bootCamp();
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const torch = scene.context.visibleObjects.find((object) => object.label === "факел");
    if (!torch) throw new Error("placed torch is not visible in the camp scene");
    const plan = observePlan(torch.label, { worldTime: world.time, eventNumber: world.eventNumber }, [
      { observerRef: torch.observerRef, surface: torch.label, kind: "target" },
    ]);

    projection.apply(campEvent("TickPassed", "tick-1", { delta: 1 }, 1));
    const result = revalidateMasterTurnPlan({ plan, scene, world: projection.getSnapshot() });

    expect(result).toEqual({ status: "rechecked" });
  });

  it("goes stale when the target leaves with the player", () => {
    const { projection, events } = bootCamp();
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const plan = observePlan("факел", { worldTime: world.time, eventNumber: world.eventNumber }, []);

    projection.apply(campEvent("PlayerLocationChanged", "move-grove", { locationId: "grove" }, 1));
    const result = revalidateMasterTurnPlan({ plan, scene, world: projection.getSnapshot() });

    expect(result.status).toBe("stale");
    if (result.status !== "stale") return;
    expect(result.question.length).toBeGreaterThan(0);
    expect(result.options.length).toBeGreaterThan(0);
  });

  it("goes stale when another identity matches the bound name", () => {
    const { projection, events } = bootCamp();
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const torch = scene.context.visibleObjects.find((object) => object.label === "факел");
    if (!torch) throw new Error("placed torch is not visible in the camp scene");
    const plan = observePlan(torch.label, { worldTime: world.time, eventNumber: world.eventNumber }, [
      { observerRef: torch.observerRef, surface: torch.label, kind: "target" },
    ]);

    const original = world.objects.get("torch");
    if (!original) throw new Error("torch object is missing");
    const objects = new Map(world.objects);
    objects.set("torch", { ...original, name: "лампа", aliases: [] });
    objects.set("fake-torch", { ...original, id: "fake-torch", name: "факел", aliases: [] });
    const camp = world.locations.get("camp");
    if (!camp) throw new Error("camp location is missing");
    const locations = new Map(world.locations);
    locations.set("camp", { ...camp, objectIds: [...camp.objectIds.filter((id) => id !== "torch"), "fake-torch"] });
    const rebound = { ...world, objects, locations, eventNumber: world.eventNumber + 1 };

    const result = revalidateMasterTurnPlan({ plan, scene, world: rebound });

    expect(result.status).toBe("stale");
  });

  it("goes stale with resolver candidates when twins appear", () => {
    const { projection, events } = bootCamp();
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const plan = observePlan("Тестовый камень", { worldTime: world.time, eventNumber: world.eventNumber }, []);
    for (const index of [1, 2]) {
      projection.apply(campObject(`twin-${index}`, "Тестовый камень", {}, { mass: 1 }));
    }

    const result = revalidateMasterTurnPlan({ plan, scene, world: projection.getSnapshot() });

    expect(result.status).toBe("stale");
    if (result.status !== "stale") return;
    expect(result.options.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps inquiry-only plans fresh on any revision", () => {
    const { projection, events } = bootCamp();
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const plan: ValidatedMasterTurnPlan = {
      contextRevision: { worldTime: world.time, eventNumber: world.eventNumber },
      kind: "inquiry",
      execution: null,
      postActionInquiry: {
        type: "InquiryRequest",
        queryId: "visible_scene",
        rawText: "что я вижу?",
        confidence: 1,
        source: "llm",
      },
      metaInquiry: null,
      deferredClauses: [],
      focus: [],
    };

    projection.apply(campEvent("TickPassed", "tick-1", { delta: 1 }, 1));
    projection.apply(campEvent("PlayerLocationChanged", "move-grove", { locationId: "grove" }, 2));
    const result = revalidateMasterTurnPlan({ plan, scene, world: projection.getSnapshot() });

    expect(result).toEqual({ status: "fresh" });
  });

  it("rechecks surface-only destinations and blocks forgotten routes", () => {
    const { projection, events } = bootCamp();
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const journey = (destination: string): ValidatedMasterTurnPlan => ({
      contextRevision: { worldTime: world.time, eventNumber: world.eventNumber },
      kind: "action",
      execution: {
        intent: {
          type: "JourneyIntent",
          destination: { raw: destination },
          rawText: "иду",
          interpretation: { source: "llm", confidence: 1, ambiguities: [] },
        },
      },
      postActionInquiry: null,
      metaInquiry: null,
      deferredClauses: [],
      focus: [],
    });

    projection.apply(campEvent("TickPassed", "tick-1", { delta: 1 }, 1));
    const moved = projection.getSnapshot();
    expect(revalidateMasterTurnPlan({ plan: journey("Роща"), scene, world: moved })).toEqual({ status: "rechecked" });

    const routedScene = {
      context: scene.context,
      references: new Map([
        ...scene.references,
        ["route_1", { kind: "route", internalId: "rel-forgotten", label: "Переправа" } as const],
      ]),
    };
    const routed: ValidatedMasterTurnPlan = {
      ...journey("Переправа"),
      focus: [{ observerRef: "route_1", surface: "Переправа", kind: "destination" }],
    };
    expect(revalidateMasterTurnPlan({ plan: routed, scene: routedScene, world: moved }).status).toBe("stale");
  });

  it("rechecks ambient observation without a target", () => {
    const { projection, events } = bootCamp();
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const plan: ValidatedMasterTurnPlan = {
      contextRevision: { worldTime: world.time, eventNumber: world.eventNumber },
      kind: "action",
      execution: {
        intent: {
          type: "InteractionCommand",
          verb: "observe",
          rawText: "осматриваюсь",
          interpretation: { source: "llm", confidence: 1, ambiguities: [] },
        },
      },
      postActionInquiry: null,
      metaInquiry: null,
      deferredClauses: [],
      focus: [],
    };

    projection.apply(campEvent("TickPassed", "tick-1", { delta: 1 }, 1));
    expect(revalidateMasterTurnPlan({ plan, scene, world: projection.getSnapshot() })).toEqual({ status: "rechecked" });
  });

  it("blocks an item sealed after the scene snapshot", () => {
    const projection = new WorldProjector();
    const bus = new EventBus();
    const events: DomainEvent[] = [...campBootstrap()];
    for (const bootstrap of events) {
      projection.apply(bootstrap);
      bus.append(bootstrap);
    }
    const engine = new RuleEngine(createRules(), projection, bus);
    const take: InteractionCommand = {
      type: "InteractionCommand", verb: "take", target: { raw: "факел" }, rawText: "take факел",
      interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
    };
    events.push(...engine.process(handleCommand(take, "take-torch", 1)).committed);
    events.push(...engine.process(campEvent("InteractionValidated", "place-torch", {
      law: "containment", verb: "place", entityId: "torch", secondaryTarget: "сумка",
    }, 2)).committed);
    const world = projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(events, world);
    const torch = scene.context.accessibleItems.find((item) => item.label === "факел");
    if (!torch) throw new Error("torch is not accessible in the open-container scene");
    const plan = observePlan(torch.label, { worldTime: world.time, eventNumber: world.eventNumber }, [
      { observerRef: torch.observerRef, surface: torch.label, kind: "target" },
    ]);

    projection.apply(campEvent("ContainerClosed", "close-pouch", { containerId: "pouch", subjectId: "player" }, 3));
    const result = revalidateMasterTurnPlan({ plan, scene, world: projection.getSnapshot() });

    expect(result.status).toBe("stale");
  });
});
