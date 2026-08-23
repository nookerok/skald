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

    // New format: ActionValidated from ActionAttempted with semantic speech
    // metadata. The original player utterance is intentionally not persisted.
    const opPayload = originalPayload as { operation?: string; mode?: string; speech?: { relation?: string; target?: string }; utterance?: string };
    if (opPayload.operation === "speak" && opPayload.mode === "communicate") {
      const semanticSpeech = opPayload.speech;
      const legacyMatch = typeof opPayload.utterance === "string" ? opPayload.utterance.match(/^(\S+)\s+to\s+(.+)$/) : null;
      const relation = semanticSpeech?.relation ?? legacyMatch?.[1];
      const target = semanticSpeech?.target?.trim() || legacyMatch?.[2]?.trim();
      if (relation && target) {
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
