/**
 * Offline World Simulation Test (PR-7.5)
 *
 * Verifies the core Living World concept:
 *   Player absent → World evolves → Player returns → Observer sees consequences
 *
 * Scenario:
 *   TickPassed × N (player offline)
 *   → Weather changes
 *   → River level changes
 *   → Crossing condition changes
 *   → Settlement state changes
 *   → PlayerJoin
 *   → BeliefModel built from events
 *   → Observer sees only observable consequences
 */

import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import { weatherProcess, riverLevelProcess, crossingCondition, settlementPattern, buildBeliefModel } from "@skald/world";
import type { WeatherProcessDefinition } from "../../src/weather/types.js";
import type { RiverProcessDefinition, CrossingDefinition } from "../../src/region/types.js";

// ── Test Fixtures ──────────────────────────────────────────────────────────

const WEATHER_DEF: WeatherProcessDefinition = {
  processId: "weather-1",
  climateZone: "temperate",
  seasonCycleTicks: 100,
  phaseOffset: 0,
};

const RIVER_DEF: RiverProcessDefinition = {
  processId: "river-1",
  watercourseId: "river_basin",
  baselineLevel: 40,
  minimumLevel: 20,
  maximumLevel: 90,
  cycleLengthTicks: 16,
  phaseOffset: 0,
  riseRate: 8,
  fallRate: 5,
};

const CROSSING_DEF: CrossingDefinition = {
  crossingId: "crossing-1",
  watercourseId: "river_basin",
  openAtOrBelow: 55,
  difficultAtOrBelow: 75,
  closedAbove: 75,
  baseTravelCostTicks: 2,
};

function makeWorld(): ReadonlyWorld {
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
    locations: new Map(),
    currentLocationId: "",
    pendingChecks: new Map(),
    entities: new Map(),
    journeys: new Map(),
    activeJourneyId: null,
    spatial: {
      riverProcesses: new Map([["river-1", RIVER_DEF]]),
      riverStates: new Map([["river_basin", { watercourseId: "river_basin", level: 40, band: "normal", updatedAt: 0 }]]),
      crossingDefinitions: new Map([["crossing-1", CROSSING_DEF]]),
      crossingStates: new Map([["crossing-1", { crossingId: "crossing-1", condition: "open", travelCostTicks: 2, updatedAt: 0 }]]),
      travelRelations: new Map(),
    },
    weather: {
      weatherProcesses: new Map([["weather-1", WEATHER_DEF]]),
      weatherStates: new Map(),
    },
    heat: null,
    settlement: {
      settlements: new Map([["settlement-1", {
        settlementId: "settlement-1",
        population: 50,
        risk: 30,
        status: "active",
        createdAt: 0,
        updatedAt: 0,
      }]]),
    },
  }) as unknown as ReadonlyWorld;
}

function evt(type: string, eventId: string, payload: unknown = {}, timestamp: number, causationId: string | null = null): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "offline-sim", causationId };
}

// ── Offline World Simulation Test ──────────────────────────────────────────

