/**
 * Classified clarification reasons (plan_9 §2).
 *
 * A closed set of internal causes for asking the player instead of acting.
 * Every reason maps to a contextual generator that names the conflicting
 * entities or actions; the reason code itself never reaches the UI. Pure
 * strings only: no world access, no events, no randomness.
 *
 * Reason ownership across the pipeline:
 * - missing_referent: pronoun with no candidates, stale observerRef,
 *   malformed or absent action target.
 * - multiple_referents: ambiguous pronouns, ambiguous preflight targets,
 *   ambiguous journey destinations.
 * - unclear_primary_action: topic without an action, unknown verb/operation.
 * - unclear_destination: journey destination missing or unknown.
 * - conflicting_actions: compound replicas (deterministic or structural).
 * - unsafe_combination: verb/target combination the valency forbids.
 * - unknown_observed_target: a named target outside observer scope.
 */

import type { ProposalValidationReason } from "./types.js";
import type { ClarificationOption } from "./intent-proposal.js";

/** Closed internal cause for a clarification question. Never player-facing. */
export type ClarificationReason =
  | "missing_referent"
  | "multiple_referents"
  | "unclear_primary_action"
  | "unclear_destination"
  | "conflicting_actions"
  | "unsafe_combination"
  | "unknown_observed_target";

export interface ClassifiedClarification {
  readonly reason: ClarificationReason;
  readonly question: string;
  readonly options: readonly ClarificationOption[];
}

/**
 * Last-resort wordings: emitted only when no classified generator applies.
 * Every emission is an interpretation defect and must be diagnosed as such.
 * Covered by isGenericFallbackText and the mixed-corpus acceptance gate.
 */
export const GENERIC_FALLBACK_TEXTS: readonly string[] = [
  "Я не уверен, что правильно понял. Скажи, чего ты хочешь добиться первым.",
  "Я не уверен, что правильно понял действие. Скажи, что ты хочешь сделать в первую очередь.",
  "Я не уверен, что правильно понял это намерение. Скажи, чего ты хочешь добиться первым.",
];

function normalizeQuestion(text: string): string {
  return text.trim().toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
}

/** True for a last-resort wording carrying no entities, actions or options. */
export function isGenericFallbackText(text: string): boolean {
  const normalized = normalizeQuestion(text);
  return GENERIC_FALLBACK_TEXTS.some((generic) => normalizeQuestion(generic) === normalized);
}

function rephraseOption(): readonly [ClarificationOption] {
  return [{ optionId: "rephrase", label: "Уточнить намерение" }];
}

/** 2+ candidates: name them all (at most three). */
export function multipleReferents(
  labels: readonly string[],
  personOnly: boolean,
): ClassifiedClarification {
  const named = labels.slice(0, 3);
  return Object.freeze({
    reason: "multiple_referents" as const,
    question: personOnly
      ? `К кому именно — ${named.join(" или ")}?`
      : `Кого или что именно — ${named.join(" или ")}?`,
    options: rephraseOption(),
  });
}

/** Non-person ambiguous candidates keep their own wording. */
export function multipleThings(labels: readonly string[]): ClassifiedClarification {
  const named = labels.slice(0, 3);
  return Object.freeze({
    reason: "multiple_referents" as const,
    question: `Что именно — ${named.join(" или ")}?`,
    options: rephraseOption(),
  });
}

/** Named referent is gone or was never observed; a known mention softens it. */
export function missingReferent(input: {
  readonly kind: "person" | "thing" | "topic" | "place" | "either";
  readonly mention?: string | undefined;
}): ClassifiedClarification {
  const question = input.kind === "topic"
    ? input.mention
      ? `«${input.mention}» сейчас не о чем спросить. Что именно ты имеешь в виду?`
      : "Что именно ты имеешь в виду? Назови тему явно."
    : input.kind === "place"
      ? "Куда именно? Назови направление или место."
      : input.mention
        ? `«${input.mention}» сейчас нет рядом. Кого ты имеешь в виду? Назови явно.`
        : input.kind === "person"
          ? "Кого ты имеешь в виду? Назови, к кому обратиться."
          : input.kind === "thing"
            ? "Что именно ты имеешь в виду? Назови объект."
            : "Кого или что ты имеешь в виду? Назови явно.";
  return Object.freeze({ reason: "missing_referent" as const, question, options: rephraseOption() });
}

/** The referent is known but the action is not: name it and ask. */
export function unclearPrimaryAction(input: {
  readonly surface: string;
  readonly speak: boolean;
}): ClassifiedClarification {
  return Object.freeze({
    reason: "unclear_primary_action" as const,
    question: input.speak
      ? `У кого спросить про «${input.surface}»? Назови, к кому обратиться.`
      : `«${input.surface}» — что именно ты хочешь сделать?`,
    options: rephraseOption(),
  });
}

/** Journey destination missing: ask for it, never invent one. */
export function unclearDestination(): ClassifiedClarification {
  return Object.freeze({
    reason: "unclear_destination" as const,
    question: "Куда ты хочешь направиться? Назови место или направление.",
    options: rephraseOption(),
  });
}

/**
 * Compound replica: one slot, several actions. The interpretations name the
 * parts so nothing understood is lost silently; the model or the player
 * picks the order through the normal mixed/clarification path.
 */
export function conflictingActions(actions: readonly string[]): ClassifiedClarification {
  return Object.freeze({
    reason: "conflicting_actions" as const,
    question: "Что именно ты хочешь сделать?",
    options: actions.length > 0
      ? actions.slice(0, 3).map((label, index) => ({ optionId: `deterministic-${index + 1}`, label }))
      : rephraseOption(),
  });
}

/** Verb/target combination the valency forbids: name the verb. */
export function unsafeCombination(action: string): ClassifiedClarification {
  return Object.freeze({
    reason: "unsafe_combination" as const,
    question: `Действие «${action}» не требует указания предмета.`,
    options: rephraseOption(),
  });
}

/** Named target outside observer scope: quote it back, offer a rephrase. */
export function unknownObservedTarget(target: string): ClassifiedClarification {
  return Object.freeze({
    reason: "unknown_observed_target" as const,
    question: `Я не нахожу «${target}» среди того, что тебе доступно сейчас. Что именно ты хочешь сделать?`,
    options: [{ optionId: "rephrase", label: "Уточнить цель" }],
  });
}

/**
 * Maps a structural validation reason onto the clarification taxonomy.
 * Structural texts stay where they are; this documents which generator
 * owns each reason. A missing journey destination is unclear_destination;
 * a missing action target is missing_referent.
 */
export function classifyStructuralReason(reason: ProposalValidationReason, isJourney = false): ClarificationReason {
  switch (reason) {
    case "missing_target": return isJourney ? "unclear_destination" : "missing_referent";
    case "malformed_target": return "missing_referent";
    case "multiple_actions": return "conflicting_actions";
    case "unexpected_target": return "unsafe_combination";
    case "unsupported_structure": return "unclear_primary_action";
  }
}
