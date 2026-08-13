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
    const relation = world.spatial?.relations?.get(journey.relationId);
    const points = relation?.points ?? [];
    const oriented = relation && relation.fromId === journey.toLocationId && relation.toId === journey.fromLocationId
      ? [...points].reverse()
      : points;
    const position = fraction > 0 && oriented.length > 1 ? interpolate(oriented, fraction) : null;
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
          fromLocationId: journey.fromLocationId,
          toLocationId: journey.toLocationId,
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
        ...(position ? { xMetres: position.xMetres, yMetres: position.yMetres } : {}),
      },
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    });
    return events;
  },
};

function interpolate(points: readonly { xMetres: number; yMetres: number }[], fraction: number): { xMetres: number; yMetres: number } {
  const lengths = points.slice(1).map((point, index) => Math.hypot(point.xMetres - points[index]!.xMetres, point.yMetres - points[index]!.yMetres));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) return points[0]!;
  const target = total * fraction;
  let travelled = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const segment = lengths[index]!;
    if (travelled + segment >= target) {
      const local = (target - travelled) / segment;
      const from = points[index]!;
      const to = points[index + 1]!;
      return { xMetres: from.xMetres + (to.xMetres - from.xMetres) * local, yMetres: from.yMetres + (to.yMetres - from.yMetres) * local };
    }
    travelled += segment;
  }
  return points[points.length - 1]!;
}
