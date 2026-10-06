/**
 * Command outcome diagnostics unit tests (ADR-0039, T6).
 */

import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import { rebuildProjection } from "../src/projection.js";
import {
  buildCommandDiagnostics,
  movementOutcome,
  movementTargetKind,
  type ReadonlyWorld,
} from "../src/index.js";
import type { CommandTimePlan } from "../src/command-time-policy.js";

function evt(type: string, payload: unknown = {}): DomainEvent {
  return { eventId: `e-${type}-${Math.random()}`, type, schemaVersion: 1, payload, timestamp: 1, correlationId: "cmd-1", causationId: null } as DomainEvent;
}

function evtAt(type: string, eventId: string, payload: unknown): any {
  return { eventId, type, schemaVersion: 1, payload, timestamp: 0, correlationId: "boot", causationId: null };
}

function hallWorld(): ReadonlyWorld {
  return rebuildProjection([
    evtAt("PlayerSpawned", "p", { x: 0, y: 0 }),
    evtAt("LocationDefined", "l", { id: "hall", name: "Зал", description: "h", objectIds: ["npc"], connections: { "дверь": "yard" } }),
    evtAt("PlayerLocationChanged", "pc", { locationId: "hall" }),
    evtAt("ObjectPlaced", "npc", {
      entityId: "npc", x: 1, y: 1, name: "Перевозчик", aliases: [], description: "n",
      components: { contact: { locationId: "hall", profile: { visibleAppearance: [], distinguishingFeatures: [], publicRole: "n", knownAs: ["Перевозчик"], addressForms: ["Перевозчик"] } } },
    }),
  ]).getSnapshot();
}

const plan: CommandTimePlan = { kind: "turn", cost: 1, eventTimestamp: 1, emitTickPassed: true, reason: "ordinary_attempt" };

describe("movementOutcome", () => {
  it("classifies each owner outcome", () => {
    expect(movementOutcome([evt("PlayerLocationChanged", { locationId: "x" })])).toBe("moved");
    expect(movementOutcome([evt("MovementSucceeded", { x: 1, y: 1 })])).toBe("moved");
    expect(movementOutcome([evt("MovementBlocked", { reason: "wall" })])).toBe("blocked");
    expect(movementOutcome([evt("JourneyStarted", { journeyId: "j" })])).toBe("journey_started");
    expect(movementOutcome([evt("ActionResolved", { result: "approach" })])).toBe("approached");
    expect(movementOutcome([evt("ActionRejected", { reason: "traveling" })])).toBe("none");
    expect(movementOutcome([])).toBe("none");
  });
});

describe("movementTargetKind", () => {
  it("classifies movement intents and ignores non-movement ones", () => {
    const world = hallWorld();
    expect(movementTargetKind({ type: "JourneyIntent", destination: { raw: "Речной Страж" } }, world)).toBe("remote_location");
    expect(movementTargetKind({ type: "ActionIntentCommand", operation: "approach", target: { raw: "перевозчику" } }, world)).toBe("present_contact");
    expect(movementTargetKind({ type: "ActionIntentCommand", operation: "enter", target: { raw: "дверь" } }, world)).toBe("connected_location");
    expect(movementTargetKind({ type: "ActionIntentCommand", operation: "speak", target: { raw: "перевозчику" } }, world)).toBe("none");
  });
});

describe("buildCommandDiagnostics", () => {
  it("builds a frozen, sanitized descriptor", () => {
    const diag = buildCommandDiagnostics({
      plan,
      worldTimeBefore: 0,
      worldTimeAfter: 1,
      tickPassedCount: 1,
      targetKind: "present_contact",
      events: [evt("ActionResolved", { result: "approach" })],
    });
    expect(diag).toEqual({
      temporal: { worldTimeBefore: 0, worldTimeAfter: 1, cost: 1, tickPassedCount: 1, policy: "ordinary_attempt" },
      movement: { targetKind: "present_contact", outcome: "approached" },
    });
    expect(Object.isFrozen(diag)).toBe(true);
    expect(Object.isFrozen(diag.temporal)).toBe(true);
  });
});
