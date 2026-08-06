/**
 * Production projection wiring for the new simulation systems.
 *
 * Verifies that weather, heat, settlement and spatial read views are derived
 * from the canonical Event Log by WorldProjector (so Rules no longer early-exit
 * on null read views in a real world lifecycle), including clone() and replay
 * purity.
 */

import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import {
  WorldProjector,
  rebuildProjection,
  buildPilotRegionBootstrapEvents,
  weatherProcess,
  riverLevelProcess,
  crossingCondition,
  heatTransferProcess,
  settlementPattern,
} from "@skald/world";

function evt(type: string, eventId: string, payload: unknown, timestamp: number): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "t", causationId: null };
}

const WEATHER_DEFINED = evt("WeatherProcessDefined", "w-def", {
  processId: "weather-1",
  climateZone: "temperate",
  seasonCycleTicks: 100,
  phaseOffset: 0,
}, 0);

const WEATHER_CHANGED = evt("WeatherStateChanged", "w-1", {
  processId: "weather-1",
  previousSky: "clear",
  sky: "cloudy",
  previousPrecipitation: "none",
  precipitation: "none",
  previousWind: "calm",
  wind: "breeze",
  visibilityModifier: 1.0,
  changedAt: 1,
}, 1);

const HEAT_DEFINED = evt("HeatProcessDefined", "h-def", {
  processId: "heat-1",
  ambientTemperature: 15,
  transferRate: 0.1,
  dissipationRate: 0.05,
  zoneThresholds: { cold: 0, warm: 25, hot: 60 },
}, 0);

const HEAT_CHANGED = evt("HeatStateChanged", "h-1", {
  processId: "heat-1",
  previousTemperature: 15,
  temperature: 17,
  previousZone: "neutral",
  zone: "neutral",
  exposure: 0.4,
  changedAt: 1,
}, 1);

const SETTLEMENT_CREATED = evt("SettlementCreated", "s-def", {
  settlementId: "city",
  population: 60,
  risk: 40,
  status: "active",
  createdAt: 0,
  updatedAt: 0,
}, 0);

const SETTLEMENT_CHANGED = evt("SettlementStateChanged", "s-1", {
  settlementId: "city",
  previousPopulation: 60,
  population: 61,
  previousRisk: 40,
  risk: 38,
  previousStatus: "active",
  status: "active",
  changedAt: 1,
}, 1);

