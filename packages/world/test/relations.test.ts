import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import { giveRule } from "@skald/world";

function world(): ReadonlyWorld {
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
    eventNumber: 0,
    time: 0,
  }) as unknown as ReadonlyWorld;
}

function evt(type: string, eventId: string, payload: unknown = {}, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "cmd-1", causationId: null };
}

describe("relations.give", () => {
  it("produces RelationChanged with delta 1 for help", () => {
    const event = evt("GiveRequested", "g-1", { relation: "help", target: "guild" });
    const out = giveRule.handle(event, world());

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("RelationChanged");
    expect(out[0]!.payload).toEqual({ from: "player", to: "guild", kind: "help", delta: 1 });
    expect(out[0]!.causationId).toBe("g-1");
    expect(out[0]!.eventId).toBe("g-1>RelationChanged#0");
  });

  it("produces RelationChanged for respect", () => {
    const event = evt("GiveRequested", "g-2", { relation: "respect", target: "merchant" });
    const out = giveRule.handle(event, world());
    expect(out[0]!.payload).toEqual({ from: "player", to: "merchant", kind: "respect", delta: 1 });
  });

  it("produces RelationChanged for fear", () => {
    const event = evt("GiveRequested", "g-3", { relation: "fear", target: "dragon" });
    const out = giveRule.handle(event, world());
    expect(out[0]!.payload).toEqual({ from: "player", to: "dragon", kind: "fear", delta: 1 });
  });

  it("does not mutate the world", () => {
    const event = evt("GiveRequested", "g-1", { relation: "help", target: "guild" });
    const w = world();
    giveRule.handle(event, w);
    expect(w.relations.size).toBe(0);
  });
});
