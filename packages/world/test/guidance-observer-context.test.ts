import { describe, expect, it } from "vitest";
import {
  buildBootstrapEvents,
  buildNarrativeAdapterContext,
  buildObserverGuidanceContext,
  selectTurnPresentation,
  buildPlayerGuidance,
  getRegionEntrypoint,
  rebuildProjection,
} from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";

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

describe("observer-safe guidance context", () => {
  it("uses only grounded local facts and authored hook", () => {
    const { world, narrativeContext } = livingWorld();
    const context = buildObserverGuidanceContext(livingWorld().events, world, narrativeContext);
    expect(context.personalHook).toContain("Переправа");
    expect(context.knownContacts.map((contact) => contact.label).join(" ")).toContain("Архивист");
    expect(context.accessibleItems.map((item) => item.label).join(" ")).toContain("Письменные");
    const guidance = buildPlayerGuidance(livingWorld().events, world, narrativeContext);
    expect(JSON.stringify(guidance)).not.toContain("contact:riverwatch-archivist");
    expect(JSON.stringify(guidance)).not.toContain("eventId");
    expect(Object.isFrozen(context)).toBe(true);
  });

  it("does not use another observer's evidence", () => {
    const { world } = livingWorld();
    const otherEvidence: DomainEvent = {
      eventId: "other-evidence",
      type: "EpistemicEvidenceRecorded",
      schemaVersion: 1,
      payload: { evidenceId: "other-evidence", observerId: "archivist", proposition: "Дальний пожар." },
      timestamp: 1,
      correlationId: "other",
      causationId: null,
    };
    const events = [...livingWorld().events, otherEvidence];
    const context = buildObserverGuidanceContext(events, rebuildProjection(events).getSnapshot());
    expect(JSON.stringify(context)).not.toContain("Дальний пожар");
    const baseline = buildObserverGuidanceContext(livingWorld().events, livingWorld().world);
    expect(context).toEqual(baseline);
    expect(world.time).toBe(0);
  });

  it("does not treat an unobserved object at the current location as visible", () => {
    const baseline = livingWorld();
    const hiddenObject: DomainEvent = {
      eventId: "hidden-object",
      type: "WorldObjectPlaced",
      schemaVersion: 1,
      payload: {
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
      },
      timestamp: 0,
      correlationId: "bootstrap",
      causationId: null,
    };
    const events = [...baseline.events, hiddenObject];
    const context = buildObserverGuidanceContext(events, rebuildProjection(events).getSnapshot());
    expect(context.observedObjects.some((object) => object.id === "hidden-object")).toBe(false);
  });

  it("accepts an object only after player-scoped observation evidence", () => {
    const baseline = livingWorld();
    const hiddenObject: DomainEvent = {
      eventId: "hidden-object",
      type: "WorldObjectPlaced",
      schemaVersion: 1,
      payload: {
        id: "hidden-object",
        name: "Скрытый ящик",
        aliases: ["ящик"],
        description: "Ящик, который удалось заметить.",
        material: "wood",
        locationId: baseline.world.currentLocationId,
        integrity: 100,
        temperature: 20,
        state: { hidden: true, portable: true },
        mass: 1,
        portable: true,
      },
      timestamp: 0,
      correlationId: "bootstrap",
      causationId: null,
    };
    const observed: DomainEvent = {
      eventId: "observe-hidden-object",
      type: "ObjectObserved",
      schemaVersion: 1,
      payload: { objectId: "hidden-object", observerId: "player" },
      timestamp: 1,
      correlationId: "observe",
      causationId: null,
    };
    const events = [...baseline.events, hiddenObject, observed];
    const context = buildObserverGuidanceContext(events, rebuildProjection(events).getSnapshot());
    expect(context.observedObjects.some((object) => object.id === "hidden-object")).toBe(true);
  });

  it("does not expose an active situation without local observer evidence", () => {
    const baseline = livingWorld();
    const situation: DomainEvent = {
      eventId: "forest-fire-started",
      type: "SituationStarted",
      schemaVersion: 1,
      payload: { situationId: "forest_fire", type: "forest_fire", startedAt: 1, duration: 8, data: {} },
      timestamp: 1,
      correlationId: "world-process",
      causationId: null,
    };
    const events = [...baseline.events, situation];
    const context = buildObserverGuidanceContext(events, rebuildProjection(events).getSnapshot());
    expect(context.activeSituation?.situationId).not.toBe("forest_fire");
  });

  it("accepts an active situation when the selected presentation is observer-scoped", () => {
    const baseline = livingWorld();
    const situation: DomainEvent = {
      eventId: "forest-fire-started",
      type: "SituationStarted",
      schemaVersion: 1,
      payload: { situationId: "forest_fire", type: "forest_fire", startedAt: 1, duration: 8, data: {} },
      timestamp: 1,
      correlationId: "world-process",
      causationId: null,
    };
    const observation: DomainEvent = {
      eventId: "fire-observation",
      type: "ObjectObserved",
      schemaVersion: 1,
      payload: { objectId: "fire-signal", situationId: "forest_fire", name: "дым", description: "Пламя видно у кромки леса.", temperature: 20, integrity: 100 },
      timestamp: 2,
      correlationId: "observe",
      causationId: null,
    };
    const events = [...baseline.events, situation, observation];
    const world = rebuildProjection(events).getSnapshot();
    const context = buildObserverGuidanceContext(events, world, buildNarrativeAdapterContext(events, world, {
      profile: { background_id: "keeper" },
      entrypoint: getRegionEntrypoint("river_waystation_arrival"),
      presentation: selectTurnPresentation(events, world),
    }));
    expect(context.activeSituation?.situationId).toBe("forest_fire");
  });

  it("does not use an unrelated observation to expose an active situation", () => {
    const baseline = livingWorld();
    const situation: DomainEvent = {
      eventId: "forest-fire-started",
      type: "SituationStarted",
      schemaVersion: 1,
      payload: { situationId: "forest_fire", type: "forest_fire", startedAt: 1, duration: 8, data: {} },
      timestamp: 1,
      correlationId: "world-process",
      causationId: null,
    };
    const stoneObservation: DomainEvent = {
      eventId: "stone-observation",
      type: "ObjectObserved",
      schemaVersion: 1,
      payload: { objectId: "stone", name: "камень", description: "Камень заметен у дороги.", temperature: 20, integrity: 100 },
      timestamp: 2,
      correlationId: "observe",
      causationId: null,
    };
    const events = [...baseline.events, situation, stoneObservation];
    const world = rebuildProjection(events).getSnapshot();
    const narrativeContext = buildNarrativeAdapterContext(events, world, {
      profile: { background_id: "keeper" },
      entrypoint: getRegionEntrypoint("river_waystation_arrival"),
      presentation: selectTurnPresentation(events, world),
    });
    const context = buildObserverGuidanceContext(events, world, narrativeContext);
    expect(context.activeSituation?.situationId).not.toBe("forest_fire");
  });

  it("is deterministic, immutable and produces no generic commands", () => {
    const { events, world, narrativeContext } = livingWorld();
    const first = buildPlayerGuidance(events, world, narrativeContext);
    const second = buildPlayerGuidance(events, world, narrativeContext);
    expect(first).toEqual(second);
    expect(first.intentExamples.length).toBeLessThanOrEqual(3);
    const encoded = JSON.stringify(first);
    expect(encoded).not.toMatch(/move\s+(north|south|east|west)|give\s+.+guild|\bwait\b/i);
    expect(() => { (first.intentExamples as any).push({ id: "bad", text: "bad" }); }).toThrow();
    expect(() => { (first as any).worldTime = 99; }).toThrow();
  });

  it("returns the exact empty-context fallback", () => {
    const guidance = buildPlayerGuidance([], rebuildProjection([]).getSnapshot());
    expect(guidance.intentExamples).toEqual([]);
    expect(guidance.text).toBe("Опиши, что хочешь осмотреть, узнать или изменить.");
  });
});
