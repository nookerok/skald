import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { EntityComponentName, EntityComponents } from "../entities/types.js";
import { getInteractionDefinition, type InteractionDefinition } from "../interaction-registry.js";
import { resolveInteractionTarget, targetFromObject } from "../interactions/index.js";
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

function reject(
  event: DomainEvent,
  reason: "no_such_target" | "not_applicable" | "ambiguous_target",
  candidateNames?: readonly string[],
): DomainEvent {
  return {
    ...baseFrom(event),
    eventId: ruleEventId(event.eventId, "ActionRejected", 0),
    type: "ActionRejected",
    payload: candidateNames ? { reason, candidateNames } : { reason },
  };
}

/**
 * Validation gate after InteractionTimeValidated. It is the sole owner of this
 * event and never performs law selection or outcome generation. Target
 * resolution runs the unified resolver (ADR-0013 §3) shared with the offline
 * classifier, so runtime and offline can never disagree.
 */
export const interactionResolveTarget: Rule<ReadonlyWorld> = {
  id: "interaction.resolve_target",
  phase: "validation",
  listens: ["InteractionTimeValidated"],
  produces: ["TargetResolved", "ActionRejected"],
  handle: (event, world) => {
    const payload = event.payload as { verb?: string; object?: string };
    if (!payload.verb) return [reject(event, "no_such_target")];

    const resolution = resolveInteractionTarget(world, payload.verb, payload.object ?? "");

    if (resolution.kind === "resolved") {
      return [{
        ...baseFrom(event),
        eventId: ruleEventId(event.eventId, "TargetResolved", 0),
        type: "TargetResolved",
        payload: { entityId: resolution.target.id, verb: payload.verb },
      }];
    }
    if (resolution.kind === "environment") {
      return [{
        ...baseFrom(event),
        eventId: ruleEventId(event.eventId, "TargetResolved", 0),
        type: "TargetResolved",
        payload: { environment: true, locationId: resolution.locationId, verb: payload.verb },
      }];
    }
    if (resolution.kind === "ambiguous") {
      return [reject(event, "ambiguous_target", resolution.candidates.map((candidate) => candidate.name))];
    }
    return [reject(event, "no_such_target")];
  },
};

function hasRequiredComponents(components: EntityComponents, required: readonly EntityComponentName[]): boolean {
  return required.every((component) => components[component] !== undefined);
}

/** Pure testable implementation; production uses the fixed compile-time registry. */
export function resolveInteractionLaw(
  event: DomainEvent,
  world: ReadonlyWorld,
  lookup: DefinitionLookup = getInteractionDefinition,
): DomainEvent[] {
  const payload = event.payload as { entityId?: string; environment?: boolean; locationId?: string; verb?: string };
  const definition = payload.verb ? lookup(payload.verb) : undefined;
  if (!definition) return [reject(event, "not_applicable")];

  if (payload.environment && payload.locationId) {
    return [{
      ...baseFrom(event),
      eventId: ruleEventId(event.eventId, "InteractionValidated", 0),
      type: "InteractionValidated",
      payload: { law: definition.law, locationId: payload.locationId, verb: definition.verb },
    }];
  }

  // Targets may be generic entities (grid scope) or physical WorldObjects
  // (location scope); both are validated against the same registry
  // (ADR-0013 §3, §4).
  const entity = payload.entityId ? world.entities.get(payload.entityId) : undefined;
  const object = payload.entityId ? world.objects.get(payload.entityId) : undefined;
  if (!entity && !object) return [reject(event, "not_applicable")];
  const components = entity ? entity.components : targetFromObject(object!).components;
  if (!hasRequiredComponents(components, definition.requiredComponents)) {
    return [reject(event, "not_applicable")];
  }
  return [{
    ...baseFrom(event),
    eventId: ruleEventId(event.eventId, "InteractionValidated", 0),
    type: "InteractionValidated",
    payload: { law: definition.law, entityId: entity ? entity.id : object!.id, verb: definition.verb },
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

export const worldInteractionRules: readonly Rule<ReadonlyWorld>[] = [
  interactionResolveTarget,
  interactionResolveLaw,
];
