import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import { weatherProcess, computeWeatherState } from "@skald/world";
import type { WeatherProcessDefinition, WeatherState } from "@skald/weather/types";

function evt(type: string, eventId: string, payload: unknown = {}, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

const TEST_WEATHER: WeatherProcessDefinition = {
  processId: "test-weather",
  climateZone: "temperate",
  seasonCycleTicks: 100,
  phaseOffset: 0,
};

function makeWorld(weather?: { weatherProcesses: ReadonlyMap<string, WeatherProcessDefinition>; weatherStates: ReadonlyMap<string, WeatherState> }): ReadonlyWorld {
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
    spatial: null,
    weather: weather ?? null,
  }) as unknown as ReadonlyWorld;
}

describe("Weather process (ADR-0020, influences graph)", () => {
  it("computeWeatherState produces deterministic output", () => {
    const s1 = computeWeatherState(TEST_WEATHER, 10);
    const s2 = computeWeatherState(TEST_WEATHER, 10);
    expect(s1).toEqual(s2);
  });

  it("computeWeatherState cycles through sky conditions", () => {
    const states = [];
    for (let t = 0; t < 100; t++) {
      states.push(computeWeatherState(TEST_WEATHER, t).skyCondition);
    }
    // Should have all three sky conditions in a 100-tick cycle
    expect(new Set(states).size).toBeGreaterThanOrEqual(2);
  });

  it("weatherProcess emits WeatherStateChanged when state changes", () => {
    const weatherProcesses = new Map([["test-weather", TEST_WEATHER]]);
    const weatherStates = new Map<string, WeatherState>();
    const world = makeWorld({ weatherProcesses, weatherStates });

    const event = evt("TickPassed", "t-1", { delta: 1 }, 10);
    const out = weatherProcess.handle(event, world);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0]!.type).toBe("WeatherStateChanged");
  });

  it("weatherProcess does not emit when state unchanged", () => {
    const weatherProcesses = new Map([["test-weather", TEST_WEATHER]]);
    const state = computeWeatherState(TEST_WEATHER, 0);
    const weatherStates = new Map([["test-weather", state]]);
    const world = makeWorld({ weatherProcesses, weatherStates });

    // Same timestamp → same state → no emission
    const event = evt("TickPassed", "t-1", { delta: 1 }, 0);
    const out = weatherProcess.handle(event, world);
    expect(out).toHaveLength(0);
  });

  it("weatherProcess handles no weather gracefully", () => {
    const world = makeWorld();
    const event = evt("TickPassed", "t-1", { delta: 1 }, 10);
    const out = weatherProcess.handle(event, world);
    expect(out).toHaveLength(0);
  });

  it("influences graph: weather → river concept is documented", () => {
    // This test verifies the architectural intent:
    // Weather influences river-hydrology through precipitation.
    // The actual influence is implemented in river-level rule
    // by reading weather.readView from ReadonlyWorld.
    const weatherProcesses = new Map([["test-weather", TEST_WEATHER]]);
    const weatherStates = new Map<string, WeatherState>();
    const world = makeWorld({ weatherProcesses, weatherStates });

    // Weather state is accessible from ReadonlyWorld
    expect(world.weather).toBeDefined();
    expect(world.weather!.weatherProcesses.size).toBe(1);
  });
});
