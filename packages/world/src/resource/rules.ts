import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";
import { spatialKnowledgeRank } from "../region/observer-knowledge.js";
import type { ResourceSituationBlocker } from "./types.js";

function base(event: DomainEvent) {
  return { schemaVersion: 1, timestamp: event.timestamp, correlationId: event.correlationId, causationId: event.eventId } as const;
}

function rejection(event: DomainEvent, type: string, reason: string, index = 0): DomainEvent {
  return { ...base(event), eventId: ruleEventId(event.eventId, type, index), type, payload: { reason, playerText: resourceReasonText(reason) } };
}

function resourceReasonText(reason: string): string {
  switch (reason) {
    case "resource_not_here": return "Здесь нет доступного источника этого ресурса.";
    case "resource_not_observed": return "Сначала нужно внимательно осмотреть это место.";
    case "resource_depleted": return "Источник уже истощён.";
    case "method_not_applicable": return "Так этот ресурс добыть не получится.";
    case "required_instrument_missing": return "Нужен подходящий инструмент.";
    case "carrying_capacity_exceeded": return "Столько не унести.";
    case "situation_blocks_extraction": return "Ситуация вокруг не позволяет заниматься добычей.";
    case "insufficient_holding": return "У владельца нет такого количества ресурса.";
    case "invalid_owner": return "Нельзя передать ресурс этому владельцу.";
    default: return "Действие с ресурсом не дало результата.";
  }
}

function blockerMatches(blocker: string | ResourceSituationBlocker, situation: ReadonlyWorld["activeSituations"] extends ReadonlyMap<string, infer V> ? V : never, locationId: string): boolean {
  if (typeof blocker === "string") return situation.type === blocker;
  if (situation.type !== blocker.situationType) return false;
  if (blocker.scope === "region") return true;
  const data = situation.data as { locationId?: unknown; locationIds?: unknown };
  return data.locationId === locationId || (Array.isArray(data.locationIds) && data.locationIds.includes(locationId));
}

function isBlocked(world: ReadonlyWorld, blockedBy: readonly (string | ResourceSituationBlocker)[], locationId: string): boolean {
  return [...world.activeSituations.values()].some((situation) => blockedBy.some((blocker) => blockerMatches(blocker, situation, locationId)));
}

function isObserved(world: ReadonlyWorld, locationId: string): boolean {
  const observation = world.spatialKnowledge?.locations.get(locationId);
  return !!observation && spatialKnowledgeRank(observation.knowledge) >= spatialKnowledgeRank("observed");
}

function hasRequiredInstrument(world: ReadonlyWorld, required: readonly string[] | undefined): boolean {
  if (!required || required.length === 0) return true;
  const currentLocationObjects = [...world.objects.values()].filter((object) => object.locationId === world.currentLocationId);
  return required.some((requiredName) => currentLocationObjects.some((object) => {
    const haystack = `${object.name} ${object.aliases.join(" ")}`.toLocaleLowerCase();
    return haystack.includes(requiredName.toLocaleLowerCase());
  }));
}

/** Resolves a resource extraction request against the current read view. */
export const resourceExtraction: Rule<ReadonlyWorld> = {
  id: "resource.extraction",
  phase: "physics",
  listens: ["ResourceExtractionRequested"],
  produces: ["ResourceExtracted", "ResourceExtractionRejected"],
  handle: (event, world) => {
    const resources = world.resources;
    if (!resources) return [rejection(event, "ResourceExtractionRejected", "resource_not_here")];
    const payload = event.payload as { nodeId?: string; methodId?: string; requestedUnits?: number; actorId?: string };
    const requestedUnits = payload.requestedUnits;
    const definition = payload.nodeId ? resources.definitions.get(payload.nodeId) : undefined;
    const state = payload.nodeId ? resources.states.get(payload.nodeId) : undefined;
    if (!definition || !state || definition.locationId !== world.currentLocationId) return [rejection(event, "ResourceExtractionRejected", "resource_not_here")];
    if (definition.requiresObservation && !isObserved(world, definition.locationId)) return [rejection(event, "ResourceExtractionRejected", "resource_not_observed")];
    if (typeof requestedUnits !== "number" || !Number.isInteger(requestedUnits) || requestedUnits <= 0) return [rejection(event, "ResourceExtractionRejected", "method_not_applicable")];
    if (state.stockUnits <= 0) return [rejection(event, "ResourceExtractionRejected", "resource_depleted")];
    if (isBlocked(world, definition.regeneration?.blockedBy ?? [], definition.locationId)) return [rejection(event, "ResourceExtractionRejected", "situation_blocks_extraction")];
    const method = definition.extractionMethods.find((entry) => entry.id === payload.methodId);
    if (!method) return [rejection(event, "ResourceExtractionRejected", "method_not_applicable")];
    if (!hasRequiredInstrument(world, method.requiredInstruments)) return [rejection(event, "ResourceExtractionRejected", "required_instrument_missing")];
    const amountUnits = Math.min(requestedUnits, method.maximumPerAction, state.stockUnits);
    if (amountUnits <= 0) return [rejection(event, "ResourceExtractionRejected", "resource_depleted")];
    return [{
      ...base(event),
      eventId: ruleEventId(event.eventId, "ResourceExtracted", 0),
      type: "ResourceExtracted",
      payload: { nodeId: definition.id, methodId: method.id, requestedUnits, amountUnits, actorId: payload.actorId ?? "player" },
    }];
  },
};

