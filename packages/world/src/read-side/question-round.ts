/**
 * One bounded reading round for a semantic question plan
 * (semantic-question-plan T3; ADR-0028/0037 amendments 2026-09-27).
 *
 * The server executes every model-proposed `ReadingRequest` EXACTLY once
 * against ONE consistent `QuestionReadingContext` built from a single
 * snapshot (scene + narrative + transcript all from the same read). There
 * is no re-request loop: when the round is exhausted, parts nothing served
 * simply stay outside `coveredParts`, which is the explicit
 * incomplete-coverage signal the answer assembly turns into a concrete gap
 * statement (plan §5, §6). Limits (≤3 requests, ≤4 parts) are enforced by
 * the static proposal validator before the round ever runs.
 *
 * Pure read-side orchestration: no Domain Events, no Rules, no persistence.
 */

import type {
  ProposedQuestionPlan,
  QuestionPlan,
  ReadingRequest,
} from "@skald/intent-parser";
import type { MasterTurnSceneSnapshot } from "../master-turn/observer-context.js";
import type { NarrativeAdapterContext } from "../setup/background-context.js";
import {
  coveredPartsOf,
  type QuestionReadingResult,
  type ReadingTranscriptEntry,
} from "./question-reading-types.js";
import { executeQuestionReading } from "./question-readings.js";

/** Event-log position of one snapshot: what a round actually read. */
export interface QuestionRoundRevision {
  readonly worldTime: number;
  readonly eventNumber: number;
}

/**
 * Server-built round specification carried from interpretation to the
 * answer-time snapshot. Built by the gateway from a validated proposal:
 * bindings are server-side, never model output.
 */
export interface QuestionRoundSpec {
  /** Validated plan with resolved subject bindings and the mirrored action. */
  readonly questionPlan: QuestionPlan;
  /** Model-proposed requests from the closed catalog (≤3, static-checked). */
  readonly readings: readonly ReadingRequest[];
  /** Revision of the interpretation snapshot the plan was built against. */
  readonly interpretationRevision: QuestionRoundRevision;
}

/** Snapshot inputs the round reads; all fields come from ONE queue entry. */
export interface QuestionRoundContext {
  readonly scene: MasterTurnSceneSnapshot;
  readonly revision: QuestionRoundRevision;
  readonly narrative: NarrativeAdapterContext | null;
  readonly transcript: readonly ReadingTranscriptEntry[] | null;
}

/** Result of one executed round. */
export interface QuestionReadingRound {
  readonly revision: QuestionRoundRevision;
  readonly questionPlan: QuestionPlan;
  readonly results: readonly QuestionReadingResult[];
  /** Part ids served by at least one fact (subject + aspect), sorted. */
  readonly coveredParts: readonly string[];
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

/**
 * Executes ONE reading round: every request exactly once, one shared
 * context, frozen output tagged with the revision actually read. Callers
 * must not invoke this in a loop — exhaustion is a result, not a retry.
 */
export function executeQuestionReadingRound(
  spec: QuestionRoundSpec,
  context: QuestionRoundContext,
): QuestionReadingRound {
  const plan: ProposedQuestionPlan = freeze({
    subjects: spec.questionPlan.subjects.map((binding) => binding.subject),
    parts: spec.questionPlan.parts,
  });
  const readingContext = freeze({
    plan,
    bindings: spec.questionPlan.subjects,
    scene: context.scene,
    narrative: context.narrative,
    transcript: context.transcript,
  });
  const results = spec.readings.map((request) => executeQuestionReading(request, readingContext));
  const covered = [...coveredPartsOf(results, plan.parts)].sort();
  return freeze({
    revision: freeze({ ...context.revision }),
    questionPlan: spec.questionPlan,
    results: freeze(results),
    coveredParts: freeze(covered),
  });
}
