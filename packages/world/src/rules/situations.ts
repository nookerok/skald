import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";

const FEAR_THRESHOLD = 2;
const DURATION = 8;
const SPREAD_INTERVAL = 2;

export const start: Rule<ReadonlyWorld> = {
  id: "situations.start",
  phase: "consequence",
  listens: ["ObservationUpdated"],
  produces: ["ForestFireStarted", "SituationStarted"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const { key, delta } = event.payload as { key: string; delta: number };
    if (key !== "world_reaction_fear") return [];

    const oldValue = world.observations.get("world_reaction_fear") ?? 0;
    const newValue = oldValue + delta;
    if (newValue < FEAR_THRESHOLD) return [];

    if (world.activeSituations.has("forest_fire")) return [];

    return [
      {
        eventId: ruleEventId(event.eventId, "ForestFireStarted", 0),
        type: "ForestFireStarted",
        schemaVersion: 1,
        payload: { startedAt: event.timestamp },
        timestamp: event.timestamp,
        correlationId: event.correlationId,
        causationId: event.eventId,
      },
      {
        eventId: ruleEventId(event.eventId, "SituationStarted", 1),
        type: "SituationStarted",
        schemaVersion: 1,
        payload: {
          situationId: "forest_fire",
          type: "forest_fire",
          startedAt: event.timestamp,
          duration: DURATION,
          data: {},
        },
        timestamp: event.timestamp,
        correlationId: event.correlationId,
        causationId: event.eventId,
      },
    ];
  },
};

export const forestFireSpread: Rule<ReadonlyWorld> = {
  id: "forest_fire.spread",
  phase: "consequence",
  listens: ["TickPassed"],
  produces: ["TreeBurned"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const situation = world.activeSituations.get("forest_fire");
    if (!situation) return [];

    const now = event.timestamp;
    const elapsed = now - situation.startedAt;
    const expected = Math.floor(elapsed / SPREAD_INTERVAL) + 1;

    if (world.burnedTrees < expected) {
      return [
        {
          eventId: ruleEventId(event.eventId, "TreeBurned", 0),
          type: "TreeBurned",
          schemaVersion: 1,
          payload: { burnedAt: now, treeIndex: world.burnedTrees },
          timestamp: now,
          correlationId: event.correlationId,
          causationId: event.eventId,
        },
      ];
    }

    return [];
  },
};

export const end: Rule<ReadonlyWorld> = {
  id: "situations.end",
  phase: "consequence",
  listens: ["TickPassed"],
  produces: ["SituationEnded"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const now = event.timestamp;
    const ended: DomainEvent[] = [];
    let idx = 0;
    for (const [, situation] of world.activeSituations) {
      const endsAt = situation.startedAt + situation.duration;
      if (endsAt <= now) {
        ended.push({
          eventId: ruleEventId(event.eventId, "SituationEnded", idx),
          type: "SituationEnded",
          schemaVersion: 1,
          payload: { situationId: situation.situationId },
          timestamp: event.timestamp,
          correlationId: event.correlationId,
          causationId: event.eventId,
        });
        idx++;
      }
    }
    return ended;
  },
};
