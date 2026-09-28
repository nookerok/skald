/**
 * `AllowedNarrativeFacts` — the closed contract handed to the master for answer
 * composition (ADR-0037).
 *
 * The master may select, group and order THESE facts to answer the current
 * replica. It cannot add facts, change their availability, provenance or
 * epistemic class. The set is bounded and every entry carries a turn-local
 * reference; internal ids, Event ids, Canon and provenance never leave the
 * server. Building is a pure read-side operation: no Domain Events, no world
 * writes.
 */

import type { NarrativeAdapterContext, NarrativeFact, NarrativeFactEpistemicClass, NarrativeFactSource } from "./setup/background-context.js";
import type { AnswerPlan } from "./read-side/answer-plan.js";

/** Where an allowed fact came from. */
export type AllowedFactProvenance = "observation" | "testimony" | "background" | "hypothesis";

/** How the master is allowed to assert a fact. */
export type AllowedFactAssertion = "established" | "observed" | "told" | "inferred";

/** Temporal membership of a fact within the current turn. */
export type AllowedFactTemporal = "now" | "earlier" | "memory";

/** One element the master may use in the answer. `ref` is turn-local. */
export interface AllowedNarrativeFact {
  readonly ref: string;
  readonly content: string;
  readonly provenance: AllowedFactProvenance;
  readonly assertion: AllowedFactAssertion;
  readonly temporal: AllowedFactTemporal;
  readonly available: boolean;
}

/** The complete, bounded allowed set for one turn's answer composition. */
export interface AllowedNarrativeFacts {
  readonly question: string | null;
  readonly facts: readonly AllowedNarrativeFact[];
  readonly mandatory: readonly string[];
  readonly continuations: readonly string[];
  readonly gaps: readonly string[];
  /**
   * False when a RESERVED description — a mandatory world result or a
   * question-part fact — did not fit {@link ALLOWED_NARRATIVE_FACTS_MAX}.
   * This is the explicit incomplete-coverage signal (plan §6): overflow of
   * useful context is silent, overflow of a needed description never is.
   */
  readonly coverageComplete: boolean;
}

/** Hard bound on the allowed set so the prompt stays bounded. */
export const ALLOWED_NARRATIVE_FACTS_MAX = 24;

/** Maximum characters kept per allowed fact. */
export const ALLOWED_NARRATIVE_FACT_MAX_CHARS = 400;

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/gu, " ");
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function provenanceOf(fact: NarrativeFact): AllowedFactProvenance {
  const source: NarrativeFactSource = fact.source;
  // A hypothesis stays a hypothesis even when the underlying evidence was observed.
  if (fact.epistemicClass === "inference" || fact.epistemicClass === "interpretation") return "hypothesis";
  if (fact.epistemicClass === "testimony" || source === "testimony") return "testimony";
  if (source === "background" || source === "entrypoint") return "background";
  return "observation";
}

function assertionOf(epistemicClass: NarrativeFactEpistemicClass): AllowedFactAssertion {
  switch (epistemicClass) {
    case "established_fact": return "established";
    case "observed_fact": return "observed";
    case "testimony": return "told";
    case "inference":
    case "interpretation":
    default:
      return "inferred";
  }
}

function temporalOf(fact: NarrativeFact): AllowedFactTemporal {
  return fact.usableNow === false ? "memory" : "now";
}

function toAllowed(fact: NarrativeFact, ref: string): AllowedNarrativeFact {
  return freeze({
    ref,
    content: truncate(fact.text, ALLOWED_NARRATIVE_FACT_MAX_CHARS),
    provenance: provenanceOf(fact),
    assertion: assertionOf(fact.epistemicClass),
    temporal: temporalOf(fact),
    available: true,
  });
}

/** One additional allowed fact the caller already cleared for the player. */
export interface AllowedNarrativeExtraFact {
  readonly content: string;
  readonly provenance: AllowedFactProvenance;
  readonly assertion: AllowedFactAssertion;
  readonly temporal?: AllowedFactTemporal | undefined;
}

/** Input for the closed allowed set: an existing read-side context and the turn's mandatory results. */
export interface AllowedNarrativeFactsInput {
  readonly question?: string | null | undefined;
  readonly context?: NarrativeAdapterContext | null | undefined;
  /** Extra facts from the scene/conversation the caller already cleared. */
  readonly extraFacts?: readonly AllowedNarrativeExtraFact[] | undefined;
  /** Mandatory results of this turn (e.g. "путь заблокирован"). */
  readonly mandatory?: readonly string[] | undefined;
  /** Allowed continuations (existing affordances, routes, contacts). */
  readonly continuations?: readonly string[] | undefined;
  /** Explicit gaps in the available data. */
  readonly gaps?: readonly string[] | undefined;
  /** Question part → facts → coverage plan (semantic-question-plan T4). */
  readonly answerPlan?: AnswerPlan | null | undefined;
}

