import { describe, it, expect } from "vitest";
import { WorldProjector, rebuildProjection } from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";

function evt(type: string, eventId: string, payload: unknown = {}, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

describe("WorldProjector — JourneyState (ADR-0015)", () => {
  it("initializes with empty journeys and no active journey", () => {
    const projector = new WorldProjector();
    const world = projector.getSnapshot();
    expect(world.journeys.size).toBe(0);
    expect(world.activeJourneyId).toBeNull();
  });

  it("creates JourneyState on JourneyStarted", () => {
    const projector = new WorldProjector();
    projector.apply(evt("JourneyStarted", "js-1", {
      journeyId: "j-1",
      relationId: "road_waystation_city",
      fromLocationId: "river_waystation",
      toLocationId: "riverwatch_city",
      startedAt: 5,
      plannedTicks: 4,
    }, 5));
    const world = projector.getSnapshot();
    expect(world.journeys.size).toBe(1);
    const journey = world.journeys.get("j-1");
    expect(journey).toBeDefined();
    expect(journey!.status).toBe("active");
    expect(journey!.plannedTicks).toBe(4);
    expect(journey!.elapsedTicks).toBe(0);
    expect(world.activeJourneyId).toBe("j-1");
  });

  it("completes journey on JourneyCompleted", () => {
    const projector = new WorldProjector();
    projector.apply(evt("JourneyStarted", "js-1", {
      journeyId: "j-1",
      relationId: "road_waystation_city",
      fromLocationId: "river_waystation",
      toLocationId: "riverwatch_city",
      startedAt: 5,
      plannedTicks: 4,
    }, 5));
    projector.apply(evt("JourneyCompleted", "jc-1", { journeyId: "j-1" }, 9));
    const world = projector.getSnapshot();
    const journey = world.journeys.get("j-1");
    expect(journey!.status).toBe("completed");
    expect(world.activeJourneyId).toBeNull();
  });

  it("JourneyBlocked does not create JourneyState", () => {
    const projector = new WorldProjector();
    projector.apply(evt("JourneyBlocked", "jb-1", { reason: "unknown_destination", playerText: "Test" }, 5));
    const world = projector.getSnapshot();
    expect(world.journeys.size).toBe(0);
    expect(world.activeJourneyId).toBeNull();
  });

  it("rebuilds JourneyState from Event Log replay", () => {
    const events: DomainEvent[] = [
      evt("JourneyStarted", "js-1", {
        journeyId: "j-1",
        relationId: "road_waystation_city",
        fromLocationId: "river_waystation",
        toLocationId: "riverwatch_city",
        startedAt: 5,
        plannedTicks: 4,
      }, 5),
      evt("TickPassed", "t-1", { delta: 1 }, 6),
      evt("TickPassed", "t-2", { delta: 1 }, 7),
      evt("TickPassed", "t-3", { delta: 1 }, 8),
      evt("TickPassed", "t-4", { delta: 1 }, 9),
      evt("PlayerLocationChanged", "plc-1", { locationId: "riverwatch_city" }, 10),
      evt("JourneyCompleted", "jc-1", { journeyId: "j-1" }, 10),
    ];
    const world = rebuildProjection(events).getSnapshot();
    expect(world.journeys.size).toBe(1);
    expect(world.journeys.get("j-1")!.status).toBe("completed");
    expect(world.activeJourneyId).toBeNull();
    expect(world.currentLocationId).toBe("riverwatch_city");
  });

  it("clone preserves journey state", () => {
    const projector = new WorldProjector();
    projector.apply(evt("JourneyStarted", "js-1", {
      journeyId: "j-1",
      relationId: "road_waystation_city",
      fromLocationId: "river_waystation",
      toLocationId: "riverwatch_city",
      startedAt: 5,
      plannedTicks: 4,
    }, 5));
    const cloned = projector.clone();
    const world = cloned.getSnapshot();
    expect(world.journeys.size).toBe(1);
    expect(world.activeJourneyId).toBe("j-1");
  });
});
