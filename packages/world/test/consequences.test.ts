import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld, Consequence } from "@skald/world";
import { repercussion, expire } from "@skald/world";

function world(opts?: {
  observations?: Record<string, number>;
  consequences?: Consequence[];
}): ReadonlyWorld {
  const obs = new Map<string, number>();
  if (opts?.observations) {
    for (const [k, v] of Object.entries(opts.observations)) obs.set(k, v);
  }
  const cons = new Map<string, Consequence>();
  if (opts?.consequences) {
    for (const c of opts.consequences) cons.set(c.id, c);
  }
  return Object.freeze({
    player: Object.freeze({ x: 0, y: 0 }),
    walls: new Set<string>(),
    observations: obs,
    consequences: cons,
    eventNumber: 0,
    time: 0,
  }) as ReadonlyWorld;
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

describe("consequences.repercussion", () => {
  it("creates ConsequenceCreated when risk_taken reaches threshold", () => {
    const event = evt("ObservationUpdated", "obs-1", { key: "risk_taken", delta: 1 }, 5);
    const w = world({ observations: { risk_taken: 2 } });

    const out = repercussion.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("ConsequenceCreated");
    const p = out[0]!.payload as Consequence;
    expect(p.type).toBe("audacity");
    expect(p.severity).toBe(1);
    expect(p.createdAt).toBe(5);
    expect(p.expiresAt).toBe(10);
    expect(p.data).toEqual({ threshold: 3 });
    expect(out[0]!.causationId).toBe("obs-1");
    expect(out[0]!.eventId).toBe("obs-1>ConsequenceCreated#0");
  });

  it("returns [] for non-risk_taken keys", () => {
    const event = evt("ObservationUpdated", "obs-1", { key: "wall_caution", delta: 1 });
    const w = world({ observations: { risk_taken: 2 } });
    expect(repercussion.handle(event, w)).toEqual([]);
  });

  it("returns [] when newValue is below threshold", () => {
    const event = evt("ObservationUpdated", "obs-1", { key: "risk_taken", delta: 1 });
    const w = world({ observations: { risk_taken: 0 } });
    expect(repercussion.handle(event, w)).toEqual([]);
  });

  it("returns [] when audacity consequence already exists (dedup)", () => {
    const event = evt("ObservationUpdated", "obs-1", { key: "risk_taken", delta: 1 }, 5);
    const w = world({
      observations: { risk_taken: 2 },
      consequences: [
        {
          id: "audacity@cmd-1",
          type: "audacity",
          severity: 1,
          createdAt: 5,
          expiresAt: 10,
          data: {},
        },
      ],
    });
    expect(repercussion.handle(event, w)).toEqual([]);
  });

  it("does not mutate the world (snapshot-consistency)", () => {
    const event = evt("ObservationUpdated", "obs-1", { key: "risk_taken", delta: 1 }, 5);
    const w = world({ observations: { risk_taken: 2 } });

    const obsBefore = w.observations.get("risk_taken");
    repercussion.handle(event, w);
    expect(w.observations.get("risk_taken")).toBe(obsBefore);
    expect(w.consequences.size).toBe(0);
  });
});

describe("consequences.expire", () => {
  const active: Consequence = {
    id: "c-1",
    type: "audacity",
    severity: 1,
    createdAt: 3,
    expiresAt: 8,
    data: {},
  };
  const future: Consequence = {
    id: "c-2",
    type: "audacity",
    severity: 1,
    createdAt: 3,
    expiresAt: 15,
    data: {},
  };

  it("emits ConsequenceExpired for consequences with expiresAt <= now", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 10);
    const w = world({ consequences: [active, future] });

    const out = expire.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("ConsequenceExpired");
    expect(out[0]!.payload).toEqual({ id: "c-1" });
    expect(out[0]!.causationId).toBe("tick-1");
    expect(out[0]!.eventId).toBe("tick-1>ConsequenceExpired#0");
  });

  it("emits multiple ConsequenceExpired when multiple expire at the same tick", () => {
    const a: Consequence = { id: "c-1", type: "a", severity: 1, createdAt: 1, expiresAt: 10, data: {} };
    const b: Consequence = { id: "c-2", type: "b", severity: 1, createdAt: 1, expiresAt: 10, data: {} };
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 10);
    const w = world({ consequences: [a, b] });

    const out = expire.handle(event, w);

    expect(out).toHaveLength(2);
    expect(out[0]!.payload).toEqual({ id: "c-1" });
    expect(out[0]!.eventId).toBe("tick-1>ConsequenceExpired#0");
    expect(out[1]!.payload).toEqual({ id: "c-2" });
    expect(out[1]!.eventId).toBe("tick-1>ConsequenceExpired#1");
  });

  it("returns [] when no consequences have expired", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 10);
    const w = world({ consequences: [future] });
    expect(expire.handle(event, w)).toEqual([]);
  });

  it("does not mutate the world", () => {
    const event = evt("TickPassed", "tick-1", { delta: 1 }, 10);
    const w = world({ consequences: [active] });
    expire.handle(event, w);
    expect(w.consequences.size).toBe(1);
  });
});
