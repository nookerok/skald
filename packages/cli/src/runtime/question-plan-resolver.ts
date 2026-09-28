/**
 * Server-side subject binding for a model-declared `QuestionPlan`
 * (semantic-question-plan T3; ADR-0028/0037 amendments 2026-09-27).
 *
 * Turns each declared `QuestionSubject` into a `SubjectBinding` using ONLY
 * server-side context: the observer-safe scene, the conversation focus
 * (recent mentions/focus stack) and the pending-clarification mechanism —
 * which reaches this resolver indirectly, because an exact answer is
 * rewritten into a concrete replica BEFORE interpretation
 * (`interpretFramedInput`). The model never chooses a binding itself: a
 * declared `observerRef` is checked against the scene registries, surfaces
 * are matched against scene labels, and pronouns go through the same
 * focus-stack ranking the deterministic pronoun path uses.
 *
 * Outcomes: `resolved` (unique server-side candidate), `absent` (nothing
 * known — the reading answers with an honest `no_data` gap, never a guess)
 * or a clarification that names the scene candidates, mirroring the
 * deterministic pronoun ambiguity wording. Pure: no Domain Events, no
 * persistence, no world mutation.
 */

import {
  isUnresolvedFocusSurface,
  multipleReferents,
  multipleThings,
  stemRussianToken,
  type ClarificationOption,
  type ProposedQuestionPlan,
  type SubjectBinding,
} from "@skald/intent-parser";
import type { MasterTurnSceneContext } from "@skald/world";
import { bindTurnPronouns } from "../conversation/focus-stack.js";
import type { MasterConversationContext } from "../conversation/context-builder.js";

/** Outcome of binding every declared subject of one question plan. */
export type QuestionPlanBindingOutcome =
  | { readonly status: "resolved"; readonly bindings: readonly SubjectBinding[] }
  | {
    readonly status: "clarification";
    readonly question: string;
    readonly options: readonly ClarificationOption[];
  };

/** Deictic place surfaces answered from the current location alone. */
const DEICTIC_PLACE_SURFACES: ReadonlySet<string> = new Set([
  "здесь", "тут", "тута", "это место", "текущее место", "место",
]);

interface SceneCandidate {
  readonly ref: string;
  /** Primary label first, then aliases — all player-facing surfaces. */
  readonly labels: readonly string[];
  readonly person: boolean;
  readonly thing: boolean;
  readonly topic: boolean;
}

function fold(text: string): string {
  return text.trim().toLowerCase().replace(/ё/gu, "е");
}

function contentWords(text: string): readonly string[] {
  return fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3)
    .map((word) => stemRussianToken(word));
}

/** Every content word of `surface` appears (stemmed) in the label words. */
function surfaceMatches(surface: string, labels: readonly string[]): boolean {
  const surfaceWords = contentWords(surface);
  if (surfaceWords.length === 0) return false;
  const labelWords = new Set(labels.flatMap((label) => contentWords(label)));
  return surfaceWords.every((word) => labelWords.has(word));
}

function sceneCandidates(scene: MasterTurnSceneContext): readonly SceneCandidate[] {
  const referent = (entry: { readonly observerRef: string; readonly label: string; readonly knownAs?: readonly string[] }, flags: { person: boolean; thing: boolean; topic: boolean }): SceneCandidate => ({
    ref: entry.observerRef,
    labels: Object.freeze([entry.label, ...(entry.knownAs ?? [])]),
    ...flags,
  });
  return [
    ...scene.knownPeople.map((entry) => referent(entry, { person: true, thing: false, topic: false })),
    ...scene.visibleObjects.map((entry) => referent(entry, { person: false, thing: true, topic: false })),
    ...scene.accessibleItems.map((entry) => referent(entry, { person: false, thing: true, topic: false })),
    ...scene.knownRoutes.map((entry) => referent(entry, { person: false, thing: false, topic: false })),
    ...scene.knownTopics.map((entry) => referent({ observerRef: entry.observerRef, label: entry.text }, { person: false, thing: false, topic: true })),
  ];
}

function labelForRef(candidates: readonly SceneCandidate[], ref: string): string | null {
  return candidates.find((candidate) => candidate.ref === ref)?.labels[0] ?? null;
}

function hasRef(candidates: readonly SceneCandidate[], ref: string): boolean {
  return candidates.some((candidate) => candidate.ref === ref);
}

