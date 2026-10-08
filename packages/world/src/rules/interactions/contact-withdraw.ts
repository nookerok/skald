/**
 * Withdraw from the current scene engagement (ADR-0039 §3).
 *
 * Sole owner of `mode: relocate, operation: withdraw`: it clears the per-scene
 * engagement and answers honestly whether there was anyone to step back from.
 * No location change, no coordinates. Pure and deterministic.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import { ruleEventId } from "../../ids.js";
import type { ReadonlyWorld } from "../../projection.js";

export const contactWithdraw: Rule<ReadonlyWorld> = {
  id: "interactions.contact_withdraw",
  phase: "physics",
  listens: ["ActionValidated"],
  produces: ["ActionResolved"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const payload = (event.payload as { originalPayload: Record<string, unknown> }).originalPayload;
    if (payload["mode"] !== "relocate" || payload["operation"] !== "withdraw") return [];
    const engaged = world.sceneEngagement != null;
    return [{
      schemaVersion: 1,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
      eventId: ruleEventId(event.eventId, "ActionResolved", 0),
      type: "ActionResolved",
      payload: {
        actionEventId: event.eventId,
        result: "withdraw",
        description: engaged
          ? "Ты отходишь на шаг. Между вами снова расстояние."
          : "Ты и так не стоишь рядом ни с кем.",
      },
    }];
  },
};
