import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";

export const giveRule: Rule<ReadonlyWorld> = {
  id: "relations.give",
  phase: "consequence",
  listens: ["GiveRequested"],
  produces: ["RelationChanged"],
  handle: (event: DomainEvent, _world: ReadonlyWorld): DomainEvent[] => {
    const { relation, target } = event.payload as { relation: string; target: string };
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
  },
};
