import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import {
  WorldProjector,
  rebuildProjection,
  bootstrapWorldEvents,
  START_POSITION,
} from "@skald/world";

function e(
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

describe("WorldProjector", () => {
  it("starts at the documented start position with no walls and eventNumber 0", () => {
    const p = new WorldProjector();
    const w = p.getSnapshot();
    expect(w.player).toEqual(START_POSITION);
    expect(w.walls.size).toBe(0);
    expect(w.eventNumber).toBe(0);
    expect(w.time).toBe(0);
  });

  it("applying MovementSucceeded updates the player position", () => {
    const p = new WorldProjector();
    p.apply(e("PlayerSpawned", "boot", { x: 0, y: 0 }, 0));
    p.apply(e("MovementSucceeded", "m1", { x: 0, y: 1 }, 1));

    expect(p.getSnapshot().player).toEqual({ x: 0, y: 1 });
    expect(p.getSnapshot().eventNumber).toBe(2);
    expect(p.getSnapshot().time).toBe(1);
  });

  it("applying MovementBlocked leaves the position unchanged but still increments eventNumber/time", () => {
    const p = new WorldProjector();
    p.apply(e("PlayerSpawned", "boot", { x: 0, y: 0 }, 0));
    p.apply(e("MovementBlocked", "b1", { reason: "wall" }, 2));

    expect(p.getSnapshot().player).toEqual({ x: 0, y: 0 });
    expect(p.getSnapshot().eventNumber).toBe(2);
    expect(p.getSnapshot().time).toBe(2);
  });

  it("applying any other event leaves the position/walls unchanged but counts the event", () => {
    const p = new WorldProjector();
    p.apply(e("PlayerSpawned", "boot", { x: 0, y: 0 }, 0));
    p.apply(e("MoveRequested", "req", { direction: "north" }, 3));

    expect(p.getSnapshot().player).toEqual({ x: 0, y: 0 });
    expect(p.getSnapshot().eventNumber).toBe(2);
    expect(p.getSnapshot().time).toBe(3);
  });

  it("PlayerSpawned and WallPlaced populate the projection from the log", () => {
    const events = bootstrapWorldEvents();
    const p = rebuildProjection(events);

    expect(p.getSnapshot().player).toEqual(START_POSITION);
    expect(p.getSnapshot().walls.size).toBe(2);
    expect([...p.getSnapshot().walls].sort()).toEqual(["2,0", "3,3"]);
  });
});

describe("WorldProjector — observations", () => {
  it("applying ObservationUpdated increments an observation counter", () => {
    const p = new WorldProjector();
    p.apply(e("ObservationUpdated", "o-1", { key: "risk_taken", delta: 1 }, 1));
    expect(p.getSnapshot().observations.get("risk_taken")).toBe(1);
  });

  it("applying multiple ObservationUpdated for the same key accumulates", () => {
    const p = new WorldProjector();
    p.apply(e("ObservationUpdated", "o-1", { key: "risk_taken", delta: 1 }, 1));
    p.apply(e("ObservationUpdated", "o-2", { key: "risk_taken", delta: 3 }, 2));
    expect(p.getSnapshot().observations.get("risk_taken")).toBe(4);
  });

  it("applying ObservationUpdated for a new key creates it", () => {
    const p = new WorldProjector();
    p.apply(e("ObservationUpdated", "o-1", { key: "wall_caution", delta: 5 }, 1));
    expect(p.getSnapshot().observations.get("wall_caution")).toBe(5);
  });

  it("still increments eventNumber and time for ObservationUpdated", () => {
    const p = new WorldProjector();
    p.apply(e("ObservationUpdated", "o-1", { key: "risk_taken", delta: 1 }, 7));
    expect(p.getSnapshot().eventNumber).toBe(1);
    expect(p.getSnapshot().time).toBe(7);
  });
});

describe("WorldProjector — Projection Purity (replay from scratch = current)", () => {
  it("deleting the projection and replaying the whole log reproduces it identically", () => {
    const events: DomainEvent[] = [
      ...bootstrapWorldEvents(),
      e("MovementSucceeded", "mv-1", { x: 0, y: 1 }, 1),
      e("MovementBlocked", "mv-2", { reason: "wall" }, 2),
      e("MovementSucceeded", "mv-3", { x: 1, y: 1 }, 3),
    ];

    const original = rebuildProjection(events);
    // "Delete" the projection, then rebuild from the log alone.
    const rebuilt = rebuildProjection(events);

    expect(rebuilt.getSnapshot()).toEqual(original.getSnapshot());
    expect(rebuilt.getSnapshot().player).toEqual({ x: 1, y: 1 });
    expect(rebuilt.getSnapshot().eventNumber).toBe(original.getSnapshot().eventNumber);
    expect(rebuilt.getSnapshot().time).toBe(original.getSnapshot().time);
  });

  it("purity holds with observations: bootstrap + movements + ObservationUpdated", () => {
    const events: DomainEvent[] = [
      ...bootstrapWorldEvents(),
      e("MovementSucceeded", "mv-1", { x: 0, y: 1 }, 1),
      e("ObservationUpdated", "o-1", { key: "risk_taken", delta: 1 }, 1),
      e("MovementBlocked", "mv-2", { reason: "wall" }, 2),
      e("ObservationUpdated", "o-2", { key: "edge_awareness", delta: 1 }, 2),
      e("ObservationUpdated", "o-3", { key: "wall_caution", delta: 1 }, 2),
    ];

    const original = rebuildProjection(events);
    const rebuilt = rebuildProjection(events);

    expect(rebuilt.getSnapshot()).toEqual(original.getSnapshot());
    expect(rebuilt.getSnapshot().observations.get("risk_taken")).toBe(1);
    expect(rebuilt.getSnapshot().observations.get("edge_awareness")).toBe(1);
    expect(rebuilt.getSnapshot().observations.get("wall_caution")).toBe(1);
  });
});

describe("WorldProjector — consequences", () => {
  it("ConsequenceCreated adds a consequence to the map", () => {
    const p = new WorldProjector();
    const payload = {
      id: "aud@1",
      type: "audacity",
      severity: 1,
      createdAt: 5,
      expiresAt: 10,
      data: {},
    };
    p.apply(e("ConsequenceCreated", "c-1", payload, 5));

    const c = p.getSnapshot().consequences.get("aud@1");
    expect(c).toBeDefined();
    expect(c!.type).toBe("audacity");
    expect(c!.expiresAt).toBe(10);
  });

  it("ConsequenceExpired removes a consequence from the map", () => {
    const p = new WorldProjector();
    p.apply(e("ConsequenceCreated", "c-1", {
      id: "aud@1", type: "audacity", severity: 1, createdAt: 5, expiresAt: 10, data: {},
    }, 5));
    p.apply(e("ConsequenceExpired", "c-2", { id: "aud@1" }, 10));

    expect(p.getSnapshot().consequences.has("aud@1")).toBe(false);
  });

  it("TickPassed updates time without mutating consequences", () => {
    const p = new WorldProjector();
    p.apply(e("TickPassed", "t-1", { delta: 1 }, 10));

    expect(p.getSnapshot().time).toBe(10);
    expect(p.getSnapshot().consequences.size).toBe(0);
  });
});

describe("WorldProjector — Projection Purity with consequences", () => {
  it("purity holds: bootstrap + moves + observations + ConsequenceCreated + TickPassed + ConsequenceExpired", () => {
    const events: DomainEvent[] = [
      ...bootstrapWorldEvents(),
      e("MovementSucceeded", "mv-1", { x: 0, y: 1 }, 1),
      e("ObservationUpdated", "o-1", { key: "risk_taken", delta: 1 }, 1),
      e("MovementSucceeded", "mv-2", { x: 1, y: 1 }, 2),
      e("ObservationUpdated", "o-2", { key: "risk_taken", delta: 1 }, 2),
      e("MovementSucceeded", "mv-3", { x: 1, y: 2 }, 3),
      e("ObservationUpdated", "o-3", { key: "risk_taken", delta: 1 }, 3),
      e("ConsequenceCreated", "cc-1", {
        id: "aud@cmd-3",
        type: "audacity",
        severity: 1,
        createdAt: 3,
        expiresAt: 8,
        data: { threshold: 3 },
      }, 3),
      e("TickPassed", "t-1", { delta: 1 }, 3),
      e("TickPassed", "t-2", { delta: 1 }, 4),
      e("TickPassed", "t-3", { delta: 1 }, 5),
      e("TickPassed", "t-4", { delta: 1 }, 6),
      e("TickPassed", "t-5", { delta: 1 }, 7),
      e("TickPassed", "t-6", { delta: 1 }, 8),
      e("ConsequenceExpired", "ce-1", { id: "aud@cmd-3" }, 8),
    ];

    const original = rebuildProjection(events);
    const rebuilt = rebuildProjection(events);

    expect(rebuilt.getSnapshot()).toEqual(original.getSnapshot());
    expect(rebuilt.getSnapshot().consequences.size).toBe(0);
    expect(rebuilt.getSnapshot().eventNumber).toBe(original.getSnapshot().eventNumber);
  });
});

describe("WorldProjector — clone", () => {
  it("clone copies observations independently", () => {
    const p = new WorldProjector();
    p.apply(e("ObservationUpdated", "o-1", { key: "risk_taken", delta: 3 }, 1));
    const clone = p.clone() as WorldProjector;
    clone.apply(e("ObservationUpdated", "o-2", { key: "risk_taken", delta: 1 }, 2));

    expect(p.getSnapshot().observations.get("risk_taken")).toBe(3);
    expect(clone.getSnapshot().observations.get("risk_taken")).toBe(4);
  });

  it("clone copies consequences independently", () => {
    const p = new WorldProjector();
    p.apply(e("ConsequenceCreated", "c-1", {
      id: "aud@1", type: "audacity", severity: 1, createdAt: 5, expiresAt: 10, data: {},
    }, 5));
    const clone = p.clone() as WorldProjector;
    clone.apply(e("ConsequenceExpired", "c-2", { id: "aud@1" }, 10));

    expect(p.getSnapshot().consequences.size).toBe(1);
    expect(clone.getSnapshot().consequences.size).toBe(0);
  });
});