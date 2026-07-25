import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";
import { PREDICATES, ACTIONS } from "../strategy-registry.js";

export const playerStrategy: Rule<ReadonlyWorld> = {
  id: "player.strategy",
  phase: "consequence",
  listens: ["TickPassed"],
  produces: ["MoveRequested", "GiveRequested"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const payload = event.payload as { delta: number; playerOffline?: boolean };
    if (!payload.playerOffline) return [];

    if (world.strategy.length === 0) return [];

    for (const entry of world.strategy) {
      const predicate = PREDICATES.get(entry.condition);
      if (!predicate) continue;

      if (!predicate(world)) continue;

      const action = ACTIONS.get(entry.action);
      if (!action) break;

      const intent = action();
      if (intent.type === "idle") return [];

      const requestedType = intent.type === "move" ? "MoveRequested" : "GiveRequested";
      const pl = intent.type === "move"
        ? { direction: intent.direction }
        : { relation: intent.relation, target: intent.target };

      return [
        {
          eventId: ruleEventId(event.eventId, requestedType, 0),
          type: requestedType,
          schemaVersion: 1,
          payload: pl,
          timestamp: event.timestamp,
          correlationId: event.correlationId,
          causationId: event.eventId,
        },
      ];
    }

    return [];
  },
};
