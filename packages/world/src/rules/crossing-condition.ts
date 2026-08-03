/**
 * Crossing Condition Rule (ADR-0017 §8).
 *
 * Listens to RiverLevelChanged, checks crossing thresholds,
 * emits CrossingConditionChanged when condition transitions.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import type { CrossingDefinition, CrossingState, CrossingCondition } from "../region/types.js";
import { ruleEventId } from "../ids.js";

export function classifyCrossingCondition(level: number, def: CrossingDefinition): CrossingCondition {
  if (level > def.closedAbove) return "closed";
  if (level > def.openAtOrBelow) return "difficult";
  return "open";
}

export function computeCrossingTravelTicks(condition: CrossingCondition, base: number): number {
  if (condition === "closed") return Infinity;
  if (condition === "difficult") return base + 2;
  return base;
}

/**
 * Crossing condition rule.
 * Reacts to RiverLevelChanged and updates crossing states.
 */
export const crossingCondition: Rule<ReadonlyWorld> = {
  id: "hydrology.crossing_condition",
  phase: "consequence",
  listens: ["RiverLevelChanged"],
  produces: ["CrossingConditionChanged"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const payload = event.payload as { watercourseId: string; level: number };
    const spatial = (world as unknown as { spatial?: { crossingDefinitions: ReadonlyMap<string, CrossingDefinition>; crossingStates: ReadonlyMap<string, CrossingState> } }).spatial;
    if (!spatial) return [];

    const events: DomainEvent[] = [];
    let idx = 0;

    for (const [crossingId, def] of spatial.crossingDefinitions) {
      if (def.watercourseId !== payload.watercourseId) continue;

      const newCondition = classifyCrossingCondition(payload.level, def);
      const newTravelTicks = computeCrossingTravelTicks(newCondition, def.baseTravelCostTicks);
      const existing = spatial.crossingStates.get(crossingId);

      // Only emit if condition or travel cost actually changed
      if (existing && existing.condition === newCondition && existing.travelCostTicks === newTravelTicks) continue;

      events.push({
        eventId: ruleEventId(event.eventId, "CrossingConditionChanged", idx),
        type: "CrossingConditionChanged",
        schemaVersion: 1,
        payload: {
          crossingId,
          watercourseId: payload.watercourseId,
          previousCondition: existing?.condition ?? "open",
          condition: newCondition,
          previousTravelCostTicks: existing?.travelCostTicks ?? def.baseTravelCostTicks,
          travelCostTicks: newTravelTicks,
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