describe("Offline World Simulation (PR-7.5)", () => {
  it("world evolves while player is absent", () => {
    const world = makeWorld();
    const offlineEvents: DomainEvent[] = [];

    // Simulate 20 ticks while player is offline
    for (let t = 1; t <= 20; t++) {
      const tick = evt("TickPassed", `t-${t}`, { delta: 1, playerOffline: true }, t);

      const weatherOut = weatherProcess.handle(tick, world);
      offlineEvents.push(...weatherOut);

      const riverOut = riverLevelProcess.handle(tick, world);
      offlineEvents.push(...riverOut);

      if (riverOut.length > 0) {
        const crossingOut = crossingCondition.handle(riverOut[0]!, world);
        offlineEvents.push(...crossingOut);
      }

      const settlementOut = settlementPattern.handle(tick, world);
      offlineEvents.push(...settlementOut);
    }

    // Events were generated while player was offline
    expect(offlineEvents.length).toBeGreaterThan(0);

    // Weather changed
    const weatherEvents = offlineEvents.filter((e) => e.type === "WeatherStateChanged");
    expect(weatherEvents.length).toBeGreaterThan(0);
  });

  it("projection is restored after player returns", () => {
    const world = makeWorld();
    const allEvents: DomainEvent[] = [];

    // Offline ticks
    for (let t = 1; t <= 10; t++) {
      const tick = evt("TickPassed", `t-${t}`, { delta: 1, playerOffline: true }, t);
      const weatherOut = weatherProcess.handle(tick, world);
      allEvents.push(...weatherOut);
      const riverOut = riverLevelProcess.handle(tick, world);
      allEvents.push(...riverOut);
    }

    // Player returns — rebuild BeliefModel from all events
    const beliefModel = buildBeliefModel(allEvents, world, "player");

    // BeliefModel should exist and be valid
    expect(beliefModel).toBeDefined();
    expect(beliefModel.schemaVersion).toBe(2);
    expect(beliefModel.lastUpdated).toBe(10);
  });

  it("BeliefModel does not get hidden events", () => {
    const world = makeWorld();
    const allEvents: DomainEvent[] = [];

    // Offline ticks with weather and river changes
    for (let t = 1; t <= 5; t++) {
      const tick = evt("TickPassed", `t-${t}`, { delta: 1, playerOffline: true }, t);
      const weatherOut = weatherProcess.handle(tick, world);
      allEvents.push(...weatherOut);
      const riverOut = riverLevelProcess.handle(tick, world);
      allEvents.push(...riverOut);
    }

    // Add some observer-visible events
    allEvents.push(evt("ObservationUpdated", "obs-1", { key: "risk_taken", delta: 1 }, 6));

    const beliefModel = buildBeliefModel(allEvents, world, "player");

    // BeliefModel should not contain raw weather/river internals
    const json = JSON.stringify(beliefModel);
    expect(json).not.toContain("weatherProcesses");
    expect(json).not.toContain("riverProcesses");
    expect(json).not.toContain("crossingDefinitions");
  });

  it("narrative reads only belief, not raw world state", () => {
    const world = makeWorld();
    const allEvents: DomainEvent[] = [];

    // Offline ticks
    for (let t = 1; t <= 10; t++) {
      const tick = evt("TickPassed", `t-${t}`, { delta: 1, playerOffline: true }, t);
      const weatherOut = weatherProcess.handle(tick, world);
      allEvents.push(...weatherOut);
      const riverOut = riverLevelProcess.handle(tick, world);
      allEvents.push(...riverOut);
      const settlementOut = settlementPattern.handle(tick, world);
      allEvents.push(...settlementOut);
    }

    const beliefModel = buildBeliefModel(allEvents, world, "player");

    // Verify narrative can read belief model
    expect(beliefModel.beliefs).toBeDefined();
    expect(beliefModel.activeHypotheses).toBeDefined();
    expect(beliefModel.knownRelations).toBeDefined();
    expect(beliefModel.contradictions).toBeDefined();

    // Verify no private state leaked
    const json = JSON.stringify(beliefModel);
    expect(json).not.toContain("heatProcesses");
    expect(json).not.toContain("settlements");
    expect(json).not.toContain("pendingChecks");
  });

  it("full offline simulation: weather → river → crossing → settlement → belief", () => {
    const world = makeWorld();
    const allEvents: DomainEvent[] = [];

    // Simulate 30 ticks offline
    for (let t = 1; t <= 30; t++) {
      const tick = evt("TickPassed", `t-${t}`, { delta: 1, playerOffline: true }, t);

      const weatherOut = weatherProcess.handle(tick, world);
      allEvents.push(...weatherOut);

      const riverOut = riverLevelProcess.handle(tick, world);
      allEvents.push(...riverOut);

      if (riverOut.length > 0) {
        const crossingOut = crossingCondition.handle(riverOut[0]!, world);
        allEvents.push(...crossingOut);
      }

      const settlementOut = settlementPattern.handle(tick, world);
      allEvents.push(...settlementOut);
    }

    // Player returns
    const beliefModel = buildBeliefModel(allEvents, world, "player");

    // Verify complete pipeline
    expect(beliefModel).toBeDefined();
    expect(beliefModel.schemaVersion).toBe(2);
    expect(beliefModel.lastUpdated).toBe(30);

    // Verify events were generated
    const weatherEvents = allEvents.filter((e) => e.type === "WeatherStateChanged");
    expect(weatherEvents.length).toBeGreaterThan(0);

    // Verify no private state in belief model
    const json = JSON.stringify(beliefModel);
    expect(json).not.toContain("weatherProcesses");
    expect(json).not.toContain("riverProcesses");
    expect(json).not.toContain("settlements");
  });
});
