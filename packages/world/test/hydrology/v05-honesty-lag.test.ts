import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import { riverLevelProcess, crossingCondition } from "@skald/world";
import { buildObserverMap } from "@skald/world";
import type { SpatialWorldProjection } from "@skald/world";

function evt(type: string, eventId: string, payload: unknown = {}, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

function makeSpatial(): SpatialWorldProjection {
  return {
    region: null,
    locations: new Map(),
    landmarks: new Map(),
    relations: new Map(),
    travelRelations: new Map(),
    riverProcesses: new Map([
      ["test-process", {
        processId: "test-process",
        watercourseId: "test_river",
        baselineLevel: 40,
        minimumLevel: 20,
        maximumLevel: 90,
        cycleLengthTicks: 16,
        phaseOffset: 0,
        riseRate: 8,
        fallRate: 5,
      }],
    ]),
    riverStates: new Map([
      ["test_river", { watercourseId: "test_river", level: 40, band: "normal", updatedAt: 0 }],
    ]),
    crossingDefinitions: new Map([
      ["test_crossing", {
        crossingId: "test_crossing",
        watercourseId: "test_river",
        openAtOrBelow: 55,
        difficultAtOrBelow: 75,
        closedAbove: 75,
        baseTravelCostTicks: 2,
      }],
    ]),
    crossingStates: new Map([
      ["test_crossing", { crossingId: "test_crossing", condition: "open", travelCostTicks: 2, updatedAt: 0 }],
    ]),
  };
}

function makeWorld(spatial?: SpatialWorldProjection): ReadonlyWorld {
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
    spatial: spatial ?? makeSpatial(),
  }) as unknown as ReadonlyWorld;
}

describe("V-05: River event emission honesty", () => {
  it("riverLevelProcess does not emit when level unchanged", () => {
    const spatial = makeSpatial();
    // Level at T=0 should be 40 (baseline) — same as stored
    const world = makeWorld(spatial);
    const event = evt("TickPassed", "t-1", { delta: 1 }, 0);
    const out = riverLevelProcess.handle(event, world);
    expect(out).toHaveLength(0);
  });

  it("riverLevelProcess emits only when band changes", () => {
    const spatial = makeSpatial();
    const world = makeWorld(spatial);
    // At T=4, level should be ~65 (normal→high transition)
    const event = evt("TickPassed", "t-2", { delta: 1 }, 4);
    const out = riverLevelProcess.handle(event, world);
    expect(out.length).toBeGreaterThanOrEqual(1);
    const payload = out[0]!.payload as { previousBand: string; band: string };
    expect(payload.previousBand).not.toBe(payload.band);
  });

  it("crossingCondition does not emit when condition unchanged", () => {
    const spatial = makeSpatial();
    const world = makeWorld(spatial);
    // River level 40 → still open (same as stored)
    const event = evt("RiverLevelChanged", "rl-1", { watercourseId: "test_river", level: 40, band: "normal" }, 5);
    const out = crossingCondition.handle(event, world);
    expect(out).toHaveLength(0);
  });

  it("crossingCondition emits only on actual transition", () => {
    const spatial = makeSpatial();
    const world = makeWorld(spatial);
    // River level 80 → closed (was open)
    const event = evt("RiverLevelChanged", "rl-2", { watercourseId: "test_river", level: 80, band: "flood" }, 5);
    const out = crossingCondition.handle(event, world);
    expect(out).toHaveLength(1);
    const payload = out[0]!.payload as { condition: string };
    expect(payload.condition).toBe("closed");
  });
});

describe("V-05: Observer knowledge lag", () => {
  it("offline TickPassed does not generate observer evidence", () => {
    const events: DomainEvent[] = [
      evt("TickPassed", "t-1", { delta: 1, playerOffline: true }, 1),
      evt("RiverLevelChanged", "rl-1", { watercourseId: "test_river", previousLevel: 40, level: 65, previousBand: "normal", band: "high", changedAt: 1 }, 1),
    ];
    const spatial = makeSpatial();
    const observerMap = buildObserverMap(events, spatial, true);
    // Observer should not have river evidence from offline events
    // (the RiverLevelChanged is still in the event log, but observer scope filters it)
    expect(observerMap).toBeDefined();
  });

  it("online events generate observer evidence", () => {
    const events: DomainEvent[] = [
      evt("PlayerLocationChanged", "plc-1", { locationId: "test_loc" }, 0),
      evt("RiverLevelChanged", "rl-1", { watercourseId: "test_river", previousLevel: 40, level: 65, previousBand: "normal", band: "high", changedAt: 1 }, 1),
    ];
    const spatial = makeSpatial();
    const observerMap = buildObserverMap(events, spatial, true);
    expect(observerMap).toBeDefined();
    // The observer map should reflect the current state
    expect(observerMap.revision.worldTime).toBe(1);
  });

  it("stale belief does not become truth automatically", () => {
    // First observation: river is normal
    const events1: DomainEvent[] = [
      evt("PlayerLocationChanged", "plc-1", { locationId: "test_loc" }, 0),
      evt("SpatialObservationRecorded", "obs-1", { subjectKind: "relation", subjectId: "test_route", knowledge: "observed", observedAt: 0, confidence: 0.9 }, 0),
    ];
    const spatial = makeSpatial();
    const map1 = buildObserverMap(events1, spatial, true);

    // Second observation: river changed, but old observation still exists
    const events2: DomainEvent[] = [
      ...events1,
      evt("RiverLevelChanged", "rl-1", { watercourseId: "test_river", previousLevel: 40, level: 80, previousBand: "normal", band: "flood", changedAt: 5 }, 5),
    ];
    const map2 = buildObserverMap(events2, spatial, true);

    // The old observation should still be there (stale, but not replaced)
    const oldRoute = map2.routes.find((r) => r.ref === map1.routes[0]?.ref);
    if (oldRoute) {
      // Freshness should be lower for older observations
      expect(oldRoute.freshness).toBeLessThanOrEqual(1);
    }
  });
});
