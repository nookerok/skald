import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import { journeyStart, journeyProgress, journeyInterrupt } from "@skald/world";
import { createJourneyValidationRule } from "@skald/world";
import type { SpatialWorldProjection, ObserverMapDTO } from "@skald/world";

function makeWorld(overrides?: {
  activeJourneyId?: string | null;
  journey?: Record<string, unknown>;
  spatial?: SpatialWorldProjection;
  spatialKnowledge?: import("@skald/world").ObserverSpatialKnowledge;
}): ReadonlyWorld {
  const journeys = new Map<string, Record<string, unknown>>();
  if (overrides?.journey) journeys.set(String(overrides.journey.journeyId), overrides.journey);
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
    journeys,
    activeJourneyId: overrides?.activeJourneyId ?? null,
    ...(overrides?.spatial ? { spatial: overrides.spatial } : {}),
    ...(overrides?.spatialKnowledge ? { spatialKnowledge: overrides.spatialKnowledge } : {}),
  }) as unknown as ReadonlyWorld;
}

function makeSpatial(overrides?: {
  travelRelations?: Map<string, { id: string; kind: "road" | "crossing" | "river" | "visibility"; fromId: string; toId: string; distanceMetres: number; baseTravelTicks: number; terrainCost: number; passability: "open" | "blocked" }>;
  crossingDefinitions?: Map<string, { crossingId: string; watercourseId: string; openAtOrBelow: number; difficultAtOrBelow: number; closedAbove: number; baseTravelCostTicks: number }>;
  crossingStates?: Map<string, { crossingId: string; condition: "open" | "difficult" | "closed"; travelCostTicks: number }>;
  riverBand?: "low" | "normal" | "high" | "flood" | null;
}): SpatialWorldProjection {
  const band = overrides?.riverBand ?? "normal";
  return {
    region: null,
    locations: new Map([
      ["river_waystation", { id: "river_waystation", name: "Переправа у Чёрного леса", description: "Test", anchor: { xMetres: 8000, yMetres: 9500 }, footprintTileIds: [] }],
      ["riverwatch_city", { id: "riverwatch_city", name: "Речной Страж", description: "Test", anchor: { xMetres: 13500, yMetres: 7500 }, footprintTileIds: [] }],
    ]),
    landmarks: new Map(),
    relations: new Map(),
    travelRelations: overrides?.travelRelations ?? new Map([
      ["road_waystation_city", { id: "road_waystation_city", kind: "road", fromId: "river_waystation", toId: "riverwatch_city", distanceMetres: 5500, baseTravelTicks: 4, terrainCost: 1.0, passability: "open" }],
    ]),
    riverProcesses: new Map(),
    riverStates: new Map(band === null ? [] : [["river", { watercourseId: "river", level: 50, band, updatedAt: 1 }]]),
    crossingDefinitions: overrides?.crossingDefinitions ?? new Map(),
    crossingStates: overrides?.crossingStates ?? new Map(),
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

describe("progressive journey rules", () => {
  it("schedules one step when a journey starts", () => {
    const event = evt("JourneyStarted", "js-1", {
      journeyId: "j-1", relationId: "road_waystation_city", fromLocationId: "river_waystation",
      toLocationId: "riverwatch_city", startedAt: 5, plannedTicks: 4,
    }, 5);
    const out = journeyStart.handle(event, makeWorld());
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("JourneyStepRequested");
    expect((out[0]!.payload as { journeyId: string }).journeyId).toBe("j-1");
  });

  it("advances one tick for a scheduled step", () => {
    const event = evt("JourneyStarted", "js-2", {
      journeyId: "j-2", relationId: "road_waystation_city", fromLocationId: "river_waystation",
      toLocationId: "riverwatch_city", startedAt: 5, plannedTicks: 2,
    }, 5);
    const start = journeyStart.handle(event, makeWorld())[0]!;
    const journey = { journeyId: "j-2", relationId: "road_waystation_city", fromLocationId: "river_waystation", toLocationId: "riverwatch_city", startedAt: 5, plannedTicks: 2, elapsedTicks: 0, status: "active" };
    const out = journeyProgress.handle(start, makeWorld({ activeJourneyId: "j-2", journey }));
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("TickPassed");
    expect((out[0]!.payload as { delta: number }).delta).toBe(1);
  });

  it("completes only on the final external tick", () => {
    const event = evt("JourneyStarted", "js-3", {
      journeyId: "j-3", relationId: "road_waystation_city", fromLocationId: "river_waystation",
      toLocationId: "riverwatch_city", startedAt: 5, plannedTicks: 1,
    }, 5);
    const start = journeyStart.handle(event, makeWorld())[0]!;
    const journey = { journeyId: "j-3", relationId: "road_waystation_city", fromLocationId: "river_waystation", toLocationId: "riverwatch_city", startedAt: 5, plannedTicks: 1, elapsedTicks: 0, status: "active" };
    const step = journeyProgress.handle(start, makeWorld({ activeJourneyId: "j-3", journey }))[0]!;
    const out = journeyProgress.handle(step, makeWorld({ activeJourneyId: "j-3", journey }));
    const completed = out.find((e) => e.type === "JourneyCompleted");
    expect(completed).toBeDefined();
    expect((completed!.payload as { journeyId: string }).journeyId).toBe("j-3");
    expect(out.filter((e) => e.type === "SpatialObservationRecorded")).toHaveLength(2);
  });

  it("partial stop records only the observed route prefix", () => {
    const journey = { journeyId: "j-4", relationId: "road_waystation_city", fromLocationId: "river_waystation", toLocationId: "riverwatch_city", startedAt: 5, plannedTicks: 3, elapsedTicks: 1, status: "active" };
    const validated = evt("JourneyInterruptValidated", "stop-1", { rawText: "остановиться" }, 7);
    const out = journeyInterrupt.handle(validated, makeWorld({ activeJourneyId: "j-4", journey }));
    expect(out.map((e) => e.type)).toEqual(["SpatialObservationRecorded", "JourneyInterrupted"]);
    const observation = out[0]!.payload as { knowledge: string; progressFraction: number };
    expect(observation.knowledge).toBe("observed");
    expect(observation.progressFraction).toBeCloseTo(1 / 3);
    expect(out.some((e) => e.type === "JourneyCompleted")).toBe(false);
  });
});

describe("journey completion across ticks (plan_9 §3-4)", () => {
  const twoTickJourney = (elapsedTicks: number) => ({
    journeyId: "j-2t", relationId: "road_waystation_city", fromLocationId: "river_waystation",
    toLocationId: "riverwatch_city", startedAt: 5, plannedTicks: 2, elapsedTicks, status: "active",
  });

  it("a non-final tick advances without completing", () => {
    const out = journeyProgress.handle(
      evt("TickPassed", "tick-1", { delta: 1 }, 6),
      makeWorld({ activeJourneyId: "j-2t", journey: twoTickJourney(0) }),
    );
    expect(out).toEqual([]);
  });

  it("the final tick completes with location change and traversed knowledge", () => {
    const out = journeyProgress.handle(
      evt("TickPassed", "tick-2", { delta: 1 }, 7),
      makeWorld({ activeJourneyId: "j-2t", journey: twoTickJourney(1) }),
    );
    expect(out.map((e) => e.type)).toEqual([
      "PlayerLocationChanged",
      "SpatialObservationRecorded",
      "SpatialObservationRecorded",
      "JourneyCompleted",
    ]);
    expect((out[0]!.payload as { locationId: string }).locationId).toBe("riverwatch_city");
    expect((out[3]!.payload as { journeyId: string }).journeyId).toBe("j-2t");
  });

  function crossingWorld(
    condition: "open" | "closed",
    band: "low" | "normal" | "high" | "flood" = "normal",
    journeyStatus: "active" | "blocked" = "active",
    elapsedTicks = 1,
  ) {
    const spatial = makeSpatial({
      riverBand: band,
      travelRelations: new Map([
        ["river_crossing", { id: "river_crossing", kind: "crossing", fromId: "river_waystation", toId: "riverwatch_city", distanceMetres: 2000, baseTravelTicks: 2, terrainCost: 1.5, passability: "open" }],
      ]),
      crossingDefinitions: new Map([
        ["x-1", { crossingId: "river_crossing", watercourseId: "river", openAtOrBelow: 1, difficultAtOrBelow: 2, closedAbove: 3, baseTravelCostTicks: 2 }],
      ]),
      crossingStates: new Map([
        ["river_crossing", { crossingId: "river_crossing", condition, travelCostTicks: 5 }],
      ]),
    });
    const knowledge = {
      observerId: "player",
      locations: new Map(),
      landmarks: new Map(),
      relations: new Map(),
      water: new Map(),
    };
    const journey = {
      journeyId: "j-x", relationId: "river_crossing", fromLocationId: "river_waystation",
      toLocationId: "riverwatch_city", startedAt: 5, plannedTicks: 2, elapsedTicks, status: journeyStatus,
    };
    return makeWorld({ activeJourneyId: "j-x", journey, spatial, spatialKnowledge: knowledge });
  }

  it("a closed crossing blocks completion with a named cause", () => {
    const out = journeyProgress.handle(evt("TickPassed", "tick-x", { delta: 1 }, 7), crossingWorld("closed"));
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("JourneyBlocked");
    expect((out[0]!.payload as { reason: string }).reason).toBe("crossing_closed");
    expect((out[0]!.payload as { playerText: string }).playerText).toContain("Речной Страж");
  });

  it("carries the journey id on the block so projection can stand at the obstacle", () => {
    const out = journeyProgress.handle(evt("TickPassed", "tick-x", { delta: 1 }, 7), crossingWorld("closed"));
    expect((out[0]!.payload as { journeyId: string }).journeyId).toBe("j-x");
  });

  it("claims high water only with a high river band, never from the closed flag alone", () => {
    const high = journeyProgress.handle(evt("TickPassed", "tick-x", { delta: 1 }, 7), crossingWorld("closed", "high"));
    expect((high[0]!.payload as { playerText: string }).playerText).toContain("высокой воды");
    const normal = journeyProgress.handle(evt("TickPassed", "tick-x", { delta: 1 }, 7), crossingWorld("closed", "normal"));
    const neutral = (normal[0]!.payload as { playerText: string }).playerText;
    expect(neutral).toContain("переправа закрыта");
    expect(neutral).not.toContain("высокой воды");
    expect(neutral).not.toContain("спада");
  });

  it("a second tick while closed stays silent instead of duplicating the block", () => {
    const out = journeyProgress.handle(
      evt("TickPassed", "tick-x2", { delta: 1 }, 8),
      crossingWorld("closed", "normal", "blocked", 2),
    );
    expect(out).toEqual([]);
  });

  it("reopening resumes the same journey instead of stranding it", () => {
    const out = journeyProgress.handle(
      evt("TickPassed", "tick-x3", { delta: 1 }, 9),
      crossingWorld("open", "normal", "blocked", 2),
    );
    expect(out.map((e) => e.type)).toEqual([
      "PlayerLocationChanged",
      "SpatialObservationRecorded",
      "SpatialObservationRecorded",
      "JourneyCompleted",
    ]);
    expect((out[3]!.payload as { journeyId: string }).journeyId).toBe("j-x");
  });

  it("completes once the crossing reopens", () => {
    const out = journeyProgress.handle(evt("TickPassed", "tick-x", { delta: 1 }, 8), crossingWorld("open"));
    expect(out.map((e) => e.type)).toContain("JourneyCompleted");
    expect((out[0]!.payload as { locationId: string }).locationId).toBe("riverwatch_city");
  });
});
