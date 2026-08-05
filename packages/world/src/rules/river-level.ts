/**
 * River Level Rule (ADR-0017 §7).
 *
 * Listens to TickPassed, computes deterministic river level from
 * RiverProcessDefinition, emits RiverLevelChanged when level/band changes.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import type { RiverProcessDefinition, RiverBand } from "../region/types.js";
import { ruleEventId } from "../ids.js";

/**
 * Deterministic river level computation.
 * Cyclic profile: rise → high → fall → low.
 */
export function computeRiverLevel(
  process: RiverProcessDefinition,
  worldTime: number,
): number {
  const cyclePos = ((worldTime - process.phaseOffset) % process.cycleLengthTicks + process.cycleLengthTicks) % process.cycleLengthTicks;
  const halfCycle = process.cycleLengthTicks / 2;

  let level: number;
  if (cyclePos < halfCycle) {
    // Rising phase: baseline → maximum
    const progress = cyclePos / halfCycle;
    level = process.baselineLevel + (process.maximumLevel - process.baselineLevel) * progress;
  } else {
    // Falling phase: maximum → baseline
    const progress = (cyclePos - halfCycle) / halfCycle;
    level = process.maximumLevel - (process.maximumLevel - process.baselineLevel) * progress;
  }

  return Math.round(Math.max(process.minimumLevel, Math.min(process.maximumLevel, level)));
}

export function classifyRiverBand(level: number, process: RiverProcessDefinition): RiverBand {
  const ratio = (level - process.minimumLevel) / (process.maximumLevel - process.minimumLevel);
  if (ratio <= 0.25) return "low";
  if (ratio <= 0.5) return "normal";
  if (ratio <= 0.75) return "high";
  return "flood";
}

/**
 * River level process rule.
 * For each registered RiverProcessDefinition, computes the level at current
 * world time and emits RiverLevelChanged if it differs from stored state.
 */
export const riverLevelProcess: Rule<ReadonlyWorld> = {
  id: "hydrology.river_level",
  phase: "physics",
  listens: ["TickPassed"],
  produces: ["RiverLevelChanged"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const spatial = world.spatial;
    if (!spatial) return [];

    const events: DomainEvent[] = [];
    let idx = 0;

    for (const process of spatial.riverProcesses.values()) {
      const newLevel = computeRiverLevel(process, event.timestamp);
      const newBand = classifyRiverBand(newLevel, process);
      const existing = spatial.riverStates.get(process.watercourseId);

      // Only emit if level or band actually changed
      if (existing && existing.level === newLevel && existing.band === newBand) continue;
      // Don't emit for same timestamp (dedup)
      if (existing && existing.updatedAt === event.timestamp) continue;

      events.push({
        eventId: ruleEventId(event.eventId, "RiverLevelChanged", idx),
        type: "RiverLevelChanged",
        schemaVersion: 1,
        payload: {
          watercourseId: process.watercourseId,
          previousLevel: existing?.level ?? process.baselineLevel,
          level: newLevel,
          previousBand: existing?.band ?? classifyRiverBand(process.baselineLevel, process),
          band: newBand,
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
