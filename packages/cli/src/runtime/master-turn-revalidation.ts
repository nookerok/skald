/**
 * Master Turn revalidation inside the world queue (ADR-0028, plan_6 Stage 8).
 *
 * The interpretation gateway runs before the serialized world command queue,
 * so another request may change the world while the LLM thinks. This module
 * is the synchronous pre-execution check that runs INSIDE the queue closure,
 * right before the validated plan executes:
 *
 * - revision unchanged → fresh, execute;
 * - revision changed but the bound target still resolves to the same
 *   identity with intact capability → rechecked, execute;
 * - target gone, inaccessible, ambiguous, or rebound to another identity,
 *   or a bound route forgotten → stale: no Events, natural clarification.
 *
 * It is deliberately synchronous and takes no model router: re-invoking the
 * LLM inside the queue would block every other command on a network timeout.
 * World Rules stay authoritative after execution starts; this layer only
 * refuses to execute a plan whose meaning did not survive.
 */

import {
  isItemAccessible,
  resolveInteractionTarget,
  spatialKnowledgeRank,
  type MasterTurnSceneSnapshot,
  type ReadonlyWorld,
} from "@skald/world";
import type {
  ValidatedConversationReferent,
  ValidatedMasterTurnPlan,
} from "./master-turn-validator.js";

/** Pre-execution revalidation outcome. Stale plans must not execute. */
export type MasterTurnRevalidation =
  | { readonly status: "fresh" }
  | { readonly status: "rechecked" }
  | {
      readonly status: "stale";
      readonly question: string;
      readonly options: readonly { readonly optionId: string; readonly label: string }[];
    };

/** Input for revalidation: the accepted plan, its scene table, live world. */
export interface MasterTurnRevalidationInput {
  readonly plan: ValidatedMasterTurnPlan;
  readonly scene: MasterTurnSceneSnapshot;
  readonly world: ReadonlyWorld;
}

function stale(question: string): MasterTurnRevalidation {
  return {
    status: "stale",
    question,
    options: [{ optionId: "rephrase", label: "Уточнить намерение" }],
  };
}

/**
 * Revalidates a plan against the live world. Pure and synchronous: no
 * Events, no Projection writes, no network calls, no model invocation.
 */
export function revalidateMasterTurnPlan(input: MasterTurnRevalidationInput): MasterTurnRevalidation {
  const { plan, scene, world } = input;
  if (!plan.execution) {
    // Inquiry and meta plans mutate nothing; the question is answered from
    // whatever snapshot is current at execution time.
    return { status: "fresh" };
  }
  if (world.time === plan.contextRevision.worldTime && world.eventNumber === plan.contextRevision.eventNumber) {
    return { status: "fresh" };
  }
  const intent = plan.execution.intent;
  if (intent.type === "JourneyIntent") return revalidateJourney(plan, scene, world);
  const surface = intent.type === "InteractionCommand" || intent.type === "ActionIntentCommand"
    ? intent.target?.raw
    : undefined;
  if (!surface) {
    // Ambient observe/listen without a target cannot go stale.
    return { status: "rechecked" };
  }
  const verb = intent.type === "InteractionCommand" ? intent.verb : intent.operation;
  const bound = boundIdentity(plan, scene);
  const resolution = resolveInteractionTarget(world, verb, surface);
  if (resolution.kind === "ambiguous") {
    return {
      status: "stale",
      question: "Уточни, что именно ты имеешь в виду.",
      options: resolution.candidates.slice(0, 4).map((candidate, index) => ({ optionId: `candidate-${index + 1}`, label: candidate.name })),
    };
  }
  if (resolution.kind !== "resolved") {
    return stale(`Пока готовился ответ, мир изменился, и «${surface}» стал недоступен. Уточни, что делать дальше.`);
  }
  if (bound && resolution.target.id !== bound) {
    // The name now matches another identity: executing would hit the wrong thing.
    return stale(`Пока готовился ответ, мир изменился, и «${surface}» стал недоступен. Уточни, что делать дальше.`);
  }
  if (world.actionCapabilities?.itemDefinitions.has(resolution.target.id)
    && !isItemAccessible(world, "player", resolution.target.id)) {
    return stale(`Пока готовился ответ, мир изменился, и «${surface}» стал недоступен. Уточни, что делать дальше.`);
  }
  if (intent.type === "InteractionCommand" && intent.verb === "use") {
    const definition = world.actionCapabilities?.itemDefinitions.get(resolution.target.id);
    if (definition && definition.affordances.length === 0) {
      return stale(`Пока готовился ответ, мир изменился, и «${surface}» так использовать не получится. Уточни намерение.`);
    }
  }
  return { status: "rechecked" };
}

/** The scene-table identity bound at validation time, if any. */
function boundIdentity(plan: ValidatedMasterTurnPlan, scene: MasterTurnSceneSnapshot): string | null {
  const entry: ValidatedConversationReferent | undefined = plan.focus.find(
    (candidate) => (candidate.kind === "target" || candidate.kind === "addressee") && candidate.observerRef !== null,
  );
  if (!entry?.observerRef) return null;
  return scene.references.get(entry.observerRef)?.internalId ?? null;
}

/** A bound route must still exist and stay observed; surface-only destinations defer to world route resolution. */
function revalidateJourney(
  plan: ValidatedMasterTurnPlan,
  scene: MasterTurnSceneSnapshot,
  world: ReadonlyWorld,
): MasterTurnRevalidation {
  const entry = plan.focus.find((candidate) => candidate.kind === "destination" && candidate.observerRef !== null);
  if (!entry?.observerRef) return { status: "rechecked" };
  const reference = scene.references.get(entry.observerRef);
  if (!reference || reference.kind !== "route") {
    return stale("Пока готовился ответ, мир изменился, и путь стал недоступен. Уточни направление.");
  }
  const knowledge = world.spatialKnowledge;
  const observation = knowledge?.observerId === "player" ? knowledge.relations.get(reference.internalId) : undefined;
  const known = observation !== undefined && spatialKnowledgeRank(observation.knowledge) >= spatialKnowledgeRank("observed");
  const exists = world.spatial?.travelRelations.has(reference.internalId) ?? false;
  if (!known || !exists) {
    return stale("Пока готовился ответ, мир изменился, и путь стал недоступен. Уточни направление.");
  }
  return { status: "rechecked" };
}
