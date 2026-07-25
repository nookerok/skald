import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld, HeatSource } from "@skald/world";
import { heatSpread } from "@skald/world";

function world(heatSources: HeatSource[] = []): ReadonlyWorld {
  const hs = new Map<string, HeatSource>();
  for (const s of heatSources) hs.set(`${s.x},${s.y}`, s);
  return Object.freeze({
    player: Object.freeze({ x: 0, y: 0 }),
    walls: new Set<string>(),
    observations: new Map<string, number>(),
    consequences: new Map(),
    firedConsequences: new Map(),
    activeSituations: new Map(),
    burnedTrees: 0,
    relations: new Map(),
    heatSources: hs,
    heatMap: new Map(),
    eventNumber: 0,
    time: 0,
  }) as unknown as ReadonlyWorld;
}

function evt(type: string, eventId: string, payload: unknown = {}, timestamp = 1): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload, timestamp, correlationId: "tick-1", causationId: null };
}

describe("heat.spread", () => {
  it("emits 5 HeatRadiated for a center source at {1,1} intensity 10", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 1);
    const source: HeatSource = { id: "boot#heat", x: 1, y: 1, intensity: 10, placedAt: 0 };
    const w = world([source]);

    const out = heatSpread.handle(event, w);

    expect(out).toHaveLength(5);
    expect(out[0]!.payload).toEqual({ x: 1, y: 1, delta: 10 }); // center
    expect(out[1]!.payload).toEqual({ x: 2, y: 1, delta: 5 });  // east
    expect(out[2]!.payload).toEqual({ x: 0, y: 1, delta: 5 });  // west
    expect(out[3]!.payload).toEqual({ x: 1, y: 2, delta: 5 });  // north
    expect(out[4]!.payload).toEqual({ x: 1, y: 0, delta: 5 });  // south
    expect(out[0]!.causationId).toBe("tick-1");
  });

  it("emits 3 HeatRadiated for source at corner {0,0}", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 1);
    const source: HeatSource = { id: "boot#heat", x: 0, y: 0, intensity: 10, placedAt: 0 };
    const w = world([source]);

    const out = heatSpread.handle(event, w);

    expect(out).toHaveLength(3);
    expect(out[0]!.payload).toEqual({ x: 0, y: 0, delta: 10 });
    expect(out[1]!.payload).toEqual({ x: 1, y: 0, delta: 5 });
    expect(out[2]!.payload).toEqual({ x: 0, y: 1, delta: 5 });
  });

  it("all deltas are 1 for intensity 1 (Math.round(0.5)=1)", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 1);
    const source: HeatSource = { id: "boot#heat", x: 2, y: 2, intensity: 1, placedAt: 0 };
    const w = world([source]);

    const out = heatSpread.handle(event, w);

    expect(out).toHaveLength(5);
    for (const e of out) {
      expect((e.payload as { delta: number }).delta).toBe(1);
    }
  });

  it("returns [] for intensity 0", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 1);
    const source: HeatSource = { id: "boot#heat", x: 2, y: 2, intensity: 0, placedAt: 0 };
    const w = world([source]);
    expect(heatSpread.handle(event, w)).toEqual([]);
  });

  it("returns [] when no heat sources exist", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 1);
    const w = world();
    expect(heatSpread.handle(event, w)).toEqual([]);
  });

  it("does not mutate the world", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 1);
    const source: HeatSource = { id: "boot#heat", x: 1, y: 1, intensity: 10, placedAt: 0 };
    const w = world([source]);
    heatSpread.handle(event, w);
    expect(w.heatSources.size).toBe(1);
    expect(w.heatMap.size).toBe(0);
  });
});
