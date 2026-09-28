/**
 * `AnswerPlan` — the small server-side plan between the bounded reading round
 * and the answer/composer layers (semantic-question-plan T4; ADR-0037
 * amendment 2026-09-27).
 *
 * One question part maps to its reading facts, an explicit coverage state and
 * — when the part produced no usable data — an allowed gap statement. Missing
 * data is ALWAYS stated as missing; a gap part never contributes an assertive
 * sentence, so absence cannot invert into an assertion. Exactly one ambiguous
 * part yields ONE narrow clarification instead of a fabricated answer; every
 * other uncovered part stays an honest gap. Pure and total: no Domain Events,
 * no world writes, no randomness.
 */

import type {
  QuestionAspect,
  QuestionPart,
} from "@skald/intent-parser";
import type {
  AllowedFactAssertion,
  AllowedFactProvenance,
  AllowedFactTemporal,
} from "../allowed-narrative-facts.js";
import type {
  QuestionReadingFact,
  QuestionReadingGapStatus,
  QuestionReadingResult,
} from "./question-reading-types.js";
import type { QuestionReadingRound } from "./question-round.js";

/**
 * Coverage of one question part in the answer plan.
 *
 * - `covered` — at least one reading fact matches the part's subjects and
 *   aspect, so the answer may assert from those facts;
 * - `gap` — no usable data: the part carries an allowed gap statement (or,
 *   for a single ambiguous part, the narrow clarification) instead.
 */
export type QuestionPartCoverage = "covered" | "gap";

/** One reading fact promoted into the answer plan, cleared for composition. */
export interface AnswerPlanFact {
  readonly content: string;
  readonly provenance: AllowedFactProvenance;
  readonly assertion: AllowedFactAssertion;
  readonly temporal: AllowedFactTemporal;
  readonly available: boolean;
}

/** One question part's answer-plan entry. */
export interface AnswerPlanPart {
  readonly partId: string;
  readonly aspect: QuestionAspect;
  readonly coverage: QuestionPartCoverage;
  /** Facts for a covered part; empty for a gap part (never guessed). */
  readonly facts: readonly AnswerPlanFact[];
  /** Allowed gap statement for a gap part; null for a covered part. */
  readonly gapStatement: string | null;
  /** Raw reading gap status behind a gap part; null for a covered part. */
  readonly gapStatus: QuestionReadingGapStatus | null;
}

/**
 * Deterministic answer assembly for one replica's question plan: per-part
 * statements, mandatory world results and — only when exactly one part is
 * ambiguous — the single narrow clarification. The deterministic answer built
 * from `statements` already covers every part; composer prose replaces the
 * same bubble afterwards and is checked against these lines.
 */
export interface AnswerPlan {
  readonly parts: readonly AnswerPlanPart[];
  /** World results of THIS turn (refusal, partial success, consequence). */
  readonly worldResults: readonly string[];
  /** Deterministic per-part statements in plan order (covered facts + gaps). */
  readonly statements: readonly string[];
  /** True when every part of the plan is covered by reading facts. */
  readonly allCovered: boolean;
  /** Exactly one ambiguous part → one narrow question; otherwise null. */
  readonly narrowClarification: string | null;
}

/**
 * Allowed gap statement for a part with no usable data. The wording is the
 * plan's closed template (plan §6): missing stays missing, never inverted
 * into an assertion.
 */
export const ANSWER_GAP_STATEMENT = "По доступным наблюдениям пока нельзя понять.";

function cleanLines(lines: readonly string[] | undefined): readonly string[] {
  return Object.freeze((lines ?? [])
    .map((line) => line.trim().replace(/\s+/gu, " "))
    .filter((line) => line.length > 0));
}

function provenanceOf(fact: QuestionReadingFact): AllowedFactProvenance {
  if (fact.epistemicClass === "inference" || fact.epistemicClass === "interpretation") return "hypothesis";
  if (fact.epistemicClass === "testimony") return "testimony";
  return "observation";
}

function assertionOf(fact: QuestionReadingFact): AllowedFactAssertion {
  switch (fact.epistemicClass) {
    case "established_fact": return "established";
    case "observed_fact": return "observed";
    case "testimony": return "told";
    case "inference":
    case "interpretation":
    default:
      return "inferred";
  }
}

function temporalOf(fact: QuestionReadingFact): AllowedFactTemporal {
  if (fact.temporal === "past") return "earlier";
  if (fact.temporal === "current") return "now";
  // TODO(semantic-question-plan): `unspecified` has no slot in the closed
  // AllowedFactTemporal (now|earlier|memory). Mapped conservatively to
  // `earlier` so an unknown time is never asserted as present; extend the
  // vocabulary with an explicit unknown only through an ADR amendment.
  return "earlier";
}

