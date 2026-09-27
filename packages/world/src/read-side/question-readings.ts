/**
 * Bounded question readings (semantic-question-plan T2).
 *
 * The closed seven-source catalog from plan §4, implemented as adapters
 * over existing observer-safe builders. ONE `executeQuestionReading` entry
 * validates the request server-side and dispatches; the model never
 * chooses a world, observer, event range or table — the context below is
 * built by the gateway from the current snapshot only.
 *
 * Rules enforced here:
 * - request validation: declared part exists, bindings cover its subjects,
 *   source is the closed catalog (statically) — violations produce `failed`
 *   gaps, never facts;
 * - subject resolution: `ambiguous` → `ambiguous_subject`, `absent` or a
 *   stale scene ref → `no_data` (the subject stays talkable as a memory;
 *   this layer only reports it cannot be described NOW);
 * - hidden data: nothing here can observe a secret, so a denied or empty
 *   read is the same `no_data` and no gap reason leaks existence;
 * - coverage: returned facts are filtered to the requested part's aspect;
 *   an aspect no source can serve yields an explicit gap (e.g. a portrait
 *   read cannot answer `observed_reaction` — the data is simply absent).
 *
 * Pure and read-only: no Domain Events, no Projection writes, no network.
 */

import { sameRussianStem, type ProposedQuestionPlan, type QuestionAspect, type QuestionSubject, type ReadingRequest, type SubjectBinding } from "@skald/intent-parser";
import type { MasterTurnSceneSnapshot } from "../master-turn/observer-context.js";
import type { NarrativeAdapterContext, NarrativeFact } from "../setup/background-context.js";
import {
  type QuestionReadingFact,
  type QuestionReadingGap,
  type QuestionReadingGapStatus,
  type QuestionReadingResult,
  type ReadingTranscriptEntry,
} from "./question-reading-types.js";

/**
 * Server-chosen context for readings. Built by the gateway from ONE
 * consistent snapshot; the model only ever names `partId`+`source`.
 */
export interface QuestionReadingContext {
  /** The validated model-declared plan (subjects + parts). */
  readonly plan: ProposedQuestionPlan;
  /** Gateway-resolved subject bindings for this snapshot. */
  readonly bindings: readonly SubjectBinding[];
  /** Observer-safe scene snapshot (the bounded world slice). */
  readonly scene: MasterTurnSceneSnapshot;
  /** Background/arrival/knowledge context; null when unavailable. */
  readonly narrative: NarrativeAdapterContext | null;
  /** Transcript slice for `conversation_topics`; null when unavailable. */
  readonly transcript: readonly ReadingTranscriptEntry[] | null;
}

export type {
  QuestionReadingFact,
  QuestionReadingGap,
  QuestionReadingGapStatus,
  QuestionReadingResult,
  ReadingTranscriptEntry,
};
export { coveredPartsOf } from "./question-reading-types.js";

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

interface AdapterOutcome {
  readonly facts: readonly QuestionReadingFact[];
  readonly gaps: readonly QuestionReadingGap[];
}

interface ResolvedSubject {
  readonly subject: QuestionSubject;
  /** Settled transient scene handle (entity/topic/place/ordinal), or null. */
  readonly ref: string | null;
}

function words(value: string): readonly string[] {
  return value
    .toLowerCase()
    .replace(/ё/gu, "е")
    .split(/[^a-zа-я0-9]+/iu)
    .filter((word) => word.length >= 3);
}

/**
 * Content-word stem overlap between a fact text and the subject surface —
 * the honest-link filter for text-shaped sources (knowledge, relations,
 * inventory, transcript). Pure.
 */
function textMentions(text: string, surface: string): boolean {
  const textWords = new Set(words(text));
  if (textWords.size === 0) return false;
  for (const surfaceWord of words(surface)) {
    for (const textWord of textWords) {
      if (sameRussianStem(surfaceWord, textWord)) return true;
    }
  }
  return false;
}

function fact(
  source: ReadingRequest["source"],
  subjectId: string,
  local: string,
  text: string,
  aspects: readonly QuestionAspect[],
  epistemicClass: QuestionReadingFact["epistemicClass"],
  temporal: QuestionReadingFact["temporal"],
  usableNow = true,
): QuestionReadingFact {
  return freeze({
    factId: `${source}:${subjectId}:${local}`,
    text,
    subjectId,
    aspects: freeze([...aspects]),
    epistemicClass,
    temporal,
    usableNow,
    source,
  });
}