/**
 * Builds the bounded allowed set from the existing read-side context (plan
 * §6, coverage-first selection):
 *
 * 1. facts whose content equals a mandatory result (world results, or the
 *    legacy mandatory answer) — a needed line must never overflow away;
 * 2. every question-part fact of the {@link AnswerPlan} — the description
 *    the replica asked for, reserved before useful context;
 * 3. context groups in their existing order;
 * 4. the remaining extra facts (deterministic fallback formulation,
 *    portraits).
 *
 * Overflow of a RESERVED description sets `coverageComplete` false instead
 * of silently dropping it; overflow of context stays silent. Each fact gets
 * a turn-local `fN` reference; internal ids and source event ids are dropped.
 * Pure and total.
 */
export function buildAllowedNarrativeFacts(input: AllowedNarrativeFactsInput = {}): AllowedNarrativeFacts {
  const context = input.context ?? null;
  const answerPlan = input.answerPlan ?? null;
  // Background facts are derived from character + arrival, mirroring
  // `contextFacts` so the set reuses the existing read-side source.
  const backgroundFacts: readonly NarrativeFact[] = context
    ? ([
      { id: "background:title", text: context.character.backgroundTitle, epistemicClass: "established_fact", source: "background", usableNow: true },
      { id: "background:role", text: context.character.formerRole, epistemicClass: "established_fact", source: "background", usableNow: true },
      { id: "background:rupture", text: context.character.rupture, epistemicClass: "established_fact", source: "background", usableNow: true },
      { id: "background:obligation", text: context.character.obligation, epistemicClass: "established_fact", source: "background", usableNow: true },
      { id: "arrival:reason", text: context.arrival.reason, epistemicClass: "established_fact", source: "entrypoint", usableNow: true },
      { id: "arrival:hook", text: context.arrival.personalHook, epistemicClass: "established_fact", source: "entrypoint", usableNow: true },
    ] as NarrativeFact[])
    : [];
  const groups: readonly (readonly NarrativeFact[])[] = context
    ? [
      backgroundFacts,
      context.visibleSituation?.facts ?? [],
      context.visibleSituation?.sensoryContext ?? [],
      context.accessibleItems ?? [],
      context.contacts ?? [],
      context.knowledge?.testimony ?? [],
      context.knowledge?.observed ?? [],
      context.knowledge?.hypotheses ?? [],
      context.unresolvedSituation ?? [],
    ]
    : [];

  const clean = (lines: readonly string[] | undefined): readonly string[] =>
    freeze((lines ?? []).map((line) => truncate(line, ALLOWED_NARRATIVE_FACT_MAX_CHARS)).filter((line) => line.length > 0));
  const mandatory = clean(input.mandatory);
  const mandatorySet = new Set(mandatory);

  const facts: AllowedNarrativeFact[] = [];
  let index = 0;
  let reservedDropped = false;
  const reserve = (build: () => AllowedNarrativeFact): void => {
    if (facts.length >= ALLOWED_NARRATIVE_FACTS_MAX) {
      reservedDropped = true;
      return;
    }
    index += 1;
    facts.push(build());
  };
  const tryAppend = (build: () => AllowedNarrativeFact): void => {
    if (facts.length >= ALLOWED_NARRATIVE_FACTS_MAX) return;
    index += 1;
    facts.push(build());
  };

  // 1. Mandatory results first: a fact carrying a mandatory line is selected,
  //    never overflowed away (the answer paragraph of the legacy path lives
  //    here too when it is still mandatory).
  const priorityExtras: AllowedNarrativeExtraFact[] = [];
  const deferredExtras: AllowedNarrativeExtraFact[] = [];
  for (const extra of input.extraFacts ?? []) {
    const content = truncate(extra.content, ALLOWED_NARRATIVE_FACT_MAX_CHARS);
    if (content.length === 0) continue;
    const entry: AllowedNarrativeExtraFact = { ...extra, content };
    if (mandatorySet.has(content)) priorityExtras.push(entry);
    else deferredExtras.push(entry);
  }
  for (const extra of priorityExtras) {
    reserve(() => freeze({
      ref: `f${index}`,
      content: extra.content,
      provenance: extra.provenance,
      assertion: extra.assertion,
      temporal: extra.temporal ?? "now",
      available: true,
    }));
  }

  // 2. Every question-part fact, in plan order — the needed description.
  if (answerPlan) {
    for (const part of answerPlan.parts) {
      for (const fact of part.facts) {
        const content = truncate(fact.content, ALLOWED_NARRATIVE_FACT_MAX_CHARS);
        if (content.length === 0) continue;
        reserve(() => freeze({
          ref: `f${index}`,
          content,
          provenance: fact.provenance,
          assertion: fact.assertion,
          temporal: fact.temporal,
          available: fact.available,
        }));
      }
    }
  }

  // 3. Useful context in the existing group order (silent overflow).
  for (const group of groups) {
    for (const fact of group) {
      if (facts.length >= ALLOWED_NARRATIVE_FACTS_MAX) break;
      if (typeof fact?.text !== "string" || fact.text.trim().length === 0) continue;
      tryAppend(() => toAllowed(fact, `f${index}`));
    }
    if (facts.length >= ALLOWED_NARRATIVE_FACTS_MAX) break;
  }

  // 4. Remaining extras: the deterministic fallback formulation, portraits.
  for (const extra of deferredExtras) {
    tryAppend(() => freeze({
      ref: `f${index}`,
      content: extra.content,
      provenance: extra.provenance,
      assertion: extra.assertion,
      temporal: extra.temporal ?? "now",
      available: true,
    }));
  }

  const planGaps = answerPlan
    ? answerPlan.parts.map((part) => part.gapStatement).filter((entry): entry is string => entry !== null)
    : [];
  const gaps = Array.from(new Set([...clean(input.gaps), ...clean(planGaps)]));
  const question = typeof input.question === "string" && input.question.trim().length > 0 ? truncate(input.question, ALLOWED_NARRATIVE_FACT_MAX_CHARS) : null;

  return freeze({
    question,
    facts: freeze(facts),
    mandatory,
    continuations: clean(input.continuations),
    gaps: freeze(gaps),
    coverageComplete: !reservedDropped,
  });
}