function toAnswerFact(fact: QuestionReadingFact): AnswerPlanFact {
  return Object.freeze({
    content: fact.text.trim(),
    provenance: provenanceOf(fact),
    assertion: assertionOf(fact),
    temporal: temporalOf(fact),
    available: fact.usableNow,
  });
}

/** True when a reading fact serves the part's subjects AND its aspect. */
function factServesPart(fact: QuestionReadingFact, part: QuestionPart): boolean {
  return part.subjectRefs.includes(fact.subjectId) && fact.aspects.includes(part.aspect);
}

/**
 * Narrow clarification for exactly ONE ambiguous part. It echoes the player's
 * own surface wording (gap `surface` is the player's text — never a hidden
 * candidate), so the question can be answered from the replica alone.
 */
function narrowClarificationFor(surface: string | undefined): string {
  const cleaned = (surface ?? "").trim();
  return cleaned.length > 0
    ? `Что именно ты имеешь в виду — «${cleaned}»?`
    : "Что именно ты имеешь в виду?";
}

/**
 * Builds the deterministic answer plan from the bounded reading round.
 *
 * - Facts are re-filtered to each part's subjects + aspect, so two subjects
 *   of the same aspect never mix inside one part;
 * - A gap part yields the closed gap statement (or, for exactly one
 *   ambiguous part across the plan, contributes the single narrow
 *   clarification instead of statements);
 * - `worldResults` are carried verbatim for the mandatory split.
 *
 * With no round (offline or a plan without readings) the result is an empty,
 * vacuously complete plan.
 */
export function buildAnswerPlan(input: {
  readonly readings?: QuestionReadingRound | null | undefined;
  readonly worldResults?: readonly string[] | undefined;
}): AnswerPlan {
  const worldResults = cleanLines(input.worldResults);
  const round = input.readings ?? null;
  if (!round) {
    return Object.freeze({
      parts: Object.freeze([]),
      worldResults,
      statements: Object.freeze([]),
      allCovered: true,
      narrowClarification: null,
    });
  }

  const partResults = new Map<string, QuestionReadingResult[]>();
  for (const result of round.results) {
    const bucket = partResults.get(result.request.partId);
    if (bucket) bucket.push(result);
    else partResults.set(result.request.partId, [result]);
  }

  const parts: AnswerPlanPart[] = [];
  const ambiguousGaps: { readonly partId: string; readonly surface: string | undefined }[] = [];

  for (const part of round.questionPlan.parts) {
    const results = partResults.get(part.id) ?? [];
    const facts = results
      .flatMap((result) => result.facts)
      .filter((fact) => factServesPart(fact, part))
      .map(toAnswerFact)
      .filter((fact) => fact.content.length > 0);

    if (facts.length > 0) {
      parts.push(Object.freeze({
        partId: part.id,
        aspect: part.aspect,
        coverage: "covered" as const,
        facts: Object.freeze(facts),
        gapStatement: null,
        gapStatus: null,
      }));
      continue;
    }

    const gap = results.flatMap((result) => result.gaps).find((entry) => entry.partId === part.id) ?? null;
    const gapStatus = gap?.status ?? "no_data";
    parts.push(Object.freeze({
      partId: part.id,
      aspect: part.aspect,
      coverage: "gap" as const,
      facts: Object.freeze([]),
      gapStatement: ANSWER_GAP_STATEMENT,
      gapStatus,
    }));
    if (gapStatus === "ambiguous_subject") ambiguousGaps.push({ partId: part.id, surface: gap?.surface });
  }

  // Exactly ONE ambiguous part → answer the rest and ask one narrow
  // clarification; the ambiguous part contributes neither facts nor a gap
  // assertion, so the deterministic answer never guesses. Several ambiguous
  // parts leave no narrow question to ask — every gap stays an explicit
  // statement.
  const narrowClarification = ambiguousGaps.length === 1
    ? narrowClarificationFor(ambiguousGaps[0]!.surface)
    : null;
  const deferredPartId = ambiguousGaps.length === 1 ? ambiguousGaps[0]!.partId : null;

  const statements: string[] = [];
  for (const part of parts) {
    if (part.partId === deferredPartId) continue;
    if (part.coverage === "covered") {
      for (const fact of part.facts) statements.push(fact.content);
    } else {
      statements.push(ANSWER_GAP_STATEMENT);
    }
  }

  return Object.freeze({
    parts: Object.freeze(parts),
    worldResults,
    statements: Object.freeze(statements),
    allCovered: parts.every((part) => part.coverage === "covered"),
    narrowClarification,
  });
}
