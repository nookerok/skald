import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import { durationCheck } from "@skald/world";

function world(lastActionTick = 0): ReadonlyWorld {
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
    lastActionTick,
    eventNumber: 0,
    time: 0,
  }) as unknown as ReadonlyWorld;
}

function evt(type: string, eventId: string, payload: unknown = {}, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

describe("simulation.duration_check", () => {
  it("passes MoveRequested when no action in this tick", () => {
    const event = evt("MoveRequested", "m-1", { direction: "north" }, 5);
    const w = world(0); // lastActionTick != 5

    const out = durationCheck.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("ActionValidated");
    expect(out[0]!.payload).toEqual({
      actionType: "MoveRequested",
      originalEventId: "m-1",
      originalPayload: { direction: "north" },
    });
    expect(out[0]!.causationId).toBe("m-1");
    expect(out[0]!.eventId).toBe("m-1>ActionValidated#0");
  });

  it("rejects MoveRequested when tick already used", () => {
    const event = evt("MoveRequested", "m-2", { direction: "east" }, 5);
    const w = world(5); // lastActionTick === timestamp

    const out = durationCheck.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("ActionRejected");
    expect(out[0]!.payload).toEqual({ reason: "insufficient_time" });
    expect(out[0]!.causationId).toBe("m-2");
    expect(out[0]!.eventId).toBe("m-2>ActionRejected#0");
  });

  it("passes GiveRequested when no action in this tick", () => {
    const event = evt("GiveRequested", "g-1", { relation: "help", target: "guild" }, 5);
    const w = world(0);

    const out = durationCheck.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("GiveValidated");
    expect(out[0]!.payload).toEqual({
      actionType: "GiveRequested",
      originalEventId: "g-1",
      originalPayload: { relation: "help", target: "guild" },
    });
  });

  it("rejects GiveRequested when tick already used", () => {
    const event = evt("GiveRequested", "g-2", { relation: "help", target: "guild" }, 5);
    const w = world(5);

    const out = durationCheck.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("ActionRejected");
    expect(out[0]!.payload).toEqual({ reason: "insufficient_time" });
  });

  it("does not mutate the world", () => {
    const event = evt("MoveRequested", "m-1", { direction: "north" }, 5);
    const w = world(0);
    durationCheck.handle(event, w);
    expect(w.lastActionTick).toBe(0);
  });
});


describe("simulation.duration_check ? World Interaction Model gate", () => {
  it("passes InteractionRequested through InteractionTimeValidated", () => {
    const out = durationCheck.handle(
      evt("InteractionRequested", "interaction-1", { verb: "examine", object: "cart" }, 5),
      world(0),
    );
    expect(out).toEqual([expect.objectContaining({
      type: "InteractionTimeValidated",
      causationId: "interaction-1",
      payload: { verb: "examine", object: "cart" },
    })]);
  });

  it("rejects InteractionRequested when the action budget is exhausted", () => {
    const out = durationCheck.handle(
      evt("InteractionRequested", "interaction-2", { verb: "examine", object: "cart" }, 5),
      world(5),
    );
    expect(out).toEqual([expect.objectContaining({
      type: "ActionRejected",
      payload: { reason: "insufficient_time" },
    })]);
  });
});
