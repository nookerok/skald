import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";

const FEAR_THRESHOLD = 2;
const DURATION = 8;
const SPREAD_INTERVAL = 2;

/** Local objects whose observation starts the crossing watch (observable start). */
const OPENING_WATCH_OBJECTS: ReadonlySet<string> = new Set(["crossing_upper_stones", "water_trace_marks"]);
/** Ticks the crossing watch stands before the generic end rule closes it. */
const WATCH_DURATION = 12;
export const OPENING_SITUATION_ID = "river_waystation_flood";
export const OPENING_SITUATION_TYPE = "crossing_watch";

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

/**
 * Simulation-backed opening problem (plan: opening Situation).
 *
 * The crossing's own water traces and upper stones are the observable start:
 * observing them raises the watch. The situation carries its participants,
 * stakes and the ways forward as observer-safe data; the rising water (an
 * existing CrossingCondition/river process) is the temporal process, and a
 * reopened crossing resolves it early. No QuestManager, no dialogue tree —
 * only the existing Situation/observation machinery.
 */
export const crossingWatchStart: Rule<ReadonlyWorld> = {
  id: "situations.crossing_watch_start",
  phase: "consequence",
  listens: ["ObjectObserved"],
  produces: ["SituationStarted"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const { objectId } = event.payload as { objectId?: string };
    if (!objectId || !OPENING_WATCH_OBJECTS.has(objectId)) return [];
    if (world.activeSituations.has(OPENING_SITUATION_ID)) return [];
    return [{
      eventId: ruleEventId(event.eventId, "SituationStarted", 0),
      type: "SituationStarted",
      schemaVersion: 1,
      payload: {
        situationId: OPENING_SITUATION_ID,
        type: OPENING_SITUATION_TYPE,
        startedAt: event.timestamp,
        duration: WATCH_DURATION,
        data: {
          participant: "carrier",
          approaches: ["осмотреть следы воды", "расспросить перевозчика", "найти обход или дождаться спада"],
          stakes: "к Речному Стражу не пройти напрямую, пока переправа трудная",
          completion: "понять причину подъёма воды, найти обход или дождаться спада",
        },
      },
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    }];
  },
};

/**
 * Early resolution: the crossing watch ends as soon as the crossing reopens.
 * The generic end rule still closes it after its duration if the water never
 * recedes within the watch window.
 */
export const crossingWatchResolve: Rule<ReadonlyWorld> = {
  id: "situations.crossing_watch_resolve",
  phase: "consequence",
  listens: ["CrossingConditionChanged"],
  produces: ["SituationEnded"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    if (!world.activeSituations.has(OPENING_SITUATION_ID)) return [];
    const { condition } = event.payload as { condition?: string };
    if (condition !== "open") return [];
    return [{
      eventId: ruleEventId(event.eventId, "SituationEnded", 0),
      type: "SituationEnded",
      schemaVersion: 1,
      payload: { situationId: OPENING_SITUATION_ID },
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    }];
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
