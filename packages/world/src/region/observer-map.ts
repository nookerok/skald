import type { DomainEvent } from "@skald/event-bus";
import type { ObserverMapDTO, ObserverMapLandmark, ObserverMapLocation, ObserverMapRoute, ObserverMapRouteGeometry, ObserverMapPoint, ObserverMapTerrainPatch, ObserverMapWaterBody, ObserverMapWatercourse, SpatialKnowledge, SpatialWorldProjection } from "./types.js";
import type { ObserverPosition, VisibilityResult } from "../visibility/types.js";
import { computeVisibility, terrainElevationAt } from "../visibility/visibility-engine.js";

function ref(prefix: string, id: string): string {
  let hash = 0x811c9dc5;
  const value = `${prefix}:${id}`;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193) >>> 0;
  return `${prefix}-${hash.toString(36)}`;
}

function freshness(observedAt: number, worldTime: number): number {
  return Math.max(0, Math.min(1, 1 - Math.max(0, worldTime - observedAt) / 20));
}

function currentLocation(events: readonly DomainEvent[]): string | null {
  let id: string | null = null;
  for (const event of events) if (event.type === "PlayerLocationChanged") id = (event.payload as { locationId: string }).locationId;
  return id;
}

/**
 * Build observer position from current location.
 * Returns null if no location is set or location not found in spatial.
 */
function buildObserverPosition(
  locationId: string | null,
  spatial: SpatialWorldProjection,
): ObserverPosition | null {
  if (!locationId) return null;
  const location = spatial.locations.get(locationId);
  if (!location) return null;
  const elevation = terrainElevationAt(location.anchor.xMetres, location.anchor.yMetres, spatial);
  return {
    xMetres: location.anchor.xMetres,
    yMetres: location.anchor.yMetres,
    elevationMetres: elevation,
    locationRef: locationId,
  };
}

