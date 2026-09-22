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
import { ensureGameMomentum } from "@skald/world";

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
  /** Post-action answer prose in proposal order; empty when the turn asks nothing. */
  readonly inquiryAnswers: readonly { readonly text: string }[];
  /** Speech reaction prose for speech turns; null otherwise. */
  readonly speechReaction: { readonly text: string } | null;
  /** Runtime-supplied meta answer prose; null when unavailable. */
  readonly metaAnswer: { readonly text: string } | null;
  readonly deferredClauses: readonly DeferredClause[];
  readonly clarification: { readonly question: string; readonly options: readonly MasterTurnResponseOption[] } | null;
  /**
   * Observer-safe continuation line (plan_9 §10 fourth part). When present
   * and the assembled answer does not already move the game (no question,
   * no next step), it is appended as the final line. Absent by default so
   * legacy callers keep byte-identical output.
   */
  readonly continuationHint?: string | null | undefined;
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

const SANITIZED_FALLBACK = "Мастер не расслышал намерение. Скажи иначе, что ты хочешь сделать.";

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

/**
 * Collapses exact-duplicate sentences (case/ё/whitespace-normalized) while
 * preserving order. A mixed turn's parts legitimately overlap — an ambient
 * observe outcome and the `visible_scene` answer are both the location line —
 * and repeating a sentence back-to-back reads as a defect to the player.
 */
function dedupeSentences(text: string): string {
  const sentences = text.split(/(?<=[.!?…])\s+/u).map((part) => part.trim()).filter((part) => part.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sentence of sentences) {
    const key = sentence.toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sentence);
  }
  return out.join(" ");
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
 * Appends the observer-safe continuation hint when the assembled answer
 * does not already move the game. Clarification turns never reach here:
 * their question is the momentum. Pure and total.
 */
function applyMomentum(text: string, input: MasterTurnResponseInput): string {
  const hint = input.continuationHint?.trim() ? input.continuationHint!.trim() : null;
  if (!hint) return text;
  return ensureGameMomentum(text, hint);
}

/**
 * Composes one unified Master answer from validated parts. Total: never
 * throws and never leaks interpreter internals; missing parts fall back to
 * a safe clarification instead of an empty answer.
 */
export function composeMasterTurnResponse(input: MasterTurnResponseInput): MasterTurnResponse {
  if (input.clarification && !input.actionPresentation && input.inquiryAnswers.length === 0 && !input.speechReaction && !input.metaAnswer) {
    return clarificationResponse(input.clarification);
  }

  switch (input.kind) {
    case "inquiry": {
      if (input.inquiryAnswers.length === 0) return clarificationResponse(fallbackClarification());
      const text = dedupeSentences(joinProse(input.inquiryAnswers.map((answer) => answer.text)));
      if (!text) return clarificationResponse(fallbackClarification());
      const moved = applyMomentum(text, input);
      const scrubbed = scrub(moved);
      return freeze({
        kind: "inquiry_answer" as const,
        text: scrubbed.sanitized ? SANITIZED_FALLBACK : moved,
        options: freeze([]),
        sanitized: scrubbed.sanitized,
      });
    }
    case "speech": {
      if (!input.speechReaction) return clarificationResponse(fallbackClarification());
      const moved = applyMomentum(input.speechReaction.text, input);
      const scrubbed = scrub(moved);
      return freeze({
        kind: "speech_reaction" as const,
        text: scrubbed.sanitized ? SANITIZED_FALLBACK : moved,
        options: freeze([]),
        sanitized: scrubbed.sanitized,
      });
    }
    case "meta": {
      if (!input.metaAnswer) return clarificationResponse(fallbackClarification());
      const moved = applyMomentum(input.metaAnswer.text, input);
      const scrubbed = scrub(moved);
      return freeze({
        kind: "meta_answer" as const,
        text: scrubbed.sanitized ? SANITIZED_FALLBACK : moved,
        options: freeze([]),
        sanitized: scrubbed.sanitized,
      });
    }
    case "mixed": {
      const text = dedupeSentences(joinProse([
        input.actionPresentation?.text ?? null,
        ...input.inquiryAnswers.map((answer) => answer.text),
        deferredNote(input.deferredClauses),
      ]));
      if (!text) return clarificationResponse(fallbackClarification());
      const moved = applyMomentum(text, input);
      const scrubbed = scrub(moved);
      return freeze({
        kind: "mixed_outcome" as const,
        text: scrubbed.sanitized ? SANITIZED_FALLBACK : moved,
        options: freeze([]),
        sanitized: scrubbed.sanitized,
      });
    }
    case "action":
    default: {
      if (!input.actionPresentation) return clarificationResponse(fallbackClarification());
      const moved = applyMomentum(input.actionPresentation.text, input);
      const scrubbed = scrub(moved);
      return freeze({
        kind: "action_outcome" as const,
        text: scrubbed.sanitized ? SANITIZED_FALLBACK : moved,
        options: freeze([]),
        sanitized: scrubbed.sanitized,
      });
    }
  }
}

function fallbackClarification(): NonNullable<MasterTurnResponseInput["clarification"]> {
  return freeze({
    question: "Мастер не понял намерение. Скажи иначе, чего ты хочешь добиться.",
    options: freeze([{ optionId: "rephrase", label: "Уточнить намерение" }]),
  });
}
