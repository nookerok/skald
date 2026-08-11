import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld, JourneyState } from "../projection.js";
import { ruleEventId } from "../ids.js";

function base(event: DomainEvent) {
  return {
    schemaVersion: 1 as const,
    correlationId: event.correlationId,
    causationId: event.eventId,
  };
}

function completionEvents(event: DomainEvent, journey: JourneyState, world: ReadonlyWorld): DomainEvent[] {
  const completedAt = event.timestamp;
  const locationName = world.locations.get(journey.toLocationId)?.name ?? journey.toLocationId;
  const common = base(event);
  return [
    {
      ...common,
      eventId: ruleEventId(event.eventId, "PlayerLocationChanged", 0),
      type: "PlayerLocationChanged",
      timestamp: completedAt,
      payload: { locationId: journey.toLocationId, locationName },
    },
    {
      ...common,
      eventId: ruleEventId(event.eventId, "SpatialObservationRecorded", 1),
      type: "SpatialObservationRecorded",
      timestamp: completedAt,
      payload: {
        subjectKind: "relation",
        subjectId: journey.relationId,
        knowledge: "traversed",
        observedAt: completedAt,
        confidence: 1,
        observerId: "player",
        progressFraction: 1,
      },
    },
    {
      ...common,
      eventId: ruleEventId(event.eventId, "SpatialObservationRecorded", 2),
      type: "SpatialObservationRecorded",
      timestamp: completedAt,
      payload: {
        subjectKind: "location",
        subjectId: journey.toLocationId,
        knowledge: "traversed",
        observedAt: completedAt,
        confidence: 1,
        observerId: "player",
      },
    },
    {
      ...common,
      eventId: ruleEventId(event.eventId, "JourneyCompleted", 3),
      type: "JourneyCompleted",
      timestamp: completedAt,
      payload: { journeyId: journey.journeyId },
    },
  ];
}

/**
 * Advances an active journey one tick at a time.
 *
 * Offline ticks advance the world clock but do not progress a player's active
 * journey or create observer knowledge. A normal TickPassed can complete the
 * route; only then is the destination and full relation marked traversed.
 */
export const journeyProgress: Rule<ReadonlyWorld> = {
  id: "journey.progress",
  phase: "consequence",
  listens: ["JourneyStepRequested", "TickPassed"],
  produces: ["TickPassed", "PlayerLocationChanged", "SpatialObservationRecorded", "JourneyCompleted"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const journeyId = event.type === "JourneyStepRequested"
      ? (event.payload as { journeyId?: string }).journeyId
      : world.activeJourneyId;
    if (!journeyId || world.activeJourneyId !== journeyId) return [];
    const journey = world.journeys.get(journeyId);
    if (!journey || journey.status !== "active") return [];

    if (event.type === "JourneyStepRequested") {
      if (journey.plannedTicks <= 0) return completionEvents(event, journey, world);
      return [{
        ...base(event),
        eventId: ruleEventId(event.eventId, "TickPassed", 0),
        type: "TickPassed",
        timestamp: Math.max(world.time, event.timestamp) + 1,
        payload: { delta: 1, journeyId: journey.journeyId },
      }];
    }

    const payload = event.payload as { delta?: number; playerOffline?: boolean };
    if (payload.playerOffline) return [];
    const delta = Math.max(0, Math.floor(payload.delta ?? 1));
    const nextElapsed = Math.min(journey.plannedTicks, journey.elapsedTicks + delta);
    if (nextElapsed < journey.plannedTicks) return [];
    return completionEvents(event, journey, world);
  },
};