/** Advances all resource regeneration deterministically from world time. */
export const resourceRegeneration: Rule<ReadonlyWorld> = {
  id: "resource.regeneration",
  phase: "physics",
  listens: ["TickPassed"],
  produces: ["ResourceRegenerated", "ResourceRegenerationBlocked"],
  handle: (event, world) => {
    const resources = world.resources;
    if (!resources) return [];
    const result: DomainEvent[] = [];
    let index = 0;
    for (const definition of resources.definitions.values()) {
      const regeneration = definition.regeneration;
      const state = resources.states.get(definition.id);
      if (!regeneration || !state || state.stockUnits >= regeneration.maximumUnits) continue;
      const blocked = isBlocked(world, regeneration.blockedBy, definition.locationId);
      if (blocked) {
        if (regeneration.pauseWhileBlocked !== false && state.lastChangedWorldTime < event.timestamp) result.push({
          ...base(event), eventId: ruleEventId(event.eventId, "ResourceRegenerationBlocked", index), type: "ResourceRegenerationBlocked", payload: { nodeId: definition.id, reason: "situation_blocks_extraction", locationId: definition.locationId },
        });
        index += 1;
        continue;
      }
      const elapsed = event.timestamp - state.lastChangedWorldTime;
      if (elapsed < regeneration.intervalWorldTime) continue;
      const intervals = Math.floor(elapsed / regeneration.intervalWorldTime);
      const amountUnits = Math.min(intervals * regeneration.amountUnits, regeneration.maximumUnits - state.stockUnits, definition.capacityUnits - state.stockUnits);
      if (amountUnits <= 0) continue;
      result.push({
        ...base(event), eventId: ruleEventId(event.eventId, "ResourceRegenerated", index), type: "ResourceRegenerated", payload: { nodeId: definition.id, amountUnits },
      });
      index += 1;
    }
    return result;
  },
};

export const resourceTransfer: Rule<ReadonlyWorld> = {
  id: "resource.transfer",
  phase: "physics",
  listens: ["ResourceTransferRequested"],
  produces: ["ResourceTransferred", "ResourceTransferRejected"],
  handle: (event, world) => {
    const p = event.payload as { fromOwnerId?: string; toOwnerId?: string; resourceKind?: string; quality?: string; amountUnits?: number };
    if (!p.fromOwnerId || !p.toOwnerId || p.fromOwnerId === p.toOwnerId) return [rejection(event, "ResourceTransferRejected", "invalid_owner")];
    const quality = p.quality as "poor" | "common" | "rich";
    const key = `${p.fromOwnerId}|${p.resourceKind}|${quality}`;
    const holding = world.resources?.holdings.get(key);
    if (!holding || !Number.isInteger(p.amountUnits) || (p.amountUnits ?? 0) <= 0 || holding.amountUnits < (p.amountUnits ?? 0)) return [rejection(event, "ResourceTransferRejected", "insufficient_holding")];
    return [{ ...base(event), eventId: ruleEventId(event.eventId, "ResourceTransferred", 0), type: "ResourceTransferred", payload: { fromOwnerId: p.fromOwnerId, toOwnerId: p.toOwnerId, resourceKind: p.resourceKind, quality, amountUnits: p.amountUnits } }];
  },
};

export const resourceConsume: Rule<ReadonlyWorld> = {
  id: "resource.consume",
  phase: "physics",
  listens: ["ResourceConsumeRequested"],
  produces: ["ResourceConsumed", "ResourceConsumeRejected"],
  handle: (event, world) => {
    const p = event.payload as { ownerId?: string; resourceKind?: string; quality?: string; amountUnits?: number; reason?: string };
    const quality = p.quality as "poor" | "common" | "rich";
    const holding = p.ownerId && p.resourceKind ? world.resources?.holdings.get(`${p.ownerId}|${p.resourceKind}|${quality}`) : undefined;
    if (!holding || !Number.isInteger(p.amountUnits) || (p.amountUnits ?? 0) <= 0 || holding.amountUnits < (p.amountUnits ?? 0)) return [rejection(event, "ResourceConsumeRejected", "insufficient_holding")];
    return [{ ...base(event), eventId: ruleEventId(event.eventId, "ResourceConsumed", 0), type: "ResourceConsumed", payload: { ownerId: p.ownerId, resourceKind: p.resourceKind, quality, amountUnits: p.amountUnits, reason: p.reason ?? "unspecified" } }];
  },
};


