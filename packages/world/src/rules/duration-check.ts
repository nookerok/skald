import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";

export const durationCheck: Rule<ReadonlyWorld> = {
  id: "simulation.duration_check",
  phase: "validation",
  listens: ["MoveRequested", "GiveRequested"],
  produces: ["ActionValidated", "GiveValidated", "ActionRejected"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const now = event.timestamp;

    if (world.lastActionTick === now) {
      return [
        {
          eventId: ruleEventId(event.eventId, "ActionRejected", 0),
          type: "ActionRejected",
          schemaVersion: 1,
          payload: { reason: "insufficient_time" },
          timestamp: event.timestamp,
          correlationId: event.correlationId,
          causationId: event.eventId,
        },
      ];
    }

    const validatedType = event.type === "MoveRequested" ? "ActionValidated" : "GiveValidated";

    return [
      {
        eventId: ruleEventId(event.eventId, validatedType, 0),
        type: validatedType,
        schemaVersion: 1,
        payload: {
          actionType: event.type,
          originalEventId: event.eventId,
          originalPayload: event.payload,
        },
        timestamp: event.timestamp,
        correlationId: event.correlationId,
        causationId: event.eventId,
      },
    ];
  },
};
