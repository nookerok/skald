import { describe, it, expect } from "vitest";
import { buildDiscoveryJournal } from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";

function ev(type: string, timestamp: number, payload: Record<string, unknown> = {}): DomainEvent {
  return { eventId: `${type}-${timestamp}`, type, schemaVersion: 1, payload, timestamp, correlationId: "test", causationId: null };
}

describe("Discovery Builder — Spatial Discoveries (ADR-0018)", () => {
  describe("river_cycle", () => {
    it("one RiverLevelChanged with band change → trace", () => {
      const events = [ev("RiverLevelChanged", 1, { watercourseId: "river_basin", previousLevel: 40, level: 65, previousBand: "normal", band: "high" })];
      const journal = buildDiscoveryJournal(events);
      const card = journal.cards.find((c) => c.discoveryId === "river_cycle");
      expect(card).toBeDefined();
      expect(card!.stage).toBe("trace");
    });

    it("multiple band changes at different times → hypothesis", () => {
      const events = [
        ev("RiverLevelChanged", 1, { watercourseId: "river_basin", previousLevel: 40, level: 65, previousBand: "normal", band: "high" }),
        ev("RiverLevelChanged", 5, { watercourseId: "river_basin", previousLevel: 65, level: 30, previousBand: "high", band: "normal" }),
      ];
      const journal = buildDiscoveryJournal(events);
      const card = journal.cards.find((c) => c.discoveryId === "river_cycle");
      expect(card).toBeDefined();
      expect(card!.stage).toBe("hypothesis");
    });

    it("three band changes → discovered", () => {
      const events = [
        ev("RiverLevelChanged", 1, { watercourseId: "river_basin", previousLevel: 40, level: 65, previousBand: "normal", band: "high" }),
        ev("RiverLevelChanged", 5, { watercourseId: "river_basin", previousLevel: 65, level: 30, previousBand: "high", band: "normal" }),
        ev("RiverLevelChanged", 10, { watercourseId: "river_basin", previousLevel: 30, level: 70, previousBand: "normal", band: "high" }),
      ];
      const journal = buildDiscoveryJournal(events);
      const card = journal.cards.find((c) => c.discoveryId === "river_cycle");
      expect(card).toBeDefined();
      expect(card!.stage).toBe("discovered");
    });

    it("CrossingConditionChanged also contributes evidence", () => {
      const events = [
        ev("CrossingConditionChanged", 1, { crossingId: "river_crossing", watercourseId: "river_basin", previousCondition: "open", condition: "difficult", previousTravelCostTicks: 2, travelCostTicks: 4 }),
      ];
      const journal = buildDiscoveryJournal(events);
      const card = journal.cards.find((c) => c.discoveryId === "river_cycle");
      expect(card).toBeDefined();
      expect(card!.evidence.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("monolith_sighting", () => {
    it("one spatial observation → trace", () => {
      const events = [ev("SpatialObservationRecorded", 1, { subjectKind: "landmark", subjectId: "suspended_monolith", knowledge: "glimpsed", observedAt: 1, confidence: 0.45, bearing: "северо-восток" })];
      const journal = buildDiscoveryJournal(events);
      const card = journal.cards.find((c) => c.discoveryId === "monolith_sighting");
      expect(card).toBeDefined();
      expect(card!.stage).toBe("trace");
    });

    it("two observations at different times → hypothesis", () => {
      const events = [
        ev("SpatialObservationRecorded", 1, { subjectKind: "landmark", subjectId: "suspended_monolith", knowledge: "glimpsed", observedAt: 1, confidence: 0.45 }),
        ev("SpatialObservationRecorded", 5, { subjectKind: "landmark", subjectId: "suspended_monolith", knowledge: "glimpsed", observedAt: 5, confidence: 0.5 }),
      ];
      const journal = buildDiscoveryJournal(events);
      const card = journal.cards.find((c) => c.discoveryId === "monolith_sighting");
      expect(card).toBeDefined();
      expect(card!.stage).toBe("hypothesis");
    });

    it("two observations with one observed → discovered", () => {
      const events = [
        ev("SpatialObservationRecorded", 1, { subjectKind: "landmark", subjectId: "suspended_monolith", knowledge: "glimpsed", observedAt: 1, confidence: 0.45 }),
        ev("SpatialObservationRecorded", 5, { subjectKind: "landmark", subjectId: "suspended_monolith", knowledge: "observed", observedAt: 5, confidence: 0.8 }),
      ];
      const journal = buildDiscoveryJournal(events);
      const card = journal.cards.find((c) => c.discoveryId === "monolith_sighting");
      expect(card).toBeDefined();
      expect(card!.stage).toBe("discovered");
    });
  });

  describe("crossing_changes", () => {
    it("one condition change → trace", () => {
      const events = [ev("CrossingConditionChanged", 1, { crossingId: "river_crossing", watercourseId: "river_basin", previousCondition: "open", condition: "difficult", previousTravelCostTicks: 2, travelCostTicks: 4 })];
      const journal = buildDiscoveryJournal(events);
      const card = journal.cards.find((c) => c.discoveryId === "crossing_changes");
      expect(card).toBeDefined();
      expect(card!.stage).toBe("trace");
    });
  });

  describe("canonical region content", () => {
    it("waterfall observation forms a hypothesis after re-observation", () => {
      const events = [
        ev("ObjectObserved", 2, { objectId: "western_cliff_waterfalls", description: "Потоки падают с утёса." }),
        ev("ObjectObserved", 7, { objectId: "western_cliff_waterfalls", description: "Потоки всё ещё питают реку." }),
      ];
      const journal = buildDiscoveryJournal(events);
      const card = journal.cards.find((c) => c.discoveryId === "western_waterfalls");
      expect(card?.stage).toBe("hypothesis");
      expect(card?.question).toContain("уровнем реки");
    });

    it("crater surface remains an observation, not an origin truth", () => {
      const journal = buildDiscoveryJournal([
        ev("ObjectObserved", 3, { objectId: "glass_crater_surface", description: "Камень отражает свет." }),
      ]);
      const card = journal.cards.find((c) => c.discoveryId === "crater_surface");
      expect(card?.stage).toBe("trace");
      expect(card?.question).toContain("отражает");
    });

  });

  describe("biography chains", () => {
    it("builds biography chains from evidence", () => {
      const events = [
        ev("RiverLevelChanged", 1, { watercourseId: "river_basin", previousLevel: 40, level: 65, previousBand: "normal", band: "high" }),
        ev("RiverLevelChanged", 5, { watercourseId: "river_basin", previousLevel: 65, level: 30, previousBand: "high", band: "normal" }),
      ];
      const journal = buildDiscoveryJournal(events);
      expect(journal.biographyChains.length).toBeGreaterThanOrEqual(1);
      const chain = journal.biographyChains[0]!;
      expect(chain.steps.length).toBeGreaterThanOrEqual(2);
      expect(chain.status).toBe("forming");
    });
  });

  describe("offline events excluded", () => {
    it("offline TickPassed does not generate evidence", () => {
      const events = [
        ev("TickPassed", 1, { delta: 1, playerOffline: true }),
        ev("RiverLevelChanged", 1, { watercourseId: "river_basin", previousLevel: 40, level: 65, previousBand: "normal", band: "high" }),
      ];
      const journal = buildDiscoveryJournal(events);
      // The RiverLevelChanged should still generate evidence (it's not filtered)
      const card = journal.cards.find((c) => c.discoveryId === "river_cycle");
      expect(card).toBeDefined();
    });
  });

  describe("determinism", () => {
    it("same input always gives same output", () => {
      const events = [
        ev("RiverLevelChanged", 1, { watercourseId: "river_basin", previousLevel: 40, level: 65, previousBand: "normal", band: "high" }),
        ev("CrossingConditionChanged", 2, { crossingId: "river_crossing", watercourseId: "river_basin", previousCondition: "open", condition: "difficult", previousTravelCostTicks: 2, travelCostTicks: 4 }),
      ];
      const j1 = buildDiscoveryJournal(events);
      const j2 = buildDiscoveryJournal(events);
      expect(j1.cards.length).toBe(j2.cards.length);
      expect(j1.biographyChains.length).toBe(j2.biographyChains.length);
    });
  });
});
