/**
 * Dice Roller infrastructure for Iteration 15.
 *
 * Generates random dice rolls for critical checks.
 * Math.random() is used exactly once per check, and the result is
 * recorded in the Event Log. Replay uses the recorded result.
 */

import type { DomainEvent } from "@skald/event-bus";
import { ruleEventId } from "@skald/world";
import type { CriticalCheckState } from "@skald/world";

/**
 * Roll a d20 die. Returns a value between 1 and 20 inclusive.
 * Uses Math.random() — must be called exactly once per check.
 */
export function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

/**
 * Create a CriticalCheckRolled event from a CriticalCheckRequested event.
 * This is the ONLY place where Math.random() is called for dice rolls.
 * Embeds difficulty, modifiers, and stakes from the request for deterministic resolution.
 */
export function rollCriticalCheck(
  requestEvent: DomainEvent,
): DomainEvent {
  const payload = requestEvent.payload as {
    checkId: string;
    die: string;
    difficulty: number;
    modifiers: Array<{ label: string; delta: number }>;
    stakes: { success: string; failure: string };
    targetObjectId: string;
    targetObjectName: string;
    locationId: string;
  };

  const naturalRoll = rollD20();

  // Apply modifiers to get total
  const modifierTotal = payload.modifiers.reduce((sum, m) => sum + m.delta, 0);
  const total = naturalRoll + modifierTotal;

  return {
    eventId: ruleEventId(requestEvent.eventId, "CriticalCheckRolled", 0),
    type: "CriticalCheckRolled",
    schemaVersion: 1,
    payload: {
      checkId: payload.checkId,
      die: payload.die,
      naturalRoll,
      modifierTotal,
      total,
      difficulty: payload.difficulty,
      modifiers: payload.modifiers,
      stakes: payload.stakes,
      targetObjectId: payload.targetObjectId,
      targetObjectName: payload.targetObjectName,
      locationId: payload.locationId,
    },
    timestamp: requestEvent.timestamp,
    correlationId: requestEvent.correlationId,
    causationId: requestEvent.eventId,
  };
}

/**
 * Create a CriticalCheckRolled event from pending check state (for crash recovery).
 * This is used when a CriticalCheckRequested was committed but the roll was never performed.
 */
export function rollPendingCheck(
  pendingCheck: CriticalCheckState,
  requestEventId: string,
  correlationId: string,
  timestamp: number,
): DomainEvent {
  const naturalRoll = rollD20();

  // Apply modifiers to get total
  const modifierTotal = pendingCheck.modifiers.reduce((sum, m) => sum + m.delta, 0);
  const total = naturalRoll + modifierTotal;

  return {
    eventId: ruleEventId(requestEventId, "CriticalCheckRolled", 0),
    type: "CriticalCheckRolled",
    schemaVersion: 1,
    payload: {
      checkId: pendingCheck.checkId,
      die: pendingCheck.die,
      naturalRoll,
      modifierTotal,
      total,
      difficulty: pendingCheck.difficulty,
      modifiers: pendingCheck.modifiers,
      stakes: pendingCheck.stakes,
      targetObjectId: pendingCheck.targetObjectId,
      targetObjectName: pendingCheck.targetObjectName,
      locationId: pendingCheck.locationId,
    },
    timestamp,
    correlationId,
    causationId: requestEventId,
  };
}
