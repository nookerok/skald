/**
 * Journey travel rule — production path (ADR-0015).
 *
 * Consumes JourneyValidated (after the duration_check gate) and resolves the
 * destination against observer-reachable space using ONLY the ReadonlyWorld
 * read views: world.locations (names) and world.spatial (travel relations +
 * crossing states, maintained by WorldProjector). Emits JourneyStarted or
 * JourneyBlocked. Unlike the offline/test journey validation rule, it has no
 * closure observerMap dependency and uses raw location ids consistently.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";
import { spatialKnowledgeRank } from "../region/observer-knowledge.js";

function blocked(event: DomainEvent, idx: number, reason: string, playerText: string): DomainEvent {
  return {
    eventId: ruleEventId(event.eventId, "JourneyBlocked", idx),
    type: "JourneyBlocked",
    schemaVersion: 1,
    payload: { reason, playerText },
    timestamp: event.timestamp,
    correlationId: event.correlationId,
    causationId: event.eventId,
  };
}

function relationLabel(kind: string): string {
  switch (kind) {
    case "crossing": return "переправа";
    case "road": return "дорога";
    case "river": return "река";
    case "visibility": return "линия видимости";
    default: return "путь";
  }
}

function normalize(text: string): string {
  return text.toLowerCase()
    .replace(/\u0451/g, "\u0435")
    .replace(/[^\u0061-\u007a\u0430-\u044f0-9]+/gu, " ")
    .trim();
}

function stemToken(token: string): string {
  let stem = token.replace(/[\u0430\u0435\u0438\u043e\u0443\u044b\u044d\u044e\u044f]/gu, "");
  if (stem.endsWith("\u043c") || stem.endsWith("\u0439")) stem = stem.slice(0, -1);
  return stem;
}

/** Tolerant phrase matching without treating a shared suffix as the place name. */
function namesMatch(raw: string, name: string): boolean {
  const a = normalize(raw);
  const b = normalize(name);
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const ta = a.split(" ").filter(Boolean).map(stemToken);
  const tb = b.split(" ").filter(Boolean).map(stemToken);
  return ta.length === tb.length && ta.every((token, index) => token.length > 0 && token === tb[index]);
}

export const journeyTravel: Rule<ReadonlyWorld> = {
  id: "journey.travel",
  phase: "validation",
  listens: ["JourneyValidated"],
  produces: ["JourneyStarted", "JourneyBlocked"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const payload = event.payload as { destination?: string };
    const destination = (payload.destination ?? "").trim();
    const currentId = world.currentLocationId;

    if (!currentId) return [blocked(event, 0, "no_route", "Ты не знаешь, где находишься.")];
    if (!destination) return [blocked(event, 0, "unknown_destination", "Ты не указал, куда идти.")];

    // Living-region worlds resolve only observer-known locations. Legacy worlds
    // have no spatial knowledge read model and retain their compatibility path.
    const knownLocationIds = world.spatialKnowledge
      ? new Set([...world.spatialKnowledge.locations.entries()]
        .filter(([, observation]) => spatialKnowledgeRank(observation.knowledge) >= spatialKnowledgeRank("observed"))
        .map(([locationId]) => locationId))
      : null;
    const candidates = [...world.locations.values()].filter((location) => {
      if (knownLocationIds && !knownLocationIds.has(location.id)) return false;
      const aliases = world.spatial?.toponymIndex?.subjects.find((subject) => subject.id === location.id)?.aliases ?? [];
      return namesMatch(destination, location.name) || aliases.some((alias) => namesMatch(destination, alias));
    });

    if (candidates.length === 0) {
      return [blocked(event, 0, "unknown_destination", `Ты не знаешь дороги к «${destination}». Может быть, стоит осмотреться.`)];
    }
    if (candidates.length > 1) {
      return [blocked(event, 0, "ambiguous", `Куда именно: ${candidates.map((c) => c.name).join(" или ")}?`)];
    }
    const target = candidates[0]!;
    if (target.id === currentId) {
      return [blocked(event, 0, "no_route", `Ты уже находишься в «${target.name}».`)];
    }

    // Find a travel relation between the current location and the target.
    const spatial = world.spatial;
    const relation = spatial?.travelRelations
      ? [...spatial.travelRelations.values()].find(
          (r) => (r.fromId === currentId && r.toId === target.id) || (r.fromId === target.id && r.toId === currentId),
        )
      : undefined;

    if (!relation) {
      return [blocked(event, 0, "no_route", `Нет известного пути из «${world.locations.get(currentId)?.name ?? currentId}» в «${target.name}».`)];
    }
    if (relation.passability === "blocked") {
      const reason = relation.kind === "crossing" ? "crossing_closed" : "no_route";
      return [blocked(event, 0, reason, `Путь к «${target.name}» невозможен: ${relationLabel(relation.kind)} заблокирован.`)];
    }

    // Dynamic crossing condition from river hydrology (P02 -> P03).
    let travelTicks = relation.baseTravelTicks;
    if (relation.kind === "crossing" && spatial) {
      const crossing = spatial.crossingStates.get(relation.id)
        ?? [...spatial.crossingStates.values()].find((c) => c.crossingId === relation.id);
      if (crossing) {
        if (crossing.condition === "closed") {
          return [blocked(event, 0, "crossing_closed", `Путь к «${target.name}» невозможен: переправа закрыта из-за высокой воды.`)];
        }
        if (crossing.condition === "difficult") travelTicks = crossing.travelCostTicks;
      }
    }

    return [{
      eventId: ruleEventId(event.eventId, "JourneyStarted", 0),
      type: "JourneyStarted",
      schemaVersion: 1,
      payload: {
        journeyId: `journey#${event.eventId}`,
        relationId: relation.id,
        fromLocationId: currentId,
        toLocationId: target.id,
        startedAt: event.timestamp,
        plannedTicks: travelTicks,
      },
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    }];
  },
};
