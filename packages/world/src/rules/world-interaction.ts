import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { Entity, EntityComponentName } from "../entities/types.js";
import { getInteractionDefinition, type InteractionDefinition } from "../interaction-registry.js";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";

type DefinitionLookup = (verb: string) => InteractionDefinition | undefined;

function baseFrom(event: DomainEvent) {
  return {
    schemaVersion: 1,
    timestamp: event.timestamp,
    correlationId: event.correlationId,
    causationId: event.eventId,
  } as const;
}

function reject(event: DomainEvent, reason: "no_such_target" | "not_applicable"): DomainEvent {
  return {
    ...baseFrom(event),
    eventId: ruleEventId(event.eventId, "ActionRejected", 0),
    type: "ActionRejected",
    payload: { reason },
  };
}

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function isNearby(entity: Entity, world: ReadonlyWorld): boolean {
  return Math.abs(entity.x - world.player.x) + Math.abs(entity.y - world.player.y) <= 1;
}

function namesMatch(entity: Entity, object: string): boolean {
  const query = normalized(object);
  if (!query) return false;
  return [entity.name, ...entity.aliases].some((candidate) => {
    const name = normalized(candidate);
    return name.includes(query) || query.includes(name);
  });
}

/**
 * Shared examine target resolution predicate. Both the examine gate and the
 * offline intent classifier use this exact function so that a classified
 * "accepted" offline intent can never resolve to a different target at
 * execution time.
 */
export function findExamineTarget(world: ReadonlyWorld, object: string): Entity | undefined {
  return [...world.entities.values()]
    .filter((candidate) => isNearby(candidate, world) && namesMatch(candidate, object))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
}

/**
 * Validation gate after InteractionTimeValidated. It is the sole owner of this
 * event and never performs law selection or outcome generation.
 */
export const interactionResolveTarget: Rule<ReadonlyWorld> = {
  id: "interaction.resolve_target",
  phase: "validation",
  listens: ["InteractionTimeValidated"],
  produces: ["TargetResolved", "ActionRejected"],
  handle: (event, world) => {
    const payload = event.payload as { verb?: string; object?: string };
    const entity = findExamineTarget(world, payload.object ?? "");

    if (!entity || !payload.verb) return [reject(event, "no_such_target")];
    return [{
      ...baseFrom(event),
      eventId: ruleEventId(event.eventId, "TargetResolved", 0),
      type: "TargetResolved",
      payload: { entityId: entity.id, verb: payload.verb },
    }];
  },
};

function hasRequiredComponents(entity: Entity, required: readonly EntityComponentName[]): boolean {
  return required.every((component) => entity.components[component] !== undefined);
}

/** Pure testable implementation; production uses the fixed compile-time registry. */
export function resolveInteractionLaw(
  event: DomainEvent,
  world: ReadonlyWorld,
  lookup: DefinitionLookup = getInteractionDefinition,
): DomainEvent[] {
  const payload = event.payload as { entityId?: string; verb?: string };
  const definition = payload.verb ? lookup(payload.verb) : undefined;
  const entity = payload.entityId ? world.entities.get(payload.entityId) : undefined;
  if (!definition || !entity || !hasRequiredComponents(entity, definition.requiredComponents)) {
    return [reject(event, "not_applicable")];
  }
  return [{
    ...baseFrom(event),
    eventId: ruleEventId(event.eventId, "InteractionValidated", 0),
    type: "InteractionValidated",
    payload: { law: definition.law, entityId: entity.id, verb: definition.verb },
  }];
}

/** Validation gate after TargetResolved; sole owner of TargetResolved. */
export const interactionResolveLaw: Rule<ReadonlyWorld> = {
  id: "interaction.resolve_law",
  phase: "validation",
  listens: ["TargetResolved"],
  produces: ["InteractionValidated", "ActionRejected"],
  handle: (event, world) => resolveInteractionLaw(event, world),
};

/** Physics-law outcome for the first and only registered law: perception. */
export const perceptionExamine: Rule<ReadonlyWorld> = {
  id: "perception.examine",
  phase: "physics",
  listens: ["InteractionValidated"],
  produces: ["EntityExamined"],
  handle: (event, world) => {
    const payload = event.payload as { law?: string; entityId?: string; verb?: string };
    if (payload.law !== "perception" || payload.verb !== "examine" || !payload.entityId) return [];
    const entity = world.entities.get(payload.entityId);
    if (!entity) return [];
    return [{
      ...baseFrom(event),
      eventId: ruleEventId(event.eventId, "EntityExamined", 0),
      type: "EntityExamined",
      payload: { entityId: entity.id, name: entity.name, description: entity.description },
    }];
  },
};

/** Consequence-side observation, deliberately separate from perception.examine. */
export const examinedCuriosity: Rule<ReadonlyWorld> = {
  id: "observation.curiosity_from_examination",
  phase: "consequence",
  listens: ["EntityExamined"],
  produces: ["ObservationUpdated"],
  handle: (event) => [{
    ...baseFrom(event),
    eventId: ruleEventId(event.eventId, "ObservationUpdated", 0),
    type: "ObservationUpdated",
    payload: { key: "curiosity", delta: 1 },
  }],
};

export const worldInteractionRules: readonly Rule<ReadonlyWorld>[] = [
  interactionResolveTarget,
  interactionResolveLaw,
  perceptionExamine,
  examinedCuriosity,
];