/** Builds only observer evidence; canonical region geometry never crosses this boundary. */
export function buildObserverMap(
  events: readonly DomainEvent[],
  spatial: SpatialWorldProjection,
  useVisibility?: boolean,
): ObserverMapDTO {
  const worldTime = events.reduce((max, event) => Math.max(max, event.timestamp), 0);
  const locationId = currentLocation(events);
  const observations = events.filter((event) => event.type === "SpatialObservationRecorded").map((event) => event.payload as { subjectKind: "location" | "landmark" | "relation"; subjectId: string; knowledge: SpatialKnowledge; observedAt: number; confidence: number; bearing?: string });
  const known = new Map<string, typeof observations[number]>();
  for (const observation of observations) {
    const previous = known.get(`${observation.subjectKind}:${observation.subjectId}`);
    if (!previous || observation.observedAt >= previous.observedAt) known.set(`${observation.subjectKind}:${observation.subjectId}`, observation);
  }
  if (locationId && spatial.locations.has(locationId) && !known.has(`location:${locationId}`)) known.set(`location:${locationId}`, { subjectKind: "location", subjectId: locationId, knowledge: "traversed", observedAt: worldTime, confidence: 1 });

  // Compute visibility from current position if enabled
  let visibilityResults: Map<string, VisibilityResult> | null = null;
  if (useVisibility) {
    const observer = buildObserverPosition(locationId, spatial);
    if (observer) {
      visibilityResults = computeVisibility(observer, spatial);
    }
  }

  const locations: ObserverMapLocation[] = [];
  for (const [key, observation] of known) {
    if (observation.subjectKind !== "location") continue;
    const location = spatial.locations.get(observation.subjectId);
    if (!location) continue;
    locations.push({ ref: ref("loc", location.id), name: location.name, aliases: spatial.toponymIndex?.subjects.find((subject) => subject.id === location.id)?.aliases ?? [], knowledge: observation.knowledge, confidence: observation.confidence, freshness: freshness(observation.observedAt, worldTime), xMetres: location.anchor.xMetres, yMetres: location.anchor.yMetres });
    void key;
  }

  // Merge visibility results: use visibility if it provides better knowledge
  if (visibilityResults) {
    for (const [targetRef, visResult] of visibilityResults) {
      if (!visResult.visible) continue;
      const existingKey = `location:${targetRef}`;
      const existing = known.get(existingKey);
      // Visibility gives higher knowledge than existing
      if (!existing || knowledgeRank(visResult.knowledge) > knowledgeRank(existing.knowledge)) {
        const location = spatial.locations.get(targetRef);
        if (location) {
          locations.push({
            ref: ref("loc", location.id),
            name: location.name,
            aliases: spatial.toponymIndex?.subjects.find((subject) => subject.id === location.id)?.aliases ?? [],
            knowledge: visResult.knowledge,
            confidence: visResult.confidence,
            freshness: 1,
            xMetres: location.anchor.xMetres,
            yMetres: location.anchor.yMetres,
          });
        }
      }
    }
  }

  const landmarks: ObserverMapLandmark[] = [];
  for (const observation of known.values()) {
    if (observation.subjectKind !== "landmark") continue;
    const landmark = spatial.landmarks.get(observation.subjectId);
    if (!landmark) continue;
    const exact = observation.knowledge === "observed" || observation.knowledge === "traversed";
    landmarks.push({ ref: ref("landmark", landmark.id), name: landmark.name, silhouette: landmark.silhouetteClass, knowledge: observation.knowledge, confidence: observation.confidence, freshness: freshness(observation.observedAt, worldTime), xMetres: exact ? landmark.anchor.xMetres : null, yMetres: exact ? landmark.anchor.yMetres : null, bearing: observation.bearing ?? null });
  }

  // Merge visibility results for landmarks
  if (visibilityResults) {
    for (const [targetRef, visResult] of visibilityResults) {
      if (!visResult.visible) continue;
      const existingForLandmark = [...known.values()].find(
        (o) => o.subjectKind === "landmark" && o.subjectId === targetRef,
      );
      if (!existingForLandmark || knowledgeRank(visResult.knowledge) > knowledgeRank(existingForLandmark.knowledge)) {
        const landmark = spatial.landmarks.get(targetRef);
        if (landmark) {
          landmarks.push({
            ref: ref("landmark", landmark.id),
            name: landmark.name,
            silhouette: landmark.silhouetteClass,
            knowledge: visResult.knowledge,
            confidence: visResult.confidence,
            freshness: 1,
            xMetres: visResult.exactPositionAllowed ? landmark.anchor.xMetres : null,
            yMetres: visResult.exactPositionAllowed ? landmark.anchor.yMetres : null,
            bearing: visResult.bearing,
          });
        }
      }
    }
  }

  const routes: ObserverMapRoute[] = [];
  for (const observation of known.values()) {
    if (observation.subjectKind !== "relation") continue;
    const relation = spatial.relations.get(observation.subjectId);
    if (!relation) continue;

    // Build route geometry based on knowledge level
    const geometry = buildRouteGeometry(relation.points, observation.knowledge);

    routes.push({
      ref: ref("route", relation.id),
      kind: relation.kind,
      label: relation.label,
      fromLocationRef: ref("loc", relation.fromId),
      toLocationRef: ref("loc", relation.toId),
      knowledge: observation.knowledge,
      confidence: observation.confidence,
      freshness: freshness(observation.observedAt, worldTime),
      geometry,
    });
  }
  const hydrography = spatial.hydrography ?? spatial.region?.hydrography;
  const toponymName = (subjectId: string): string | null => spatial.toponymIndex?.subjects.find((subject) => subject.id === subjectId)?.canonicalName ?? null;
  const knownWatercourses: ObserverMapWatercourse[] = [];
  const knownWaterBodies: ObserverMapWaterBody[] = [];
  for (const watercourse of hydrography?.watercourses ?? []) {
    const observation = [...known.values()].find((entry) => entry.subjectId === watercourse.id);
    if (!observation || observation.knowledge === "rumored") continue;
    const relation = spatial.relations.get(watercourse.id);
    knownWatercourses.push({
      ref: ref("watercourse", watercourse.id),
      name: toponymName(watercourse.id),
      kind: watercourse.kind,
      knowledge: observation.knowledge,
      confidence: observation.confidence,
      freshness: freshness(observation.observedAt, worldTime),
      geometry: relation ? buildRouteGeometry(relation.points, observation.knowledge) : null,
    });
  }
  for (const waterBody of hydrography?.waterBodies ?? []) {
    const observation = [...known.values()].find((entry) => entry.subjectId === waterBody.id);
    if (!observation || observation.knowledge === "rumored") continue;
    knownWaterBodies.push({
      ref: ref("waterbody", waterBody.id),
      name: toponymName(waterBody.id) ?? (waterBody.classification === "unresolved" ? "Южная водная область" : null),
      classification: waterBody.classification,
      classificationConfidence: observation.confidence,
      knowledge: observation.knowledge,
      confidence: observation.confidence,
      freshness: freshness(observation.observedAt, worldTime),
      geometry: null,
    });
  }

  // Rumors may be listed as uncertain knowledge, but their authored coordinates
  // must not expand or shift the observer-visible map area.
  const points = locations
    .filter((entry) => entry.knowledge !== "rumored")
    .map((entry) => ({ x: entry.xMetres, y: entry.yMetres }));
  const knownArea = points.length === 0 ? null : { minXMetres: Math.max(0, Math.min(...points.map((p) => p.x)) - 1_000), minYMetres: Math.max(0, Math.min(...points.map((p) => p.y)) - 1_000), maxXMetres: Math.max(...points.map((p) => p.x)) + 1_000, maxYMetres: Math.max(...points.map((p) => p.y)) + 1_000 };
  const knownTerrain: ObserverMapTerrainPatch[] = [];
  if (knownArea && spatial.region) {
    for (const tile of spatial.region.tiles) {
      const intersects = tile.bounds.maxXMetres >= knownArea.minXMetres && tile.bounds.minXMetres <= knownArea.maxXMetres && tile.bounds.maxYMetres >= knownArea.minYMetres && tile.bounds.minYMetres <= knownArea.maxYMetres;
      if (intersects) knownTerrain.push({ bounds: tile.bounds, surface: tile.surface, elevationBand: tile.elevationBand, slopeBand: tile.slopeBand });
    }
  }

  const current = locationId ? spatial.locations.get(locationId) : undefined;
  return Object.freeze({ schemaVersion: 2, revision: { worldTime, eventNumber: events.length }, region: spatial.region ? { ref: ref("region", spatial.region.id), name: spatial.region.name } : null, observer: { locationRef: current ? ref("loc", current.id) : null, xMetres: current?.anchor.xMetres ?? null, yMetres: current?.anchor.yMetres ?? null }, knownArea, knownTerrain: Object.freeze(knownTerrain), locations: Object.freeze(locations), landmarks: Object.freeze(landmarks), routes: Object.freeze(routes), knownWatercourses: Object.freeze(knownWatercourses), knownWaterBodies: Object.freeze(knownWaterBodies) });
}

