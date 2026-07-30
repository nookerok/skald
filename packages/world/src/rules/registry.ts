import { RuleRegistry } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { physicsMovement } from "./physics-movement.js";
import { observationRules } from "./observations.js";
import { repercussion, expire, fire } from "./consequences.js";
import { start, forestFireSpread, end } from "./situations.js";
import { giveRule } from "./relations.js";
import { heatSpread } from "./heat.js";
import { durationCheck } from "./duration-check.js";
import { playerStrategy } from "./player-strategy.js";
import { interactionRules } from "./interaction.js";
import { criticalCheckRules, criticalCheckOutcomeRules } from "../checks/index.js";
import { worldInteractionRules } from "./world-interaction.js";

/**
 * Create a fully-configured RuleRegistry with all game rules.
 *
 * This is the single composition root for rules. Every runtime
 * (CLI, persistent app, WorldRuntimeManager) must use this function
 * to ensure consistent rule registration.
 */
export function createRules(): RuleRegistry<ReadonlyWorld> {
  const registry = new RuleRegistry<ReadonlyWorld>();

  // Phase: validation
  registry.register(durationCheck);

  // Phase: physics
  registry.register(physicsMovement);
  for (const rule of observationRules) registry.register(rule);

  // Interaction rules (Iteration 15)
  for (const rule of interactionRules) registry.register(rule);

  // World Interaction Model — examine/perception vertical slice
  for (const rule of worldInteractionRules) registry.register(rule);

  // Phase: consequence
  registry.register(repercussion);
  registry.register(expire);
  registry.register(fire);
  registry.register(start);
  registry.register(forestFireSpread);
  registry.register(end);
  registry.register(giveRule);
  registry.register(heatSpread);
  registry.register(playerStrategy);

  // Critical check rules (Iteration 15)
  for (const rule of criticalCheckRules) registry.register(rule);
  for (const rule of criticalCheckOutcomeRules) registry.register(rule);

  return registry;
}