/** Input for {@link buildAnswerPlanAllowedFacts}: the read-side context plus the turn's answer split. */
export interface AnswerPlanAllowedFactsInput {
  readonly question?: string | null | undefined;
  readonly context?: NarrativeAdapterContext | null | undefined;
  /**
   * Deterministic answer for this replica. With an {@link AnswerPlan} it is a
   * full fallback formulation from the SAME facts and is NOT mandatory; the
   * legacy no-plan path keeps it mandatory (ADR-0037).
   */
  readonly answer: string;
  /** World results of this turn (refusal, partial success, consequence). */
  readonly worldResults?: readonly string[] | undefined;
  readonly answerPlan?: AnswerPlan | null | undefined;
  /** Portrait facts already cleared for the player. */
  readonly portraitFacts?: readonly AllowedNarrativeExtraFact[] | undefined;
  readonly continuations?: readonly string[] | undefined;
  readonly gaps?: readonly string[] | undefined;
}

/**
 * Builds the allowed set for a read-side inquiry answer with the T4
 * mandatory split:
 *
 * - world results of the turn stay mandatory (and enter as facts so the
 *   composer can cite them);
 * - with an {@link AnswerPlan}, every covered part's facts become mandatory
 *   and are reserved in the set;
 * - the deterministic answer paragraph is only the fallback formulation —
 *   a paragraph chosen by an old inquiry is no longer a mandatory fact;
 * - without a plan the legacy contract stands: answer mandatory.
 *
 * Gap statements of the plan join `gaps`, so the composer may state missing
 * data exactly as the plan does. Pure.
 */
export function buildAnswerPlanAllowedFacts(input: AnswerPlanAllowedFactsInput): AllowedNarrativeFacts {
  const plan = input.answerPlan ?? null;
  const cleanLine = (line: string): string => truncate(line.trim().replace(/\s+/gu, " "), ALLOWED_NARRATIVE_FACT_MAX_CHARS);
  const answer = input.answer.trim().length > 0 ? cleanLine(input.answer) : "";
  // Explicit turn results win; otherwise the plan carries the world results
  // it was assembled from (one source of truth, not two).
  const worldResults = (input.worldResults ?? plan?.worldResults ?? []).map(cleanLine).filter((line) => line.length > 0);

  const mandatory = plan
    ? [...worldResults, ...plan.parts.flatMap((part) => part.facts.map((fact) => cleanLine(fact.content)))]
    : [...worldResults, ...(answer.length > 0 ? [answer] : [])];

  const worldResultFacts: readonly AllowedNarrativeExtraFact[] = worldResults.map((content) => ({
    content,
    provenance: "observation" as const,
    assertion: "observed" as const,
  }));
  const answerExtra: readonly AllowedNarrativeExtraFact[] = answer.length > 0
    ? [{ content: answer, provenance: "observation", assertion: "observed" }]
    : [];

  return buildAllowedNarrativeFacts({
    question: input.question,
    context: input.context,
    mandatory,
    extraFacts: [...worldResultFacts, ...answerExtra, ...(input.portraitFacts ?? [])],
    ...(plan ? { answerPlan: plan } : {}),
    continuations: input.continuations,
    gaps: input.gaps,
  });
}
