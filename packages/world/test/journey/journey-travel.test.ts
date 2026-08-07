/**
 * journey.travel unit tests (ADR-0015 production path).
 * Given JourneyValidated + ReadonlyWorld (locations + spatial read view)
 * -> JourneyStarted or JourneyBlocked, with tolerant Russian destination
 * matching and crossing passability.
 */

import { describe, it, expect } from "vitest";
import { journeyTravel } from "../../src/rules/journey-travel.js";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../../src/projection.js";
import type { Location } from "../../src/objects/types.js";

function evt(destination: string, timestamp = 5): DomainEvent {
  return {
    eventId: "j-1",
    type: "JourneyValidated",
    schemaVersion: 1,
    payload: { destination },
    timestamp,
    correlationId: "cmd-5",
    causationId: "jr-5",
  };
}

function location(id: string, name: string): Location {
  return { id, name, description: name, objectIds: [], connections: {} } as unknown as Location;
}

function makeWorld(overrides: { currentLocationId?: string; crossing?: string; crossingOnly?: boolean } = {}): ReadonlyWorld {
  const locations = new Map<string, Location>([
    ["river_waystation", location("river_waystation", "Переправа у Чёрного леса")],
    ["riverwatch_city", location("riverwatch_city", "Речной Страж")],
    ["blackwood_edge", location("blackwood_edge", "Кромка Чёрного леса")],
    ["southern_borough", location("southern_borough", "Южный посад")],
  ]);
  const travelRelations = new Map<string, { id: string; kind: string; fromId: string; toId: string; baseTravelTicks: number; passability: string }>();
  travelRelations.set("road_waystation_forest", { id: "road_waystation_forest", kind: "road", fromId: "river_waystation", toId: "blackwood_edge", baseTravelTicks: 3, passability: "open" });
  if (overrides.crossingOnly) {
    travelRelations.set("river_crossing", { id: "river_crossing", kind: "crossing", fromId: "river_waystation", toId: "riverwatch_city", baseTravelTicks: 2, passability: "open" });
  } else {
    travelRelations.set("road_waystation_city", { id: "road_waystation_city", kind: "road", fromId: "river_waystation", toId: "riverwatch_city", baseTravelTicks: 4, passability: "open" });
  }
  const crossingStates = new Map<string, { crossingId: string; condition: string; travelCostTicks: number }>();
  crossingStates.set("river_crossing", { crossingId: "river_crossing", condition: overrides.crossing ?? "open", travelCostTicks: 4 });
  const base = {
    player: { x: 0, y: 0 }, walls: new Set<string>(), observations: new Map(), consequences: new Map(),
    firedConsequences: new Map(), activeSituations: new Map(), burnedTrees: 0, relations: new Map(),
    heatSources: new Map(), heatMap: new Map(), lastActionTick: 0, strategy: [], eventNumber: 0, time: 5,
    objects: new Map(), pendingChecks: new Map(), entities: new Map(), journeys: new Map(), activeJourneyId: null,
    currentLocationId: overrides.currentLocationId ?? "river_waystation",
  };
  return {
    ...base,
    locations,
    spatial: {
      riverProcesses: new Map(), riverStates: new Map(), crossingDefinitions: new Map(),
      crossingStates, travelRelations,
    },
    weather: null, heat: null, settlement: null,
  } as unknown as ReadonlyWorld;
}

describe("journey.travel", () => {
  it("resolves a Russian inflected destination to JourneyStarted via the road", () => {
    const out = journeyTravel.handle(evt("речному стражу"), makeWorld());
    expect(out[0]!.type).toBe("JourneyStarted");
    const payload = out[0]!.payload as { toLocationId: string; plannedTicks: number };
    expect(payload.toLocationId).toBe("riverwatch_city");
    expect(payload.plannedTicks).toBe(4); // via the road (open)
  });

  it("uses the difficult crossing cost when the ford is difficult", () => {
    const out = journeyTravel.handle(evt("Речной Страж"), makeWorld({ crossing: "difficult", crossingOnly: true }));
    const payload = out[0]!.payload as { plannedTicks: number };
    expect(payload.plannedTicks).toBe(4);
  });

  it("blocks when the crossing is closed by high water", () => {
    const out = journeyTravel.handle(evt("речному стражу"), makeWorld({ crossing: "closed", crossingOnly: true }));
    expect(out[0]!.type).toBe("JourneyBlocked");
    expect((out[0]!.payload as { reason: string }).reason).toBe("crossing_closed");
  });

  it("blocks when already at the destination", () => {
    const out = journeyTravel.handle(evt("Речной Страж"), makeWorld({ currentLocationId: "riverwatch_city" }));
    expect(out[0]!.type).toBe("JourneyBlocked");
    expect((out[0]!.payload as { reason: string }).reason).toBe("no_route");
  });

  it("blocks unknown destinations honestly", () => {
    const out = journeyTravel.handle(evt("где-то там"), makeWorld());
    expect(out[0]!.type).toBe("JourneyBlocked");
    expect((out[0]!.payload as { reason: string }).reason).toBe("unknown_destination");
  });
});
