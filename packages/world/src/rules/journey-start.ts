import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";

/**
 * Journey start rule (ADR-0015).
 *
 * Listens to JourneyStarted. Creates JourneyState in Projection
 * and emits TickPassed × N for the journey duration, plus
 * PlayerLocationChanged and JourneyCompleted after the last tick.
 *
 * This is the sole owner of JourneyStarted.
 */
export const journeyStart: Rule<ReadonlyWorld> = {
  id: "journey.start",
  phase: "consequence",
  listens: ["JourneyStarted"],
  produces: ["TickPassed", "PlayerLocationChanged", "JourneyCompleted"],
  handle: (event: DomainEvent, _world: ReadonlyWorld): DomainEvent[] => {
    const payload = event.payload as {
      journeyId: string;
      relationId: string;
      fromLocationId: string;
      toLocationId: string;
      startedAt: number;
      plannedTicks: number;
    };

    const base = {
      schemaVersion: 1 as const,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    };

    const events: DomainEvent[] = [];

    // Emit TickPassed for each travel tick
    for (let i = 0; i < payload.plannedTicks; i++) {
      events.push({
        ...base,
        eventId: ruleEventId(event.eventId, "TickPassed", i),
        type: "TickPassed",
        payload: { delta: 1 },
      });
    }

    // Emit PlayerLocationChanged at the end of the journey
    events.push({
      ...base,
      eventId: ruleEventId(event.eventId, "PlayerLocationChanged", payload.plannedTicks),
      type: "PlayerLocationChanged",
      payload: {
        locationId: payload.toLocationId,
        locationName: _world.locations.get(payload.toLocationId)?.name ?? payload.toLocationId,
      },
    });

    // Emit JourneyCompleted
    events.push({
      ...base,
      eventId: ruleEventId(event.eventId, "JourneyCompleted", payload.plannedTicks + 1),
      type: "JourneyCompleted",
      payload: {
        journeyId: payload.journeyId,
      },
    });

    return events;
  },
};
