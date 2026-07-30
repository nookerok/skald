import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";
import type { CheckOutcome } from "./types.js";

/**
 * Critical Check Resolution Rule.
 *
 * Listens for CriticalCheckRolled events and resolves the check
 * deterministically based on the roll, difficulty, and modifiers.
 *
 * Emits only CriticalCheckResolved. World effects and ActionResolved
 * are handled by the outcome rule.
 */
export const criticalCheckResolution: Rule<ReadonlyWorld> = {
  id: "checks.resolution",
  phase: "consequence",
  listens: ["CriticalCheckRolled"],
  produces: ["CriticalCheckResolved"],
  handle: (event: DomainEvent, _world: ReadonlyWorld): DomainEvent[] => {
    const payload = event.payload as {
      checkId: string;
      naturalRoll: number;
      modifierTotal: number;
      total: number;
      difficulty: number;
      modifiers: Array<{ label: string; delta: number }>;
      stakes: { success: string; failure: string };
      targetObjectId: string;
      targetObjectName: string;
      locationId: string;
    };

    const { checkId, naturalRoll, modifierTotal, total, difficulty, stakes,
            targetObjectId, targetObjectName, locationId } = payload;

    const base = {
      schemaVersion: 1,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    };

    // Determine outcome based on natural roll and total vs difficulty
    let outcome: CheckOutcome;
    if (naturalRoll === 1) {
      outcome = "critical_failure";
    } else if (naturalRoll === 20) {
      outcome = "critical_success";
    } else if (total >= difficulty) {
      outcome = "success";
    } else if (total >= difficulty - 5) {
      outcome = "failure";
    } else {
      outcome = "critical_failure";
    }

    // Build description based on outcome
    let description: string;
    switch (outcome) {
      case "critical_success":
        description = `Критический успех! ${stakes.success}`;
        break;
      case "success":
        description = stakes.success;
        break;
      case "failure":
        description = stakes.failure;
        break;
      case "critical_failure":
        description = `Критическая ошибка! ${stakes.failure}`;
        break;
    }

    return [{
      ...base,
      eventId: ruleEventId(event.eventId, "CriticalCheckResolved", 0),
      type: "CriticalCheckResolved",
      payload: {
        checkId,
        naturalRoll,
        modifierTotal,
        total,
        difficulty,
        outcome,
        description,
        targetObjectId,
        targetObjectName,
        locationId,
      },
    }];
  },
};

export const criticalCheckRules = [criticalCheckResolution];
