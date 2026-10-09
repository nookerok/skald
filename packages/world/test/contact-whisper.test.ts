/**
 * Whisper rule unit tests (ADR-0039 §3).
 */

import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "@skald/world";
import { contactWhisper } from "../src/rules/interactions/contact-whisper.js";

function validated(operation: string): DomainEvent {
  return {
    eventId: "av-1", type: "ActionValidated", schemaVersion: 1,
    payload: { originalPayload: { mode: "communicate", operation } },
    timestamp: 5, correlationId: "cmd-1", causationId: null,
  };
}

function world(state: "near" | "engaged" | null): ReadonlyWorld {
  return {
    currentLocationId: "hall",
    sceneEngagement: state ? { targetRef: "npc", locationId: "hall", state, establishedAt: 1 } : null,
  } as unknown as ReadonlyWorld;
}

describe("contact whisper rule", () => {
  it("whispers only when engaged", () => {
    const out = contactWhisper.handle(validated("whisper"), world("engaged"));
    expect(out[0]).toMatchObject({ type: "ActionResolved", payload: { result: "whisper" } });
  });

  it("blocks a whisper without engagement", () => {
    expect(contactWhisper.handle(validated("whisper"), world("near"))[0]).toMatchObject({ type: "ActionBlocked", payload: { reason: "whisper_requires_engagement" } });
    expect(contactWhisper.handle(validated("whisper"), world(null))[0]).toMatchObject({ type: "ActionBlocked", payload: { reason: "whisper_requires_engagement" } });
  });

  it("ignores other operations", () => {
    expect(contactWhisper.handle(validated("speak"), world("engaged"))).toEqual([]);
  });
});
