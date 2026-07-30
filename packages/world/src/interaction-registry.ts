import type { EntityComponentName } from "./entities/types.js";

export interface InteractionDefinition {
  readonly verb: string;
  readonly requiredComponents: readonly EntityComponentName[];
  readonly law: "perception";
}

const DEFINITIONS: readonly InteractionDefinition[] = Object.freeze([
  Object.freeze({
    verb: "examine",
    requiredComponents: Object.freeze([]),
    law: "perception",
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
