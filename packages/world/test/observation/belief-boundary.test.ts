/**
 * Observation/Belief Boundary Test (PR-6.4)
 *
 * Documents the current architecture:
 *   World State → buildBeliefModel (compatibility adapter) → BeliefModel
 *
 * Target architecture (future):
 *   World State → Observable Surface → Observation Engine → Belief Model → Presentation
 *
 * This test verifies the boundary is respected:
 *   - BeliefModel is built from events + world, NOT from raw Simulation state
 *   - No hidden world state leaks into BeliefModel
 *   - Observer-scoped: only observer-visible events enter BeliefModel
 */

import { describe, it, expect } from "vitest";
import { buildBeliefModel, serializeBeliefModel } from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";

function evt(type: string, timestamp: number, payload: unknown = {}): DomainEvent {
  return { eventId: `${type}-${timestamp}`, type, schemaVersion: 1, payload, timestamp, correlationId: "test", causationId: null };
}

describe("Observation/Belief Boundary (PR-6.4)", () => {
  it("BeliefModel is built from events, not from raw world state", () => {
    const events = [
      evt("PlayerSpawned", 0, { x: 0, y: 0 }),
      evt("ObservationUpdated", 1, { key: "risk_taken", delta: 1 }),
    ];
    // World is minimal — BeliefModel comes from events
    const world = {
      player: { x: 0, y: 0 },
      walls: new Set(),
      observations: new Map(),
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
      time: 1,
      objects: new Map(),
      locations: new Map(),
      currentLocationId: "",
      pendingChecks: new Map(),
      entities: new Map(),
      journeys: new Map(),
      activeJourneyId: null,
      spatial: null,
      weather: null,
    } as any;

    const model = buildBeliefModel(events, world, "player");

    // BeliefModel is derived from events, not world state
    expect(model.schemaVersion).toBe(2);
    expect(model.observerId).toBe("player");
    expect(model.lastUpdated).toBe(1);
  });

  it("hidden events do not enter BeliefModel", () => {
    const events = [
      evt("PlayerSpawned", 0, { x: 0, y: 0 }),
      // ConsequenceCreated is hidden from observer
      evt("ConsequenceCreated", 1, { id: "c-1", type: "noise_attention", severity: 2, createdAt: 1, expiresAt: 4, data: {} }),
      evt("ObservationUpdated", 2, { key: "risk_taken", delta: 1 }),
    ];
    const world = {
      player: { x: 0, y: 0 },
      walls: new Set(),
      observations: new Map(),
      consequences: new Map([["c-1", { id: "c-1", type: "noise_attention", severity: 2, createdAt: 1, expiresAt: 4, data: {} }]]),
      firedConsequences: new Map(),
      activeSituations: new Map(),
      burnedTrees: 0,
      relations: new Map(),
      heatSources: new Map(),
      heatMap: new Map(),
      lastActionTick: 0,
      strategy: [],
      eventNumber: 0,
      time: 2,
      objects: new Map(),
      locations: new Map(),
      currentLocationId: "",
      pendingChecks: new Map(),
      entities: new Map(),
      journeys: new Map(),
      activeJourneyId: null,
      spatial: null,
      weather: null,
    } as any;

    const model = buildBeliefModel(events, world, "player");

    // ConsequenceCreated should not create a belief
    const noiseBelief = model.beliefs.get("consequence:noise_attention");
    expect(noiseBelief).toBeUndefined();
  });

  it("observer-scoped: only player observer is supported", () => {
    const events = [evt("PlayerSpawned", 0, { x: 0, y: 0 })];
    const world = { time: 0 } as any;

    const model = buildBeliefModel(events, world, "npc-123");

    // Non-player observers get empty model
    expect(model.observerId).toBe("npc-123");
    expect(model.beliefs.size).toBe(0);
  });

  it("BeliefModel is serializable for persistence", () => {
    const events = [
      evt("PlayerSpawned", 0, { x: 0, y: 0 }),
      evt("ObservationUpdated", 1, { key: "risk_taken", delta: 1 }),
    ];
    const world = { time: 1 } as any;

    const model = buildBeliefModel(events, world, "player");
    const serialized = serializeBeliefModel(model);

    // Serialized form is a DTO (JSON-safe object)
    expect(serialized).toBeDefined();
    expect(serialized.schemaVersion).toBe(2);
    expect(serialized.observerId).toBe("player");

    // Can be further serialized to JSON
    const json = JSON.stringify(serialized);
    expect(typeof json).toBe("string");
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(2);
  });

  it("BeliefModel does not contain raw Event Log data", () => {
    const events = [
      evt("PlayerSpawned", 0, { x: 0, y: 0 }),
      evt("ObservationUpdated", 1, { key: "risk_taken", delta: 1 }),
    ];
    const world = { time: 1 } as any;

    const model = buildBeliefModel(events, world, "player");
    const serialized = JSON.stringify(model);

    // Should not contain raw event IDs or internal state
    expect(serialized).not.toContain("eventId");
    expect(serialized).not.toContain("causationId");
    expect(serialized).not.toContain("correlationId");
  });
});
