/**
 * Heat Transfer Rule — TickDriven thermal process.
 *
 * Listens to TickPassed, computes heat state, emits HeatStateChanged.
 * Influenced by Weather (wind factor) and influences River (evaporation).
 */

import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import type { HeatProcessDefinition, ThermalState } from "./types.js";
import { computeHeatTransfer } from "../heat/process.js";
import { ruleEventId } from "../ids.js";

export const heatTransferProcess: Rule<ReadonlyWorld> = {
  id: "heat.transfer",
  phase: "physics",
  listens: ["TickPassed"],
  produces: ["HeatStateChanged"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const heatReadView = (world as unknown as { heat?: { heatProcesses: ReadonlyMap<string, HeatProcessDefinition>; thermalStates: ReadonlyMap<string, ThermalState> } }).heat;
    if (!heatReadView) return [];

    // Get wind factor from weather if available
    const weatherReadView = (world as unknown as { weather?: { weatherStates: ReadonlyMap<string, { wind: string }> } }).weather;
    let windFactor = 1.0;
    if (weatherReadView) {
      for (const ws of weatherReadView.weatherStates.values()) {
        if (ws.wind === "strong") windFactor = 1.5;
        else if (ws.wind === "breeze") windFactor = 1.2;
        break;
      }
    }

    const events: DomainEvent[] = [];
    let idx = 0;

    for (const process of heatReadView.heatProcesses.values()) {
      const currentState = heatReadView.thermalStates.get(process.processId);
      const baseState: ThermalState = currentState ?? {
        zoneId: process.processId,
        temperature: process.ambientTemperature,
        zone: "neutral",
        exposure: 0,
        updatedAt: 0,
      };

      const result = computeHeatTransfer(process, baseState, process.ambientTemperature, windFactor);

      // Only emit if state actually changed
      if (currentState &&
          currentState.temperature === result.temperature &&
          currentState.zone === result.zone) {
        continue;
      }

      events.push({
        eventId: ruleEventId(event.eventId, "HeatStateChanged", idx),
        type: "HeatStateChanged",
        schemaVersion: 1,
        payload: {
          processId: process.processId,
          previousTemperature: baseState.temperature,
          temperature: result.temperature,
          previousZone: baseState.zone,
          zone: result.zone,
          exposure: result.exposure,
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
