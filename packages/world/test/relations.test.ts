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
    lastActionTick: 0,
    eventNumber: 0,
    time: 0,
  }) as unknown as ReadonlyWorld;
}

function giveValidated(eventId: string, relation: string, target: string, timestamp = 1): DomainEvent {
  return {
    eventId,
    type: "GiveValidated",
    schemaVersion: 1,
    payload: {
      actionType: "GiveRequested",
      originalEventId: `${eventId}-orig`,
      originalPayload: { relation, target },
    },
    timestamp,
    correlationId: "cmd-1",
    causationId: `${eventId}-orig`,
  };
}

describe("relations.give (via GiveValidated gate)", () => {
  it("produces RelationChanged with delta 1 for help", () => {
    const event = giveValidated("g-1", "help", "guild");
    const out = giveRule.handle(event, world());

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("RelationChanged");
    expect(out[0]!.payload).toEqual({ from: "player", to: "guild", kind: "help", delta: 1 });
    expect(out[0]!.causationId).toBe("g-1");
    expect(out[0]!.eventId).toBe("g-1>RelationChanged#0");
  });

  it("produces RelationChanged for respect", () => {
    const event = giveValidated("g-2", "respect", "merchant");
    const out = giveRule.handle(event, world());
    expect(out[0]!.payload).toEqual({ from: "player", to: "merchant", kind: "respect", delta: 1 });
  });

  it("produces RelationChanged for fear", () => {
    const event = giveValidated("g-3", "fear", "dragon");
    const out = giveRule.handle(event, world());
    expect(out[0]!.payload).toEqual({ from: "player", to: "dragon", kind: "fear", delta: 1 });
  });

  it("does not mutate the world", () => {
    const event = giveValidated("g-1", "help", "guild");
    const w = world();
    giveRule.handle(event, w);
    expect(w.relations.size).toBe(0);
  });
});