function ambiguityFor(labels: readonly string[], candidates: readonly SceneCandidate[], refs: readonly string[]): QuestionPlanBindingOutcome {
  const named = labels.slice(0, 3);
  const onlyPeople = refs.every((ref) => candidates.find((candidate) => candidate.ref === ref)?.person === true);
  const onlyThings = refs.every((ref) => candidates.find((candidate) => candidate.ref === ref)?.thing === true);
  const classified = onlyPeople
    ? multipleReferents(named, true)
    : onlyThings
      ? multipleThings(named)
      : multipleReferents(named, false);
  const candidateOptions: readonly ClarificationOption[] = refs.slice(0, 3).map((ref, index) => ({
    optionId: `candidate-${index + 1}`,
    label: labelForRef(candidates, ref) ?? ref,
    referentRefs: [ref],
  }));
  return {
    status: "clarification",
    question: classified.question,
    options: [...candidateOptions, ...classified.options],
  };
}

interface BindState {
  readonly candidates: readonly SceneCandidate[];
  readonly scene: MasterTurnSceneContext;
  readonly conversation: MasterConversationContext;
}

/** One subject: resolved binding, clarification or an honest `absent`. */
function bindSubject(
  subject: ProposedQuestionPlan["subjects"][number],
  state: BindState,
): { readonly binding: SubjectBinding } | { readonly clarification: QuestionPlanBindingOutcome } {
  const { candidates, scene, conversation } = state;

  if (subject.kind === "self") {
    return { binding: { subject, resolution: "resolved", resolvedRef: null } };
  }

  if (subject.kind === "place") {
    const deictic = DEICTIC_PLACE_SURFACES.has(fold(subject.surface)) || isUnresolvedFocusSurface(subject.surface);
    if (deictic || surfaceMatches(subject.surface, [scene.currentLocation.name])) {
      return { binding: { subject, resolution: "resolved", resolvedRef: null } };
    }
    // TODO(semantic-question-plan): cross-location place subjects need a
    // closed location-reference registry; until then a named other place is
    // honestly absent rather than answered from the current location.
    return { binding: { subject, resolution: "absent", resolvedRef: null } };
  }

  if (subject.kind === "ordinal") {
    // TODO(semantic-question-plan T5): listRef vocabulary is not closed yet,
    // so no list can be re-identified server-side — honest absence.
    return { binding: { subject, resolution: "absent", resolvedRef: null } };
  }

  // Declared refs are checked, never trusted.
  if (subject.observerRef && hasRef(candidates, subject.observerRef)) {
    return { binding: { subject, resolution: "resolved", resolvedRef: subject.observerRef } };
  }

  if (subject.kind === "group" && subject.members && subject.members.length > 0) {
    const complete = subject.members.every((member) => hasRef(candidates, member));
    return {
      binding: { subject, resolution: complete ? "resolved" : "absent", resolvedRef: null },
    };
  }

  // Concrete surface: unique scene label wins.
  const matched = candidates.filter((candidate) => surfaceMatches(subject.surface, candidate.labels));
  if (matched.length === 1) {
    return { binding: { subject, resolution: "resolved", resolvedRef: matched[0]!.ref } };
  }
  if (matched.length > 1) {
    return {
      clarification: ambiguityFor(matched.map((entry) => entry.labels[0] ?? entry.ref), candidates, matched.map((entry) => entry.ref)),
    };
  }

  // Pronouns and demonstratives: the focus stack ranks scene candidates the
  // same way the deterministic pronoun path does.
  const pronouns = bindTurnPronouns(subject.surface, conversation, scene);
  const pronoun = pronouns[0];
  if (pronoun) {
    if (pronoun.resolution === "single") {
      const ref = pronoun.candidates[0] ?? null;
      return { binding: { subject, resolution: ref !== null ? "resolved" : "absent", resolvedRef: ref } };
    }
    if (pronoun.resolution === "ambiguous") {
      return {
        clarification: ambiguityFor(
          pronoun.candidates.map((ref) => labelForRef(candidates, ref) ?? ref),
          candidates,
          pronoun.candidates,
        ),
      };
    }
    return { binding: { subject, resolution: "absent", resolvedRef: null } };
  }

  return { binding: { subject, resolution: "absent", resolvedRef: null } };
}

/**
 * Binds every declared subject of one question plan against the current
 * scene and conversation context. Returns `clarification` for the FIRST
 * ambiguous subject (deterministic plan order) so the player names the
 * referent before any reading or action runs; all other subjects settle as
 * `resolved` or `absent`.
 */
export function resolveQuestionPlanBindings(
  plan: ProposedQuestionPlan,
  scene: MasterTurnSceneContext,
  conversation: MasterConversationContext,
): QuestionPlanBindingOutcome {
  const state: BindState = { candidates: sceneCandidates(scene), scene, conversation };
  const bindings: SubjectBinding[] = [];
  for (const subject of plan.subjects) {
    const outcome = bindSubject(subject, state);
    if ("clarification" in outcome) return outcome.clarification;
    bindings.push(outcome.binding);
  }
  return { status: "resolved", bindings: Object.freeze(bindings) };
}
