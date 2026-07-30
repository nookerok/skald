import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";

export const giveRule: Rule<ReadonlyWorld> = {
  id: "relations.give",
  phase: "consequence",
  listens: ["GiveValidated", "ActionValidated"],
  produces: ["RelationChanged"],
  handle: (event: DomainEvent, _world: ReadonlyWorld): DomainEvent[] => {
    const originalPayload = (event.payload as { originalPayload: Record<string, unknown> }).originalPayload;

    // Legacy format: GiveValidated with relation/target
    if ("relation" in originalPayload && "target" in originalPayload) {
      const relation = originalPayload.relation as string;
      const target = originalPayload.target as string;
      return [
        {
          eventId: ruleEventId(event.eventId, "RelationChanged", 0),
          type: "RelationChanged",
          schemaVersion: 1,
          payload: { from: "player", to: target, kind: relation, delta: 1 },
          timestamp: event.timestamp,
          correlationId: event.correlationId,
          causationId: event.eventId,
        },
      ];
    }

    // New format: ActionValidated from ActionAttempted with speak operation
    // The give command is parsed as mode=communicate, operation=speak, utterance="relation to target"
    const opPayload = originalPayload as { operation?: string; mode?: string; utterance?: string; target?: { raw?: string } };
    if (opPayload.operation === "speak" && opPayload.mode === "communicate" && opPayload.utterance) {
      const utterance = opPayload.utterance;
      const match = utterance.match(/^(\S+)\s+to\s+(.+)$/);
      if (match) {
        const relation = match[1]!;
        const target = match[2]!.trim();
        return [
          {
            eventId: ruleEventId(event.eventId, "RelationChanged", 0),
            type: "RelationChanged",
            schemaVersion: 1,
            payload: { from: "player", to: target, kind: relation, delta: 1 },
            timestamp: event.timestamp,
            correlationId: event.correlationId,
            causationId: event.eventId,
          },
        ];
      }
    }

    return [];
  },
};
