import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import { criticalCheckRules, criticalCheckOutcomeRules } from "@skald/world";

const criticalCheckResolution = criticalCheckRules[0]!;
const criticalCheckOutcome = criticalCheckOutcomeRules[0]!;

function world(overrides: Partial<ReadonlyWorld> = {}): ReadonlyWorld {
  const objects = new Map([
    ["tower_door", {
      id: "tower_door",
      name: "Башенная дверь",
      description: "Дубовая дверь",
      material: "wood" as const,
      locationId: "tower_entrance",
      integrity: 50,
      temperature: 20,
      state: Object.freeze({ locked: true }),
    }],
    ["tower_hinge", {
      id: "tower_hinge",
      name: "Петля двери",
      description: "Ржавая петля",
      material: "iron" as const,
      locationId: "tower_entrance",
      integrity: 30,
      temperature: 20,
      state: Object.freeze({}),
    }],
  ]);
  const locations = new Map([
    ["tower_entrance", {
      id: "tower_entrance",
      name: "Вход в Башню",
      description: "Каменные ступени",
      objectIds: ["tower_door", "tower_hinge"],
      connections: Object.freeze({ enter: "tower_interior" }),
    }],
  ]);
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
    eventNumber: 0,
    time: 0,
    objects,
    locations,
    currentLocationId: "tower_entrance",
    pendingChecks: new Map(),
    ...overrides,
  }) as unknown as ReadonlyWorld;
}

function evt(type: string, eventId: string, payload: unknown = {}, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

describe("checks.resolution", () => {
  const basePayload = {
    checkId: "act-1>check",
    actionEventId: "act-1",
    checkKind: "force",
    die: "d20",
    difficulty: 12,
    modifiers: [{ label: "Test", delta: 2 }],
    stakes: { success: "Door breaks", failure: "Door holds" },
    targetObjectId: "tower_door",
    targetObjectName: "Башенная дверь",
    locationId: "tower_entrance",
  };

  it("returns CriticalCheckResolved with success when total >= difficulty", () => {
    const event = evt("CriticalCheckRolled", "roll-1", {
      ...basePayload,
      naturalRoll: 15,
      modifierTotal: 2,
      total: 17,
    });
    const w = world();

    const out = criticalCheckResolution.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("CriticalCheckResolved");
    expect(out[0]!.payload).toEqual({
      checkId: "act-1>check",
      naturalRoll: 15,
      modifierTotal: 2,
      total: 17,
      difficulty: 12,
      outcome: "success",
      description: "Door breaks",
      targetObjectId: "tower_door",
      targetObjectName: "Башенная дверь",
      locationId: "tower_entrance",
    });
    expect(out[0]!.causationId).toBe("roll-1");
    expect(out[0]!.eventId).toBe("roll-1>CriticalCheckResolved#0");
  });

  it("returns critical_success when natural roll is 20", () => {
    const event = evt("CriticalCheckRolled", "roll-2", {
      ...basePayload,
      naturalRoll: 20,
      modifierTotal: 0,
      total: 20,
    });
    const w = world();

    const out = criticalCheckResolution.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.payload).toMatchObject({
      outcome: "critical_success",
      description: "Критический успех! Door breaks",
    });
  });

  it("returns critical_failure when natural roll is 1", () => {
    const event = evt("CriticalCheckRolled", "roll-3", {
      ...basePayload,
      naturalRoll: 1,
      modifierTotal: 5,
      total: 6,
    });
    const w = world();

    const out = criticalCheckResolution.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.payload).toMatchObject({
      outcome: "critical_failure",
      description: "Критическая ошибка! Door holds",
    });
  });

  it("returns failure when total < difficulty but >= difficulty - 5", () => {
    const event = evt("CriticalCheckRolled", "roll-4", {
      ...basePayload,
      naturalRoll: 8,
      modifierTotal: 2,
      total: 10,
      difficulty: 12,
    });
    const w = world();

    const out = criticalCheckResolution.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.payload).toMatchObject({
      outcome: "failure",
      description: "Door holds",
    });
  });

  it("returns critical_failure when total < difficulty - 5", () => {
    const event = evt("CriticalCheckRolled", "roll-5", {
      ...basePayload,
      naturalRoll: 3,
      modifierTotal: 0,
      total: 3,
      difficulty: 12,
    });
    const w = world();

    const out = criticalCheckResolution.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.payload).toMatchObject({
      outcome: "critical_failure",
      description: "Критическая ошибка! Door holds",
    });
  });

  it("passes through targetObjectId, targetObjectName, locationId", () => {
    const event = evt("CriticalCheckRolled", "roll-6", {
      ...basePayload,
      naturalRoll: 15,
      modifierTotal: 0,
      total: 15,
      targetObjectId: "tower_hinge",
      targetObjectName: "Петля двери",
      locationId: "tower_entrance",
    });
    const w = world();

    const out = criticalCheckResolution.handle(event, w);

    expect(out[0]!.payload).toMatchObject({
      targetObjectId: "tower_hinge",
      targetObjectName: "Петля двери",
      locationId: "tower_entrance",
    });
  });

  it("does not mutate the world", () => {
    const event = evt("CriticalCheckRolled", "roll-7", {
      ...basePayload,
      naturalRoll: 15,
      modifierTotal: 0,
      total: 15,
    });
    const w = world();
    criticalCheckResolution.handle(event, w);
    expect(w.objects.size).toBe(2);
  });
});

