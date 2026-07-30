import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import { interactionRules } from "@skald/world";

const interactionForce = interactionRules.find((r) => r.id === "interaction.force")!;

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

function validatedEvent(
  operation: string,
  target?: { raw: string; normalized?: string },
  eventId = "act-1",
): DomainEvent {
  return {
    eventId,
    type: "ActionValidated",
    schemaVersion: 1,
    payload: {
      actionType: "InteractionRequested",
      originalEventId: "raw-1",
      originalPayload: {
        operation,
        target,
      },
    },
    timestamp: 1,
    correlationId: "cmd-1",
    causationId: "raw-1",
  };
}

describe("interaction.force", () => {
  it("returns [] when operation is not apply_force", () => {
    const event = validatedEvent("observe", { raw: "дверь" });
    const w = world();
    expect(interactionForce.handle(event, w)).toEqual([]);
  });

  it("returns ActionHadNoObservableEffect when no location", () => {
    const event = validatedEvent("apply_force", { raw: "дверь" });
    const w = world({ currentLocationId: "" as string });

    const out = interactionForce.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("ActionHadNoObservableEffect");
    expect(out[0]!.payload).toEqual({ reason: "no_location" });
  });

  it("returns ActionHadNoObservableEffect when target not found", () => {
    const event = validatedEvent("apply_force", { raw: "несуществующий" });
    const w = world();

    const out = interactionForce.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("ActionHadNoObservableEffect");
    expect(out[0]!.payload).toEqual({ reason: "target_not_found" });
  });

  it("requests critical check when integrity is between 20 and 80", () => {
    const event = validatedEvent("apply_force", { raw: "дверь" });
    const w = world();

    const out = interactionForce.handle(event, w);

    const checkEvent = out.find((e) => e.type === "CriticalCheckRequested");
    expect(checkEvent).toBeDefined();
    expect(checkEvent!.payload).toMatchObject({
      checkKind: "force",
      die: "d20",
      targetObjectId: "tower_door",
      targetObjectName: "Башенная дверь",
      locationId: "tower_entrance",
    });
    expect((checkEvent!.payload as { difficulty: number }).difficulty).toBeGreaterThanOrEqual(10);
    expect((checkEvent!.payload as { difficulty: number }).difficulty).toBeLessThanOrEqual(15);
  });

  it("applies direct damage when integrity <= 20 (no check)", () => {
    const event = validatedEvent("apply_force", { raw: "петля" });
    const w = world({
      objects: new Map([
        ["tower_hinge", {
          id: "tower_hinge",
          name: "Петля двери",
          description: "Ржавая петля",
          material: "iron" as const,
          locationId: "tower_entrance",
          integrity: 15,
          temperature: 20,
          state: Object.freeze({}),
        }],
      ]),
    });

    const out = interactionForce.handle(event, w);

    const integrityEvent = out.find((e) => e.type === "ObjectIntegrityChanged");
    expect(integrityEvent).toBeDefined();
    expect(integrityEvent!.payload).toMatchObject({
      objectId: "tower_hinge",
      previousIntegrity: 15,
      integrity: 0,
    });

    const checkEvent = out.find((e) => e.type === "CriticalCheckRequested");
    expect(checkEvent).toBeUndefined();
  });

  it("applies direct damage when integrity >= 80 (no check)", () => {
    const event = validatedEvent("apply_force", { raw: "дверь" });
    const w = world({
      objects: new Map([
        ["tower_door", {
          id: "tower_door",
          name: "Башенная дверь",
          description: "Дубовая дверь",
          material: "wood" as const,
          locationId: "tower_entrance",
          integrity: 90,
          temperature: 20,
          state: Object.freeze({ locked: true }),
        }],
      ]),
    });

    const out = interactionForce.handle(event, w);

    const integrityEvent = out.find((e) => e.type === "ObjectIntegrityChanged");
    expect(integrityEvent).toBeDefined();
    expect(integrityEvent!.payload).toMatchObject({
      objectId: "tower_door",
      previousIntegrity: 90,
      integrity: 70,
    });
  });

  it("adds hot metal modifier when temperature > HOT", () => {
    const event = validatedEvent("apply_force", { raw: "дверь" });
    const w = world({
      objects: new Map([
        ["tower_door", {
          id: "tower_door",
          name: "Башенная дверь",
          description: "Дубовая дверь",
          material: "wood" as const,
          locationId: "tower_entrance",
          integrity: 50,
          temperature: 200,
          state: Object.freeze({ locked: true }),
        }],
      ]),
    });

    const out = interactionForce.handle(event, w);

    const checkEvent = out.find((e) => e.type === "CriticalCheckRequested");
    expect(checkEvent).toBeDefined();
    const payload = checkEvent!.payload as { modifiers: Array<{ label: string; delta: number }> };
    expect(payload.modifiers.some((m) => m.label === "Нагретый металл")).toBe(true);
  });

  it("adds damage modifier when integrity < 60", () => {
    const event = validatedEvent("apply_force", { raw: "дверь" });
    const w = world({
      objects: new Map([
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
      ]),
    });

    const out = interactionForce.handle(event, w);

    const checkEvent = out.find((e) => e.type === "CriticalCheckRequested");
    expect(checkEvent).toBeDefined();
    const payload = checkEvent!.payload as { modifiers: Array<{ label: string; delta: number }> };
    expect(payload.modifiers.some((m) => m.label === "Повреждение")).toBe(true);
  });

  it("adds weakened modifier when integrity < 40", () => {
    const event = validatedEvent("apply_force", { raw: "петля" });
    const w = world({
      objects: new Map([
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
      ]),
    });

    const out = interactionForce.handle(event, w);

    const checkEvent = out.find((e) => e.type === "CriticalCheckRequested");
    expect(checkEvent).toBeDefined();
    const payload = checkEvent!.payload as { modifiers: Array<{ label: string; delta: number }> };
    expect(payload.modifiers.some((m) => m.label === "Уже ослаблен")).toBe(true);
  });

  it("emits SoundProduced before check", () => {
    const event = validatedEvent("apply_force", { raw: "дверь" });
    const w = world();

    const out = interactionForce.handle(event, w);

    const soundEvent = out.find((e) => e.type === "SoundProduced");
    expect(soundEvent).toBeDefined();
    expect(soundEvent!.payload).toMatchObject({
      source: "Башенная дверь",
      kind: "impact",
      intensity: "loud",
      locationId: "tower_entrance",
    });
  });

  it("emits SoundProduced on direct damage (no check)", () => {
    const event = validatedEvent("apply_force", { raw: "дверь" });
    const w = world({
      objects: new Map([
        ["tower_door", {
          id: "tower_door",
          name: "Башенная дверь",
          description: "Дубовая дверь",
          material: "wood" as const,
          locationId: "tower_entrance",
          integrity: 90,
          temperature: 20,
          state: Object.freeze({ locked: true }),
        }],
      ]),
    });

    const out = interactionForce.handle(event, w);

    const soundEvent = out.find((e) => e.type === "SoundProduced");
    expect(soundEvent).toBeDefined();
  });

  it("does not mutate the world", () => {
    const event = validatedEvent("apply_force", { raw: "дверь" });
    const w = world();
    interactionForce.handle(event, w);
    expect(w.objects.get("tower_door")!.integrity).toBe(50);
  });
});
