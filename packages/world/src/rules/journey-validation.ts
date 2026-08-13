import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";
import { resolveJourneyRoute } from "../journey/route-resolver.js";
import type { SpatialWorldProjection } from "../region/types.js";
import type { ObserverMapDTO } from "../region/types.js";

/**
 * Journey validation rule (ADR-0015).
 *
 * Listens to JourneyValidated (after duration_check gate).
 * Calls resolveJourneyRoute to check destination and passability.
 * Emits JourneyStarted or JourneyBlocked.
 *
 * This is the sole owner of JourneyValidated.
 */
export function createJourneyValidationRule(
  spatial: SpatialWorldProjection,
  observerMap: ObserverMapDTO | (() => ObserverMapDTO),
): Rule<ReadonlyWorld> {
  return {
    id: "journey.validate",
    phase: "validation",
    listens: ["JourneyValidated"],
    produces: ["JourneyStarted", "JourneyBlocked"],
    handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
      const payload = event.payload as {
        destination: string;
        routeHint?: string | null;
      };

      const base = {
        schemaVersion: 1 as const,
        timestamp: event.timestamp,
        correlationId: event.correlationId,
        causationId: event.eventId,
      };

      // Resolve against the observers current knowledge. The registry is
      // static, but observer-scoped route knowledge grows as events arrive.
      const currentObserverMap = typeof observerMap === "function" ? observerMap() : observerMap;

      // Resolve the route
      const resolution = resolveJourneyRoute(
        payload.destination,
        world.currentLocationId,
        spatial,
        currentObserverMap,
        payload.routeHint ?? undefined,
      );

      if (resolution.kind === "resolved") {
        const journeyId = `journey#${event.eventId}`;
        return [{
          ...base,
          eventId: ruleEventId(event.eventId, "JourneyStarted", 0),
          type: "JourneyStarted",
          payload: {
            journeyId,
            relationId: resolution.relationId,
            fromLocationId: resolution.fromLocationId,
            toLocationId: resolution.toLocationId,
            startedAt: event.timestamp,
            plannedTicks: resolution.travelTicks,
            ...(payload.routeHint ? { routeHint: payload.routeHint } : {}),
          },
        }];
      }

      if (resolution.kind === "blocked") {
        return [{
          ...base,
          eventId: ruleEventId(event.eventId, "JourneyBlocked", 0),
          type: "JourneyBlocked",
          payload: {
            reason: resolution.reason,
            playerText: resolution.playerText,
          },
        }];
      }

      // ambiguous
      return [{
        ...base,
        eventId: ruleEventId(event.eventId, "JourneyBlocked", 0),
        type: "JourneyBlocked",
        payload: {
          reason: "ambiguous",
          playerText: `Куда именно ты хочешь идти? ${resolution.candidates.join(" или ")}`,
        },
      }];
    },
  };
}