describe("checks.outcome", () => {
  const baseResolvedPayload = {
    checkId: "act-1>check",
    naturalRoll: 15,
    modifierTotal: 2,
    total: 17,
    difficulty: 12,
    targetObjectId: "tower_door",
    targetObjectName: "Башенная дверь",
    locationId: "tower_entrance",
  };

  it("applies damage on success", () => {
    const event = evt("CriticalCheckResolved", "res-1", {
      ...baseResolvedPayload,
      outcome: "success",
      description: "Door breaks",
    });
    const w = world();

    const out = criticalCheckOutcome.handle(event, w);

    const integrityEvent = out.find((e) => e.type === "ObjectIntegrityChanged");
    expect(integrityEvent).toBeDefined();
    expect(integrityEvent!.payload).toMatchObject({
      objectId: "tower_door",
      name: "Башенная дверь",
      previousIntegrity: 50,
      integrity: 25,
    });
  });

  it("applies more damage on critical_success", () => {
    const event = evt("CriticalCheckResolved", "res-2", {
      ...baseResolvedPayload,
      outcome: "critical_success",
      description: "Критический успех! Door breaks",
    });
    const w = world();

    const out = criticalCheckOutcome.handle(event, w);

    const integrityEvent = out.find((e) => e.type === "ObjectIntegrityChanged");
    expect(integrityEvent).toBeDefined();
    expect(integrityEvent!.payload).toMatchObject({
      objectId: "tower_door",
      previousIntegrity: 50,
      integrity: 10,
    });
  });

  it("creates noise consequence on failure", () => {
    const event = evt("CriticalCheckResolved", "res-3", {
      ...baseResolvedPayload,
      outcome: "failure",
      description: "Door holds",
    });
    const w = world();

    const out = criticalCheckOutcome.handle(event, w);

    const consequence = out.find((e) => e.type === "ConsequenceCreated");
    expect(consequence).toBeDefined();
    expect(consequence!.payload).toMatchObject({
      type: "noise_attention",
      severity: 2,
      data: { source: "Башенная дверь", intensity: "loud" },
    });
  });

  it("creates more severe noise on critical_failure", () => {
    const event = evt("CriticalCheckResolved", "res-4", {
      ...baseResolvedPayload,
      outcome: "critical_failure",
      description: "Критическая ошибка! Door holds",
    });
    const w = world();

    const out = criticalCheckOutcome.handle(event, w);

    const consequence = out.find((e) => e.type === "ConsequenceCreated");
    expect(consequence).toBeDefined();
    expect(consequence!.payload).toMatchObject({
      type: "noise_attention",
      severity: 3,
    });
  });

  it("opens passage and unlocks door when integrity reaches 0", () => {
    const event = evt("CriticalCheckResolved", "res-5", {
      ...baseResolvedPayload,
      outcome: "critical_success",
      description: "Критический успех! Door breaks",
      targetObjectId: "tower_door",
    });
    const w = world({
      objects: new Map([
        ["tower_door", {
          id: "tower_door",
          name: "Башенная дверь",
          description: "Дубовая дверь",
          material: "wood" as const,
          locationId: "tower_entrance",
          integrity: 15,
          temperature: 20,
          state: Object.freeze({ locked: true }),
        }],
      ]),
    });

    const out = criticalCheckOutcome.handle(event, w);

    // Should have 3 events: ObjectIntegrityChanged (damage), ObjectIntegrityChanged (unlock), PassageOpened
    const integrityEvents = out.filter((e) => e.type === "ObjectIntegrityChanged");
    expect(integrityEvents).toHaveLength(2);

    // First: damage to 0
    expect(integrityEvents[0]!.payload).toMatchObject({
      objectId: "tower_door",
      previousIntegrity: 15,
      integrity: 0,
    });

    // Second: unlock
    expect(integrityEvents[1]!.payload).toMatchObject({
      objectId: "tower_door",
      integrity: 0,
      stateChange: { locked: false },
    });

    const passageEvent = out.find((e) => e.type === "PassageOpened");
    expect(passageEvent).toBeDefined();
    expect(passageEvent!.payload).toMatchObject({
      fromLocationId: "tower_entrance",
      via: "tower_door",
    });
  });

  it("opens passage when hinge is destroyed (not door)", () => {
    const event = evt("CriticalCheckResolved", "res-6", {
      ...baseResolvedPayload,
      outcome: "critical_success",
      description: "Критический успех! Hinge breaks",
      targetObjectId: "tower_hinge",
      targetObjectName: "Петля двери",
    });
    const w = world({
      objects: new Map([
        ["tower_hinge", {
          id: "tower_hinge",
          name: "Петля двери",
          description: "Ржавая петля",
          material: "iron" as const,
          locationId: "tower_entrance",
          integrity: 10,
          temperature: 20,
          state: Object.freeze({}),
        }],
      ]),
    });

    const out = criticalCheckOutcome.handle(event, w);

    const passageEvent = out.find((e) => e.type === "PassageOpened");
    expect(passageEvent).toBeDefined();

    // Should NOT unlock tower_door when hinge is destroyed
    const integrityEvents = out.filter((e) => e.type === "ObjectIntegrityChanged");
    expect(integrityEvents).toHaveLength(1);
    expect(integrityEvents[0]!.payload).toMatchObject({ objectId: "tower_hinge" });
  });

  it("always emits ActionResolved", () => {
    const outcomes = ["success", "critical_success", "failure", "critical_failure"] as const;
    for (const outcome of outcomes) {
      const event = evt("CriticalCheckResolved", `res-${outcome}`, {
        ...baseResolvedPayload,
        outcome,
        description: `Test ${outcome}`,
      });
      const w = world();

      const out = criticalCheckOutcome.handle(event, w);

      const resolved = out.find((e) => e.type === "ActionResolved");
      expect(resolved).toBeDefined();
      expect(resolved!.payload).toMatchObject({
        actionEventId: "act-1",
        result: outcome === "success" || outcome === "critical_success" ? "success" : "failure",
      });
    }
  });

  it("returns [] when target object not found", () => {
    const event = evt("CriticalCheckResolved", "res-unknown", {
      ...baseResolvedPayload,
      outcome: "success",
      description: "Door breaks",
      targetObjectId: "nonexistent_object",
    });
    const w = world();

    const out = criticalCheckOutcome.handle(event, w);

    // Should still emit ActionResolved even if object not found
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("ActionResolved");
  });

  it("does not emit duplicate ActionResolved", () => {
    const event = evt("CriticalCheckResolved", "res-dup", {
      ...baseResolvedPayload,
      outcome: "success",
      description: "Door breaks",
    });
    const w = world();

    const out = criticalCheckOutcome.handle(event, w);

    const resolvedEvents = out.filter((e) => e.type === "ActionResolved");
    expect(resolvedEvents).toHaveLength(1);
  });

  it("does not mutate the world", () => {
    const event = evt("CriticalCheckResolved", "res-mut", {
      ...baseResolvedPayload,
      outcome: "success",
      description: "Door breaks",
    });
    const w = world();
    criticalCheckOutcome.handle(event, w);
    expect(w.objects.size).toBe(2);
    expect(w.objects.get("tower_door")!.integrity).toBe(50);
  });
});