export const resourceProcessStart: Rule<ReadonlyWorld> = {
  id: "resource.process.start",
  phase: "physics",
  listens: ["ResourceProcessRequested"],
  produces: ["ResourceProcessStarted", "ResourceProcessRejected"],
  handle: (event, world) => {
    const p = event.payload as { processId?: string; ownerId?: string };
    const definition = p.processId ? world.resources?.processDefinitions.get(p.processId) : undefined;
    if (!definition || !p.ownerId) return [rejection(event, "ResourceProcessRejected", "method_not_applicable")];
    if (p.ownerId === "player" && world.currentLocationId !== definition.locationId) return [rejection(event, "ResourceProcessRejected", "resource_not_here")];
    if (definition.blockedBy && isBlocked(world, definition.blockedBy, definition.locationId)) return [rejection(event, "ResourceProcessRejected", "situation_blocks_extraction")];
    if (world.resources?.processes.has(definition.id)) return [rejection(event, "ResourceProcessRejected", "method_not_applicable")];
    const holdingOk = definition.inputs.every((amount) => (world.resources?.holdings.get(`${p.ownerId}|${amount.resourceKind}|${amount.quality}`)?.amountUnits ?? 0) >= amount.amountUnits);
    if (!holdingOk) return [rejection(event, "ResourceProcessRejected", "insufficient_holding")];
    return [{ ...base(event), eventId: ruleEventId(event.eventId, "ResourceProcessStarted", 0), type: "ResourceProcessStarted", payload: { processId: definition.id, ownerId: p.ownerId, completesAt: event.timestamp + definition.durationWorldTime } }];
  },
};

export const resourceProcessCompletion: Rule<ReadonlyWorld> = {
  id: "resource.process.complete",
  phase: "physics",
  listens: ["TickPassed"],
  produces: ["ResourceProcessCompleted"],
  handle: (event, world) => {
    const result: DomainEvent[] = [];
    let index = 0;
    for (const process of world.resources?.processes.values() ?? []) {
      if (process.status !== "active" || process.completesAt > event.timestamp) continue;
      result.push({ ...base(event), eventId: ruleEventId(event.eventId, "ResourceProcessCompleted", index), type: "ResourceProcessCompleted", payload: { processId: process.processId, ownerId: process.ownerId } });
      index += 1;
    }
    return result;
  },
};

export const resourceDemandProcess: Rule<ReadonlyWorld> = {
  id: "resource.demand",
  phase: "physics",
  listens: ["TickPassed"],
  produces: ["ResourceConsumed", "ResourceShortageStarted", "ResourceShortageEnded"],
  handle: (event, world) => {
    const result: DomainEvent[] = [];
    let index = 0;
    for (const definition of world.resources?.demandDefinitions.values() ?? []) {
      const state = world.resources?.demandStates.get(definition.id);
      if (!state || event.timestamp - state.lastEvaluatedWorldTime < definition.intervalWorldTime) continue;
      const key = `${definition.ownerId}|${definition.resourceKind}|${definition.quality}`;
      const holding = world.resources?.holdings.get(key);
      const amount = holding?.amountUnits ?? 0;
      const consumed = Math.min(amount, definition.amountPerInterval);
      if (consumed > 0) result.push({ ...base(event), eventId: ruleEventId(event.eventId, "ResourceConsumed", index++), type: "ResourceConsumed", payload: { ownerId: definition.ownerId, resourceKind: definition.resourceKind, quality: definition.quality, amountUnits: consumed, reason: definition.id } });
      if (consumed < definition.amountPerInterval && !state.shortageActive) result.push({ ...base(event), eventId: ruleEventId(event.eventId, "ResourceShortageStarted", index++), type: "ResourceShortageStarted", payload: { demandId: definition.id, missingUnits: definition.amountPerInterval - consumed } });
      if (consumed >= definition.amountPerInterval && state.shortageActive) result.push({ ...base(event), eventId: ruleEventId(event.eventId, "ResourceShortageEnded", index++), type: "ResourceShortageEnded", payload: { demandId: definition.id } });
    }
    return result;
  },
};
