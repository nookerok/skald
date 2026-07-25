import { describe, it, expect } from "vitest";
import type { ReadonlyWorld, Consequence } from "@skald/world";
import { PREDICATES, ACTIONS } from "@skald/world";

function emptyWorld(): ReadonlyWorld {
  return Object.freeze({
    player: Object.freeze({ x: 0, y: 0 }),
    walls: new Set<string>(),
    observations: new Map<string, number>(),
    consequences: new Map<string, Consequence>(),
    firedConsequences: new Map(),
    activeSituations: new Map(),
    burnedTrees: 0,
    relations: new Map(),
    heatSources: new Map(),
    heatMap: new Map(),
    lastActionTick: 0,
    strategy: [],
    eventNumber: 0,
    time: 0,
  }) as unknown as ReadonlyWorld;
}

function worldWithAudacity(): ReadonlyWorld {
  const w = emptyWorld();
  const c: Consequence = { id: "aud@1", type: "audacity", severity: 1, createdAt: 1, expiresAt: 10, data: {} };
  const map = new Map<string, Consequence>();
  map.set("aud@1", c);
  return Object.freeze({ ...w, consequences: map }) as unknown as ReadonlyWorld;
}

function worldWithHeat(amount: number): ReadonlyWorld {
  const hm = new Map<string, number>();
  hm.set("0,0", amount);
  return Object.freeze({ ...emptyWorld(), heatMap: hm }) as unknown as ReadonlyWorld;
}

describe("PREDICATES", () => {
  it("always returns true", () => {
    expect(PREDICATES.get("always")!(emptyWorld())).toBe(true);
  });

  it("never returns false", () => {
    expect(PREDICATES.get("never")!(emptyWorld())).toBe(false);
  });

  it("danger_nearby returns false without audacity", () => {
    expect(PREDICATES.get("danger_nearby")!(emptyWorld())).toBe(false);
  });

  it("danger_nearby returns true with audacity", () => {
    expect(PREDICATES.get("danger_nearby")!(worldWithAudacity())).toBe(true);
  });

  it("heat_at_player returns true when heat >= 5", () => {
    expect(PREDICATES.get("heat_at_player")!(worldWithHeat(5))).toBe(true);
    expect(PREDICATES.get("heat_at_player")!(worldWithHeat(10))).toBe(true);
  });

  it("heat_at_player returns false when heat < 5", () => {
    expect(PREDICATES.get("heat_at_player")!(worldWithHeat(4))).toBe(false);
    expect(PREDICATES.get("heat_at_player")!(worldWithHeat(0))).toBe(false);
  });

  it("finite set — 4 predicates", () => {
    expect(PREDICATES.size).toBe(4);
  });
});

describe("ACTIONS", () => {
  it("move_south returns correct intent", () => {
    expect(ACTIONS.get("move_south")!()).toEqual({ type: "move", direction: "south" });
  });

  it("move_north returns correct intent", () => {
    expect(ACTIONS.get("move_north")!()).toEqual({ type: "move", direction: "north" });
  });

  it("give_help_to_guild returns correct intent", () => {
    expect(ACTIONS.get("give_help_to_guild")!()).toEqual({ type: "give", relation: "help", target: "guild" });
  });

  it("idle returns idle intent", () => {
    expect(ACTIONS.get("idle")!()).toEqual({ type: "idle" });
  });

  it("finite set — 4 actions", () => {
    expect(ACTIONS.size).toBe(4);
  });
});
