import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld, Consequence, FiredConsequence } from "@skald/world";
import { repercussion, expire, fire, worldReactionFear } from "@skald/world";

function world(opts?: {
  observations?: Record<string, number>;
  consequences?: Consequence[];
  firedConsequences?: FiredConsequence[];
}): ReadonlyWorld {
  const obs = new Map<string, number>();
  if (opts?.observations) {
    for (const [k, v] of Object.entries(opts.observations)) obs.set(k, v);
  }
  const cons = new Map<string, Consequence>();
  if (opts?.consequences) {
    for (const c of opts.consequences) cons.set(c.id, c);
  }
  const fired = new Map<string, FiredConsequence>();
  if (opts?.firedConsequences) {
    for (const f of opts.firedConsequences) fired.set(f.consequenceId, f);
  }
  return Object.freeze({
    player: Object.freeze({ x: 0, y: 0 }),
    walls: new Set<string>(),
    observations: obs,
    consequences: cons,
    firedConsequences: fired,
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

describe("consequences.fire", () => {
  const audConsequence: Consequence = {
    id: "aud@1", type: "audacity", severity: 2, createdAt: 5, expiresAt: 10, data: {},
  };
  const otherConsequence: Consequence = {
    id: "other@1", type: "other_type", severity: 1, createdAt: 5, expiresAt: 10, data: {},
  };

  it("fires ConsequenceFired + AudacityTriggered for audacity type", () => {
    const event = evt("ConsequenceExpired", "ce-1", { id: "aud@1" }, 10);
    const w = world({ consequences: [audConsequence] });

    const out = fire.handle(event, w);

    expect(out).toHaveLength(2);

    // First event: ConsequenceFired (index 0)
    expect(out[0]!.type).toBe("ConsequenceFired");
    expect(out[0]!.payload).toEqual({
      consequenceId: "aud@1",
      consequenceType: "audacity",
      firedAt: 10,
    });
    expect(out[0]!.causationId).toBe("ce-1");
    expect(out[0]!.eventId).toBe("ce-1>ConsequenceFired#0");

    // Second event: AudacityTriggered (index 1)
    expect(out[1]!.type).toBe("AudacityTriggered");
    expect(out[1]!.payload).toEqual({ target: "player", severity: 2 });
    expect(out[1]!.causationId).toBe("ce-1");
    expect(out[1]!.eventId).toBe("ce-1>AudacityTriggered#1");
  });

  it("returns [] for unknown consequence id", () => {
    const event = evt("ConsequenceExpired", "ce-1", { id: "unknown" }, 10);
    const w = world({ consequences: [audConsequence] });
    expect(fire.handle(event, w)).toEqual([]);
  });

  it("emits only ConsequenceFired (no AudacityTriggered) for non-audacity type", () => {
    const event = evt("ConsequenceExpired", "ce-1", { id: "other@1" }, 10);
    const w = world({ consequences: [otherConsequence] });

    const out = fire.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("ConsequenceFired");
    expect(out[0]!.payload).toEqual({
      consequenceId: "other@1",
      consequenceType: "other_type",
      firedAt: 10,
    });
  });

  it("does not mutate the world", () => {
    const event = evt("ConsequenceExpired", "ce-1", { id: "aud@1" }, 10);
    const w = world({ consequences: [audConsequence] });
    fire.handle(event, w);
    expect(w.consequences.size).toBe(1);
    expect(w.firedConsequences.size).toBe(0);
  });
});

describe("observations.world_reaction_fear", () => {
  it("produces ObservationUpdated with delta = severity", () => {
    const event = evt("AudacityTriggered", "at-1", { target: "player", severity: 2 }, 10);
    const w = world();

    const out = worldReactionFear.handle(event, w);

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("ObservationUpdated");
    expect(out[0]!.payload).toEqual({ key: "world_reaction_fear", delta: 2 });
    expect(out[0]!.causationId).toBe("at-1");
  });

  it("handles severity 5", () => {
    const event = evt("AudacityTriggered", "at-2", { target: "player", severity: 5 }, 10);
    const w = world();
    const out = worldReactionFear.handle(event, w);
    expect(out[0]!.payload).toEqual({ key: "world_reaction_fear", delta: 5 });
  });

  it("does not mutate the world", () => {
    const event = evt("AudacityTriggered", "at-1", { target: "player", severity: 2 }, 10);
    const w = world();
    worldReactionFear.handle(event, w);
    expect(w.observations.size).toBe(0);
  });
});
