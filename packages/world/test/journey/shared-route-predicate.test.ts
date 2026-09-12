import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import {
  createJourneyValidationRule,
  createObserverSpatialKnowledge,
  freezeObserverSpatialKnowledge,
  mergeSpatialObservation,
  resolveJourneyRoute,
} from "@skald/world";
import type {
  ObserverMapDTO,
  ObserverSpatialKnowledge,
  ReadonlyWorld,
  SpatialWorldProjection,
} from "@skald/world";
import { observedRouteEndpoints } from "../../src/journey/route-resolver.js";

/**
 * QA4: the Game Shell advertises exactly the endpoints of observed travel
 * relations, and journey validation must accept those same destinations —
 * including declined player forms. Both sides share observedRouteEndpoints,
 * so an advertised road can never be rejected as an unknown destination.
 */
function makeSpatial(): SpatialWorldProjection {
  return {
    region: null,
    locations: new Map([
      ["river_waystation", { id: "river_waystation", name: "Переправа у Чёрного леса", description: "Test", anchor: { xMetres: 8000, yMetres: 9500 }, footprintTileIds: [] }],
      ["riverwatch_city", { id: "riverwatch_city", name: "Речной Страж", description: "Test", anchor: { xMetres: 13500, yMetres: 7500 }, footprintTileIds: [] }],
    ]),
    landmarks: new Map(),
    relations: new Map(),
    travelRelations: new Map([
      ["road_waystation_city", { id: "road_waystation_city", kind: "road", fromId: "river_waystation", toId: "riverwatch_city", distanceMetres: 5500, baseTravelTicks: 4, terrainCost: 1.0, passability: "open" }],
    ]),
    riverProcesses: new Map(),
    riverStates: new Map(),
    crossingDefinitions: new Map(),
    crossingStates: new Map(),
  };
}

/** The city is known ONLY as the endpoint of an observed road: the observer
 * map never lists it, mirroring a shell that advertises the road first. */
function mapWithoutCity(): ObserverMapDTO {
  return {
    schemaVersion: 1,
    revision: { worldTime: 0, eventNumber: 0 },
    region: null,
    observer: { locationRef: "river_waystation", xMetres: 8000, yMetres: 9500 },
    knownArea: null,
    locations: [
      { ref: "river_waystation", name: "Переправа у Чёрного леса", knowledge: "traversed", confidence: 1, freshness: 1, xMetres: 8000, yMetres: 9500 },
    ],
    landmarks: [],
    routes: [],
  };
}

function observedRoadKnowledge(): ObserverSpatialKnowledge {
  const mutable = createObserverSpatialKnowledge("player");
  mergeSpatialObservation(mutable, {
    subjectKind: "relation",
    subjectId: "road_waystation_city",
    knowledge: "observed",
    observedAt: 0,
    confidence: 1,
  }, "evt-1", 0);
  return freezeObserverSpatialKnowledge(mutable);
}

function makeWorld(spatial: SpatialWorldProjection, spatialKnowledge: ObserverSpatialKnowledge): ReadonlyWorld {
  return Object.freeze({
    player: Object.freeze({ x: 0, y: 0 }),
    walls: new Set<string>(),
    observations: new Map<string, number>(),
    consequences: new Map(),
    firedConsequences: new Map(),
    activeSituations: new Map(),
    burnedTrees: 0,
    relations: new Map(),
    heatSources: new Map(),
    heatMap: new Map(),
    lastActionTick: 0,
    strategy: [],
    eventNumber: 0,
    time: 0,
    objects: new Map(),
    locations: new Map([
      ["river_waystation", { id: "river_waystation", name: "Переправа у Чёрного леса", description: "Test", objectIds: [], connections: {} }],
      ["riverwatch_city", { id: "riverwatch_city", name: "Речной Страж", description: "Test", objectIds: [], connections: {} }],
    ]),
    currentLocationId: "river_waystation",
    pendingChecks: new Map(),
    entities: new Map(),
    journeys: new Map(),
    activeJourneyId: null,
    spatial,
    spatialKnowledge,
  }) as unknown as ReadonlyWorld;
}

function journeyValidated(destination: string): DomainEvent {
  return {
    eventId: "jv-shared-1",
    type: "JourneyValidated",
    schemaVersion: 1,
    payload: { destination },
    timestamp: 5,
    correlationId: "cmd-1",
    causationId: null,
  };
}

describe("shared route-endpoint predicate (shell ↔ validation)", () => {
  it("advertises the observed road endpoint the shell shows", () => {
    const endpoints = observedRouteEndpoints(makeSpatial(), observedRoadKnowledge(), "river_waystation");
    expect(endpoints).toEqual([{ id: "riverwatch_city", name: "Речной Страж", relationId: "road_waystation_city" }]);
  });

  it("resolves a declined destination known only through the shared predicate", () => {
    const spatial = makeSpatial();
    const endpoints = observedRouteEndpoints(spatial, observedRoadKnowledge(), "river_waystation");
    const result = resolveJourneyRoute("Речному Стражу", "river_waystation", spatial, mapWithoutCity(), undefined, endpoints);
    expect(result.kind).toBe("resolved");
    if (result.kind !== "resolved") throw new Error("unreachable");
    expect(result.toLocationId).toBe("riverwatch_city");
  });

  it("validation starts the journey the shell advertises, in declined form", () => {
    const spatial = makeSpatial();
    const rule = createJourneyValidationRule(spatial, mapWithoutCity());
    const out = rule.handle(journeyValidated("Речному Стражу"), makeWorld(spatial, observedRoadKnowledge()));
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("JourneyStarted");
    expect((out[0]!.payload as { toLocationId: string }).toLocationId).toBe("riverwatch_city");
  });
});
