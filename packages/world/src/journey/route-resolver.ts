import type { JourneyResolution } from "./types.js";
import type { SpatialReadView, SpatialWorldProjection, TravelRelation, SpatialRelationKind, CrossingState } from "../region/types.js";
import type { ObserverMapDTO } from "../region/types.js";
import type { ObserverSpatialKnowledge } from "../region/observer-knowledge.js";
import { spatialKnowledgeRank } from "../region/observer-knowledge.js";
import { sameRussianStem, stemRussianToken } from "@skald/intent-parser";

/**
 * Endpoints of observer-known travel relations leaving a location: the one
 * shared predicate behind both the Game Shell advertised routes and journey
 * validation. A road the observer knows implies its named endpoint, even
 * when the endpoint location itself was never observed — advertising the
 * road while rejecting its destination would be a visible contradiction.
 * Passability is NOT filtered here: blocked relations still resolve so the
 * caller can answer "blocked" instead of "unknown".
 */
export function observedRouteEndpoints(
  spatial: SpatialReadView | null | undefined,
  spatialKnowledge: ObserverSpatialKnowledge | null | undefined,
  currentLocationId: string | null,
): Array<{ id: string; name: string; relationId: string }> {
  const endpoints: Array<{ id: string; name: string; relationId: string }> = [];
  if (!spatial || !currentLocationId) return endpoints;
  const seen = new Set<string>();
  for (const relation of spatial.travelRelations.values()) {
    const targetId = relation.fromId === currentLocationId ? relation.toId
      : relation.toId === currentLocationId ? relation.fromId
      : null;
    if (!targetId || seen.has(targetId)) continue;
    const target = spatial.locations?.get(targetId);
    if (!target) continue;
    const observation = spatialKnowledge?.relations.get(relation.id);
    if (!observation || spatialKnowledgeRank(observation.knowledge) < spatialKnowledgeRank("observed")) continue;
    seen.add(targetId);
    endpoints.push({ id: targetId, name: target.name, relationId: relation.id });
  }
  return endpoints;
}

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
  routeHint?: string,
  knownEndpoints?: readonly { id: string; name: string }[],
): JourneyResolution {
  if (!currentLocationId) {
    return { kind: "blocked", reason: "no_route", playerText: "Ты не знаешь, где находишься." };
  }

  const normalizedDest = normalizeLocationText(destination);
  if (normalizedDest.length === 0) {
    return { kind: "blocked", reason: "unknown_destination", playerText: "Ты не указал, куда идти." };
  }

  // Match observer-visible map entries back to canonical IDs without using
  // presentation refs as domain identifiers. A named glimpse may start a
  // journey only when an observer-visible route to it is known; this keeps
  // coordinates hidden while allowing a rumoured destination to be reached
  // through an explicitly chosen road or path.
  const candidateLocations: Array<{ id: string; name: string }> = [];
  for (const location of spatial.locations.values()) {
    const aliases = spatial.toponymIndex?.subjects.find((subject) => subject.id === location.id)?.aliases ?? [];
    const visible = observerMap.locations.find((entry) => {
      const rank = spatialKnowledgeRank(entry.knowledge);
      const observed = rank >= spatialKnowledgeRank("observed");
      const glimpsedRoute = rank === spatialKnowledgeRank("glimpsed")
        && Boolean(routeHint)
        && observerMap.routes.some((route) =>
          spatialKnowledgeRank(route.knowledge) >= spatialKnowledgeRank("observed")
          && ((route.fromLocationRef === observerMap.observer.locationRef && route.toLocationRef === entry.ref)
            || (route.toLocationRef === observerMap.observer.locationRef && route.fromLocationRef === entry.ref))
          && routeKindMatchesHint(route.kind, routeHint),
        );
      if (!observed && !glimpsedRoute) return false;
      // Observer DTOs may carry a reviewed alias instead of the canonical
      // name. Coordinates are a safe fallback because they are only emitted
      // for observed/traversed locations.
      const sameName = entry.name === location.name || aliases.includes(entry.name);
      const sameAnchor = entry.xMetres !== null && entry.yMetres !== null
        && entry.xMetres === location.anchor.xMetres
        && entry.yMetres === location.anchor.yMetres;
      return sameName || sameAnchor;
    });
    if (!visible) continue;
    const names = [location.name, ...aliases, visible.name, ...(visible.aliases ?? [])]
      .map(normalizeLocationText);
    if (names.some((name) => locationTextMatches(name, normalizedDest))) {
      candidateLocations.push({ id: location.id, name: location.name });
    }
  }

  // Endpoints of observed relations are known destinations even when the
  // endpoint location itself was never observed: the Game Shell advertises
  // exactly these roads, so rejecting their names here would contradict it.
  // Geometry still resolves through spatial truth; names never leak it.
  for (const endpoint of knownEndpoints ?? []) {
    if (candidateLocations.some((candidate) => candidate.id === endpoint.id)) continue;
    const target = spatial.locations.get(endpoint.id);
    if (!target) continue;
    const names = [target.name, endpoint.name].map(normalizeLocationText);
    if (names.some((name) => locationTextMatches(name, normalizedDest))) {
      candidateLocations.push({ id: target.id, name: target.name });
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
  const relation = findTravelRelation(currentLocationId, targetLocation.id, spatial, routeHint);

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

function normalizeLocationText(value: string): string {
  return value.toLowerCase().replace(/ё/gu, "е").replace(/[^a-zа-я0-9]+/giu, " ").trim();
}

/**
 * Player-facing destinations are naturally inflected («к Речному Стражу»),
 * while Canon stores the reviewed nominative toponym («Речной Страж»).
 * Token matching shares the canonical stemmer with the interaction target
 * resolver (@skald/intent-parser): exact and substring hits win first, then
 * whole-token stem equality rescues inflection. One stemmer everywhere, so
 * declined forms behave identically on every route. This never creates a
 * location or exposes hidden geometry.
 */
function locationTextMatches(candidate: string, query: string): boolean {
  if (candidate === query || candidate.includes(query) || query.includes(candidate)) return true;
  const candidateTokens = locationTextTokens(candidate);
  const queryTokens = locationTextTokens(query);
  if (queryTokens.length === 0 || queryTokens.length > candidateTokens.length) return false;
  return queryTokens.every((queryToken) =>
    candidateTokens.some((candidateToken) =>
      candidateToken === queryToken || sameRussianStem(candidateToken, queryToken),
    ),
  );
}

function locationTextTokens(value: string): string[] {
  return value
    .split(/\s+/u)
    .map((token) => stemRussianToken(token))
    .filter((token) => token.length > 0);
}

function routeKindMatchesHint(kind: SpatialRelationKind, routeHint: string | undefined): boolean {
  if (!routeHint) return false;
  const hint = routeHint.toLowerCase();
  if (hint.includes("дорог") || hint.includes("тракт") || hint.includes("road")) return kind === "road";
  if (hint.includes("переправ") || hint.includes("брод") || hint.includes("cross")) return kind === "crossing";
  if (hint.includes("рек") || hint.includes("вдоль") || hint.includes("river")) return kind === "river";
  return true;
}
function findTravelRelation(
  fromId: string,
  toId: string,
  spatial: SpatialWorldProjection,
  routeHint?: string,
): TravelRelation | undefined {
  const matches = [...spatial.travelRelations.values()].filter((rel) =>
    (rel.fromId === fromId && rel.toId === toId) || (rel.fromId === toId && rel.toId === fromId),
  );
  if (!routeHint?.trim()) return matches.find((rel) => rel.passability !== "blocked") ?? matches[0];
  const hint = routeHint.toLowerCase();
  const score = (relation: TravelRelation): number => {
    if ((hint.includes("\u043f\u0435\u0440\u0435\u043f\u0440\u0430\u0432") || hint.includes("\u0431\u0440\u043e\u0434") || hint.includes("cross")) && relation.kind === "crossing") return 0;
    if ((hint.includes("\u0434\u043e\u0440\u043e\u0433") || hint.includes("road") || hint.includes("\u0442\u0440\u0430\u043a\u0442")) && relation.kind === "road") return 0;
    if ((hint.includes("\u0440\u0435") || hint.includes("river") || hint.includes("\u0432\u0434\u043e\u043b\u044c")) && relation.kind === "river") return 0;
    return 1;
  };
  matches.sort((left, right) => score(left) - score(right) || left.baseTravelTicks - right.baseTravelTicks);
  for (const relation of matches) {
    if (relation.passability === "blocked") continue;
    if (relation.kind === "crossing" && findCrossingState(relation, spatial)?.condition === "closed") continue;
    return relation;
  }
  return matches[0];
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
