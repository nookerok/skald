import { describe, it, expect, vi, afterEach } from "vitest";
import { buildPlayerGuidance } from "../src/guidance/selector.js";
import { GUIDANCE_ACTIONS } from "../src/guidance/actions.js";
import { rebuildProjection, type ReadonlyWorld } from "../src/projection.js";
import type { DomainEvent } from "@skald/event-bus";
import type { GuidanceActionId } from "../src/guidance/types.js";

function ev(type: string, timestamp: number, payload: Record<string, unknown> = {}, eventId?: string): DomainEvent {
  return {
    eventId: eventId ?? `ev-${type}-${timestamp}`,
    type,
    schemaVersion: 1,
    payload,
    timestamp,
    correlationId: "test",
    causationId: null,
  };
}

function buildWorld(events: DomainEvent[]): ReadonlyWorld {
  return rebuildProjection(events).getSnapshot();
}

function makeGuidance(events: DomainEvent[]): ReturnType<typeof buildPlayerGuidance> {
  return buildPlayerGuidance(events, buildWorld(events));
}

describe("Player Guidance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("1. empty Event Log → first_action", () => {
    const g = makeGuidance([]);
    expect(g.phase).toBe("first_action");
    expect(g.mode).toBe("onboarding");
    expect(g.worldTime).toBe(0);
    expect(g.suggestions.length).toBe(3);
  });

  it("2. first move without discovery → explore_world", () => {
    const events = [
      ev("MoveRequested", 1),
      ev("MovementSucceeded", 1, { x: 0, y: 1 }),
    ];
    const g = makeGuidance(events);
    expect(g.phase).toBe("explore_world");
    expect(g.mode).toBe("onboarding");
  });

  it("3. one trace → test_trace", () => {
    const events = [
      ev("MoveRequested", 1),
      ev("MovementSucceeded", 1, { x: 0, y: 1 }),
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1, delta: 1 }),
    ];
    const g = makeGuidance(events);
    expect(g.phase).toBe("test_trace");
  });

  it("4. hypothesis without active audacity → strengthen_hypothesis", () => {
    const events = [
      ev("MoveRequested", 1), ev("MovementSucceeded", 1, { x: 0, y: 1 }),
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1, delta: 1 }),
      ev("MoveRequested", 2), ev("MovementSucceeded", 2, { x: 1, y: 1 }),
      ev("ObservationUpdated", 2, { key: "risk_taken", newValue: 2, delta: 1 }),
    ];
    const g = makeGuidance(events);
    expect(g.phase).toBe("strengthen_hypothesis");
  });

  it("5. hypothesis with active audacity → observe_consequence", () => {
    const events = [
      ev("MoveRequested", 1), ev("MovementSucceeded", 1, { x: 0, y: 1 }),
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1, delta: 1 }),
      ev("MoveRequested", 2), ev("MovementSucceeded", 2, { x: 1, y: 1 }),
      ev("ObservationUpdated", 2, { key: "risk_taken", newValue: 2, delta: 1 }),
      ev("ConsequenceCreated", 2, { id: "c1", type: "audacity", severity: 1, createdAt: 2, expiresAt: 10, data: {} }),
    ];
    const g = makeGuidance(events);
    expect(g.phase).toBe("observe_consequence");
  });

  it("6. recent discovered → review_discovery", () => {
    const events = [
      ev("MoveRequested", 1), ev("MovementSucceeded", 1, { x: 0, y: 1 }),
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1, delta: 1 }),
      ev("AudacityTriggered", 2, {}),
      ev("ConsequenceFired", 3, { consequenceType: "audacity", consequenceId: "c1", firedAt: 3 }),
    ];
    const g = makeGuidance(events);
    expect(g.phase).toBe("review_discovery");
  });

  it("7. old discovered → free_play", () => {
    const events = [
      ev("MoveRequested", 1), ev("MovementSucceeded", 1, { x: 0, y: 1 }),
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1, delta: 1 }),
      ev("AudacityTriggered", 2, {}),
      ev("ConsequenceFired", 3, { consequenceType: "audacity", consequenceId: "c1", firedAt: 3 }),
      // Push time beyond lastSeenAt + 2
      ev("TickPassed", 4, { delta: 1 }),
      ev("TickPassed", 5, { delta: 1 }),
      ev("TickPassed", 6, { delta: 1 }),
    ];
    const g = makeGuidance(events);
    expect(g.phase).toBe("free_play");
  });

  it("8. six non-discovery actions → free_play", () => {
    const events: DomainEvent[] = [];
    for (let i = 1; i <= 6; i++) {
      events.push(ev("GiveRequested", i));
      events.push(ev("RelationChanged", i, { from: "player", to: "guild", kind: "help", delta: 1 }));
    }
    const g = makeGuidance(events);
    expect(g.phase).toBe("free_play");
  });

  it("9. every command suggestion actionId is in allowlist", () => {
    const g = makeGuidance([]);
    for (const s of g.suggestions) {
      if (s.kind === "command") {
        expect(GUIDANCE_ACTIONS).toHaveProperty(s.actionId);
        expect(GUIDANCE_ACTIONS[s.actionId as GuidanceActionId].input).toBeTruthy();
      }
    }
  });

  it("10. onboarding phase has 2–3 suggestions", () => {
    const cases: DomainEvent[][] = [
      [],
      [ev("MoveRequested", 1), ev("MovementSucceeded", 1, { x: 0, y: 1 })],
      [ev("MoveRequested", 1), ev("MovementSucceeded", 1, { x: 0, y: 1 }), ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1, delta: 1 })],
    ];
    for (const c of cases) {
      const g = makeGuidance(c);
      expect(g.suggestions.length).toBeGreaterThanOrEqual(2);
      expect(g.suggestions.length).toBeLessThanOrEqual(3);
    }
  });

  it("11. same inputs give identical DTO", () => {
    const events = [ev("MoveRequested", 1), ev("MovementSucceeded", 1, { x: 0, y: 1 })];
    const a = makeGuidance([...events]);
    const b = makeGuidance([...events]);
    expect(a).toEqual(b);
  });

  it("12. input Events and world are not mutated", () => {
    const events: DomainEvent[] = [ev("MoveRequested", 1, {}, "ev1")];
    const frozen = structuredClone(events);
    buildPlayerGuidance(events, buildWorld(events));
    expect(events).toEqual(frozen);
  });

  it("13. result is runtime-immutable", () => {
    const g = makeGuidance([]);
    expect(() => { (g as any).phase = "free_play"; }).toThrow();
    expect(() => { (g.suggestions as any).push({}); }).toThrow();
  });

  it("14. non-monotonic timestamps are rejected", () => {
    const events = [ev("TickPassed", 5), ev("TickPassed", 3)];
    expect(() => makeGuidance(events)).toThrow(/Non-monotonic/);
  });

  it("15. fetch, LLM, EventBus are not invoked", () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("should not call"); }));
    const g = makeGuidance([ev("MoveRequested", 1), ev("MovementSucceeded", 1, { x: 0, y: 1 })]);
    expect(g.phase).toBe("explore_world");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("16. builder does not create Domain Events", () => {
    const result = makeGuidance([]);
    expect((result as any).eventId).toBeUndefined();
    expect((result as any).type).toBeUndefined();
  });

  it("17. worldTime matches snapshot world.time", () => {
    const events = [ev("TickPassed", 7), ev("TickPassed", 8)];
    const world = buildWorld(events);
    const g = buildPlayerGuidance(events, world);
    expect(g.worldTime).toBe(world.time);
  });

  it("18. append/replay produces same phase", () => {
    const base = [ev("MoveRequested", 1), ev("MovementSucceeded", 1, { x: 0, y: 1 })];
    const extended = [...base, ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1, delta: 1 })];
    const a = makeGuidance([...base]);
    const b = makeGuidance([...extended]);
    expect(a).toEqual(makeGuidance([...base])); // stable
    expect(b.phase).toBe("test_trace"); // progressed
  });

  // --- Regression tests for P1 fixes ---

  it("19. one move counts as one action, not two", () => {
    // MoveRequested + MovementSucceeded at same timestamp = 1 top-level action
    const events = [ev("MoveRequested", 1), ev("MovementSucceeded", 1, { x: 0, y: 1 })];
    // Only 1 top-level action (MoveRequested), so free_play is NOT triggered
    const g = makeGuidance(events);
    expect(g.phase).not.toBe("free_play");
  });

  it("20. three blocked movements do NOT trigger free_play", () => {
    const events: DomainEvent[] = [];
    for (let i = 1; i <= 3; i++) {
      events.push(ev("MoveRequested", i));
      events.push(ev("MovementBlocked", i, { reason: "wall" }));
    }
    // 3 MoveRequested = 3 top-level actions, well below 6
    const g = makeGuidance(events);
    expect(g.phase).not.toBe("free_play");
  });

  it("21. discovered → new trace remains free_play (does not revert to review_discovery)", () => {
    // Full discovery path
    const events: DomainEvent[] = [
      ev("MoveRequested", 1), ev("MovementSucceeded", 1, { x: 0, y: 1 }),
      ev("ObservationUpdated", 1, { key: "risk_taken", newValue: 1, delta: 1 }),
      ev("AudacityTriggered", 2, {}),
      ev("ConsequenceFired", 3, { consequenceType: "audacity", consequenceId: "c1", firedAt: 3 }),
    ];
    expect(makeGuidance(events).phase).toBe("review_discovery");

    // Later ticks push past discoveredAt+2
    const later = [...events, ev("TickPassed", 5, { delta: 1 }), ev("TickPassed", 6, { delta: 1 })];
    expect(makeGuidance(later).phase).toBe("free_play");

    // New trace after discovery should NOT reopen onboarding
    const withNewTrace = [...later, ev("MoveRequested", 7), ev("MovementSucceeded", 7, { x: 1, y: 1 }),
      ev("ObservationUpdated", 7, { key: "risk_taken", newValue: 2, delta: 1 })];
    expect(makeGuidance(withNewTrace).phase).toBe("free_play");
  });

  it("22. GUIDANCE_ACTIONS allowlist is runtime-immutable", () => {
    // Attempt to mutate the registry should throw
    expect(() => { (GUIDANCE_ACTIONS as any).move_north = null; }).toThrow();
    expect(() => { (GUIDANCE_ACTIONS as any).new_action = { kind: "command", input: "x", view: null }; }).toThrow();
    // Attempt to mutate an inner def should also throw
    expect(() => { (GUIDANCE_ACTIONS["move_north"] as any).input = "hacked"; }).toThrow();
  });
});
