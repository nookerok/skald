import { describe, expect, it } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";
import { RuleEngine } from "@skald/rule-engine";
import {
  MASTER_TURN_AVAILABLE_ACTIONS,
  MASTER_TURN_MAX_TOPICS,
  WorldProjector,
  buildBootstrapEvents,
  buildMasterTurnSceneContext,
  buildNarrativeAdapterContext,
  createRules,
  getRegionEntrypoint,
  handleCommand,
  rebuildProjection,
} from "@skald/world";
import type { InteractionCommand } from "@skald/intent-parser";

function livingWorld() {
  const events = buildBootstrapEvents({
    templateId: "living_region",
    regionId: "riverwatch-basin",
    entrypointId: "river_waystation_arrival",
    backgroundId: "keeper",
  });
  const world = rebuildProjection(events).getSnapshot();
  const narrativeContext = buildNarrativeAdapterContext(events, world, {
    profile: { background_id: "keeper" },
    entrypoint: getRegionEntrypoint("river_waystation_arrival"),
    characterName: "Виктор",
  });
  return { events, world, narrativeContext };
}

function sceneJson(context: unknown): string {
  return JSON.stringify(context);
}

function event(type: string, eventId: string, payload: unknown, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "test", causationId: null };
}

function objectEvent(id: string, name: string, state: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}): DomainEvent {
  return event("WorldObjectPlaced", "boot-object-" + id, {
    id, name, aliases: [name], description: name, material: "wood",
    locationId: "camp", integrity: 100, temperature: 20, state, ...metadata,
  }, 0);
}

function campBootstrap(): DomainEvent[] {
  return [
    event("PlayerSpawned", "boot-player", { x: 0, y: 0 }, 0),
    event("LocationDefined", "boot-location", {
      id: "camp", name: "Лагерь", description: "Тихий лагерь.",
      objectIds: ["pouch", "pebble", "torch"], connections: {},
    }, 0),
    event("PlayerLocationChanged", "boot-location-player", { locationId: "camp" }, 0),
    objectEvent("pouch", "сумка", { open: true, portable: true, containerCapacityMass: 5 }, { mass: 1, portable: true, containerCapacity: 5 }),
    objectEvent("pebble", "камень", { portable: true }, { mass: 2, portable: true }),
    objectEvent("torch", "факел", { portable: true, affordances: ["ignite", "illuminate"] }, { mass: 1, portable: true, affordances: ["ignite", "illuminate"] }),
  ];
}

