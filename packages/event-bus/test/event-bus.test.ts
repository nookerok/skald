import { describe, it, expect, vi } from "vitest";
import { EventBus, type DomainEvent } from "@skald/event-bus";

function makeEvent(type: string, eventId: string, payload: unknown = {}): DomainEvent {
  return {
    eventId,
    type,
    schemaVersion: 1,
    payload,
    timestamp: 0,
    correlationId: "cmd-1",
    causationId: null,
  };
}

describe("EventBus.append / query", () => {
  it("appends events and queries them back", () => {
    const bus = new EventBus();
    const a = makeEvent("MoveRequested", "e-1");
    const b = makeEvent("MovementSucceeded", "e-2", { x: 0, y: 1 });
    bus.append(a);
    bus.append(b);

    expect(bus.size()).toBe(2);
    const all = bus.query();
    expect(all).toHaveLength(2);
    expect(all[0]!.eventId).toBe("e-1");
    expect(all[1]!.eventId).toBe("e-2");
  });

  it("query returns a copy so the log is not externally mutated", () => {
    const bus = new EventBus();
    bus.append(makeEvent("MoveRequested", "e-1"));
    const snapshot = bus.query();
    snapshot.push(makeEvent("MovementSucceeded", "e-2"));
    expect(bus.size()).toBe(1);
    expect(bus.query()).toHaveLength(1);
  });

  it("query filters with a predicate", () => {
    const bus = new EventBus();
    bus.append(makeEvent("MoveRequested", "e-1", { dir: "north" }));
    bus.append(makeEvent("MovementSucceeded", "e-2", { x: 0, y: 1 }));
    bus.append(makeEvent("MoveRequested", "e-3", { dir: "south" }));

    const moves = bus.query((e) => e.type === "MoveRequested");
    expect(moves).toHaveLength(2);
    expect(moves.map((e) => e.eventId)).toEqual(["e-1", "e-3"]);
  });

  it("is append-only: no API to mutate or remove existing entries", () => {
    const bus = new EventBus();
    bus.append(makeEvent("MoveRequested", "e-1"));
    bus.append(makeEvent("MovementSucceeded", "e-2"));
    expect(typeof bus.append).toBe("function");
    expect(typeof bus.publish).toBe("function");
    expect(typeof bus.subscribe).toBe("function");
    expect(typeof bus.query).toBe("function");
    const keys = Object.getOwnPropertyNames(EventBus.prototype).filter(
      (k) => k !== "constructor",
    );
    expect(keys.sort()).toEqual(["append", "publish", "query", "setSubscriberErrorHandler", "size", "subscribe"]);
  });
});

describe("EventBus.publish / subscribe", () => {
  it("notifies subscribers of the matching event type", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe("MovementSucceeded", handler);

    const evt = makeEvent("MovementSucceeded", "e-1", { x: 0, y: 1 });
    bus.publish(evt);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(evt);
  });

  it("does not notify subscribers of other event types", () => {
    const bus = new EventBus();
    const moves = vi.fn();
    const blocked = vi.fn();
    bus.subscribe("MovementSucceeded", moves);
    bus.subscribe("MovementBlocked", blocked);

    bus.publish(makeEvent("MovementBlocked", "e-1", { reason: "wall" }));
    expect(moves).not.toHaveBeenCalled();
    expect(blocked).toHaveBeenCalledTimes(1);
  });

  it("publish does not append to the canonical log", () => {
    const bus = new EventBus();
    bus.subscribe("MovementSucceeded", () => {});
    bus.publish(makeEvent("MovementSucceeded", "e-1"));
    expect(bus.size()).toBe(0);
    expect(bus.query()).toHaveLength(0);
  });

  it("append does not notify subscribers (decoupled from publish)", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe("MovementSucceeded", handler);
    bus.append(makeEvent("MovementSucceeded", "e-1"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("unsubscribe stops further notifications", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe("MovementSucceeded", handler);

    bus.publish(makeEvent("MovementSucceeded", "e-1"));
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    bus.publish(makeEvent("MovementSucceeded", "e-2"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("supports multiple subscribers for the same type", () => {
    const bus = new EventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe("MovementSucceeded", h1);
    bus.subscribe("MovementSucceeded", h2);

    bus.publish(makeEvent("MovementSucceeded", "e-1"));
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });
});