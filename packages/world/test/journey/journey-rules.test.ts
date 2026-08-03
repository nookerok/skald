import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import { journeyStart } from "@skald/world";
import { createJourneyValidationRule } from "@skald/world";
import type { SpatialWorldProjection, ObserverMapDTO } from "@skald/world";

function makeWorld(overrides?: { activeJourneyId?: string | null }): ReadonlyWorld {
  return Object.freeze({
    player: Object.freeze({ x: 0, y: 0 }),
    walls: new Set<string>(),
    observations: new Map<string, number>(),
    consequences: new Map(),
    firedConsequences: new Map(),
    activeSituations: new Map(),
    burnedTrees: 0,
    relations: new Map(),
    heatSources: new Map(),
    heatMap: new Map(),
    lastActionTick: 0,
    strategy: [],
    eventNumber: 0,
    time: 0,
    objects: new Map(),
    locations: new Map([
      ["river_waystation", { id: "river_waystation", name: "Переправа у Чёрного леса", description: "Test", objectIds: [], connections: {} }],
      ["riverwatch_city", { id: "riverwatch_city", name: "Речной Страж", description: "Test", objectIds: [], connections: {} }],
    ]),
    currentLocationId: "river_waystation",
    pendingChecks: new Map(),
    entities: new Map(),
    journeys: new Map(),
    activeJourneyId: overrides?.activeJourneyId ?? null,
  }) as unknown as ReadonlyWorld;
}

function makeSpatial(): SpatialWorldProjection {
  return {
    region: null,
    locations: new Map([
      ["river_waystation", { id: "river_waystation", name: "Переправа у Чёрного леса", description: "Test", anchor: { xMetres: 8000, yMetres: 9500 }, footprintTileIds: [] }],
      ["riverwatch_city", { id: "riverwatch_city", name: "Речной Страж", description: "Test", anchor: { xMetres: 13500, yMetres: 7500 }, footprintTileIds: [] }],
    ]),
    landmarks: new Map(),
    relations: new Map(),
    travelRelations: new Map([
      ["road_waystation_city", { id: "road_waystation_city", kind: "road", fromId: "river_waystation", toId: "riverwatch_city", distanceMetres: 5500, baseTravelTicks: 4, terrainCost: 1.0, passability: "open" }],
    ]),
    riverProcesses: new Map(),
    riverStates: new Map(),
    crossingDefinitions: new Map(),
    crossingStates: new Map(),
  };
}

function makeObserverMap(): ObserverMapDTO {
  return {
    schemaVersion: 1,
    revision: { worldTime: 0, eventNumber: 0 },
    region: null,
    observer: { locationRef: "river_waystation", xMetres: 8000, yMetres: 9500 },
    knownArea: null,
    locations: [
      { ref: "river_waystation", name: "Переправа у Чёрного леса", knowledge: "traversed", confidence: 1, freshness: 1, xMetres: 8000, yMetres: 9500 },
      { ref: "riverwatch_city", name: "Речной Страж", knowledge: "observed", confidence: 0.9, freshness: 0.8, xMetres: 13500, yMetres: 7500 },
    ],
    landmarks: [],
    routes: [],
  };
}

function evt(type: string, eventId: string, payload: unknown = {}, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

describe("journey.validate rule", () => {
  it("emits JourneyStarted for valid destination", () => {
    const rule = createJourneyValidationRule(makeSpatial(), makeObserverMap());
    const event = evt("JourneyValidated", "jv-1", { destination: "Речной Страж" }, 5);
    const out = rule.handle(event, makeWorld());
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("JourneyStarted");
    const payload = out[0]!.payload as { journeyId: string; relationId: string; toLocationId: string; plannedTicks: number };
    expect(payload.toLocationId).toBe("riverwatch_city");
    expect(payload.plannedTicks).toBe(4);
  });

  it("emits JourneyBlocked for unknown destination", () => {
    const rule = createJourneyValidationRule(makeSpatial(), makeObserverMap());
    const event = evt("JourneyValidated", "jv-2", { destination: "Неведомый город" }, 5);
    const out = rule.handle(event, makeWorld());
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("JourneyBlocked");
    const payload = out[0]!.payload as { reason: string };
    expect(payload.reason).toBe("unknown_destination");
  });

  it("emits JourneyBlocked for empty destination", () => {
    const rule = createJourneyValidationRule(makeSpatial(), makeObserverMap());
    const event = evt("JourneyValidated", "jv-3", { destination: "" }, 5);
    const out = rule.handle(event, makeWorld());
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("JourneyBlocked");
  });
});

describe("journey.start rule", () => {
  it("emits TickPassed × N for journey duration", () => {
    const event = evt("JourneyStarted", "js-1", {
      journeyId: "j-1",
      relationId: "road_waystation_city",
      fromLocationId: "river_waystation",
      toLocationId: "riverwatch_city",
      startedAt: 5,
      plannedTicks: 4,
    }, 5);
    const out = journeyStart.handle(event, makeWorld());
    // 4 TickPassed + 1 PlayerLocationChanged + 1 JourneyCompleted = 6
    expect(out).toHaveLength(6);
    const ticks = out.filter((e) => e.type === "TickPassed");
    expect(ticks).toHaveLength(4);
  });

  it("emits PlayerLocationChanged with correct destination", () => {
    const event = evt("JourneyStarted", "js-2", {
      journeyId: "j-2",
      relationId: "road_waystation_city",
      fromLocationId: "river_waystation",
      toLocationId: "riverwatch_city",
      startedAt: 5,
      plannedTicks: 2,
    }, 5);
    const out = journeyStart.handle(event, makeWorld());
    const locationChanged = out.find((e) => e.type === "PlayerLocationChanged");
    expect(locationChanged).toBeDefined();
    const payload = locationChanged!.payload as { locationId: string };
    expect(payload.locationId).toBe("riverwatch_city");
  });

  it("emits JourneyCompleted", () => {
    const event = evt("JourneyStarted", "js-3", {
      journeyId: "j-3",
      relationId: "road_waystation_city",
      fromLocationId: "river_waystation",
      toLocationId: "riverwatch_city",
      startedAt: 5,
      plannedTicks: 1,
    }, 5);
    const out = journeyStart.handle(event, makeWorld());
    const completed = out.find((e) => e.type === "JourneyCompleted");
    expect(completed).toBeDefined();
    const payload = completed!.payload as { journeyId: string };
    expect(payload.journeyId).toBe("j-3");
  });

  it("TickPassed events have delta: 1", () => {
    const event = evt("JourneyStarted", "js-4", {
      journeyId: "j-4",
      relationId: "road_waystation_city",
      fromLocationId: "river_waystation",
      toLocationId: "riverwatch_city",
      startedAt: 5,
      plannedTicks: 3,
    }, 5);
    const out = journeyStart.handle(event, makeWorld());
    const ticks = out.filter((e) => e.type === "TickPassed");
    for (const tick of ticks) {
      expect((tick.payload as { delta: number }).delta).toBe(1);
    }
  });

  it("events have correct causationId chain", () => {
    const event = evt("JourneyStarted", "js-5", {
      journeyId: "j-5",
      relationId: "road_waystation_city",
      fromLocationId: "river_waystation",
      toLocationId: "riverwatch_city",
      startedAt: 5,
      plannedTicks: 2,
    }, 5);
    const out = journeyStart.handle(event, makeWorld());
    for (const e of out) {
      expect(e.causationId).toBe("js-5");
    }
  });
});
