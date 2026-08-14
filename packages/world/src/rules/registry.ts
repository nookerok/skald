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
import { perceptionRules } from "./interactions/perception.js";
import { listeningRules } from "./interactions/listening.js";
import { journeyStart } from "./journey-start.js";
import { journeyProgress } from "./journey-progress.js";
import { journeyInterrupt } from "./journey-interrupt.js";
import { journeyTravel } from "./journey-travel.js";
import { createJourneyValidationRule } from "./journey-validation.js";
import { riverLevelProcess } from "./river-level.js";
import { crossingCondition } from "./crossing-condition.js";
import { weatherProcess } from "./weather.js";
import { heatTransferProcess } from "./heat-transfer.js";
import { settlementPattern } from "./settlement-pattern.js";
import { resourceExtraction, resourceRegeneration, resourceTransfer, resourceConsume, resourceProcessStart, resourceProcessCompletion, resourceDemandProcess } from "../resource/rules.js";
import { actionCapabilityRules } from './interactions/action-capability.js';
import type { SpatialWorldProjection, ObserverMapDTO } from "../region/types.js";

/**
 * Create a fully-configured RuleRegistry with all game rules.
 *
 * This is the single composition root for rules. Every runtime
 * (CLI, persistent app, WorldRuntimeManager) must use this function
 * to ensure consistent rule registration.
 */
export function createRules(
  spatial?: SpatialWorldProjection,
  observerMap?: ObserverMapDTO | (() => ObserverMapDTO),
): RuleRegistry<ReadonlyWorld> {
  const registry = new RuleRegistry<ReadonlyWorld>();

  // Phase: validation
  registry.register(durationCheck);

  // Spatial Movement — journey validation rule (ADR-0015). It is the sole
  // JourneyValidated owner when observer-scoped region data is available;
  // the legacy resolver is registered only for worlds without that model.
  if (spatial && observerMap) {
    registry.register(createJourneyValidationRule(spatial, observerMap));
  }

  // Phase: physics
  registry.register(physicsMovement);
  for (const rule of observationRules) registry.register(rule);

  // Interaction rules (Iteration 15)
  for (const rule of interactionRules) registry.register(rule);
  for (const rule of actionCapabilityRules) registry.register(rule);

  // World Interaction Model — canonical gates + perception law (ADR-0013)
  for (const rule of worldInteractionRules) registry.register(rule);
  for (const rule of perceptionRules) registry.register(rule);
  for (const rule of listeningRules) registry.register(rule);

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

  // Spatial Movement — journey start rule (ADR-0015)
  registry.register(journeyStart);
  registry.register(journeyProgress);
  registry.register(journeyInterrupt);

  // Journey travel rule (production) remains the compatibility path for
  // legacy worlds. Living-region runtimes use the observer-scoped rule above
  // so two JourneyStarted owners can never race on one JourneyValidated.
  if (!spatial || !observerMap) registry.register(journeyTravel);

  // River Hydrology (ADR-0017)
  registry.register(riverLevelProcess);
  registry.register(crossingCondition);

  // Weather (ADR-0020, influences graph)
  registry.register(weatherProcess);

  // Heat Transfer (PR-7.1, second independent system)
  registry.register(heatTransferProcess);

  // Settlement Pattern (PR-7.4, first long-lived object)
  registry.register(settlementPattern);

  // Resource nodes and deterministic extraction/recovery
  registry.register(resourceExtraction);
  registry.register(resourceRegeneration);
  registry.register(resourceTransfer);
  registry.register(resourceConsume);
  registry.register(resourceProcessStart);
  registry.register(resourceProcessCompletion);
  registry.register(resourceDemandProcess);

  // Critical check rules (Iteration 15)
  for (const rule of criticalCheckRules) registry.register(rule);
  for (const rule of criticalCheckOutcomeRules) registry.register(rule);

  return registry;
}
