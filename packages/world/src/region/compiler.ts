import type { DomainEvent } from "@skald/event-bus";
import { buildPilotRegionDefinition } from "./definition.js";
import type { SpatialObservationPayload } from "./types.js";

function event<T extends string>(eventId: string, type: T, payload: unknown, causationId: string | null = "boot#region"): DomainEvent<T> {
  return { eventId, type, schemaVersion: 1, payload, timestamp: 0, correlationId: "boot#region", causationId };
}

/** Compiles the authored pilot region into deterministic bootstrap facts. */
export function buildPilotRegionBootstrapEvents(): readonly DomainEvent[] {
  const region = buildPilotRegionDefinition();
  const events: DomainEvent[] = [event("boot#region", "RegionDefined", { region }, null)];
  events.push(event("boot#region#PlayerSpawned", "PlayerSpawned", { x: 0, y: 0 }));
  for (const location of region.locations) {
    events.push(event(`boot#region#LocationDefined#${location.id}`, "LocationDefined", {
      id: location.id,
      name: location.name,
      description: location.description,
      objectIds: [],
      connections: {},
    }));
  }
  events.push(event("boot#region#PlayerLocationChanged", "PlayerLocationChanged", { locationId: "river_waystation" }));

  // Travel metadata for each spatial relation
  const travelMetadata: Array<{
    relationId: string;
    kind: "road" | "crossing" | "river" | "visibility";
    fromId: string;
    toId: string;
    distanceMetres: number;
    baseTravelTicks: number;
    terrainCost: number;
    passability: "open" | "blocked";
  }> = [
    { relationId: "road_waystation_city", kind: "road", fromId: "river_waystation", toId: "riverwatch_city", distanceMetres: 5_500, baseTravelTicks: 4, terrainCost: 1.0, passability: "open" },
    { relationId: "road_waystation_forest", kind: "road", fromId: "river_waystation", toId: "blackwood_edge", distanceMetres: 3_200, baseTravelTicks: 3, terrainCost: 1.2, passability: "open" },
    { relationId: "road_city_ruins", kind: "road", fromId: "riverwatch_city", toId: "old_ruins", distanceMetres: 6_800, baseTravelTicks: 5, terrainCost: 1.0, passability: "open" },
    { relationId: "river_crossing", kind: "crossing", fromId: "river_waystation", toId: "riverwatch_city", distanceMetres: 2_000, baseTravelTicks: 2, terrainCost: 1.5, passability: "open" },
    { relationId: "river_basin", kind: "river", fromId: "high_pass", toId: "riverwatch_city", distanceMetres: 12_000, baseTravelTicks: 0, terrainCost: 0, passability: "blocked" },
  ];
  travelMetadata.forEach((payload, index) => {
    events.push(event(`boot#region#Travel#${index}`, "TravelMetadataAttached", payload));
  });

  // River hydrology process (ADR-0017)
  events.push(event("boot#region#RiverProcess", "RiverProcessDefined", {
    processId: "river-basin-process",
    watercourseId: "river_basin",
    baselineLevel: 40,
    minimumLevel: 20,
    maximumLevel: 90,
    cycleLengthTicks: 16,
    phaseOffset: 0,
    riseRate: 8,
    fallRate: 5,
  }));

  // Crossing condition definition (ADR-0017)
  events.push(event("boot#region#CrossingInit", "CrossingConditionInitialized", {
    crossingId: "river_crossing",
    watercourseId: "river_basin",
    openAtOrBelow: 55,
    difficultAtOrBelow: 75,
    closedAbove: 75,
    baseTravelCostTicks: 2,
  }));

  const observations: SpatialObservationPayload[] = [
    { subjectKind: "location", subjectId: "river_waystation", knowledge: "traversed", observedAt: 0, confidence: 1 },
    { subjectKind: "relation", subjectId: "road_waystation_city", knowledge: "observed", observedAt: 0, confidence: 0.9 },
    { subjectKind: "relation", subjectId: "river_crossing", knowledge: "observed", observedAt: 0, confidence: 0.85 },
    { subjectKind: "landmark", subjectId: "suspended_monolith", knowledge: "glimpsed", observedAt: 0, confidence: 0.45, bearing: "северо-восток" },
  ];
  observations.forEach((payload, index) => events.push(event(`boot#region#Observation#${index}`, "SpatialObservationRecorded", payload)));
  events.push(event("boot#region#StrategySet", "StrategySet", { entries: [{ condition: "always", action: "idle" }] }));
  return Object.freeze(events.map((entry) => Object.freeze({ ...entry })));
}
