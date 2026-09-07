/**
 * Unified Master response composer (ADR-0028, plan_6 Stage 10).
 *
 * A deterministic composer over already-validated, already-executed turn
 * parts: it assembles one player-facing answer and never invents facts.
 * For mixed turns the order is fixed: what happened, what is now
 * visible/known, which part stays undone. LLM narration may later rephrase
 * the assembled response, but it may not select facts, importance or
 * actions. Persistence mapping of the new response kinds belongs to the
 * persistence stage.
 */

import type { DeferredClause, TurnKind } from "../runtime/master-turn-validator.js";

/** Player-facing clarification option carried into the response. */
export interface MasterTurnResponseOption {
  readonly optionId: string;
  readonly label: string;
}

/** Validated prose parts of one turn. Prose arrives pre-built; the composer only orders and joins it. */
export interface MasterTurnResponseInput {
  readonly kind: TurnKind;
  /** Primary outcome prose with its rejection flag; null when nothing executed. */
  readonly actionPresentation: { readonly text: string; readonly rejected: boolean } | null;
  /** Post-action answer prose; null when the turn asks nothing. */
  readonly inquiryAnswer: { readonly text: string } | null;
  /** Speech reaction prose for speech turns; null otherwise. */
  readonly speechReaction: { readonly text: string } | null;
  /** Runtime-supplied meta answer prose; null when unavailable. */
  readonly metaAnswer: { readonly text: string } | null;
  readonly deferredClauses: readonly DeferredClause[];
  readonly clarification: { readonly question: string; readonly options: readonly MasterTurnResponseOption[] } | null;
}

/** Unified response kinds. Persistence mapping arrives with the persistence stage. */
export type MasterTurnResponseKind =
  | "action_outcome"
  | "inquiry_answer"
  | "speech_reaction"
  | "mixed_outcome"
  | "meta_answer"
  | "clarification";

/** One unified Master answer. */
export interface MasterTurnResponse {
  readonly kind: MasterTurnResponseKind;
  readonly text: string;
  readonly options: readonly MasterTurnResponseOption[];
  /** True when forbidden internals were scrubbed from the assembled text. */
  readonly sanitized: boolean;
}

/**
 * Interpreter-internal markers that must never reach the player. Matched
 * case-insensitively against Latin identifiers and the one known technical
 * phrase; ordinary Russian prose cannot trigger them.
 */
const FORBIDDEN_MARKERS: readonly string[] = [
  "unknown",
  "confidence",
  "observerref",
  "observer_ref",
  "additionalclauses",
  "одна цель и одно действие",
  "entityid",
  "eventid",
  "sourceeventids",
  "turnproposal",
  "intentproposal",
  "schema",
  "schemaversion",
  "validateactionproposal",
  "intentgateway",
];

const SANITIZED_FALLBACK = "Не удалось собрать ответ Мастера. Уточни намерение.";

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function scrub(text: string): { readonly text: string; readonly sanitized: boolean } {
  const lowered = text.toLowerCase();
  if (FORBIDDEN_MARKERS.some((marker) => lowered.includes(marker))) {
    return { text: SANITIZED_FALLBACK, sanitized: true };
  }
  return { text, sanitized: false };
}

function joinProse(parts: readonly (string | null | undefined)[]): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join(" ");
}

function clarificationResponse(
  clarification: NonNullable<MasterTurnResponseInput["clarification"]>,
): MasterTurnResponse {
  const scrubbed = scrub(clarification.question);
  return freeze({
    kind: "clarification" as const,
    text: scrubbed.sanitized ? SANITIZED_FALLBACK : clarification.question,
    options: clarification.options,
    sanitized: scrubbed.sanitized,
  });
}

function deferredNote(deferred: readonly DeferredClause[]): string | null {
  if (deferred.length === 0) return null;
  return `Пока осталось невыполненным: ${deferred.map((clause) => clause.text).join("; ")}.`;
}

/**
 * Composes one unified Master answer from validated parts. Total: never
 * throws and never leaks interpreter internals; missing parts fall back to
 * a safe clarification instead of an empty answer.
 */
export function composeMasterTurnResponse(input: MasterTurnResponseInput): MasterTurnResponse {
  if (input.clarification && !input.actionPresentation && !input.inquiryAnswer && !input.speechReaction && !input.metaAnswer) {
    return clarificationResponse(input.clarification);
  }

  switch (input.kind) {
    case "inquiry": {
      if (!input.inquiryAnswer) return clarificationResponse(fallbackClarification());
      const scrubbed = scrub(input.inquiryAnswer.text);
      return freeze({
        kind: "inquiry_answer" as const,
        text: scrubbed.sanitized ? SANITIZED_FALLBACK : input.inquiryAnswer.text,
        options: freeze([]),
        sanitized: scrubbed.sanitized,
      });
    }
    case "speech": {
      if (!input.speechReaction) return clarificationResponse(fallbackClarification());
      const scrubbed = scrub(input.speechReaction.text);
      return freeze({
        kind: "speech_reaction" as const,
        text: scrubbed.sanitized ? SANITIZED_FALLBACK : input.speechReaction.text,
        options: freeze([]),
        sanitized: scrubbed.sanitized,
      });
    }
    case "meta": {
      if (!input.metaAnswer) return clarificationResponse(fallbackClarification());
      const scrubbed = scrub(input.metaAnswer.text);
      return freeze({
        kind: "meta_answer" as const,
        text: scrubbed.sanitized ? SANITIZED_FALLBACK : input.metaAnswer.text,
        options: freeze([]),
        sanitized: scrubbed.sanitized,
      });
    }
    case "mixed": {
      const text = joinProse([
        input.actionPresentation?.text ?? null,
        input.inquiryAnswer?.text ?? null,
        deferredNote(input.deferredClauses),
      ]);
      if (!text) return clarificationResponse(fallbackClarification());
      const scrubbed = scrub(text);
      return freeze({
        kind: "mixed_outcome" as const,
        text: scrubbed.sanitized ? SANITIZED_FALLBACK : text,
        options: freeze([]),
        sanitized: scrubbed.sanitized,
      });
    }
    case "action":
    default: {
      if (!input.actionPresentation) return clarificationResponse(fallbackClarification());
      const scrubbed = scrub(input.actionPresentation.text);
      return freeze({
        kind: "action_outcome" as const,
        text: scrubbed.sanitized ? SANITIZED_FALLBACK : input.actionPresentation.text,
        options: freeze([]),
        sanitized: scrubbed.sanitized,
      });
    }
  }
}

function fallbackClarification(): NonNullable<MasterTurnResponseInput["clarification"]> {
  return freeze({
    question: "Не удалось собрать ответ. Уточни, чего ты хочешь добиться.",
    options: freeze([{ optionId: "rephrase", label: "Уточнить намерение" }]),
  });
}
