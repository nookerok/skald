/**
 * Scene rhythm (plan_9 §11).
 *
 * A pure read-side derivation over already-committed observer-safe state.
 * It never creates Domain Events, never writes Projection, never calls
 * Rules, network or LLM. It only names what is dramatically alive right
 * now so the narration layer can choose emphasis — facts and consequences
 * keep materializing exclusively through existing Events, Situations and
 * Rules.
 *
 * Every field is observer-safe prose or null when honestly absent. A scene
 * without a situation still yields a valid rhythm with null pressure —
 * never an invented threat. This is not a Quest Manager: there are no
 * objectives, stages or rewards here, only the current question, pressure,
 * opportunity, cost of inaction, recent change and completion condition.
 */

import type { JourneyView } from "../game-shell/types.js";
import type { MasterSceneSituation } from "../master-turn/observer-context.js";

/** Dramatic rhythm of one active scene. All prose is observer-safe. */
export interface SceneRhythm {
  /** The open question holding this scene (situation, goal or clarification). */
  readonly question: string | null;
  /** Active pressure that moves even if the player waits (rising water, expiring consequence). */
  readonly pressure: string | null;
  /** A concrete observer-safe opportunity (a contact who knows, a route, an affordance). */
  readonly opportunity: string | null;
  /** Honest price of inaction, only when the world state implies one. */
  readonly inactionCost: string | null;
  /** What changed after the player's recent actions (last outcome, arrival, blockage). */
  readonly changeAfterActions: string | null;
  /** What would observably close this scene (arrival, evidence, resolved question). */
  readonly completionCondition: string | null;
}

/** Observer-safe consequence line feeding pressure and cost. */
export interface RhythmConsequence {
  readonly label: string;
  readonly detail?: string | undefined;
}

/** Inputs for rhythm derivation. All inputs are already observer-safe. */
export interface SceneRhythmInput {
  readonly situation: MasterSceneSituation | null;
  readonly journey: JourneyView;
  readonly recentConsequences: readonly RhythmConsequence[];
  /** Player's stated goal, when one is tracked read-side. */
  readonly activeGoal?: string | null | undefined;
  /** Pending master question, when one is open. */
  readonly pendingQuestion?: string | null | undefined;
  /** Last deterministic outcome prose, when the turn produced one. */
  readonly lastOutcome?: string | null | undefined;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Derives the scene question. Priority is deterministic:
 * pending clarification first (the master is waiting), then the player's
 * goal, then the observed situation. Pure and total.
 */
export function rhythmQuestion(input: Pick<SceneRhythmInput, "situation" | "activeGoal" | "pendingQuestion">): string | null {
  const pending = clean(input.pendingQuestion ?? null);
  if (pending) return pending;
  const goal = clean(input.activeGoal ?? null);
  if (goal) return goal;
  if (input.situation) {
    const title = clean(input.situation.title);
    const description = clean(input.situation.description);
    if (title && description) return `${title}: ${description}`;
    return title ?? description;
  }
  return null;
}

/**
 * Derives honest pressure: an active journey leg, a difficult or closed
 * crossing named by the situation, or the freshest consequence. Never
 * invents a countdown — without a legible source the pressure is null.
 * Pure and total.
 */
export function rhythmPressure(input: Pick<SceneRhythmInput, "situation" | "journey" | "recentConsequences">): string | null {
  const journey = input.journey;
  if (journey.status === "traveling" && journey.to) {
    return `Путь к «${journey.to}» продолжается: ${journey.elapsedTicks} из ${journey.totalTicks}.`;
  }
  // A blocked journey names its own obstacle: the pressure is the
  // standing block, never "the path continues".
  if (journey.status === "blocked") {
    return journey.text.trim().length > 0 ? journey.text : null;
  }
  const description = clean(input.situation?.description ?? null) ?? "";
  const lowered = description.toLowerCase();
  if (lowered.includes("закрыта") || lowered.includes("высокая вода") || lowered.includes("поднялась")) {
    return description || null;
  }
  if (lowered.includes("трудна") || lowered.includes("медленн")) {
    return description || null;
  }
  const first = input.recentConsequences[0];
  if (first) {
    const detail = clean(first.detail ?? null);
    return detail ? `${first.label}: ${detail}` : first.label;
  }
  return null;
}

/**
 * Derives one concrete opportunity from observer-safe affordances already
 * named by the caller (contact, route or item prose). The caller composes
 * the line; this helper only enforces the "at most one honest line" shape
 * so the director cannot stack invented options. Pure and total.
 */
export function rhythmOpportunity(candidate: string | null | undefined): string | null {
  return clean(candidate);
}

/**
 * Derives the price of inaction. Only a closed crossing or an interrupted
 * journey honestly implies one; otherwise null instead of a threat.
 * Pure and total.
 */
export function rhythmInactionCost(input: Pick<SceneRhythmInput, "situation" | "journey">): string | null {
  if (input.journey.status === "interrupted") {
    return "Путь прерван: дальше без нового решения не пройти.";
  }
  const description = clean(input.situation?.description ?? null) ?? "";
  const lowered = description.toLowerCase();
  if (lowered.includes("закрыта")) {
    return "Пока переправа закрыта, прямой путь остаётся недоступен.";
  }
  return null;
}

/**
 * Builds the full scene rhythm. Pure and total: the same inputs always
 * yield the same rhythm, and no field invents entities, routes or threats.
 */
export function buildSceneRhythm(input: SceneRhythmInput & { readonly opportunityCandidate?: string | null | undefined }): SceneRhythm {
  return freeze({
    question: rhythmQuestion(input),
    pressure: rhythmPressure(input),
    opportunity: rhythmOpportunity(input.opportunityCandidate ?? null),
    inactionCost: rhythmInactionCost(input),
    changeAfterActions: clean(input.lastOutcome ?? null),
    completionCondition: rhythmCompletion(input),
  });
}

/**
 * Derives the observable completion condition: arrival for a journey,
 * resolution of the pending question, evidence for a situation — never a
 * hidden flag. Pure and total.
 */
export function rhythmCompletion(
  input: Pick<SceneRhythmInput, "situation" | "journey" | "pendingQuestion">,
): string | null {
  if (input.journey.status === "traveling" && input.journey.to) {
    return `Прибытие к «${input.journey.to}» закроет этот переход.`;
  }
  if (input.journey.status === "completed" && input.journey.to) {
    return `Путь к «${input.journey.to}» завершён.`;
  }
  if (input.journey.status === "blocked") {
    return "Когда путь откроется или найдётся обход, переход завершится.";
  }
  const pending = clean(input.pendingQuestion ?? null);
  if (pending) return "Ответ на открытый вопрос мастера закроет эту сцену.";
  if (input.situation) return "Выбор пути, свидетельство или причина изменения течения закроют эту сцену.";
  return null;
}
