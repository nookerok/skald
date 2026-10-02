import type { InteractionVerb } from "@skald/intent-parser";
import type { EntityComponentName } from "./entities/types.js";

export type InteractionLaw = 'perception' | 'listening' | 'possession' | 'containment' | 'access' | 'affordance-use';

/** Removed when Slice 6 migrates apply_force onto the canonical registry. */
export const INTERACTION_REGISTRY_PENDING_VERBS = Object.freeze(["apply_force"] as const satisfies readonly InteractionVerb[]);
type RegisteredInteractionVerb = Exclude<InteractionVerb, (typeof INTERACTION_REGISTRY_PENDING_VERBS)[number]>;

export interface InteractionDefinition {
  readonly verb: RegisteredInteractionVerb;
  readonly requiredComponents: readonly EntityComponentName[];
  readonly law: InteractionLaw;
}

const DEFINITIONS: readonly InteractionDefinition[] = Object.freeze([
  Object.freeze({
    verb: "inspect",
    requiredComponents: Object.freeze([]),
    law: "perception",
  }),
  Object.freeze({
    verb: "observe",
    requiredComponents: Object.freeze([]),
    law: "perception",
  }),
  Object.freeze({
    verb: "listen",
    requiredComponents: Object.freeze([]),
    law: "listening",
  }),
  Object.freeze({
    verb: 'take',
    requiredComponents: Object.freeze([]),
    law: 'possession',
  }),
  Object.freeze({
    verb: 'open',
    requiredComponents: Object.freeze([]),
    law: 'access',
  }),
  Object.freeze({
    verb: 'give',
    requiredComponents: Object.freeze([]),
    law: 'possession',
  }),
  Object.freeze({
    verb: 'touch',
    requiredComponents: Object.freeze([]),
    law: 'perception',
  }),
  Object.freeze({
    verb: 'close',
    requiredComponents: Object.freeze([]),
    law: 'access',
  }),
  Object.freeze({
    verb: 'place',
    requiredComponents: Object.freeze([]),
    law: 'containment',
  }),
  Object.freeze({
    verb: 'use',
    requiredComponents: Object.freeze([]),
    law: 'affordance-use',
  }),
]);

export const interactionRegistry: ReadonlyMap<string, InteractionDefinition> = new Map(
  DEFINITIONS.map((definition) => [definition.verb, definition]),
);

export function getInteractionDefinition(verb: string): InteractionDefinition | undefined {
  return interactionRegistry.get(verb);
}

export function isKnownInteractionVerb(verb: string): boolean {
  return interactionRegistry.has(verb);
}
