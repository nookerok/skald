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

/** Input for the closed allowed set: an existing read-side context and the turn's mandatory results. */
export interface AllowedNarrativeFactsInput {
  readonly question?: string | null | undefined;
  readonly context?: NarrativeAdapterContext | null | undefined;
  /** Mandatory results of this turn (e.g. "путь заблокирован"). */
  readonly mandatory?: readonly string[] | undefined;
  /** Allowed continuations (existing affordances, routes, contacts). */
  readonly continuations?: readonly string[] | undefined;
  /** Explicit gaps in the available data. */
  readonly gaps?: readonly string[] | undefined;
}

/**
 * Builds the bounded allowed set from the existing read-side context. Facts are
 * ordered by group; each gets a turn-local `fN` reference. Internal ids and
 * source event ids are dropped. Pure and total.
 */
export function buildAllowedNarrativeFacts(input: AllowedNarrativeFactsInput = {}): AllowedNarrativeFacts {
  const context = input.context ?? null;
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

  const facts: AllowedNarrativeFact[] = [];
  let index = 0;
  for (const group of groups) {
    for (const fact of group) {
      if (facts.length >= ALLOWED_NARRATIVE_FACTS_MAX) break;
      if (typeof fact?.text !== "string" || fact.text.trim().length === 0) continue;
      index += 1;
      facts.push(toAllowed(fact, `f${index}`));
    }
    if (facts.length >= ALLOWED_NARRATIVE_FACTS_MAX) break;
  }

  const clean = (lines: readonly string[] | undefined): readonly string[] =>
    freeze((lines ?? []).map((line) => truncate(line, ALLOWED_NARRATIVE_FACT_MAX_CHARS)).filter((line) => line.length > 0));
  const question = typeof input.question === "string" && input.question.trim().length > 0 ? truncate(input.question, ALLOWED_NARRATIVE_FACT_MAX_CHARS) : null;

  return freeze({
    question,
    facts: freeze(facts),
    mandatory: clean(input.mandatory),
    continuations: clean(input.continuations),
    gaps: clean(input.gaps),
  });
}
