import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";

/**
 * Starts a journey and schedules its first travel step.
 *
 * Travel ticks are deliberately externalized: the first step is scheduled
 * immediately, while later TickPassed events advance the active journey one
 * tick at a time. This keeps the journey interruptible and ensures a partial
 * route can never be recorded as fully traversed.
 */
export const journeyStart: Rule<ReadonlyWorld> = {
  id: "journey.start",
  phase: "consequence",
  listens: ["JourneyStarted"],
  produces: ["JourneyStepRequested"],
  handle: (event: DomainEvent): DomainEvent[] => [{
    eventId: ruleEventId(event.eventId, "JourneyStepRequested", 0),
    type: "JourneyStepRequested",
    schemaVersion: 1,
    payload: { journeyId: (event.payload as { journeyId: string }).journeyId },
    timestamp: event.timestamp,
    correlationId: event.correlationId,
    causationId: event.eventId,
  }],
};
