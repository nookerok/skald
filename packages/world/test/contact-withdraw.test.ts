/**
 * Withdraw rule unit tests (ADR-0039 §3).
 */

import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import { contactWithdraw } from "../src/rules/interactions/contact-withdraw.js";

function validated(operation: string): DomainEvent {
  return {
    eventId: "av-1",
    type: "ActionValidated",
    schemaVersion: 1,
    payload: { originalPayload: { mode: "relocate", operation } },
    timestamp: 5,
    correlationId: "cmd-1",
    causationId: null,
  };
}

function world(engagement: ReadonlyWorld["sceneEngagement"]): ReadonlyWorld {
  return { sceneEngagement: engagement } as unknown as ReadonlyWorld;
}

describe("contact withdraw rule", () => {
  it("clears an existing engagement with an honest answer", () => {
    const out = contactWithdraw.handle(validated("withdraw"), world({ targetRef: "npc", locationId: "hall", state: "near", establishedAt: 1 }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "ActionResolved", payload: { result: "withdraw", description: "Ты отходишь на шаг. Между вами снова расстояние." } });
  });

  it("answers honestly when there was no engagement", () => {
    const out = contactWithdraw.handle(validated("withdraw"), world(null));
    expect(out[0]).toMatchObject({ type: "ActionResolved", payload: { result: "withdraw", description: "Ты и так не стоишь рядом ни с кем." } });
  });

  it("ignores other operations", () => {
    expect(contactWithdraw.handle(validated("approach"), world(null))).toEqual([]);
  });
});
