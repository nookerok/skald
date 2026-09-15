import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld, JourneyState } from "../projection.js";
import { ruleEventId } from "../ids.js";
import { closedCrossingText, highWaterAhead } from "../journey/crossing-cause.js";

function base(event: DomainEvent) {
  return {
    schemaVersion: 1 as const,
    correlationId: event.correlationId,
    causationId: event.eventId,
  };
}

/**
 * A closed crossing ahead blocks arrival: the journey becomes blocked
 * projection state (cleared by completion or interruption) and the master
 * names the proven cause, instead of completing through high water. The
 * block is emitted once — further ticks while closed stay silent — and the
 * same journey resumes when the crossing reopens. Mirrors the lookup order
 * of the route resolver (definition id first, crossing reference fallback)
 * without duplicating its matching.
 */
function crossingClosedAhead(world: ReadonlyWorld, journey: JourneyState): boolean {
  const spatial = world.spatial;
  if (!spatial) return false;
  const relation = spatial.travelRelations.get(journey.relationId);
  if (!relation || relation.kind !== "crossing") return false;
  const crossing = spatial.crossingStates.get(relation.id)
    ?? [...spatial.crossingStates.values()].find((state) => state.crossingId === relation.id);
  return crossing?.condition === "closed";
}

function blockedCrossing(event: DomainEvent, journey: JourneyState, world: ReadonlyWorld): DomainEvent[] {
  const locationName = world.locations.get(journey.toLocationId)?.name ?? journey.toLocationId;
  return [{
    ...base(event),
    eventId: ruleEventId(event.eventId, "JourneyBlocked", 4),
    type: "JourneyBlocked",
    timestamp: event.timestamp,
    payload: {
      reason: "crossing_closed",
      journeyId: journey.journeyId,
      playerText: closedCrossingText(locationName, highWaterAhead(world.spatial, journey.relationId)),
    },
  }];
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
        fromLocationId: journey.fromLocationId,
        toLocationId: journey.toLocationId,
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
  produces: ["TickPassed", "PlayerLocationChanged", "SpatialObservationRecorded", "JourneyBlocked", "JourneyCompleted"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const journeyId = event.type === "JourneyStepRequested"
      ? (event.payload as { journeyId?: string }).journeyId
      : world.activeJourneyId;
    if (!journeyId || world.activeJourneyId !== journeyId) return [];
    const journey = world.journeys.get(journeyId);
    if (!journey || (journey.status !== "active" && journey.status !== "blocked")) return [];

    // A blocked journey is real projection state, not a repeated verdict:
    // while the crossing stays closed the block stands silently (no
    // duplicate JourneyBlocked); once it reopens the SAME journey resumes.
    if (journey.status === "blocked") {
      if (crossingClosedAhead(world, journey)) return [];
      return completionEvents(event, journey, world);
    }

    if (event.type === "JourneyStepRequested") {
      if (journey.plannedTicks <= 0) {
        if (crossingClosedAhead(world, journey)) return blockedCrossing(event, journey, world);
        return completionEvents(event, journey, world);
      }
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
    if (crossingClosedAhead(world, journey)) return blockedCrossing(event, journey, world);
    return completionEvents(event, journey, world);
  },
};
