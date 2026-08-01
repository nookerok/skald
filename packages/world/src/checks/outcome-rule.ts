import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";
import type { CheckOutcome } from "./types.js";

/**
 * Critical Check Outcome Rule.
 *
 * Listens for CriticalCheckResolved events and creates world effects
 * based on the check outcome and the specific target object.
 *
 * For force checks:
 * - Success: ObjectIntegrityChanged (damage to target), PassageOpened (if door/hinge destroyed)
 * - Failure: ConsequenceCreated (noise attention)
 *
 * This rule is the single owner of ActionResolved for critical checks.
 */
export const criticalCheckOutcome: Rule<ReadonlyWorld> = {
  id: "checks.outcome",
  phase: "consequence",
  listens: ["CriticalCheckResolved"],
  produces: ["ObjectIntegrityChanged", "PassageOpened", "ConsequenceCreated", "ActionResolved"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const payload = event.payload as {
      checkId: string;
      naturalRoll: number;
      total: number;
      difficulty: number;
      outcome: CheckOutcome;
      description: string;
      targetObjectId: string;
      targetObjectName: string;
      locationId: string;
    };

    const { checkId, outcome, targetObjectId, targetObjectName, locationId, description } = payload;

    // Extract actionEventId from checkId (format: "${actionEventId}>check")
    const actionEventId = checkId.replace(">check", "");

    const base = {
      schemaVersion: 1,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    };

    const isSuccess = outcome === "success" || outcome === "critical_success";
    const isCritical = outcome === "critical_success" || outcome === "critical_failure";

    const events: DomainEvent[] = [];

    // Find the target object
    const targetObj = world.objects.get(targetObjectId);

    if (targetObj) {
      if (isSuccess) {
        // Success: apply damage to the specific target
        const damage = isCritical ? 40 : 25;
        const newIntegrity = Math.max(0, targetObj.integrity - damage);

        events.push({
          ...base,
          eventId: ruleEventId(event.eventId, "ObjectIntegrityChanged", 0),
          type: "ObjectIntegrityChanged",
          payload: {
            objectId: targetObj.id,
            name: targetObj.name,
            previousIntegrity: targetObj.integrity,
            integrity: newIntegrity,
            ...(targetObj.id.includes("door") && newIntegrity <= 0
              ? { stateChange: { locked: false } }
              : {}),
          },
        });

        // If door/hinge is destroyed, open passage and unlock
        if (newIntegrity <= 0 && (targetObj.id.includes("door") || targetObj.id.includes("hinge"))) {
          events.push({
            ...base,
            eventId: ruleEventId(event.eventId, "PassageOpened", 1),
            type: "PassageOpened",
            payload: {
              fromLocationId: locationId,
              toLocationId: world.locations.get(locationId)?.connections["enter"] ?? "tower_interior",
              via: targetObj.id,
            },
          });

          // A destroyed hinge unlocks the associated door without damaging it.
          // A direct door hit was already emitted above and must not be duplicated.
          if (targetObj.id.includes("hinge")) {
            const door = world.objects.get("tower_door");
            if (door) {
              events.push({
                ...base,
                eventId: ruleEventId(event.eventId, "ObjectIntegrityChanged", 2),
                type: "ObjectIntegrityChanged",
                payload: {
                  objectId: door.id,
                  name: door.name,
                  previousIntegrity: door.integrity,
                  integrity: door.integrity,
                  stateChange: { locked: false },
                },
              });
            }
          }
        }
      } else {
        // Failure: create noise consequence
        // Note: SoundProduced is already emitted by interactionForce before the check
        // So we only create the delayed consequence here
        events.push({
          ...base,
          eventId: ruleEventId(event.eventId, "ConsequenceCreated", 0),
          type: "ConsequenceCreated",
          payload: {
            id: `noise-${event.eventId}`,
            type: "noise_attention",
            severity: isCritical ? 3 : 2,
            createdAt: event.timestamp,
            expiresAt: event.timestamp + 3,
            data: { source: targetObjectName, intensity: "loud" },
          },
        });
      }
    }

    // Single ActionResolved for the entire check
    events.push({
      ...base,
      eventId: ruleEventId(event.eventId, "ActionResolved", events.length),
      type: "ActionResolved",
      payload: {
        actionEventId,
        result: isSuccess ? "success" : "failure",
        description,
      },
    });

    return events;
  },
};

export const criticalCheckOutcomeRules = [criticalCheckOutcome];
