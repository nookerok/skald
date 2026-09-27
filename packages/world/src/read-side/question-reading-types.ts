/**
 * Typed result carriers for semantic question readings
 * (semantic-question-plan T2; ADR-0028/0037 amendments 2026-09-27).
 *
 * One reading answers one `ReadingRequest` (a declared part plus a closed
 * catalog source) against server-chosen context. The result carries:
 * available facts with provenance, allowed assertion, temporal membership
 * and availability SET INDEPENDENTLY (ADR-0037 amendment), plus explicit
 * gaps. Hidden data is never distinguished from ordinary absence: a denied
 * read produces `no_data` exactly like an empty one, and no gap reason
 * reveals that a secret exists.
 */

import type {
  QuestionAspect,
  QuestionPart,
  QuestionTimeScope,
  ReadingRequest,
  ReadingResultStatus,
} from "@skald/intent-parser";
import type { NarrativeFactEpistemicClass } from "../setup/background-context.js";

/**
 * One available fact cleared for a question part.
 *
 * - `subjectId` pins which declared subject the fact describes, so two
 *   portraits never mix (ADR-0037 amendment, provenance);
 * - `aspects` is the set of question aspects this fact may serve —
 *   coverage is part → facts by subject + aspect, never by prose;
 * - `epistemicClass` is the allowed assertion mode;
 * - `temporal` is when the described content belongs to — independent of
 *   `usableNow`, which only says the fact may be recalled NOW;
 * - `source` is the reading adapter that produced it.
 */
export interface QuestionReadingFact {
  /** Stable within the reading: `source:subjectId:local` — never an entity id. */
  readonly factId: string;
  readonly text: string;
  readonly subjectId: string;
  readonly aspects: readonly QuestionAspect[];
  readonly epistemicClass: NarrativeFactEpistemicClass;
  readonly temporal: QuestionTimeScope;
  readonly usableNow: boolean;
  readonly source: ReadingRequest["source"];
}

/** Why a requested part (or subject) produced no facts. */
export type QuestionReadingGapStatus = Extract<
  ReadingResultStatus,
  "no_data" | "ambiguous_subject" | "failed"
>;

/**
 * An explicit coverage gap. `no_data` covers BOTH empty and denied reads —
 * a secret is never announced. `surface` echoes the player's own wording
 * (safe for a narrow clarification); `aspect` names the uncovered
 * aspect of the part when known.
 */
export interface QuestionReadingGap {
  readonly partId: string;
  readonly status: QuestionReadingGapStatus;
  readonly subjectId?: string;
  readonly surface?: string;
  readonly aspect?: QuestionAspect;
}

/**
 * Result of ONE reading request. `status` is `available` when at least one
 * fact was produced, otherwise the gap status (a contract violation by the
 * caller surfaces as `failed`, never as facts).
 */
export interface QuestionReadingResult {
  readonly request: ReadingRequest;
  readonly status: ReadingResultStatus;
  readonly facts: readonly QuestionReadingFact[];
  readonly gaps: readonly QuestionReadingGap[];
}

/**
 * Minimal transcript slice the CLI injects for the `conversation_topics`
 * source (plan §4): role-tagged text only — no ids, no pending
 * clarifications, no world state. The CLI owns the real transcript.
 */
export interface ReadingTranscriptEntry {
  readonly role: "player" | "master";
  readonly text: string;
}

/**
 * Part ids whose subject+aspect pair is served by at least one fact across
 * all reading results — the mechanical half of coverage (plan §6). A part
 * remains uncovered when its aspect produced nothing, which is exactly the
 * signal the AnswerPlan turns into an explicit gap statement.
 */
export function coveredPartsOf(
  results: readonly QuestionReadingResult[],
  parts: readonly QuestionPart[],
): ReadonlySet<string> {
  const facts = results.flatMap((result) => result.facts);
  const covered = new Set<string>();
  for (const part of parts) {
    const hit = facts.some((fact) =>
      part.subjectRefs.includes(fact.subjectId) && fact.aspects.includes(part.aspect));
    if (hit) covered.add(part.id);
  }
  return covered;
}
