import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import { riverLevelProcess, crossingCondition } from "@skald/world";
import type { RiverProcessDefinition, CrossingDefinition, SpatialWorldProjection } from "@skald/world";

function makeWorld(overrides?: { spatial?: Partial<SpatialWorldProjection> }): ReadonlyWorld {
  const spatial: SpatialWorldProjection = {
    region: null,
    locations: new Map(),
    landmarks: new Map(),
    relations: new Map(),
    travelRelations: new Map(),
    riverProcesses: overrides?.spatial?.riverProcesses ?? new Map(),
    riverStates: overrides?.spatial?.riverStates ?? new Map(),
    crossingDefinitions: overrides?.spatial?.crossingDefinitions ?? new Map(),
    crossingStates: overrides?.spatial?.crossingStates ?? new Map(),
  };
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
    spatial,
  }) as unknown as ReadonlyWorld;
}

function evt(type: string, eventId: string, payload: unknown = {}, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

const TEST_PROCESS: RiverProcessDefinition = {
  processId: "test-river",
  watercourseId: "test_river",
  baselineLevel: 40,
  minimumLevel: 20,
  maximumLevel: 90,
  cycleLengthTicks: 16,
  phaseOffset: 0,
  riseRate: 8,
  fallRate: 5,
};

const TEST_CROSSING: CrossingDefinition = {
  crossingId: "test_crossing",
  watercourseId: "test_river",
  openAtOrBelow: 55,
  difficultAtOrBelow: 75,
  closedAbove: 75,
  baseTravelCostTicks: 2,
};

describe("riverLevelProcess rule", () => {
  it("emits RiverLevelChanged when level changes", () => {
    const world = makeWorld({
      spatial: {
        riverProcesses: new Map([["test-river", TEST_PROCESS]]),
        riverStates: new Map([["test_river", { watercourseId: "test_river", level: 40, band: "normal", updatedAt: 0 }]]),
      },
    });
    const event = evt("TickPassed", "t-1", { delta: 1 }, 4);
    const out = riverLevelProcess.handle(event, world);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]!.type).toBe("RiverLevelChanged");
    const payload = out[0]!.payload as { watercourseId: string; level: number; band: string };
    expect(payload.watercourseId).toBe("test_river");
    expect(payload.level).toBeGreaterThan(40);
  });

  it("does not emit when level unchanged", () => {
    const world = makeWorld({
      spatial: {
        riverProcesses: new Map([["test-river", TEST_PROCESS]]),
        riverStates: new Map([["test_river", { watercourseId: "test_river", level: 90, band: "flood", updatedAt: 8 }]]),
      },
    });
    // At T=8, level should be 90 (maximum) — same as stored
    const event = evt("TickPassed", "t-2", { delta: 1 }, 8);
    const out = riverLevelProcess.handle(event, world);
    expect(out).toHaveLength(0);
  });

  it("handles no spatial projection gracefully", () => {
    const world = makeWorld();
    const event = evt("TickPassed", "t-3", { delta: 1 }, 1);
    const out = riverLevelProcess.handle(event, world);
    expect(out).toHaveLength(0);
  });

  it("deterministic: same input gives same output", () => {
    const world = makeWorld({
      spatial: {
        riverProcesses: new Map([["test-river", TEST_PROCESS]]),
        riverStates: new Map([["test_river", { watercourseId: "test_river", level: 40, band: "normal", updatedAt: 0 }]]),
      },
    });
    const event = evt("TickPassed", "t-4", { delta: 1 }, 4);
    const out1 = riverLevelProcess.handle(event, world);
    const out2 = riverLevelProcess.handle(event, world);
    expect(out1).toEqual(out2);
  });
});

describe("crossingCondition rule", () => {
  it("emits CrossingConditionChanged when condition transitions", () => {
    const world = makeWorld({
      spatial: {
        crossingDefinitions: new Map([["test_crossing", TEST_CROSSING]]),
        crossingStates: new Map([["test_crossing", { crossingId: "test_crossing", condition: "open", travelCostTicks: 2, updatedAt: 0 }]]),
      },
    });
    // River level 80 → closed
    const event = evt("RiverLevelChanged", "rl-1", { watercourseId: "test_river", level: 80, band: "flood" }, 5);
    const out = crossingCondition.handle(event, world);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("CrossingConditionChanged");
    const payload = out[0]!.payload as { crossingId: string; condition: string; travelCostTicks: number };
    expect(payload.condition).toBe("closed");
    expect(payload.travelCostTicks).toBe(Infinity);
  });

  it("does not emit when condition unchanged", () => {
    const world = makeWorld({
      spatial: {
        crossingDefinitions: new Map([["test_crossing", TEST_CROSSING]]),
        crossingStates: new Map([["test_crossing", { crossingId: "test_crossing", condition: "open", travelCostTicks: 2, updatedAt: 0 }]]),
      },
    });
    // River level 40 → still open
    const event = evt("RiverLevelChanged", "rl-2", { watercourseId: "test_river", level: 40, band: "normal" }, 5);
    const out = crossingCondition.handle(event, world);
    expect(out).toHaveLength(0);
  });

  it("handles difficult crossing", () => {
    const world = makeWorld({
      spatial: {
        crossingDefinitions: new Map([["test_crossing", TEST_CROSSING]]),
        crossingStates: new Map([["test_crossing", { crossingId: "test_crossing", condition: "open", travelCostTicks: 2, updatedAt: 0 }]]),
      },
    });
    // River level 65 → difficult
    const event = evt("RiverLevelChanged", "rl-3", { watercourseId: "test_river", level: 65, band: "high" }, 5);
    const out = crossingCondition.handle(event, world);
    expect(out).toHaveLength(1);
    const payload = out[0]!.payload as { condition: string; travelCostTicks: number };
    expect(payload.condition).toBe("difficult");
    expect(payload.travelCostTicks).toBe(4);
  });
});
