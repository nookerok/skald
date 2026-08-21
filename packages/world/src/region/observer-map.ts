import type { DomainEvent } from "@skald/event-bus";
import type { ObserverMapApproximation, ObserverMapDTO, ObserverMapLandmark, ObserverMapLocation, ObserverMapRoute, ObserverMapRouteGeometry, ObserverMapPoint, ObserverMapTerrainPatch, ObserverMapWaterBody, ObserverMapWatercourse, ObserverMapRevealZone, SpatialKnowledge, SpatialObservationPayload, SpatialWorldProjection } from "./types.js";
import type { ObserverPosition, VisibilityResult } from "../visibility/types.js";
import { computeVisibility, terrainElevationAt } from "../visibility/visibility-engine.js";
import { buildObserverSpatialKnowledge, spatialKnowledgeRank } from "./observer-knowledge.js";
import { buildAvailableObserverMapDetails } from "./map-details.js";
import { buildObserverTerrainRegions, stableObserverSeed } from "./observer-map-geometry.js";

function ref(prefix: string, id: string): string {
  let hash = 0x811c9dc5;
  const value = `${prefix}:${id}`;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193) >>> 0;
  return `${prefix}-${hash.toString(36)}`;
}

function freshness(observedAt: number, worldTime: number): number {
  return Math.max(0, Math.min(1, 1 - Math.max(0, worldTime - observedAt) / 20));
}

function approximationFor(
  knowledge: SpatialKnowledge,
  bearing: string | null | undefined,
  shape: ObserverMapApproximation["shape"],
  confidence: number,
): ObserverMapApproximation | null {
  if (knowledge !== "glimpsed" || !bearing) return null;
  const distanceBand: ObserverMapApproximation["distanceBand"] = confidence >= 0.7
    ? "near"
    : confidence >= 0.45
      ? "middle"
      : "far";
  return { shape, bearing, distanceBand, angularSpan: distanceBand === "far" ? 42 : distanceBand === "middle" ? 30 : 20 };
}

function currentLocation(events: readonly DomainEvent[]): string | null {
  let id: string | null = null;
  for (const event of events) if (event.type === "PlayerLocationChanged") id = (event.payload as { locationId: string }).locationId;
  return id;
}

function distanceToSegment(point: ObserverMapPoint, from: ObserverMapPoint, to: ObserverMapPoint): number {
  const dx = to.xMetres - from.xMetres;
  const dy = to.yMetres - from.yMetres;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0) return Math.hypot(point.xMetres - from.xMetres, point.yMetres - from.yMetres);
  const t = Math.max(0, Math.min(1, ((point.xMetres - from.xMetres) * dx + (point.yMetres - from.yMetres) * dy) / lengthSquared));
  return Math.hypot(point.xMetres - (from.xMetres + t * dx), point.yMetres - (from.yMetres + t * dy));
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

function buildInterruptedPosition(events: readonly DomainEvent[], spatial: SpatialWorldProjection, locationId: string | null) {
  let latestChange = -1;
  let candidate: { xMetres: number; yMetres: number } | null = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.type === "PlayerLocationChanged") latestChange = index;
    if (event.type !== "JourneyInterrupted" || index < latestChange) continue;
    const payload = event.payload as { xMetres?: number; yMetres?: number };
    if (Number.isFinite(payload.xMetres) && Number.isFinite(payload.yMetres)) candidate = { xMetres: payload.xMetres!, yMetres: payload.yMetres! };
  }
  if (candidate === null) return null;
  return { xMetres: candidate.xMetres, yMetres: candidate.yMetres, elevationMetres: terrainElevationAt(candidate.xMetres, candidate.yMetres, spatial), locationRef: locationId };
}