/**
 * Build route geometry for observer map.
 * - observed/traversed: full path (simplified)
 * - glimpsed: directional stub from observer to midpoint
 * - rumored: null (not visualizable)
 */
function buildRouteGeometry(
  points: readonly { xMetres: number; yMetres: number }[],
  knowledge: SpatialKnowledge,
): ObserverMapRouteGeometry {
  if (knowledge === "rumored" || points.length === 0) return null;

  if (knowledge === "observed" || knowledge === "traversed") {
    // Simplify path: keep first, last, and every Nth point
    const simplified = simplifyPath(points, 8);
    return { kind: "observed_path", points: simplified };
  }

  // glimpsed: directional stub from region center toward the route
  if (points.length >= 2) {
    const mid = points[Math.floor(points.length / 2)]!;
    const from = points[0]!;
    const bearing = computeSimpleBearing(from.xMetres, from.yMetres, mid.xMetres, mid.yMetres);
    return { kind: "directional_stub", bearing };
  }

  return null;
}

/** Simplify path by keeping every Nth point plus endpoints */
function simplifyPath(
  points: readonly { xMetres: number; yMetres: number }[],
  maxPoints: number,
): ObserverMapPoint[] {
  if (points.length <= maxPoints) {
    return points.map((p) => ({ xMetres: p.xMetres, yMetres: p.yMetres }));
  }
  const step = Math.ceil((points.length - 2) / (maxPoints - 2));
  const result: ObserverMapPoint[] = [{ xMetres: points[0]!.xMetres, yMetres: points[0]!.yMetres }];
  for (let i = 1; i < points.length - 1; i += step) {
    result.push({ xMetres: points[i]!.xMetres, yMetres: points[i]!.yMetres });
  }
  result.push({ xMetres: points[points.length - 1]!.xMetres, yMetres: points[points.length - 1]!.yMetres });
  return result;
}

function computeSimpleBearing(fromX: number, fromY: number, toX: number, toY: number): string {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const angle = Math.atan2(dx, -dy) * (180 / Math.PI);
  const normalized = ((angle % 360) + 360) % 360;
  if (normalized < 22.5 || normalized >= 337.5) return "север";
  if (normalized < 67.5) return "северо-восток";
  if (normalized < 112.5) return "восток";
  if (normalized < 157.5) return "юго-восток";
  if (normalized < 202.5) return "юг";
  if (normalized < 247.5) return "юго-запад";
  if (normalized < 292.5) return "запад";
  return "северо-запад";
}

function knowledgeRank(k: SpatialKnowledge): number {
  switch (k) {
    case "traversed": return 4;
    case "observed": return 3;
    case "glimpsed": return 2;
    case "rumored": return 1;
    default: return 0;
  }
}
