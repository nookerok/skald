import type { JourneyResolution } from "./types.js";
import type { SpatialWorldProjection, TravelRelation, SpatialRelationKind, CrossingState } from "../region/types.js";
import type { ObserverMapDTO } from "../region/types.js";

/**
 * Pure function: resolves a journey destination from observer-scoped
 * knowledge. Never reveals hidden geometry or unknown locations.
 *
 * This is the single resolver used by the runtime gate, the offline
 * classifier and the HTTP/integration tests (ADR-0011 shared-predicate
 * principle).
 */
export function resolveJourneyRoute(
  destination: string,
  currentLocationId: string,
  spatial: SpatialWorldProjection,
  observerMap: ObserverMapDTO,
): JourneyResolution {
  if (!currentLocationId) {
    return { kind: "blocked", reason: "no_route", playerText: "Ты не знаешь, где находишься." };
  }

  const normalizedDest = destination.toLowerCase().trim();
  if (normalizedDest.length === 0) {
    return { kind: "blocked", reason: "unknown_destination", playerText: "Ты не указал, куда muốn идти." };
  }

  // Find candidate locations from observer knowledge
  const candidateLocations: Array<{ id: string; name: string }> = [];

  for (const loc of observerMap.locations) {
    if (loc.knowledge === "rumored" || loc.knowledge === "glimpsed" || loc.knowledge === "observed" || loc.knowledge === "traversed") {
      const names = [loc.name, ...(loc.aliases ?? [])].map((name) => name.toLowerCase());
      if (names.some((name) => name === normalizedDest || name.includes(normalizedDest) || normalizedDest.includes(name))) {
        candidateLocations.push({ id: loc.ref, name: loc.name });
      }
    }
  }

  if (candidateLocations.length === 0) {
    return {
      kind: "blocked",
      reason: "unknown_destination",
      playerText: `Ты не знаешь дороги к «${destination}». Может быть, стоит осмотреться.`,
    };
  }

  if (candidateLocations.length > 1) {
    return {
      kind: "ambiguous",
      candidates: candidateLocations.map((c) => c.name),
    };
  }

  const targetLocation = candidateLocations[0]!;

  // Already at destination
  if (targetLocation.id === currentLocationId) {
    return {
      kind: "blocked",
      reason: "no_route",
      playerText: `Ты уже находишься в «${targetLocation.name}».`,
    };
  }

  // Find a travel relation from current location to target
  const relation = findTravelRelation(currentLocationId, targetLocation.id, spatial);

  if (!relation) {
    return {
      kind: "blocked",
      reason: "no_route",
      playerText: `Нет известного пути из «${getLocationName(currentLocationId, spatial)}» в «${targetLocation.name}».`,
    };
  }

  // Check passability — static passability first
  if (relation.passability === "blocked") {
    const reason = relation.kind === "crossing" ? "crossing_closed" : "no_route";
    return {
      kind: "blocked",
      reason,
      playerText: `Путь к «${targetLocation.name}» невозможен: ${relationLabel(relation.kind)} заблокирован.`,
    };
  }

  // Check dynamic crossing condition from river hydrology
  if (relation.kind === "crossing") {
    const crossingState = findCrossingState(relation, spatial);
    if (crossingState) {
      if (crossingState.condition === "closed") {
        return {
          kind: "blocked",
          reason: "crossing_closed",
          playerText: `Путь к «${targetLocation.name}» невозможен: переправа закрыта из-за высокой воды.`,
        };
      }
      // Difficult crossing: increase travel cost
      if (crossingState.condition === "difficult") {
        return {
          kind: "resolved",
          relationId: relation.id,
          fromLocationId: currentLocationId,
          toLocationId: targetLocation.id,
          travelTicks: crossingState.travelCostTicks,
        };
      }
    }
  }

  return {
    kind: "resolved",
    relationId: relation.id,
    fromLocationId: currentLocationId,
    toLocationId: targetLocation.id,
    travelTicks: relation.baseTravelTicks,
  };
}

function findTravelRelation(
  fromId: string,
  toId: string,
  spatial: SpatialWorldProjection,
): TravelRelation | undefined {
  for (const rel of spatial.travelRelations.values()) {
    if ((rel.fromId === fromId && rel.toId === toId) ||
        (rel.fromId === toId && rel.toId === fromId)) {
      return rel;
    }
  }
  return undefined;
}

function findCrossingState(relation: TravelRelation, spatial: SpatialWorldProjection): CrossingState | undefined {
  // Find crossing definition that matches this relation
  for (const [crossingId, def] of spatial.crossingDefinitions) {
    if (def.crossingId === relation.id || (def.openAtOrBelow !== undefined && relation.kind === "crossing")) {
      return spatial.crossingStates.get(crossingId);
    }
  }
  // Fallback: try matching by relation id directly
  return spatial.crossingStates.get(relation.id);
}

function getLocationName(locationId: string, spatial: SpatialWorldProjection): string {
  return spatial.locations.get(locationId)?.name ?? locationId;
}

function relationLabel(kind: SpatialRelationKind): string {
  switch (kind) {
    case "crossing": return "переправа";
    case "road": return "дорога";
    case "river": return "река";
    case "visibility": return "линия видимости";
    default: return "путь";
  }
}
