import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld, StrategyEntry } from "@skald/world";
import { playerStrategy } from "@skald/world";

function world(strategy: StrategyEntry[] = [], cons: { type: string }[] = [], heatMap: Record<string, number> = {}): ReadonlyWorld {
  const consequences = new Map<string, { id: string; type: string; severity: number; createdAt: number; expiresAt: number; data: Record<string, unknown> }>();
  for (let i = 0; i < cons.length; i++) {
    const c = cons[i]!;
    consequences.set(`c-${i}`, { id: `c-${i}`, type: c.type, severity: 1, createdAt: 0, expiresAt: 10, data: {} });
  }
  const hm = new Map<string, number>();
  for (const [k, v] of Object.entries(heatMap)) hm.set(k, v);
  return Object.freeze({
    player: Object.freeze({ x: 1, y: 1 }),
    walls: new Set<string>(),
    observations: new Map<string, number>(),
    consequences,
    firedConsequences: new Map(),
    activeSituations: new Map(),
    burnedTrees: 0,
    relations: new Map(),
    heatSources: new Map(),
    heatMap: hm,
    lastActionTick: 0,
    strategy,
    eventNumber: 0,
    time: 0,
  }) as unknown as ReadonlyWorld;
}

function tick(ts: number, playerOffline: boolean): DomainEvent {
  return { eventId: `tick-${ts}`, type: "TickPassed", schemaVersion: 1, payload: { delta: 1, playerOffline }, timestamp: ts, correlationId: "tick-1", causationId: null };
}

describe("player.strategy", () => {
  it("triggers MoveRequested for always → move_south", () => {
    const w = world([{ condition: "always", action: "move_south" }]);
    const out = playerStrategy.handle(tick(1, true), w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("MoveRequested");
    expect(out[0]!.payload).toEqual({ direction: "south" });
    expect(out[0]!.causationId).toBe("tick-1");
  });

  it("returns [] when predicate never matches", () => {
    const w = world([{ condition: "never", action: "move_south" }]);
    expect(playerStrategy.handle(tick(1, true), w)).toEqual([]);
  });

  it("returns [] when not playerOffline (live tick)", () => {
    const w = world([{ condition: "always", action: "move_south" }]);
    expect(playerStrategy.handle(tick(1, false), w)).toEqual([]);
  });

  it("returns [] when strategy is empty", () => {
    const w = world([]);
    expect(playerStrategy.handle(tick(1, true), w)).toEqual([]);
  });

  it("falls through to second predicate when first doesn't match", () => {
    const w = world([
      { condition: "danger_nearby", action: "move_south" },
      { condition: "always", action: "give_help_to_guild" },
    ]);
    const out = playerStrategy.handle(tick(1, true), w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("GiveRequested");
    expect(out[0]!.payload).toEqual({ relation: "help", target: "guild" });
  });

  it("triggers move_south when danger_nearby matches (has audacity consequence)", () => {
    const w = world(
      [{ condition: "danger_nearby", action: "move_south" }, { condition: "always", action: "give_help_to_guild" }],
      [{ type: "audacity" }],
    );
    const out = playerStrategy.handle(tick(1, true), w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("MoveRequested");
    expect(out[0]!.payload).toEqual({ direction: "south" });
  });

  it("skips unknown predicate", () => {
    const w = world([{ condition: "unknown_predicate", action: "move_south" }, { condition: "always", action: "give_help_to_guild" }]);
    const out = playerStrategy.handle(tick(1, true), w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("GiveRequested");
  });

  it("breaks on unknown action (no fall-through)", () => {
    const w = world([{ condition: "always", action: "unknown_action" }, { condition: "always", action: "give_help_to_guild" }]);
    const out = playerStrategy.handle(tick(1, true), w);

    expect(out).toEqual([]);
  });

  it("returns [] for idle action", () => {
    const w = world([{ condition: "always", action: "idle" }]);
    expect(playerStrategy.handle(tick(1, true), w)).toEqual([]);
  });

  it("does not mutate world", () => {
    const w = world([{ condition: "always", action: "move_south" }]);
    playerStrategy.handle(tick(1, true), w);
    expect(w.strategy.length).toBe(1);
  });
});
