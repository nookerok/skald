import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";

export const journeyInterrupt: Rule<ReadonlyWorld> = {
  id: "journey.interrupt",
  phase: "consequence",
  listens: ["JourneyInterruptValidated"],
  produces: ["SpatialObservationRecorded", "JourneyInterrupted", "JourneyBlocked"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const journeyId = world.activeJourneyId;
    const journey = journeyId ? world.journeys.get(journeyId) : undefined;
    if (!journey || journey.status !== "active") {
      return [{
        eventId: ruleEventId(event.eventId, "JourneyBlocked", 0),
        type: "JourneyBlocked",
        schemaVersion: 1,
        payload: {
          reason: "no_active_journey",
          playerText: "Сейчас ты не находишься в путешествии.",
        },
        timestamp: event.timestamp,
        correlationId: event.correlationId,
        causationId: event.eventId,
      }];
    }

    const fraction = journey.plannedTicks > 0
      ? Math.max(0, Math.min(1, journey.elapsedTicks / journey.plannedTicks))
      : 0;
    const events: DomainEvent[] = [];
    if (fraction > 0) {
      events.push({
        eventId: ruleEventId(event.eventId, "SpatialObservationRecorded", 0),
        type: "SpatialObservationRecorded",
        schemaVersion: 1,
        payload: {
          subjectKind: "relation",
          subjectId: journey.relationId,
          knowledge: "observed",
          observedAt: event.timestamp,
          confidence: 0.75,
          observerId: "player",
          progressFraction: fraction,
        },
        timestamp: event.timestamp,
        correlationId: event.correlationId,
        causationId: event.eventId,
      });
    }
    events.push({
      eventId: ruleEventId(event.eventId, "JourneyInterrupted", 1),
      type: "JourneyInterrupted",
      schemaVersion: 1,
      payload: {
        journeyId: journey.journeyId,
        elapsedTicks: journey.elapsedTicks,
        plannedTicks: journey.plannedTicks,
        reason: "player_stopped",
      },
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    });
    return events;
  },
};