/** Builds only observer evidence; canonical region geometry never crosses this boundary. */
export function buildObserverMap(
  events: readonly DomainEvent[],
  spatial: SpatialWorldProjection,
  useVisibility?: boolean,
): ObserverMapDTO {
  const worldTime = events.reduce((max, event) => Math.max(max, event.timestamp), 0);
  const locationId = currentLocation(events);
  const observerKnowledge = buildObserverSpatialKnowledge(events);
  const revealedLocationRefs = new Set(events
    .filter((event) => event.type === "PlayerLocationChanged")
    .map((event) => ref("loc", (event.payload as { locationId: string }).locationId)));
  for (const observation of observerKnowledge.locations.values()) {
    if (observation.observedAt <= 0) continue;
    if (observation.knowledge === "observed" || observation.knowledge === "traversed") {
      revealedLocationRefs.add(ref("loc", observation.subjectId));
    }
  }
  const observations = [
    ...observerKnowledge.locations.values(),
    ...observerKnowledge.landmarks.values(),
    ...observerKnowledge.relations.values(),
    ...observerKnowledge.water.values(),
  ];
  const known = new Map<string, SpatialObservationPayload>();
  for (const observation of observations) {
    known.set(observation.subjectKind + ":" + observation.subjectId, observation);
  }
  if (locationId && spatial.locations.has(locationId) && !known.has(`location:${locationId}`)) known.set(`location:${locationId}`, { subjectKind: "location", subjectId: locationId, knowledge: "traversed", observedAt: worldTime, confidence: 1 });

  // Compute visibility from current position if enabled
  let visibilityResults: Map<string, VisibilityResult> | null = null;
  if (useVisibility) {
    const observer = buildInterruptedPosition(events, spatial, locationId) ?? buildObserverPosition(locationId, spatial);
    if (observer) {
      visibilityResults = computeVisibility(observer, spatial);
    }
  }

  const locations: ObserverMapLocation[] = [];
  for (const [key, observation] of known) {
    if (observation.subjectKind !== "location") continue;
    const location = spatial.locations.get(observation.subjectId);
    if (!location) continue;
    const exact = observation.knowledge === "observed" || observation.knowledge === "traversed";
    locations.push({
      ref: ref("loc", location.id),
      name: location.name,
      aliases: spatial.toponymIndex?.subjects.find((subject) => subject.id === location.id)?.aliases ?? [],
      knowledge: observation.knowledge,
      confidence: observation.confidence,
      freshness: freshness(observation.observedAt, worldTime),
      xMetres: exact ? location.anchor.xMetres : null,
      yMetres: exact ? location.anchor.yMetres : null,
      bearing: observation.bearing ?? null,
      approximation: approximationFor(observation.knowledge, observation.bearing, "haze", observation.confidence),
    });
    void key;
  }

  // Merge visibility results: use visibility if it provides better knowledge
  if (visibilityResults) {
    for (const [targetRef, visResult] of visibilityResults) {
      if (!visResult.visible || targetRef === "western_cliff_waterfalls") continue;
      const existingKey = `location:${targetRef}`;
      const existing = known.get(existingKey);
      // Visibility gives higher knowledge than existing
      if (!existing || spatialKnowledgeRank(visResult.knowledge) > spatialKnowledgeRank(existing.knowledge)) {
        const location = spatial.locations.get(targetRef);
        if (location) {
          locations.push({
            ref: ref("loc", location.id),
            name: location.name,
            aliases: spatial.toponymIndex?.subjects.find((subject) => subject.id === location.id)?.aliases ?? [],
            knowledge: visResult.knowledge,
            confidence: visResult.confidence,
            freshness: 1,
            xMetres: visResult.exactPositionAllowed ? location.anchor.xMetres : null,
            yMetres: visResult.exactPositionAllowed ? location.anchor.yMetres : null,
            bearing: visResult.bearing,
            approximation: approximationFor(visResult.knowledge, visResult.bearing, "haze", visResult.confidence),
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
    landmarks.push({
      ref: ref("landmark", landmark.id),
      name: landmark.name,
      silhouette: landmark.silhouetteClass,
      knowledge: observation.knowledge,
      confidence: observation.confidence,
      freshness: freshness(observation.observedAt, worldTime),
      xMetres: exact ? landmark.anchor.xMetres : null,
      yMetres: exact ? landmark.anchor.yMetres : null,
      bearing: observation.bearing ?? null,
      approximation: approximationFor(observation.knowledge, observation.bearing, "silhouette", observation.confidence),
    });
  }

  // Merge visibility results for landmarks
  if (visibilityResults) {
    for (const [targetRef, visResult] of visibilityResults) {
      if (!visResult.visible || targetRef === "western_cliff_waterfalls") continue;
      const existingForLandmark = [...known.values()].find(
        (o) => o.subjectKind === "landmark" && o.subjectId === targetRef,
      );
      if (!existingForLandmark || spatialKnowledgeRank(visResult.knowledge) > spatialKnowledgeRank(existingForLandmark.knowledge)) {
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
            approximation: approximationFor(visResult.knowledge, visResult.bearing, "silhouette", visResult.confidence),
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
    const points = observation.fromLocationId === relation.toId && observation.toLocationId === relation.fromId
      ? [...relation.points].reverse()
      : relation.points;
    const geometry = observation.observedAt > 0 ? buildRouteGeometry(points, observation.knowledge, observation.progressFraction) : null;

    routes.push({
      ref: ref("route", relation.id),
      kind: relation.kind,
      label: relation.label,
      fromLocationRef: ref("loc", observation.fromLocationId ?? relation.fromId),
      toLocationRef: ref("loc", observation.toLocationId ?? relation.toId),
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
    .filter((entry) => entry.xMetres != null && entry.yMetres != null)
    .map((entry) => ({ x: entry.xMetres as number, y: entry.yMetres as number }));
  const knownArea = points.length === 0 ? null : { minXMetres: Math.max(0, Math.min(...points.map((p) => p.x)) - 1_000), minYMetres: Math.max(0, Math.min(...points.map((p) => p.y)) - 1_000), maxXMetres: Math.max(...points.map((p) => p.x)) + 1_000, maxYMetres: Math.max(...points.map((p) => p.y)) + 1_000 };
  const current = locationId ? spatial.locations.get(locationId) : undefined;
  const observerPosition = buildInterruptedPosition(events, spatial, locationId) ?? (current ? buildObserverPosition(locationId, spatial) : null);
  const knownTerrain: ObserverMapTerrainPatch[] = [];
  if (knownArea && spatial.region) {
    for (const tile of spatial.region.tiles) {
      const intersects = tile.bounds.maxXMetres >= knownArea.minXMetres && tile.bounds.minXMetres <= knownArea.maxXMetres && tile.bounds.maxYMetres >= knownArea.minYMetres && tile.bounds.minYMetres <= knownArea.maxYMetres;
      if (intersects) knownTerrain.push({ bounds: tile.bounds, surface: tile.surface, elevationBand: tile.elevationBand, slopeBand: tile.slopeBand });
    }
  }

  const terrainEvidence = knownTerrain.filter((patch) => {
    if (!observerPosition) return false;
    const center = {
      xMetres: (patch.bounds.minXMetres + patch.bounds.maxXMetres) / 2,
      yMetres: (patch.bounds.minYMetres + patch.bounds.maxYMetres) / 2,
    };
    if (Math.hypot(center.xMetres - observerPosition.xMetres, center.yMetres - observerPosition.yMetres) <= 3_000) return true;
    for (const location of locations) {
      if (location.xMetres == null || location.yMetres == null) continue;
      if (!revealedLocationRefs.has(location.ref)) continue;
      if (Math.hypot(center.xMetres - location.xMetres, center.yMetres - location.yMetres) <= 2_200) return true;
    }
    for (const route of routes) {
      if (route.geometry?.kind !== "observed_path") continue;
      for (let index = 1; index < route.geometry.points.length; index += 1) {
        if (distanceToSegment(center, route.geometry.points[index - 1]!, route.geometry.points[index]!) <= 900) return true;
      }
    }
    return false;
  });
  const revealZones: ObserverMapRevealZone[] = [];
  if (observerPosition) {
    revealZones.push({
      kind: "vicinity",
      profile: "organic",
      seed: stableObserverSeed(spatial.region?.id ?? "region", locationId ?? "observer", "vicinity"),
      edgeVariance: 0.18,
      center: { xMetres: observerPosition.xMetres, yMetres: observerPosition.yMetres },
      radiusMetres: 2_500,
      strength: 1,
    });
  }
  for (const location of locations) {
    if (location.xMetres == null || location.yMetres == null || location.ref === (current ? ref("loc", current.id) : null)) continue;
    if (!revealedLocationRefs.has(location.ref)) continue;
    if (location.knowledge !== "observed" && location.knowledge !== "traversed") continue;
    revealZones.push({
      kind: "vicinity",
      profile: "organic",
      seed: stableObserverSeed(spatial.region?.id ?? "region", location.ref, "location"),
      edgeVariance: location.knowledge === "traversed" ? 0.24 : 0.3,
      center: { xMetres: location.xMetres, yMetres: location.yMetres },
      radiusMetres: location.knowledge === "traversed" ? 2_000 : 1_500,
      strength: 1,
    });
  }
  for (const route of routes) {
    if (route.geometry?.kind !== "observed_path") continue;
    revealZones.push({
      kind: "route",
      profile: "memory_trace",
      seed: stableObserverSeed(spatial.region?.id ?? "region", route.ref, "route"),
      edgeVariance: route.knowledge === "traversed" ? 0.22 : 0.35,
      path: route.geometry.points,
      widthMetres: route.knowledge === "traversed" ? 1_200 : 800,
      strength: route.knowledge === "traversed" ? 1 : 0.78,
    });
  }
  const terrainRegions = buildObserverTerrainRegions(terrainEvidence);
  const regionRef = spatial.region ? ref("region", spatial.region.id) : null;
  const region = spatial.region ? { ref: regionRef as string, name: spatial.region.name } : null;
  return Object.freeze({
    schemaVersion: 4,
    revision: { worldTime, eventNumber: events.length },
    region,
    observer: { locationRef: current ? ref("loc", current.id) : null, xMetres: observerPosition?.xMetres ?? null, yMetres: observerPosition?.yMetres ?? null },
    knownArea,
    revealZones: Object.freeze(revealZones),
    availableDetails: buildAvailableObserverMapDetails(spatial.region?.id ?? null, observerKnowledge),
    knownTerrain: Object.freeze(terrainEvidence),
    terrainRegions,
    locations: Object.freeze(locations),
    landmarks: Object.freeze(landmarks),
    routes: Object.freeze(routes),
    knownWatercourses: Object.freeze(knownWatercourses),
    knownWaterBodies: Object.freeze(knownWaterBodies),
    knownHazards: Object.freeze([]),
  });
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
  progressFraction = 1,
): ObserverMapRouteGeometry {
  if (knowledge === "rumored" || points.length === 0) return null;

  if (knowledge === "observed" || knowledge === "traversed") {
    // An interrupted journey carries only the physically traversed prefix.
    const fraction = Math.max(0, Math.min(1, Number.isFinite(progressFraction) ? progressFraction : 1));
    const partial = fraction < 1 ? slicePath(points, fraction) : points;
    if (partial.length < 2) return null;
    // Simplify path: keep first, last, and every Nth point.
    const simplified = simplifyPath(partial, 8);
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

/** Return a deterministic prefix of a polyline at the requested fraction. */
function slicePath(
  points: readonly { xMetres: number; yMetres: number }[],
  fraction: number,
): ObserverMapPoint[] {
  if (points.length < 2 || fraction <= 0) return [];
  if (fraction >= 1) return points.map((point) => ({ xMetres: point.xMetres, yMetres: point.yMetres }));
  const lengths = points.slice(1).map((point, index) => Math.hypot(
    point.xMetres - points[index]!.xMetres,
    point.yMetres - points[index]!.yMetres,
  ));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) return [{ xMetres: points[0]!.xMetres, yMetres: points[0]!.yMetres }];
  const target = total * fraction;
  const result: ObserverMapPoint[] = [{ xMetres: points[0]!.xMetres, yMetres: points[0]!.yMetres }];
  let travelled = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const segment = lengths[index]!;
    if (travelled + segment >= target) {
      const local = (target - travelled) / segment;
      const from = points[index]!;
      const to = points[index + 1]!;
      result.push({
        xMetres: from.xMetres + (to.xMetres - from.xMetres) * local,
        yMetres: from.yMetres + (to.yMetres - from.yMetres) * local,
      });
      return result;
    }
    result.push({ xMetres: points[index + 1]!.xMetres, yMetres: points[index + 1]!.yMetres });
    travelled += segment;
  }
  return result;
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
