import type { EntityComponentName } from "./entities/types.js";

export type InteractionLaw = "perception" | "listening";

export interface InteractionDefinition {
  readonly verb: string;
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
