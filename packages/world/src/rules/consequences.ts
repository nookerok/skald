import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";

const THRESHOLD = 3;

export const repercussion: Rule<ReadonlyWorld> = {
  id: "consequences.repercussion",
  phase: "consequence",
  listens: ["ObservationUpdated"],
  produces: ["ConsequenceCreated"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const { key, delta } = event.payload as { key: string; delta: number };
    if (key !== "risk_taken") return [];

    const oldValue = world.observations.get("risk_taken") ?? 0;
    const newValue = oldValue + delta;
    if (newValue < THRESHOLD) return [];

    for (const c of world.consequences.values()) {
      if (c.type === "audacity") return [];
    }

    return [
      {
        eventId: ruleEventId(event.eventId, "ConsequenceCreated", 0),
        type: "ConsequenceCreated",
        schemaVersion: 1,
        payload: {
          id: `audacity@${event.correlationId}`,
          type: "audacity",
          severity: 1,
          createdAt: event.timestamp,
          expiresAt: event.timestamp + 5,
          data: { threshold: THRESHOLD },
        },
        timestamp: event.timestamp,
        correlationId: event.correlationId,
        causationId: event.eventId,
      },
    ];
  },
};

export const expire: Rule<ReadonlyWorld> = {
  id: "consequences.expire",
  phase: "consequence",
  listens: ["TickPassed"],
  produces: ["ConsequenceExpired"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const now = event.timestamp;
    const expired: DomainEvent[] = [];
    let idx = 0;
    for (const c of world.consequences.values()) {
      if (c.expiresAt <= now) {
        expired.push({
          eventId: ruleEventId(event.eventId, "ConsequenceExpired", idx),
          type: "ConsequenceExpired",
          schemaVersion: 1,
          payload: { id: c.id },
          timestamp: event.timestamp,
          correlationId: event.correlationId,
          causationId: event.eventId,
        });
        idx++;
      }
    }
    return expired;
  },
};
