import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import type { Consequence } from "@skald/world";
import {
  riskTaker,
  wallCaution,
  edgeAwareness,
  impatience,
} from "@skald/world";

function world(): ReadonlyWorld {
  return Object.freeze({
    player: Object.freeze({ x: 0, y: 0 }),
    walls: new Set<string>(),
    observations: new Map<string, number>(),
    consequences: new Map<string, Consequence>(),
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

describe("observations.risk_taker", () => {
  it("produces ObservationUpdated { key: 'risk_taken', delta: 1 } on MovementSucceeded", () => {
    const event = evt("MovementSucceeded", "ms-1", { x: 0, y: 1 });
    const out = riskTaker.handle(event, world());

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("ObservationUpdated");
    expect(out[0]!.payload).toEqual({ key: "risk_taken", delta: 1 });
    expect(out[0]!.causationId).toBe("ms-1");
    expect(out[0]!.eventId).toBe("ms-1>ObservationUpdated#0");
  });

  it("does not mutate the world", () => {
    const w = world();
    const event = evt("MovementSucceeded", "ms-1", { x: 0, y: 1 });
    riskTaker.handle(event, w);
    expect(w.observations.size).toBe(0);
  });
});

describe("observations.wall_caution", () => {
  it("produces ObservationUpdated { key: 'wall_caution', delta: 1 } on MovementBlocked with reason 'wall'", () => {
    const event = evt("MovementBlocked", "mb-1", { reason: "wall" });
    const out = wallCaution.handle(event, world());

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("ObservationUpdated");
    expect(out[0]!.payload).toEqual({ key: "wall_caution", delta: 1 });
    expect(out[0]!.causationId).toBe("mb-1");
  });

  it("returns [] on MovementBlocked with reason 'boundary'", () => {
    const event = evt("MovementBlocked", "mb-2", { reason: "boundary" });
    const out = wallCaution.handle(event, world());
    expect(out).toEqual([]);
  });

  it("does not mutate the world", () => {
    const w = world();
    const event = evt("MovementBlocked", "mb-1", { reason: "wall" });
    wallCaution.handle(event, w);
    expect(w.observations.size).toBe(0);
  });
});

describe("observations.edge_awareness", () => {
  it("produces ObservationUpdated { key: 'edge_awareness', delta: 1 } on MovementBlocked with reason 'boundary'", () => {
    const event = evt("MovementBlocked", "mb-1", { reason: "boundary" });
    const out = edgeAwareness.handle(event, world());

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("ObservationUpdated");
    expect(out[0]!.payload).toEqual({ key: "edge_awareness", delta: 1 });
    expect(out[0]!.causationId).toBe("mb-1");
  });

  it("returns [] on MovementBlocked with reason 'wall'", () => {
    const event = evt("MovementBlocked", "mb-2", { reason: "wall" });
    const out = edgeAwareness.handle(event, world());
    expect(out).toEqual([]);
  });

  it("does not mutate the world", () => {
    const w = world();
    const event = evt("MovementBlocked", "mb-1", { reason: "boundary" });
    edgeAwareness.handle(event, w);
    expect(w.observations.size).toBe(0);
  });
});

describe("observations.impatience", () => {
  it("produces ObservationUpdated { key: 'impatience', delta: 1 } on CommandRejected", () => {
    const event = evt("CommandRejected", "cr-1", { reason: "unknown command type: FooCommand" });
    const out = impatience.handle(event, world());

    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("ObservationUpdated");
    expect(out[0]!.payload).toEqual({ key: "impatience", delta: 1 });
    expect(out[0]!.causationId).toBe("cr-1");
  });

  it("does not mutate the world", () => {
    const w = world();
    const event = evt("CommandRejected", "cr-1", { reason: "unknown" });
    impatience.handle(event, w);
    expect(w.observations.size).toBe(0);
  });
});