describe("master turn observer-safe scene context", () => {
  it("carries revision and location without internal identifiers", () => {
    const { events, world, narrativeContext } = livingWorld();
    const { context } = buildMasterTurnSceneContext(events, world, narrativeContext);

    expect(context.schemaVersion).toBe(1);
    expect(context.revision).toEqual({ worldTime: world.time, eventNumber: world.eventNumber });
    expect(context.currentLocation.name.length).toBeGreaterThan(0);
    expect(context.currentLocation.description.length).toBeGreaterThan(0);
    const json = sceneJson(context);
    expect(json).not.toContain("worldId");
    expect(json).not.toContain("locationId");
    expect(json).not.toContain("eventId");
    expect(json).not.toContain("sourceEventIds");
    expect(json).not.toContain("entityId");
    expect(json).not.toContain("confidence");
  });

  it("lists known people under transient refs that resolve server-side", () => {
    const { events, world, narrativeContext } = livingWorld();
    const { context, references } = buildMasterTurnSceneContext(events, world, narrativeContext);

    expect(context.knownPeople.length).toBeGreaterThan(0);
    for (const person of context.knownPeople) {
      expect(person.observerRef).toMatch(/^person_[1-9][0-9]?$/);
      const reference = references.get(person.observerRef);
      expect(reference?.kind).toBe("person");
      expect(reference?.label).toBe(person.label);
      expect(person.label.length).toBeGreaterThan(0);
    }
    const json = sceneJson(context);
    for (const reference of references.values()) {
      if (reference.kind === "person") expect(json).not.toContain(reference.internalId);
    }
  });

  it("lists accessible items with affordances and shared object refs", () => {
    const { events, world, narrativeContext } = livingWorld();
    const { context, references } = buildMasterTurnSceneContext(events, world, narrativeContext);

    expect(context.accessibleItems.length).toBeGreaterThan(0);
    const objectRefs = new Set(context.visibleObjects.map((object) => object.observerRef));
    for (const item of context.accessibleItems) {
      expect(item.observerRef).toMatch(/^object_[1-9][0-9]?$/);
      expect(item.affordances.length).toBeGreaterThan(0);
      expect(references.get(item.observerRef)?.kind).toBe("object");
      if (objectRefs.has(item.observerRef)) {
        expect(context.visibleObjects.find((object) => object.observerRef === item.observerRef)?.label).toBe(item.label);
      }
    }
    expect(sceneJson(context)).not.toContain("blockedAffordances");
  });

  it("hides unobserved objects placed at the current location", () => {
    const baseline = livingWorld();
    const hidden = event("WorldObjectPlaced", "hidden-object", {
      id: "hidden-object",
      name: "Скрытый ящик",
      aliases: ["ящик"],
      description: "Ящик, который пока не был замечен.",
      material: "wood",
      locationId: baseline.world.currentLocationId,
      integrity: 100,
      temperature: 20,
      state: { hidden: true, portable: true },
      mass: 1,
      portable: true,
    }, 0);
    const events = [...baseline.events, hidden];
    const { context } = buildMasterTurnSceneContext(events, rebuildProjection(events).getSnapshot(), baseline.narrativeContext);

    expect(context.visibleObjects.some((object) => object.label === "Скрытый ящик")).toBe(false);
    expect(sceneJson(context)).not.toContain("Скрытый ящик");
    expect(sceneJson(context)).not.toContain("hidden-object");
  });

  it("keeps foreign observations and unknown voices out of people and topics", () => {
    const baseline = livingWorld();
    const foreign: DomainEvent = {
      eventId: "foreign-voice",
      type: "EpistemicEvidenceRecorded",
      schemaVersion: 1,
      payload: { evidenceId: "foreign-voice", observerId: "archivist", proposition: "Тайный Владыка замышляет недоброе." },
      timestamp: 1,
      correlationId: "other",
      causationId: null,
    };
    const events = [...baseline.events, foreign];
    const { context } = buildMasterTurnSceneContext(events, rebuildProjection(events).getSnapshot(), baseline.narrativeContext);
    const json = sceneJson(context);

    expect(json).not.toContain("Тайный Владыка");
    expect(context.knownPeople.some((person) => person.label.includes("Владыка"))).toBe(false);
  });

  it("does not reveal items sealed inside a closed container", () => {
    const projection = new WorldProjector();
    const bus = new EventBus();
    const events: DomainEvent[] = [...campBootstrap()];
    for (const bootstrap of events) {
      projection.apply(bootstrap);
      bus.append(bootstrap);
    }
    const engine = new RuleEngine(createRules(), projection, bus);
    const take = (name: string, id: string, timestamp: number): void => {
      const command: InteractionCommand = {
        type: "InteractionCommand", verb: "take", target: { raw: name }, rawText: "take " + name,
        interpretation: { source: "deterministic", confidence: 1, ambiguities: [] },
      };
      events.push(...engine.process(handleCommand(command, id, timestamp)).committed);
    };
    // Torch carries affordances, so it is listed while accessible.
    take("факел", "take-torch", 1);
    events.push(...engine.process(event("InteractionValidated", "place-torch", {
      law: "containment", verb: "place", entityId: "torch", secondaryTarget: "сумка",
    }, 2)).committed);

    const openWorld = projection.getSnapshot();
    const openLabels = buildMasterTurnSceneContext(events, openWorld).context.accessibleItems.map((item) => item.label);
    expect(openLabels).toContain("факел");

    const closed = event("ContainerClosed", "close-pouch", { containerId: "pouch", subjectId: "player" }, 3);
    projection.apply(closed);
    events.push(closed);
    const closedLabels = buildMasterTurnSceneContext(events, projection.getSnapshot()).context.accessibleItems.map((item) => item.label);
    expect(closedLabels).not.toContain("факел");
  });

  it("exposes no coordinates, numeric relations or projection internals", () => {
    const { events, world, narrativeContext } = livingWorld();
    const json = sceneJson(buildMasterTurnSceneContext(events, world, narrativeContext).context);

    expect(json).not.toContain("\"x\":");
    expect(json).not.toContain("\"value\":");
    expect(json).not.toContain("heatMap");
    expect(json).not.toContain("currentLocationId");
    expect(json).not.toContain("observerId");
    expect(json).not.toContain("Canon");
  });

  it("strips situation identity down to player-facing prose", () => {
    const { events, world, narrativeContext } = livingWorld();
    const { context } = buildMasterTurnSceneContext(events, world, narrativeContext);

    if (context.currentSituation !== null) {
      expect(Object.keys(context.currentSituation).sort()).toEqual(["description", "title"]);
    } else {
      expect(context.currentSituation).toBeNull();
    }
  });

  it("bounds knowledge topics to closed categories and transient refs", () => {
    const { events, world, narrativeContext } = livingWorld();
    const { context, references } = buildMasterTurnSceneContext(events, world, narrativeContext);

    expect(context.knownTopics.length).toBeLessThanOrEqual(MASTER_TURN_MAX_TOPICS);
    for (const topic of context.knownTopics) {
      expect(topic.observerRef).toMatch(/^topic_[1-9][0-9]?$/);
      expect(["seen", "told", "inferred", "doubt"]).toContain(topic.category);
      expect(topic.text.length).toBeGreaterThan(0);
      expect(references.get(topic.observerRef)?.kind).toBe("topic");
    }
  });

  it("lists available actions from closed registries only", () => {
    const { events, world, narrativeContext } = livingWorld();
    const { context } = buildMasterTurnSceneContext(events, world, narrativeContext);

    expect(context.availableActions.length).toBeGreaterThan(0);
    expect(context.availableActions).toContainEqual({ kind: "journey", verb: "journey" });
    for (const action of context.availableActions) {
      expect(["interaction", "journey", "legacy"]).toContain(action.kind);
      expect(action.verb.length).toBeGreaterThan(0);
    }
    expect(MASTER_TURN_AVAILABLE_ACTIONS).toBe(context.availableActions);
    expect(Object.isFrozen(MASTER_TURN_AVAILABLE_ACTIONS)).toBe(true);
  });

  it("is deterministic and reference-complete across builds", () => {
    const { events, world, narrativeContext } = livingWorld();
    const first = buildMasterTurnSceneContext(events, world, narrativeContext);
    const second = buildMasterTurnSceneContext(events, world, narrativeContext);

    expect(sceneJson(second.context)).toBe(sceneJson(first.context));
    const usedRefs = new Set<string>();
    const collect = (observerRef: string): void => {
      usedRefs.add(observerRef);
    };
    for (const person of first.context.knownPeople) collect(person.observerRef);
    for (const object of first.context.visibleObjects) collect(object.observerRef);
    for (const route of first.context.knownRoutes) collect(route.observerRef);
    for (const item of first.context.accessibleItems) collect(item.observerRef);
    for (const topic of first.context.knownTopics) collect(topic.observerRef);
    for (const observerRef of usedRefs) {
      expect(first.references.has(observerRef)).toBe(true);
    }
    expect(Object.isFrozen(first.context)).toBe(true);
  });
});
