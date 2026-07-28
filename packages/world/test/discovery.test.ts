import { describe, it, expect, vi, afterEach } from "vitest";
import { buildDiscoveryJournal, deepFreeze } from "../src/discovery/builder.js";
import type { DomainEvent } from "@skald/event-bus";

function ev(type: string, timestamp: number, payload: Record<string, unknown> = {}, eventId?: string): DomainEvent {
  return {
    eventId: eventId ?? `ev-${type}-${timestamp}-${Math.random()}`,
    type,
    schemaVersion: 1,
    payload,
    timestamp,
    correlationId: "test-correlation",
    causationId: null,
  };
}

describe("Discovery Builder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("1. empty Event Log → empty journal", () => {
    const journal = buildDiscoveryJournal([]);
    expect(journal.cards).toEqual([]);
    expect(journal.recentEvidence).toEqual([]);
    expect(journal.worldTime).toBe(0);
  });

  it("2. one risk_taken → trace stage", () => {
    const events = [ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1 })];
    const journal = buildDiscoveryJournal(events);
    expect(journal.cards.length).toBe(1);
    expect(journal.cards[0]!.stage).toBe("trace");
    expect(journal.cards[0]!.evidence.length).toBe(1);
    expect(journal.cards[0]!.evidence[0]!.kind).toBe("trace");
  });

  it("3. multiple risk_taken ⇒ hypothesis", () => {
    const events = [
      ev("ObservationUpdated", 2, { key: "risk_taken", newValue: 1 }),
      ev("ObservationUpdated", 5, { key: "risk_taken", newValue: 2 }),
    ];
    const journal = buildDiscoveryJournal(events);
    expect(journal.cards[0]!.stage).toBe("hypothesis");
  });

  it("4. AudacityTriggered without ConsequenceFired does NOT become discovered", () => {
    const events = [
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1 }),
      ev("ObservationUpdated", 2, { key: "risk_taken", newValue: 2 }),
      ev("AudacityTriggered", 3, {}),
    ];
    const journal = buildDiscoveryJournal(events);
    expect(journal.cards[0]!.stage).toBe("hypothesis");
  });

  it("5. ConsequenceFired(audacity) after prereqs → discovered", () => {
    const events = [
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1 }),
      ev("AudacityTriggered", 2, {}),
      ev("ConsequenceFired", 5, { consequenceType: "audacity" }),
    ];
    const journal = buildDiscoveryJournal(events);
    expect(journal.cards[0]!.stage).toBe("discovered");
  });

  it("6. unrelated Consequences are ignored", () => {
    const events = [
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1 }),
      ev("ConsequenceFired", 3, { consequenceType: "not_audacity" }),
    ];
    const journal = buildDiscoveryJournal(events);
    // Only one evidence (the risk_taken), the unrelated consequence is ignored
    expect(journal.cards[0]!.evidence.length).toBe(1);
    expect(journal.cards[0]!.evidence[0]!.kind).toBe("trace");
  });

  it("7. stage does not regress after append", () => {
    const discovered = [
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1 }),
      ev("AudacityTriggered", 2, {}),
      ev("ConsequenceFired", 3, { consequenceType: "audacity" }),
    ];
    const journal1 = buildDiscoveryJournal(discovered);
    expect(journal1.cards[0]!.stage).toBe("discovered");

    // Append more events
    const more = [
      ...discovered,
      ev("ObservationUpdated", 4, { key: "risk_taken", newValue: 4 }),
    ];
    const journal2 = buildDiscoveryJournal(more);
    expect(journal2.cards[0]!.stage).toBe("discovered");
  });

  it("8. same Event Log → identical DTO", () => {
    const events = [
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1 }),
      ev("AudacityTriggered", 2, {}),
      ev("ConsequenceFired", 3, { consequenceType: "audacity" }),
    ];
    const a = buildDiscoveryJournal(events);
    const b = buildDiscoveryJournal(events);
    expect(a).toEqual(b);
  });

  it("9. input Events are not mutated", () => {
    const events = [
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1 }),
    ];
    const frozenEvents = events.map((e) => ({ ...e, payload: { ...(e.payload as Record<string, unknown>) } }));
    buildDiscoveryJournal(events);
    expect(events).toEqual(frozenEvents);
  });

  it("10. result is runtime-immutable (frozen)", () => {
    const events = [
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1 }),
    ];
    const journal = buildDiscoveryJournal(events);
    expect(() => {
      (journal.cards as any).push({});
    }).toThrow();
    expect(() => {
      (journal.cards[0]!.evidence as any).push({});
    }).toThrow();
  });

  it("11. non-monotonic timestamps are rejected", () => {
    const events = [
      ev("ObservationUpdated", 5, { key: "risk_taken", newValue: 1 }),
      ev("ObservationUpdated", 3, { key: "risk_taken", newValue: 2 }),
    ];
    expect(() => buildDiscoveryJournal(events)).toThrow(/Non-monotonic/);
  });

  it("12. sourceEventIds are preserved", () => {
    const events = [
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1 }, "ev-risk-1"),
    ];
    const journal = buildDiscoveryJournal(events);
    expect(journal.cards[0]!.evidence[0]!.sourceEventIds).toEqual(["ev-risk-1"]);
  });

  it("13. LLM is not invoked during build", () => {
    // Stub fetch to ensure no network calls
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("should not call"); }));
    const events = [
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1 }),
      ev("AudacityTriggered", 2, {}),
      ev("ConsequenceFired", 3, { consequenceType: "audacity" }),
    ];
    const journal = buildDiscoveryJournal(events);
    expect(journal.cards[0]!.stage).toBe("discovered");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("14. builder does not create Domain Events (checked via type system)", () => {
    // The buildDiscoveryJournal returns DiscoveryJournal, not DomainEvent[]
    // TypeScript enforces this at compile time.
    const events = [ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1 })];
    const result = buildDiscoveryJournal(events);
    // Result is a DiscoveryJournal, confirmed by TypeScript
    expect(result).toHaveProperty("cards");
    expect(result).toHaveProperty("recentEvidence");
    expect(result).toHaveProperty("worldTime");
    // No DomainEvent-like properties on the journal itself
    expect((result as any).eventId).toBeUndefined();
  });

  it("journalTurnId is constructed correctly", () => {
    const events = [ev("ObservationUpdated", 42, { key: "risk_taken", newValue: 1 })];
    const journal = buildDiscoveryJournal(events);
    expect(journal.cards[0]!.evidence[0]!.journalTurnId).toBe("turn:42");
  });

  it("evidenceCount matches evidence array length", () => {
    const events = [
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1 }),
      ev("ObservationUpdated", 2, { key: "risk_taken", newValue: 2 }),
      ev("AudacityTriggered", 3, {}),
    ];
    const journal = buildDiscoveryJournal(events);
    expect(journal.cards[0]!.evidenceCount).toBe(journal.cards[0]!.evidence.length);
    expect(journal.cards[0]!.evidenceCount).toBe(3);
  });
});

describe("deepFreeze", () => {
  it("makes objects immutable", () => {
    const obj = deepFreeze({ a: 1, b: { c: 2 } });
    expect(Object.isFrozen(obj)).toBe(true);
    expect(Object.isFrozen(obj.b)).toBe(true);
    expect(() => { (obj as any).a = 2; }).toThrow();
  });

  it("handles null and primitives", () => {
    expect(deepFreeze(null)).toBeNull();
    expect(deepFreeze(undefined)).toBeUndefined();
    expect(deepFreeze(42)).toBe(42);
    expect(deepFreeze("hello")).toBe("hello");
  });
});
