/**
 * Settlement Pattern Rule — TickDriven long-lived object.
 *
 * Settlements persist through time, changing state based on
 * risk and population dynamics. First pattern that survives
 * across many ticks.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import type { SettlementDefinition, SettlementState } from "./types.js";
import { ruleEventId } from "../ids.js";

/**
 * Compute next settlement state based on current state and risk.
 */
export function computeSettlementTick(
  state: SettlementState,
  tick: number,
): { population: number; risk: number; status: string } {
  let population = state.population;
  let risk = state.risk;

  // Population dynamics: high risk → population decline
  if (risk > 70) {
    population = Math.max(0, population - 1);
  } else if (risk < 30) {
    population = Math.min(100, population + 1);
  }

  // Risk naturally decays toward baseline
  risk = Math.max(0, Math.min(100, risk - 2));

  // Determine status
  let status: string;
  if (population <= 0) status = "abandoned";
  else if (population < state.population * 0.5) status = "declining";
  else status = "active";

  return { population, risk, status };
}

export const settlementPattern: Rule<ReadonlyWorld> = {
  id: "settlement.pattern",
  phase: "physics",
  listens: ["TickPassed"],
  produces: ["SettlementStateChanged"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const settlementReadView = (world as unknown as { settlement?: { settlements: ReadonlyMap<string, SettlementState> } }).settlement;
    if (!settlementReadView) return [];

    const events: DomainEvent[] = [];
    let idx = 0;

    for (const [settlementId, state] of settlementReadView.settlements) {
      const result = computeSettlementTick(state, event.timestamp);

      // Only emit if state actually changed
      if (result.population === state.population && result.risk === state.risk) {
        continue;
      }

      events.push({
        eventId: ruleEventId(event.eventId, "SettlementStateChanged", idx),
        type: "SettlementStateChanged",
        schemaVersion: 1,
        payload: {
          settlementId,
          previousPopulation: state.population,
          population: result.population,
          previousRisk: state.risk,
          risk: result.risk,
          previousStatus: state.status,
          status: result.status,
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
