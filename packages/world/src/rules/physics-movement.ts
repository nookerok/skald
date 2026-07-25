import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { computeDestination, wallKey, WORLD_WIDTH, WORLD_HEIGHT } from "../map.js";
import { ruleEventId } from "../ids.js";

export const physicsMovement: Rule<ReadonlyWorld> = {
  id: "physics.movement",
  phase: "physics",
  listens: ["ActionValidated"],
  produces: ["MovementSucceeded", "MovementBlocked"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const originalPayload = (event.payload as { originalPayload: { direction: string } }).originalPayload;
    const { direction } = originalPayload;
    const from = world.player;
    const dest = computeDestination(from.x, from.y, direction as never);

    const base = {
      schemaVersion: 1,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    };

    if (dest.x < 0 || dest.x >= WORLD_WIDTH || dest.y < 0 || dest.y >= WORLD_HEIGHT) {
      return [
        {
          ...base,
          eventId: ruleEventId(event.eventId, "MovementBlocked", 0),
          type: "MovementBlocked",
          payload: { reason: "boundary" },
        },
      ];
    }

    if (world.walls.has(wallKey(dest.x, dest.y))) {
      return [
        {
          ...base,
          eventId: ruleEventId(event.eventId, "MovementBlocked", 0),
          type: "MovementBlocked",
          payload: { reason: "wall" },
        },
      ];
    }

    return [
      {
        ...base,
        eventId: ruleEventId(event.eventId, "MovementSucceeded", 0),
        type: "MovementSucceeded",
        payload: { x: dest.x, y: dest.y },
      },
    ];
  },
};
