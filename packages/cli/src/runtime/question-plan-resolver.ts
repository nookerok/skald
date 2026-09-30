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
import type { MasterSceneReference, MasterTurnSceneContext } from "@skald/world";
import type { ConversationMemoryShownGroup } from "../conversation/types.js";
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

/**
 * Plural demonstratives that name the previously shown group (T5): when the
 * model-declared members no longer resolve, the remembered group the master
 * showed supplies the member links. A closed small set — anything else goes
 * through the ordinary scene or pronoun paths.
 */
const PLURAL_DEICTIC_SURFACES: ReadonlySet<string> = new Set([
  "они", "эти люди", "эти",
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
  readonly references: ReadonlyMap<string, MasterSceneReference>;
  readonly candidates: readonly SceneCandidate[];
  readonly scene: MasterTurnSceneContext;
  readonly conversation: MasterConversationContext;
}

/**
 * Labels the conversation remembers from earlier SHOWN answers (T5): the
 * structured mention labels plus every list/group label and member link.
 * These are player-facing labels only — never transient scene handles.
 */
function rememberedLabels(state: BindState): readonly string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const push = (label: string): void => {
    const key = fold(label);
    if (!key || seen.has(key)) return;
    seen.add(key);
    labels.push(label);
  };
  for (const mention of state.conversation.recentlyMentionedEntities) push(mention.label);
  for (const list of state.conversation.rememberedLists) {
    for (const member of list.members) push(member);
  }
  for (const group of state.conversation.rememberedGroups) {
    push(group.label);
    for (const member of group.members) push(member);
  }
  return labels;
}

/** Unique scene match for a remembered label, else null. */
function sceneRefForLabel(candidates: readonly SceneCandidate[], label: string): string | null {
  const matched = candidates.filter((candidate) => surfaceMatches(label, candidate.labels));
  return matched.length === 1 ? matched[0]!.ref : null;
}

/**
 * The remembered group a plural demonstrative names (T5): either an exact
 * label match or one of the closed plural forms — the newest group wins.
 */
function findRememberedGroup(state: BindState, surface: string): ConversationMemoryShownGroup | null {
  const deictic = PLURAL_DEICTIC_SURFACES.has(fold(surface));
  for (const group of state.conversation.rememberedGroups) {
    if (deictic || surfaceMatches(surface, [group.label])) return group;
  }
  return null;
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
    // Position in THE list the master showed (T5): the stored list is the
    // identity — never a freshly derived scene order — so the meaning
    // survives reload and scene re-ordering. Labels only; availability is
    // re-checked against the current scene on every use.
    const list = state.conversation.rememberedLists.find((entry) => entry.listRef === subject.listRef);
    const position = subject.position ?? 0;
    if (!list || position < 1 || position > list.members.length) {
      return { binding: { subject, resolution: "absent", resolvedRef: null } };
    }
    const identity = list.memberIdentities?.[position - 1];
    if (identity) {
      const ref = [...state.references].find(([ref, entry]) => entry.kind === identity.kind
        && entry.internalId === identity.internalId && hasRef(candidates, ref))?.[0] ?? null;
      return { binding: { subject, resolution: "resolved", resolvedRef: ref } };
    }
    const member = list.members[position - 1]!;
    const matched = state.candidates.filter((candidate) => surfaceMatches(member, candidate.labels));
    if (matched.length === 1) {
      return { binding: { subject, resolution: "resolved", resolvedRef: matched[0]!.ref } };
    }
    if (matched.length > 1) {
      // Legacy labels cannot distinguish duplicate people; never infer identity from scene order.
      return { clarification: ambiguityFor(matched.map((entry) => entry.labels[0] ?? entry.ref), state.candidates, matched.map((entry) => entry.ref)) };
    }
    // The shown member is gone from the scene: speakable as a memory,
    // never a clarification and never a guess.
    return { binding: { subject, resolution: "resolved", resolvedRef: null } };
  }

  // Declared refs are checked, never trusted.
  if (subject.observerRef && !isUnresolvedFocusSurface(subject.surface) && hasRef(candidates, subject.observerRef)) {
    return { binding: { subject, resolution: "resolved", resolvedRef: subject.observerRef } };
  }

  if (subject.kind === "group" && subject.members && subject.members.length > 0) {
    const remembered = findRememberedGroup(state, subject.surface);
    if (remembered?.memberIdentities) {
      const refs = remembered.memberIdentities.map((identity) => identity
        ? [...state.references].find(([ref, entry]) => entry.kind === identity.kind
          && entry.internalId === identity.internalId && hasRef(candidates, ref))?.[0] ?? null
        : null);
      return { binding: { subject, resolution: "resolved", resolvedRef: null, resolvedMembers: refs } };
    }
    if (subject.members.every((member) => hasRef(candidates, member))) {
      return { binding: { subject, resolution: "resolved", resolvedRef: null, resolvedMembers: [...subject.members] } };
    }
    // The model-declared handles went stale after a scene change: fall back
    // to the member LINKS of the group the master showed earlier (T5), each
    // label re-checked against the current scene — a gone member is null,
    // never guessed, and the group stays speakable while any member remains.
    if (remembered) {
      for (const label of remembered.members) {
        const matched = candidates.filter((candidate) => surfaceMatches(label, candidate.labels));
        if (matched.length > 1) return { clarification: ambiguityFor(matched.map((entry) => entry.labels[0]!), candidates, matched.map((entry) => entry.ref)) };
      }
      const rechecked = remembered.members.map((label) => sceneRefForLabel(candidates, label));
      return { binding: { subject, resolution: "resolved", resolvedRef: null, resolvedMembers: rechecked } };
    }
    return { binding: { subject, resolution: "absent", resolvedRef: null } };
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
  const pronouns = bindTurnPronouns(subject.surface, conversation, scene, state.references);
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
    return { binding: { subject, resolution: pronoun.mention ? "resolved" : "absent", resolvedRef: null } };
  }

  // T5 memory fallback: a named subject the master showed earlier but that
  // is gone from this scene stays speakable as a memory — resolved WITHOUT
  // a scene handle (scene readings gap honestly, memory sources can still
  // answer) instead of vanishing. Pronoun surfaces never match labels, so
  // the pronoun path above is untouched; a genuinely unknown subject is
  // still honestly absent, and nothing here ever clarifies.
  const remembered = rememberedLabels(state).find((label) => surfaceMatches(subject.surface, [label]));
  if (remembered) {
    return { binding: { subject, resolution: "resolved", resolvedRef: null } };
  }
  // T6 acceptance, series 6: an unresolvable TOPIC stays speakable as a
  // memory instead of vanishing — conversation topics live in the
  // transcript and testimony, not the scene, so text sources answer by
  // surface while scene sources gap honestly. Entities keep honest absent
  // (a named-but-unknown entity is not a conversation subject).
  if (subject.kind === "topic") {
    return { binding: { subject, resolution: "resolved", resolvedRef: null } };
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
  references: ReadonlyMap<string, MasterSceneReference> = new Map(),
): QuestionPlanBindingOutcome {
  const state: BindState = { candidates: sceneCandidates(scene), scene, conversation, references };
  const bindings: SubjectBinding[] = [];
  for (const subject of plan.subjects) {
    const outcome = bindSubject(subject, state);
    if ("clarification" in outcome) return outcome.clarification;
    bindings.push(outcome.binding);
  }
  return { status: "resolved", bindings: Object.freeze(bindings) };
}
