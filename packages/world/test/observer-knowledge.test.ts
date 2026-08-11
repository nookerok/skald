import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import { buildObserverSpatialKnowledge, buildObserverMap, buildSpatialWorldProjection } from "@skald/world";

function observation(eventId: string, payload: Record<string, unknown>, timestamp: number): DomainEvent {
  return {
    eventId,
    type: "SpatialObservationRecorded",
    schemaVersion: 1,
    payload,
    timestamp,
    correlationId: "test",
    causationId: null,
  };
}

describe("observer spatial knowledge", () => {
  it("never downgrades a confirmed fact when a later rumor arrives", () => {
    const events = [
      observation("observed", {
        subjectKind: "location", subjectId: "city", knowledge: "observed",
        observedAt: 2, confidence: 0.8,
      }, 2),
      observation("rumor", {
        subjectKind: "location", subjectId: "city", knowledge: "rumored",
        observedAt: 10, confidence: 0.2,
      }, 10),
    ];
    expect(buildObserverSpatialKnowledge(events).locations.get("city")?.knowledge).toBe("observed");
  });

  it("keeps water observations in their own observer read-model", () => {
    const events = [
      observation("water", {
        subjectKind: "water", subjectId: "southern_water_body", knowledge: "observed",
        observedAt: 3, confidence: 0.4,
      }, 3),
    ];
    const knowledge = buildObserverSpatialKnowledge(events);
    expect(knowledge.water.get("southern_water_body")?.knowledge).toBe("observed");
    expect(knowledge.relations.has("southern_water_body")).toBe(false);
  });

  it("keeps observer scopes isolated", () => {
    const events = [
      observation("player", {
        subjectKind: "location", subjectId: "camp", knowledge: "observed",
        observedAt: 1, confidence: 1, observerId: "player",
      }, 1),
      observation("other", {
        subjectKind: "location", subjectId: "tower", knowledge: "observed",
        observedAt: 1, confidence: 1, observerId: "other",
      }, 1),
    ];
    const player = buildObserverSpatialKnowledge(events, "player");
    expect([...player.locations.keys()]).toEqual(["camp"]);
  });

  it("keeps a rumored location out of knownArea and exact map markers", () => {
    const events = [
      observation("observed", {
        subjectKind: "location", subjectId: "known", knowledge: "observed",
        observedAt: 0, confidence: 1,
      }, 0),
      observation("rumor", {
        subjectKind: "location", subjectId: "hidden", knowledge: "rumored",
        observedAt: 20, confidence: 1,
      }, 20),
    ];
    const spatial = buildSpatialWorldProjection(events);
    const map = buildObserverMap(events, spatial);
    expect(map.locations.map((entry) => entry.ref)).toHaveLength(0);
    expect(map.knownArea).toBeNull();
  });
});
