import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";

function base(event: DomainEvent) {
  return {
    schemaVersion: 1,
    timestamp: event.timestamp,
    correlationId: event.correlationId,
    causationId: event.eventId,
  } as const;
}

function isBlocked(world: ReadonlyWorld, blockedBy: readonly string[]): boolean {
  for (const situation of world.activeSituations.values()) {
    if (blockedBy.includes(situation.type)) return true;
  }
  return false;
}

/** Resolves a resource extraction request against the current read view. */
export const resourceExtraction: Rule<ReadonlyWorld> = {
  id: "resource.extraction",
  phase: "physics",
  listens: ["ResourceExtractionRequested"],
  produces: ["ResourceExtracted"],
  handle: (event, world) => {
    const resources = world.resources;
    if (!resources) return [];
    const payload = event.payload as { nodeId?: string; methodId?: string; requestedUnits?: number; actorId?: string };
    const requestedUnits = payload.requestedUnits;
    if (!payload.nodeId || !payload.methodId || typeof requestedUnits !== "number" || !Number.isInteger(requestedUnits) || requestedUnits <= 0) return [];
    const definition = resources.definitions.get(payload.nodeId);
    const state = resources.states.get(payload.nodeId);
    if (!definition || !state || state.stockUnits <= 0) return [];
    const method = definition.extractionMethods.find((entry) => entry.id === payload.methodId);
    if (!method) return [];
    const amountUnits = Math.min(requestedUnits, method.maximumPerAction, state.stockUnits);
    if (amountUnits <= 0) return [];
    return [{
      ...base(event),
      eventId: ruleEventId(event.eventId, "ResourceExtracted", 0),
      type: "ResourceExtracted",
      payload: {
        nodeId: definition.id,
        methodId: method.id,
        requestedUnits,
        amountUnits,
        actorId: payload.actorId ?? "player",
      },
    }];
  },
};

/** Advances all resource regeneration deterministically from world time. */
export const resourceRegeneration: Rule<ReadonlyWorld> = {
  id: "resource.regeneration",
  phase: "physics",
  listens: ["TickPassed"],
  produces: ["ResourceRegenerated"],
  handle: (event, world) => {
    const resources = world.resources;
    if (!resources) return [];
    const result: DomainEvent[] = [];
    let index = 0;
    for (const definition of resources.definitions.values()) {
      const regeneration = definition.regeneration;
      const state = resources.states.get(definition.id);
      if (!regeneration || !state || state.stockUnits >= regeneration.maximumUnits) continue;
      if (isBlocked(world, regeneration.blockedBy)) continue;
      const elapsed = event.timestamp - state.lastChangedWorldTime;
      if (elapsed < regeneration.intervalWorldTime) continue;
      const intervals = Math.floor(elapsed / regeneration.intervalWorldTime);
      const amountUnits = Math.min(
        intervals * regeneration.amountUnits,
        regeneration.maximumUnits - state.stockUnits,
        definition.capacityUnits - state.stockUnits,
      );
      if (amountUnits <= 0) continue;
      result.push({
        ...base(event),
        eventId: ruleEventId(event.eventId, "ResourceRegenerated", index),
        type: "ResourceRegenerated",
        payload: { nodeId: definition.id, amountUnits },
      });
      index += 1;
    }
    return result;
  },
};
