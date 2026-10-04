/**
 * Command time policy unit tests (ADR-0039, T3).
 *
 * Every exported function is covered: the cost table of `planCommandTime`,
 * the correlation-id uniqueness of `commandCorrelationId`, and the two
 * journey pulse timestamps.
 */

import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import {
  commandCorrelationId,
  initialJourneyPulseTimestamp,
  nextJourneyPulseTimestamp,
  planCommandTime,
  type CommandTimeWorld,
} from "@skald/world";

const world = (overrides: Partial<CommandTimeWorld> = {}): CommandTimeWorld => ({
  time: 10,
  eventNumber: 42,
  activeJourneyId: null,
  ...overrides,
});

describe("planCommandTime", () => {
  it("charges an ordinary command one turn and emits the generic pulse", () => {
    const plan = planCommandTime({ type: "ActionIntentCommand", operation: "speak" }, world());
    expect(plan.kind).toBe("turn");
    expect(plan.cost).toBe(1);
    expect(plan.eventTimestamp).toBe(11);
    expect(plan.emitTickPassed).toBe(true);
    expect(plan.reason).toBe("ordinary_attempt");
  });

  it("starts a journey at cost one without a generic pulse", () => {
    const plan = planCommandTime({ type: "JourneyIntent" }, world());
    expect(plan.kind).toBe("journey_start");
    expect(plan.cost).toBe(1);
    expect(plan.eventTimestamp).toBe(11);
    expect(plan.emitTickPassed).toBe(false);
    expect(plan.reason).toBe("journey_start");
  });

  it("advances an active journey on wait, with one pulse", () => {
    const plan = planCommandTime({ type: "ActionIntentCommand", operation: "wait" }, world({ activeJourneyId: "j1" }));
    expect(plan.kind).toBe("journey_wait");
    expect(plan.cost).toBe(1);
    expect(plan.eventTimestamp).toBe(11);
    expect(plan.emitTickPassed).toBe(true);
    expect(plan.reason).toBe("journey_wait");
  });

  it("makes an interrupt free while traveling", () => {
    const plan = planCommandTime({ type: "ActionIntentCommand", operation: "interrupt" }, world({ activeJourneyId: "j1" }));
    expect(plan.kind).toBe("journey_interrupt");
    expect(plan.cost).toBe(0);
    expect(plan.eventTimestamp).toBe(10);
    expect(plan.emitTickPassed).toBe(false);
    expect(plan.reason).toBe("journey_interrupt");
  });

  it("rejects any other command while traveling at cost zero", () => {
    const plan = planCommandTime({ type: "InteractionCommand", operation: "observe" }, world({ activeJourneyId: "j1" }));
    expect(plan.kind).toBe("rejected_while_traveling");
    expect(plan.cost).toBe(0);
    expect(plan.eventTimestamp).toBe(10);
    expect(plan.emitTickPassed).toBe(false);
    expect(plan.reason).toBe("traveling_rejection");
  });

  it("makes an interrupt outside a journey instant and free", () => {
    const plan = planCommandTime({ type: "ActionIntentCommand", operation: "interrupt" }, world());
    expect(plan.kind).toBe("instant");
    expect(plan.cost).toBe(0);
    expect(plan.eventTimestamp).toBe(10);
    expect(plan.emitTickPassed).toBe(false);
  });

  it("keeps cost-0 events at the current world time, not world time + 1", () => {
    const plan = planCommandTime({ type: "ActionIntentCommand", operation: "interrupt" }, world({ time: 7 }));
    expect(plan.eventTimestamp).toBe(7);
  });
});

describe("commandCorrelationId", () => {
  it("uses the advancing timestamp for a cost-1 command", () => {
    const plan = planCommandTime({ type: "JourneyIntent" }, world({ time: 10 }));
    expect(commandCorrelationId(plan, world({ time: 10, eventNumber: 99 }))).toBe("cmd-11");
  });

  it("appends the deterministic event counter for a cost-0 command", () => {
    const plan = planCommandTime({ type: "ActionIntentCommand", operation: "interrupt" }, world({ time: 10, activeJourneyId: "j1" }));
    expect(commandCorrelationId(plan, world({ time: 10, eventNumber: 42 }))).toBe("cmd-10-42");
  });

  it("keeps consecutive cost-0 commands distinct at the same world time", () => {
    const plan = planCommandTime({ type: "ActionIntentCommand", operation: "interrupt" }, world({ time: 10, activeJourneyId: "j1" }));
    const first = commandCorrelationId(plan, world({ time: 10, eventNumber: 42 }));
    const second = commandCorrelationId(plan, world({ time: 10, eventNumber: 44 }));
    expect(first).not.toBe(second);
  });
});

describe("journey pulse timestamps", () => {
  const event = (timestamp: number) => ({ timestamp } as unknown as DomainEvent);
  const readWorld = (time: number) => ({ time } as unknown as ReadonlyWorld);

  it("puts the first pulse at the start command's own time", () => {
    expect(initialJourneyPulseTimestamp(event(11), readWorld(10))).toBe(11);
  });

  it("never moves the first pulse backwards if the projection already advanced", () => {
    expect(initialJourneyPulseTimestamp(event(11), readWorld(12))).toBe(12);
  });

  it("advances later pulses by one from the current world time", () => {
    expect(nextJourneyPulseTimestamp(readWorld(10))).toBe(11);
  });
});
