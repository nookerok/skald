import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld, ActiveSituation } from "@skald/world";
import { start, forestFireSpread, end } from "@skald/world";

function world(opts?: {
  observations?: Record<string, number>;
  activeSituations?: ActiveSituation[];
  burnedTrees?: number;
}): ReadonlyWorld {
  const obs = new Map<string, number>();
  if (opts?.observations) {
    for (const [k, v] of Object.entries(opts.observations)) obs.set(k, v);
  }
  const situations = new Map<string, ActiveSituation>();
  if (opts?.activeSituations) {
    for (const s of opts.activeSituations) situations.set(s.situationId, s);
  }
  return Object.freeze({
    player: Object.freeze({ x: 0, y: 0 }),
    walls: new Set<string>(),
    observations: obs,
    consequences: new Map(),
    firedConsequences: new Map(),
    activeSituations: situations,
    burnedTrees: opts?.burnedTrees ?? 0,
    eventNumber: 0,
    time: 0,
  }) as unknown as ReadonlyWorld;
}

function evt(
  type: string,
  eventId: string,
  payload: unknown = {},
  timestamp = 1,
): DomainEvent {
  return {
    eventId,
    type,
    schemaVersion: 1,
    payload,
    timestamp,
    correlationId: "cmd-1",
    causationId: null,
  };
}

describe("situations.start", () => {
  it("creates ForestFireStarted + SituationStarted when world_reaction_fear reaches threshold", () => {
    const event = evt("ObservationUpdated", "obs-1", { key: "world_reaction_fear", delta: 2 }, 5);
    const w = world({ observations: { world_reaction_fear: 0 } });

    const out = start.handle(event, w);

    expect(out).toHaveLength(2);

    expect(out[0]!.type).toBe("ForestFireStarted");
    expect(out[0]!.payload).toEqual({ startedAt: 5 });
    expect(out[0]!.causationId).toBe("obs-1");
    expect(out[0]!.eventId).toBe("obs-1>ForestFireStarted#0");

    expect(out[1]!.type).toBe("SituationStarted");
    const p = out[1]!.payload as ActiveSituation;
    expect(p.situationId).toBe("forest_fire");
    expect(p.type).toBe("forest_fire");
    expect(p.startedAt).toBe(5);
    expect(p.duration).toBe(8);
    expect(out[1]!.causationId).toBe("obs-1");
    expect(out[1]!.eventId).toBe("obs-1>SituationStarted#1");
  });

  it("returns [] for non-world_reaction_fear keys", () => {
    const event = evt("ObservationUpdated", "obs-1", { key: "risk_taken", delta: 1 });
    const w = world({ observations: { world_reaction_fear: 1 } });
    expect(start.handle(event, w)).toEqual([]);
  });

  it("returns [] when newValue is below threshold", () => {
    const event = evt("ObservationUpdated", "obs-1", { key: "world_reaction_fear", delta: 1 });
    const w = world({ observations: { world_reaction_fear: 0 } });
    expect(start.handle(event, w)).toEqual([]);
  });

  it("returns [] when forest_fire already active (dedup)", () => {
    const active: ActiveSituation = {
      situationId: "forest_fire", type: "forest_fire", startedAt: 3, duration: 8, data: {},
    };
    const event = evt("ObservationUpdated", "obs-1", { key: "world_reaction_fear", delta: 2 }, 5);
    const w = world({ observations: { world_reaction_fear: 0 }, activeSituations: [active] });
    expect(start.handle(event, w)).toEqual([]);
  });

  it("does not mutate the world", () => {
    const event = evt("ObservationUpdated", "obs-1", { key: "world_reaction_fear", delta: 2 }, 5);
    const w = world({ observations: { world_reaction_fear: 0 } });
    start.handle(event, w);
    expect(w.activeSituations.size).toBe(0);
    expect(w.observations.get("world_reaction_fear")).toBe(0);
  });
});

describe("forest_fire.spread", () => {
  const active: ActiveSituation = {
    situationId: "forest_fire", type: "forest_fire", startedAt: 5, duration: 8, data: {},
  };

  it("emits TreeBurned when burnedTrees < expected at elapsed=3 (expected=2, burnedTrees=1)", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 8);
    const w = world({ activeSituations: [active], burnedTrees: 1 });

    const out = forestFireSpread.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("TreeBurned");
    expect(out[0]!.payload).toEqual({ burnedAt: 8, treeIndex: 1 });
    expect(out[0]!.causationId).toBe("tick-1");
    expect(out[0]!.eventId).toBe("tick-1>TreeBurned#0");
  });

  it("returns [] when situation is not active", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 8);
    const w = world({ burnedTrees: 0 });
    expect(forestFireSpread.handle(event, w)).toEqual([]);
  });

  it("returns [] when expected is already reached", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 8);
    // elapsed=3, expected=2, burnedTrees=2 => no burn
    const w = world({ activeSituations: [active], burnedTrees: 2 });
    expect(forestFireSpread.handle(event, w)).toEqual([]);
  });

  it("emits TreeBurned immediately at startedAt (elapsed=0, expected=1, burnedTrees=0)", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 5);
    const w = world({ activeSituations: [active], burnedTrees: 0 });

    const out = forestFireSpread.handle(event, w);
    expect(out).toHaveLength(1);
    expect(out[0]!.payload).toEqual({ burnedAt: 5, treeIndex: 0 });
  });

  it("does not mutate the world", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 8);
    const w = world({ activeSituations: [active], burnedTrees: 1 });
    forestFireSpread.handle(event, w);
    expect(w.burnedTrees).toBe(1);
    expect(w.activeSituations.size).toBe(1);
  });
});

describe("situations.end", () => {
  const ending: ActiveSituation = {
    situationId: "forest_fire", type: "forest_fire", startedAt: 0, duration: 8, data: {},
  };
  const future: ActiveSituation = {
    situationId: "other", type: "other", startedAt: 5, duration: 10, data: {},
  };

  it("emits SituationEnded for situations with startedAt+duration <= now", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 10);
    const w = world({ activeSituations: [ending, future] });

    const out = end.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("SituationEnded");
    expect(out[0]!.payload).toEqual({ situationId: "forest_fire" });
    expect(out[0]!.causationId).toBe("tick-1");
    expect(out[0]!.eventId).toBe("tick-1>SituationEnded#0");
  });

  it("emits multiple SituationEnded when both end at the same tick", () => {
    const a: ActiveSituation = {
      situationId: "a", type: "a", startedAt: 0, duration: 10, data: {},
    };
    const b: ActiveSituation = {
      situationId: "b", type: "b", startedAt: 0, duration: 10, data: {},
    };
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 10);
    const w = world({ activeSituations: [a, b] });

    const out = end.handle(event, w);
    expect(out).toHaveLength(2);
    expect(out[0]!.payload).toEqual({ situationId: "a" });
    expect(out[1]!.payload).toEqual({ situationId: "b" });
  });

  it("returns [] when no situation has ended", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 10);
    const w = world({ activeSituations: [future] });
    expect(end.handle(event, w)).toEqual([]);
  });

  it("does not mutate the world", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 10);
    const w = world({ activeSituations: [ending] });
    end.handle(event, w);
    expect(w.activeSituations.size).toBe(1);
  });
});