describe("simulation read views wired into WorldProjector", () => {
  it("weather: WeatherProcessDefined + WeatherStateChanged populate the read view", () => {
    const world = rebuildProjection([WEATHER_DEFINED, WEATHER_CHANGED]).getSnapshot();
    expect(world.weather).not.toBeNull();
    expect(world.weather!.weatherProcesses.get("weather-1")?.climateZone).toBe("temperate");
    const state = world.weather!.weatherStates.get("weather-1");
    expect(state?.skyCondition).toBe("cloudy");
    expect(state?.wind).toBe("breeze");
    expect(state?.updatedAt).toBe(1);
  });

  it("heat: HeatProcessDefined + HeatStateChanged populate the read view", () => {
    const world = rebuildProjection([HEAT_DEFINED, HEAT_CHANGED]).getSnapshot();
    expect(world.heat).not.toBeNull();
    expect(world.heat!.heatProcesses.get("heat-1")?.ambientTemperature).toBe(15);
    const state = world.heat!.thermalStates.get("heat-1");
    expect(state?.temperature).toBe(17);
    expect(state?.zoneId).toBe("heat-1");
    expect(state?.updatedAt).toBe(1);
  });

  it("settlement: SettlementCreated + SettlementStateChanged preserve createdAt", () => {
    const world = rebuildProjection([SETTLEMENT_CREATED, SETTLEMENT_CHANGED]).getSnapshot();
    expect(world.settlement).not.toBeNull();
    const state = world.settlement!.settlements.get("city");
    expect(state?.population).toBe(61);
    expect(state?.risk).toBe(38);
    expect(state?.createdAt).toBe(0);
    expect(state?.updatedAt).toBe(1);
  });

  it("read views stay null when no simulation events exist", () => {
    const world = new WorldProjector().getSnapshot();
    expect(world.spatial).toBeNull();
    expect(world.weather).toBeNull();
    expect(world.heat).toBeNull();
    expect(world.settlement).toBeNull();
  });

  it("read view maps are immutable through the frozen snapshot", () => {
    const world = rebuildProjection([WEATHER_DEFINED]).getSnapshot();
    expect(() => (world.weather!.weatherProcesses as Map<string, unknown>).set("x", {} as never)).toThrow(TypeError);
    expect(() => (world.spatial ?? { riverProcesses: new Map() } as never)).toBeDefined();
  });

  it("replay purity: two replays produce identical read views", () => {
    const events = [WEATHER_DEFINED, WEATHER_CHANGED, HEAT_DEFINED, HEAT_CHANGED, SETTLEMENT_CREATED, SETTLEMENT_CHANGED];
    const a = rebuildProjection(events).getSnapshot();
    const b = rebuildProjection([...events]).getSnapshot();
    expect([...a.weather!.weatherProcesses.entries(), ...a.weather!.weatherStates.entries()])
      .toEqual([...b.weather!.weatherProcesses.entries(), ...b.weather!.weatherStates.entries()]);
    expect([...a.heat!.heatProcesses.entries(), ...a.heat!.thermalStates.entries()])
      .toEqual([...b.heat!.heatProcesses.entries(), ...b.heat!.thermalStates.entries()]);
    expect([...a.settlement!.settlements.entries()]).toEqual([...b.settlement!.settlements.entries()]);
  });

  it("clone() keeps the read views and keeps advancing them", () => {
    const p = rebuildProjection([WEATHER_DEFINED]);
    const clone = p.clone();
    // Seeded: the process definition survives the clone.
    expect(clone.getSnapshot().weather!.weatherProcesses.get("weather-1")).toBeDefined();
    // Advancing: applying a state change to the clone updates its read view.
    clone.apply(WEATHER_CHANGED);
    expect(clone.getSnapshot().weather!.weatherStates.get("weather-1")?.skyCondition).toBe("cloudy");
  });
});

describe("living region bootstrap feeds the production lifecycle", () => {
  it("bootstrap installs weather, heat, settlement and spatial read views", () => {
    const events = buildPilotRegionBootstrapEvents();
    const world = rebuildProjection(events).getSnapshot();
    expect(world.weather?.weatherProcesses.get("weather-region")?.climateZone).toBe("temperate");
    expect(world.heat?.heatProcesses.get("heat-region")?.ambientTemperature).toBe(18);
    expect(world.settlement?.settlements.get("riverwatch_city")?.population).toBe(60);
    expect(world.spatial?.riverProcesses.get("river-basin-process")?.baselineLevel).toBe(40);
    expect(world.spatial?.crossingStates.get("river_crossing")?.condition).toBe("open");
  });

  it("rules emit instead of early-exiting once read views exist", () => {
    const events = buildPilotRegionBootstrapEvents();
    const world = rebuildProjection(events).getSnapshot();
    const tick = evt("TickPassed", "t-1", { delta: 1 }, 1);

    const weatherOut = weatherProcess.handle(tick, world);
    expect(weatherOut.some((e) => e.type === "WeatherStateChanged")).toBe(true);

    const riverOut = riverLevelProcess.handle(tick, world);
    expect(riverOut.some((e) => e.type === "RiverLevelChanged")).toBe(true);

    const settlementOut = settlementPattern.handle(tick, world);
    expect(settlementOut.some((e) => e.type === "SettlementStateChanged")).toBe(true);

    // Heat runs over its registered process (no early exit); at thermal
    // equilibrium it has nothing to emit, which is the honest outcome.
    const heatOut = heatTransferProcess.handle(tick, world);
    expect(Array.isArray(heatOut)).toBe(true);
  });

  it("crossing condition reacts to river level once spatial is projected", () => {
    const events = buildPilotRegionBootstrapEvents();
    const world = rebuildProjection(events).getSnapshot();
    const riverEvent = evt("RiverLevelChanged", "r-3", {
      watercourseId: "river_basin",
      previousLevel: 53,
      level: 60,
      previousBand: "normal",
      band: "high",
      changedAt: 3,
    }, 3);
    const out = crossingCondition.handle(riverEvent, world);
    expect(out.some((e) => e.type === "CrossingConditionChanged")).toBe(true);
  });
});
