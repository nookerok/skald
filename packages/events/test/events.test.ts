import { describe, expect, it, vi } from "vitest";
import { EventBus } from "@skald/event-bus";
import { BELIEF_EVENT_TYPES, publishBeliefEvent, subscribeBeliefEvent, subscribeToBeliefEvents } from "@skald/events";

describe("Belief Event API", () => {
  it("subscribes to the complete notification set", () => {
    const bus = new EventBus(); const handler = vi.fn(); const unsubscribe = subscribeToBeliefEvents(bus, handler);
    publishBeliefEvent(bus, { eventId: "belief-2", type: "PatternDiscovered", schemaVersion: 1, timestamp: 2, correlationId: "belief-2", causationId: null, payload: { observerId: "player", subjectId: "ridge" } });
    expect(handler).toHaveBeenCalledTimes(1); unsubscribe();
  });

  it("uses EventBus fan-out without appending to the canonical log", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    subscribeBeliefEvent(bus, BELIEF_EVENT_TYPES.beliefChanged, handler);
    publishBeliefEvent(bus, { eventId: "belief-1", type: "BeliefChanged", schemaVersion: 1, timestamp: 2, correlationId: "belief-1", causationId: null, payload: { observerId: "player", subjectId: "ridge" } });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(bus.size()).toBe(0);
  });
});
