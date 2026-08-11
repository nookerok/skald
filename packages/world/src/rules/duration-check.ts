import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";

/**
 * Duration check for ActionAttempted (Iteration 15) and JourneyRequested (ADR-0015).
 *
 * Validates that the player hasn't already acted this tick and isn't
 * currently traveling. If valid, emits the appropriate Validated event.
 * If not, emits ActionRejected.
 *
 * Also handles legacy MoveRequested and GiveRequested for backward compatibility.
 */
export const durationCheck: Rule<ReadonlyWorld> = {
  id: "simulation.duration_check",
  phase: "validation",
  listens: ["ActionAttempted", "MoveRequested", "GiveRequested", "InteractionRequested", "JourneyRequested", "JourneyInterruptRequested"],
  produces: ["ActionValidated", "GiveValidated", "InteractionTimeValidated", "JourneyValidated", "JourneyInterruptValidated", "ActionRejected"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const now = event.timestamp;

    // A stop command is the one player action allowed while traveling.
    if (event.type === "JourneyInterruptRequested") {
      return [{
        eventId: ruleEventId(event.eventId, "JourneyInterruptValidated", 0),
        type: "JourneyInterruptValidated",
        schemaVersion: 1,
        payload: event.payload,
        timestamp: event.timestamp,
        correlationId: event.correlationId,
        causationId: event.eventId,
      }];
    }

    // Block all other actions while traveling.
    if (world.activeJourneyId != null && event.type !== "TickPassed") {
      return [
        {
          eventId: ruleEventId(event.eventId, "ActionRejected", 0),
          type: "ActionRejected",
          schemaVersion: 1,
          payload: { reason: "traveling" },
          timestamp: event.timestamp,
          correlationId: event.correlationId,
          causationId: event.eventId,
        },
      ];
    }

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

    // Spatial Movement: JourneyRequested → JourneyValidated.
    // This is the sole owner of JourneyRequested.
    if (event.type === "JourneyRequested") {
      return [{
        eventId: ruleEventId(event.eventId, "JourneyValidated", 0),
        type: "JourneyValidated",
        schemaVersion: 1,
        payload: event.payload,
        timestamp: event.timestamp,
        correlationId: event.correlationId,
        causationId: event.eventId,
      }];
    }

    // World Interaction Model: InteractionRequested → InteractionTimeValidated.
    // This is the sole owner of InteractionRequested, preserving the action
    // budget before target resolution begins.
    if (event.type === "InteractionRequested") {
      return [{
        eventId: ruleEventId(event.eventId, "InteractionTimeValidated", 0),
        type: "InteractionTimeValidated",
        schemaVersion: 1,
        payload: event.payload,
        timestamp: event.timestamp,
        correlationId: event.correlationId,
        causationId: event.eventId,
      }];
    }

    // Iteration 15: ActionAttempted → ActionValidated
    if (event.type === "ActionAttempted") {
      return [
        {
          eventId: ruleEventId(event.eventId, "ActionValidated", 0),
          type: "ActionValidated",
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
    }

    // Legacy: MoveRequested → ActionValidated, GiveRequested → GiveValidated
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
