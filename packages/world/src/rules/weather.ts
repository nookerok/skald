/**
 * Weather Rule — minimal TickDriven process.
 *
 * Listens to TickPassed, computes weather state, emits WeatherStateChanged.
 * First system that influences another (river-hydrology).
 */

import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import type { WeatherProcessDefinition, WeatherState } from "../weather/types.js";
import { computeWeatherState } from "../weather/process.js";
import { ruleEventId } from "../ids.js";

export const weatherProcess: Rule<ReadonlyWorld> = {
  id: "weather.tick",
  phase: "physics",
  listens: ["TickPassed"],
  produces: ["WeatherStateChanged"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const weatherReadView = (world as unknown as { weather?: { weatherProcesses: ReadonlyMap<string, WeatherProcessDefinition>; weatherStates: ReadonlyMap<string, WeatherState> } }).weather;
    if (!weatherReadView) return [];

    const events: DomainEvent[] = [];
    let idx = 0;

    for (const process of weatherReadView.weatherProcesses.values()) {
      const newState = computeWeatherState(process, event.timestamp);
      const existing = weatherReadView.weatherStates.get(process.processId);

      // Only emit if state actually changed
      if (existing &&
          existing.skyCondition === newState.skyCondition &&
          existing.precipitation === newState.precipitation &&
          existing.wind === newState.wind) {
        continue;
      }

      events.push({
        eventId: ruleEventId(event.eventId, "WeatherStateChanged", idx),
        type: "WeatherStateChanged",
        schemaVersion: 1,
        payload: {
          processId: process.processId,
          previousSky: existing?.skyCondition ?? "clear",
          sky: newState.skyCondition,
          previousPrecipitation: existing?.precipitation ?? "none",
          precipitation: newState.precipitation,
          previousWind: existing?.wind ?? "calm",
          wind: newState.wind,
          visibilityModifier: newState.visibilityModifier,
          changedAt: event.timestamp,
        },
        timestamp: event.timestamp,
        correlationId: event.correlationId,
        causationId: event.eventId,
      });
      idx++;
    }

    return events;
  },
};
