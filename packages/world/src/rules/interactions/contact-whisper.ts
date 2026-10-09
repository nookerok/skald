/**
 * Whisper — engaged-only quiet speech (ADR-0039 §3).
 *
 * Sole owner of `mode: communicate, operation: whisper`: quiet speech is heard
 * only by someone the player is `engaged` with. Without that engagement the
 * action is blocked honestly. No target resolution, no Domain Events beyond the
 * outcome. Pure and deterministic.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import { ruleEventId } from "../../ids.js";
import type { ReadonlyWorld } from "../../projection.js";

export const contactWhisper: Rule<ReadonlyWorld> = {
  id: "interactions.contact_whisper",
  phase: "physics",
  listens: ["ActionValidated"],
  produces: ["ActionResolved", "ActionBlocked"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const payload = (event.payload as { originalPayload: Record<string, unknown> }).originalPayload;
    if (payload["mode"] !== "communicate" || payload["operation"] !== "whisper") return [];
    const base = {
      schemaVersion: 1,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    };
    const engaged = world.sceneEngagement?.state === "engaged"
      && world.sceneEngagement.locationId === world.currentLocationId;
    if (engaged) {
      return [{
        ...base,
        eventId: ruleEventId(event.eventId, "ActionResolved", 0),
        type: "ActionResolved",
        payload: {
          actionEventId: event.eventId,
          result: "whisper",
          description: "Ты говоришь тихо — так, чтобы услышал только тот, кто стоит рядом.",
        },
      }];
    }
    return [{
      ...base,
      eventId: ruleEventId(event.eventId, "ActionBlocked", 0),
      type: "ActionBlocked",
      payload: { reason: "whisper_requires_engagement" },
    }];
  },
};