function narrativeFact(
  source: ReadingRequest["source"],
  subjectId: string,
  local: string,
  entry: NarrativeFact,
  aspects: readonly QuestionAspect[],
  temporal: QuestionReadingFact["temporal"],
): QuestionReadingFact {
  return fact(source, subjectId, local, entry.text, aspects, entry.epistemicClass, temporal, entry.usableNow);
}

function uniqueTexts(facts: readonly QuestionReadingFact[]): readonly QuestionReadingFact[] {
  const seen = new Set<string>();
  return facts.filter((entry) => {
    const key = entry.text.replace(/\s+/gu, " ").trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function gap(
  partId: string,
  status: QuestionReadingGapStatus,
  extra?: { subjectId?: string; surface?: string; aspect?: QuestionAspect },
): QuestionReadingGap {
  return freeze({
    partId,
    status,
    ...(extra?.subjectId !== undefined ? { subjectId: extra.subjectId } : {}),
    ...(extra?.surface !== undefined ? { surface: extra.surface } : {}),
    ...(extra?.aspect !== undefined ? { aspect: extra.aspect } : {}),
  });
}

/** Scene person entry lookup by transient handle. */
function personByRef(context: QuestionReadingContext, ref: string | null): (typeof context.scene.context.knownPeople)[number] | null {
  if (!ref) return null;
  return context.scene.context.knownPeople.find((person) => person.observerRef === ref) ?? null;
}

/** Scene item lookup by transient handle (object_N namespace). */
function itemByRef(context: QuestionReadingContext, ref: string | null): (typeof context.scene.context.accessibleItems)[number] | null {
  if (!ref) return null;
  return context.scene.context.accessibleItems.find((item) => item.observerRef === ref) ?? null;
}

function routeStatusWord(status: "open" | "difficult" | "closed" | undefined): string {
  if (status === "open") return "возможен";
  if (status === "difficult") return "затруднён";
  return "закрыт";
}

// ── The seven adapters ───────────────────────────────────────────────

/** `scene`: location, presence, observed conditions, known routes. */
function sceneAdapter(subjects: readonly ResolvedSubject[], part: ProposedQuestionPlan["parts"][number], context: QuestionReadingContext): AdapterOutcome {
  const facts: QuestionReadingFact[] = [];
  const gaps: QuestionReadingGap[] = [];
  const location = context.scene.context.currentLocation;
  const situation = context.scene.context.currentSituation;
  for (const target of subjects) {
    const { subject } = target;
    const selfOrPlace = subject.kind === "place" || subject.kind === "self";
    if (selfOrPlace) {
      facts.push(fact("scene", subject.id, "location", `${location.name}: ${location.description}`,
        ["identity_role", "current_activity"], "observed_fact", "current"));
      if (situation) {
        facts.push(fact("scene", subject.id, "situation", `${situation.title}. ${situation.description}`,
          ["current_activity"], "observed_fact", "current"));
      }
      for (const route of context.scene.context.knownRoutes) {
        facts.push(fact("scene", subject.id, `route:${route.observerRef}`,
          `Проход к «${route.label}»: ${routeStatusWord(route.status)}`,
          ["continuation_way"], "observed_fact", "current"));
      }
      const narrative = context.narrative;
      if (narrative) {
        for (const [index, entry] of narrative.visibleSituation.sensoryContext.entries()) {
          facts.push(narrativeFact("scene", subject.id, `sensory:${index}`, entry, ["current_activity"], "current"));
        }
        for (const [index, entry] of narrative.visibleSituation.facts.entries()) {
          facts.push(narrativeFact("scene", subject.id, `situation:${index}`, entry, ["current_activity", "identity_role"], "current"));
        }
      }
      continue;
    }
    // entity / ordinal / group: presence of the ones actually in scene.
    const refs = subject.kind === "group" && subject.members
      ? [...subject.members]
      : [target.ref];
    let found = 0;
    for (const ref of refs) {
      const person = personByRef(context, ref);
      if (!person) continue;
      found += 1;
      facts.push(fact("scene", subject.id, `present:${ref ?? "x"}`,
        `${person.label} здесь`, ["current_activity", "identity_role"], "observed_fact", "current"));
    }
    if (found === 0) {
      gaps.push(gap(part.id, "no_data", { subjectId: subject.id, surface: subject.surface, aspect: part.aspect }));
    }
  }
  return { facts: uniqueTexts(facts), gaps };
}

/** `person`: observer-safe portrait, role, known name. Reaction has no source. */
function personAdapter(subjects: readonly ResolvedSubject[], part: ProposedQuestionPlan["parts"][number], context: QuestionReadingContext): AdapterOutcome {
  const facts: QuestionReadingFact[] = [];
  const gaps: QuestionReadingGap[] = [];
  for (const target of subjects) {
    const { subject } = target;
    if (subject.kind !== "entity" && subject.kind !== "ordinal" && subject.kind !== "group") {
      gaps.push(gap(part.id, "no_data", { subjectId: subject.id, surface: subject.surface, aspect: part.aspect }));
      continue;
    }
    const refs = subject.kind === "group" && subject.members
      ? [...subject.members]
      : [target.ref];
    let found = 0;
    for (const ref of refs) {
      const person = personByRef(context, ref);
      if (!person) continue;
      found += 1;
      if (person.known && person.knownAs.length > 0) {
        facts.push(fact("person", subject.id, `name:${ref ?? "x"}`, person.knownAs.join(", "),
          ["identity_role"], "established_fact", "current"));
      }
      if (!person.known && person.label) {
        facts.push(fact("person", subject.id, `unknown:${ref ?? "x"}`, person.label,
          ["identity_role"], "observed_fact", "current"));
      }
      const portrait = person.portrait;
      if (portrait) {
        portrait.visibleAppearance.forEach((line, index) => {
          facts.push(fact("person", subject.id, `appearance:${ref ?? "x"}:${index}`, line,
            ["appearance"], "observed_fact", "current"));
        });
        portrait.distinguishingFeatures.forEach((line, index) => {
          facts.push(fact("person", subject.id, `feature:${ref ?? "x"}:${index}`, line,
            ["appearance"], "observed_fact", "current"));
        });
        if (portrait.publicRole) {
          facts.push(fact("person", subject.id, `role:${ref ?? "x"}`, portrait.publicRole,
            ["identity_role"], "observed_fact", "current"));
        }
      }
    }
    if (found === 0) {
      gaps.push(gap(part.id, "no_data", { subjectId: subject.id, surface: subject.surface, aspect: part.aspect }));
    }
  }
  // observed_reaction has no observer-safe source today: the aspect filter
  // above already yields an explicit no_data gap when that is the part.
  return { facts: uniqueTexts(facts), gaps };
}

/** `background_arrival`: the hero's backstory, arrival reason and former role. */
function backgroundArrivalAdapter(subjects: readonly ResolvedSubject[], part: ProposedQuestionPlan["parts"][number], context: QuestionReadingContext): AdapterOutcome {
  const narrative = context.narrative;
  const facts: QuestionReadingFact[] = [];
  const gaps: QuestionReadingGap[] = [];
  for (const target of subjects) {
    const { subject } = target;
    if (subject.kind !== "self") {
      gaps.push(gap(part.id, "no_data", { subjectId: subject.id, surface: subject.surface, aspect: part.aspect }));
      continue;
    }
    if (!narrative) continue;
    const { arrival, character } = narrative;
    facts.push(fact("background_arrival", subject.id, "reason", arrival.reason,
      ["background_arrival"], "established_fact", "past"));
    facts.push(fact("background_arrival", subject.id, "hook", arrival.personalHook,
      ["background_arrival"], "established_fact", "past"));
    facts.push(fact("background_arrival", subject.id, "from", arrival.startingLocation,
      ["background_arrival"], "established_fact", "past"));
    facts.push(fact("background_arrival", subject.id, "former-role", character.formerRole,
      ["identity_role"], "established_fact", "past"));
    facts.push(fact("background_arrival", subject.id, "rupture", character.rupture,
      ["identity_role", "background_arrival"], "established_fact", "past"));
    facts.push(fact("background_arrival", subject.id, "title", character.backgroundTitle,
      ["identity_role"], "established_fact", "past"));
  }
  if (facts.length === 0 && gaps.length === 0) {
    gaps.push(gap(part.id, "no_data", { aspect: part.aspect }));
  }
  return { facts, gaps };
}

/** `known_events`: player-known propositions with their epistemic class. */
function knownEventsAdapter(subjects: readonly ResolvedSubject[], part: ProposedQuestionPlan["parts"][number], context: QuestionReadingContext): AdapterOutcome {
  const narrative = context.narrative;
  if (!narrative) {
    return { facts: [], gaps: [gap(part.id, "no_data", { aspect: part.aspect })] };
  }
  const entries: readonly { readonly entry: NarrativeFact; readonly local: string }[] = [
    ...narrative.knowledge.observed.map((entry, index) => ({ entry, local: `observed:${index}` })),
    ...narrative.knowledge.testimony.map((entry, index) => ({ entry, local: `testimony:${index}` })),
    ...narrative.knowledge.hypotheses.map((entry, index) => ({ entry, local: `hypothesis:${index}` })),
  ];
  const facts: QuestionReadingFact[] = [];
  const gaps: QuestionReadingGap[] = [];
  for (const target of subjects) {
    const { subject } = target;
    const universal = subject.kind === "self" || subject.kind === "place";
    let matched = 0;
    for (const { entry, local } of entries) {
      if (!universal && !textMentions(entry.text, subject.surface)) continue;
      matched += 1;
      facts.push(narrativeFact("known_events", subject.id, `${subject.id}:${local}`, entry, ["known_event"], "unspecified"));
    }
    if (matched === 0) {
      gaps.push(gap(part.id, "no_data", { subjectId: subject.id, surface: subject.surface, aspect: part.aspect }));
    }
  }
  return { facts: uniqueTexts(facts), gaps };
}

/** `relations`: acquaintance, known obligation, link history. */
function relationsAdapter(subjects: readonly ResolvedSubject[], part: ProposedQuestionPlan["parts"][number], context: QuestionReadingContext): AdapterOutcome {
  const narrative = context.narrative;
  if (!narrative) {
    return { facts: [], gaps: [gap(part.id, "no_data", { aspect: part.aspect })] };
  }
  const facts: QuestionReadingFact[] = [];
  const gaps: QuestionReadingGap[] = [];
  for (const target of subjects) {
    const { subject } = target;
    const self = subject.kind === "self";
    let matched = 0;
    for (const [index, entry] of narrative.contacts.entries()) {
      if (!self && !textMentions(entry.text, subject.surface)) continue;
      matched += 1;
      facts.push(narrativeFact("relations", subject.id, `contact:${index}`, entry, ["acquaintance_link"], "current"));
    }
    if (self) {
      facts.push(fact("relations", subject.id, "obligation", narrative.character.obligation,
        ["acquaintance_link"], "established_fact", "current"));
      matched += 1;
    }
    if (matched === 0) {
      gaps.push(gap(part.id, "no_data", { subjectId: subject.id, surface: subject.surface, aspect: part.aspect }));
    }
  }
  return { facts: uniqueTexts(facts), gaps };
}

/** `items`: accessible items with observable affordances; inventory for self. */
function itemsAdapter(subjects: readonly ResolvedSubject[], part: ProposedQuestionPlan["parts"][number], context: QuestionReadingContext): AdapterOutcome {
  const facts: QuestionReadingFact[] = [];
  const gaps: QuestionReadingGap[] = [];
  for (const target of subjects) {
    const { subject } = target;
    if (subject.kind === "self") {
      const inventory = context.narrative?.accessibleItems ?? [];
      inventory.forEach((entry, index) => {
        facts.push(narrativeFact("items", subject.id, `own:${index}`, entry, ["item_properties"], "current"));
      });
      if (inventory.length === 0) {
        gaps.push(gap(part.id, "no_data", { subjectId: subject.id, surface: subject.surface, aspect: part.aspect }));
      }
      continue;
    }
    const refs = subject.kind === "group" && subject.members
      ? [...subject.members]
      : [target.ref];
    let matched = 0;
    for (const ref of refs) {
      const item = itemByRef(context, ref);
      if (!item) continue;
      matched += 1;
      const suffix = item.affordances.length > 0 ? `: ${item.affordances.join(", ")}` : "";
      facts.push(fact("items", subject.id, `item:${ref ?? "x"}`, `${item.label}${suffix}`,
        ["item_properties"], "observed_fact", "current"));
    }
    if (matched === 0) {
      for (const [index, entry] of (context.narrative?.accessibleItems ?? []).entries()) {
        if (!textMentions(entry.text, subject.surface)) continue;
        matched += 1;
        facts.push(narrativeFact("items", subject.id, `inv:${subject.id}:${index}`, entry, ["item_properties"], "current"));
      }
    }
    if (matched === 0) {
      gaps.push(gap(part.id, "no_data", { subjectId: subject.id, surface: subject.surface, aspect: part.aspect }));
    }
  }
  return { facts: uniqueTexts(facts), gaps };
}

/** `conversation_topics`: transcript entries the subject took part in. */
function conversationTopicsAdapter(subjects: readonly ResolvedSubject[], part: ProposedQuestionPlan["parts"][number], context: QuestionReadingContext): AdapterOutcome {
  const transcript = context.transcript;
  if (!transcript || transcript.length === 0) {
    return { facts: [], gaps: [gap(part.id, "no_data", { aspect: part.aspect })] };
  }
  const facts: QuestionReadingFact[] = [];
  const gaps: QuestionReadingGap[] = [];
  for (const target of subjects) {
    const { subject } = target;
    const universal = subject.kind === "self" || subject.kind === "place";
    let matched = 0;
    transcript.forEach((entry, index) => {
      if (!universal && !textMentions(entry.text, subject.surface)) return;
      matched += 1;
      facts.push(fact("conversation_topics", subject.id, `${subject.id}:${entry.role}:${index}`,
        entry.text, ["conversation_topic"], "established_fact", "past"));
    });
    if (matched === 0) {
      gaps.push(gap(part.id, "no_data", { subjectId: subject.id, surface: subject.surface, aspect: part.aspect }));
    }
  }
  return { facts: uniqueTexts(facts), gaps };
}

// ── Engine ───────────────────────────────────────────────────────────

type ReadingAdapter = (
  subjects: readonly ResolvedSubject[],
  part: ProposedQuestionPlan["parts"][number],
  context: QuestionReadingContext,
) => AdapterOutcome;

const ADAPTERS: Readonly<Record<ReadingRequest["source"], ReadingAdapter>> = Object.freeze({
  scene: sceneAdapter,
  person: personAdapter,
  background_arrival: backgroundArrivalAdapter,
  known_events: knownEventsAdapter,
  relations: relationsAdapter,
  items: itemsAdapter,
  conversation_topics: conversationTopicsAdapter,
});

function result(
  request: ReadingRequest,
  facts: readonly QuestionReadingFact[],
  gaps: readonly QuestionReadingGap[],
): QuestionReadingResult {
  const status = facts.length > 0 ? "available" as const : (gaps[0]?.status ?? "no_data");
  return freeze({ request, status, facts: freeze([...facts]), gaps: freeze([...gaps]) });
}

/**
 * Executes ONE validated reading request against server context. Returns
 * facts filtered to the requested part's aspect plus explicit gaps; a
 * contract violation (unknown part, missing binding) is a `failed` gap,
 * never a throw and never facts. Pure.
 */
export function executeQuestionReading(
  request: ReadingRequest,
  context: QuestionReadingContext,
): QuestionReadingResult {
  const part = context.plan.parts.find((entry) => entry.id === request.partId);
  if (!part) {
    return result(request, [], [gap(request.partId, "failed")]);
  }
  const bindings = new Map(context.bindings.map((binding) => [binding.subject.id, binding]));
  const subjects: ResolvedSubject[] = [];
  const subjectGaps: QuestionReadingGap[] = [];
  for (const subjectRef of part.subjectRefs) {
    const subject = context.plan.subjects.find((entry) => entry.id === subjectRef);
    const binding = bindings.get(subjectRef);
    if (!subject || !binding) {
      return result(request, [], [gap(part.id, "failed", { subjectId: subjectRef, aspect: part.aspect })]);
    }
    if (binding.resolution === "ambiguous") {
      subjectGaps.push(gap(part.id, "ambiguous_subject", { subjectId: subject.id, surface: subject.surface, aspect: part.aspect }));
      continue;
    }
    if (binding.resolution === "absent") {
      subjectGaps.push(gap(part.id, "no_data", { subjectId: subject.id, surface: subject.surface, aspect: part.aspect }));
      continue;
    }
    subjects.push({ subject, ref: binding.resolvedRef });
  }
  if (subjects.length === 0) {
    return result(request, [], subjectGaps.length > 0 ? subjectGaps : [gap(part.id, "no_data", { aspect: part.aspect })]);
  }

  const adapter = ADAPTERS[request.source];
  if (!adapter) {
    return result(request, [], [gap(part.id, "failed", { aspect: part.aspect })]);
  }
  const outcome = adapter(subjects, part, context);
  const facts = outcome.facts.filter((entry) => entry.aspects.includes(part.aspect));
  const gaps = [...subjectGaps, ...outcome.gaps];
  if (facts.length === 0 && gaps.length === 0) {
    gaps.push(gap(part.id, "no_data", { aspect: part.aspect }));
  }
  return result(request, facts, gaps);
}
