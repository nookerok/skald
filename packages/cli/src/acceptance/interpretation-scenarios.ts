/**
 * Sequential interpretation scenarios (full-master Stage 1).
 *
 * Some replicas can only be judged in context: a pronoun needs a confirmed
 * mention, a journey continuation needs an active journey, presence needs the
 * player to have moved. Each scenario runs its steps in ONE scratch world
 * through the real command path, so turns persist with their metadata and the
 * next step sees honest context.
 *
 * Pure classification/evaluation here; the caller owns the runtime and router.
 */

import { isGenericFallbackText } from "@skald/intent-parser";
import type { CorpusEvaluation, InterpretationObservation, PrimaryClass, ReplyClass } from "./interpretation-corpus.js";

/** One ordered replica inside a scenario. */
export interface ScenarioStep {
  readonly input: string;
  readonly expect: readonly ReplyClass[];
  readonly primary?: readonly PrimaryClass[];
  readonly queryId?: string;
  readonly note?: string;
}

/** A short conversation run in one world. */
export interface Scenario {
  readonly id: string;
  readonly description: string;
  readonly steps: readonly ScenarioStep[];
}

/** Sequential cases that need prior state to be judged honestly. */
export const INTERPRETATION_SCENARIOS: readonly Scenario[] = [
  {
    id: "pronoun-reference",
    description: "A confirmed mention binds the following pronoun.",
    steps: [
      { input: "осматриваю ограду", expect: ["action"], primary: ["action"] },
      { input: "осмотрю её внимательнее", expect: ["action"], primary: ["action"] },
    ],
  },
  {
    id: "journey-continuation",
    description: "A started journey is continued by a natural phrase.",
    steps: [
      { input: "иду к Речному Стражу", expect: ["action"], primary: ["action"] },
      { input: "продолжаю путь", expect: ["action"], primary: ["action"] },
    ],
  },
  {
    id: "topic-continuation",
    description: "A question about a known subject keeps its topic.",
    steps: [
      { input: "кто рядом?", expect: ["inquiry"], primary: ["inquiry"], queryId: "who_is_nearby" },
      { input: "а что за ним?", expect: ["inquiry", "clarification"], primary: ["inquiry"] },
    ],
  },
];

/**
 * Classifies a `handleWorldCommand` HTTP-shaped body into an observation.
 * Pure and total; never throws.
 */
export function classifyHttpResponse(body: unknown): InterpretationObservation {
  const response = (body ?? {}) as Record<string, unknown>;
  const status = typeof response.status === "string" ? response.status : "unknown";
  const turn = (response.conversationTurn ?? {}) as Record<string, unknown>;
  const responseKind = typeof turn.responseKind === "string" ? turn.responseKind : null;
  const genericFallback = status === "clarification" && typeof response.question === "string" && isGenericFallbackText(response.question);
  if (status === "clarification") return { status, kind: "clarification", primary: null, queryId: null, genericFallback };
  if (status === "inquiry") {
    const inquiry = (response.inquiry ?? {}) as Record<string, unknown>;
    return { status, kind: "inquiry", primary: "inquiry", queryId: typeof inquiry.queryId === "string" ? inquiry.queryId : null, genericFallback };
  }
  if (status === "meta") return { status, kind: "meta", primary: "meta", queryId: null, genericFallback };
  const kind: ReplyClass = responseKind === "mixed_outcome" ? "mixed" : responseKind === "speech_reaction" ? "speech" : "action";
  return { status, kind, primary: "action", queryId: null, genericFallback };
}

/** Scores one scenario step. Reuses the corpus evaluation rules. */
export function evaluateScenarioStep(step: ScenarioStep, observation: InterpretationObservation): CorpusEvaluation {
  const fail = (reason: string): CorpusEvaluation => ({ input: step.input, ok: false, actual: observation.kind, reason });
  if (observation.genericFallback) return fail("generic_clarification");
  if (!step.expect.includes(observation.kind as ReplyClass)) return fail(`expected ${step.expect.join("|")} got ${observation.kind}`);
  const executes = observation.kind === "action" || observation.kind === "inquiry" || observation.kind === "speech" || observation.kind === "mixed" || observation.kind === "meta";
  if (step.primary && executes && (!observation.primary || !step.primary.includes(observation.primary))) {
    return fail(`primary ${observation.primary ?? "none"} not in ${step.primary.join("|")}`);
  }
  if (step.queryId && observation.kind === "inquiry" && observation.queryId !== step.queryId) {
    return fail(`query ${observation.queryId ?? "none"} != ${step.queryId}`);
  }
  return { input: step.input, ok: true, actual: observation.kind, reason: null };
}
