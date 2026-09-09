/**
 * Pronoun focus stack (ADR-0028, plan_6 Stage 5).
 *
 * A pure read-side resolver: given the current replica, the bounded
 * conversation context (Stage 4) and the observer-safe scene (Stage 3), it
 * binds third-person pronouns, demonstratives and locative adverbs to
 * ranked `observerRef` candidates. It never touches canonical ids — ranking
 * uses only labels and surfaces — so a pronoun can never resolve directly
 * into a hidden entity id. The interpreter (later stage) picks among the
 * ranked candidates and the server revalidates against the live world.
 *
 * Priority implemented here:
 * 1. No pronouns in the replica — nothing to bind.
 * 2. A speech-governed replica ("спрошу у него") narrows dual pronouns to
 *    person: one addresses people, not fences.
 * 3. Mentioned candidates first: conversation focus surfaces (newest first)
 *    stem-matched word-wise against scene labels, so "перевозчику" boosts
 *    a "Перевозчик у переправы" candidate.
 * 4. Remaining scene candidates of the pronoun class, in scene order.
 *
 * Boundary: mentions come from validated-plan metadata first (persisted on
 * every V2 turn, including inquiry focus and speech addressees) and fall
 * back to deterministically re-parseable accepted actions for legacy rows.
 * Slang verb forms the deterministic parser cannot read (such as "подхожу")
 * contribute no mention until validation focus persists.
 *
 * Resolution follows the count rule: one candidate resolves, several ask
 * for clarification, none means missing (stale when a mention exists but
 * its candidate is gone — the mention surface is kept for the question).
 * First/second-person pronouns need no binding and are ignored.
 */

import type { MasterTurnSceneContext } from "@skald/world";
import type { MasterConversationContext } from "./context-builder.js";

/** Referent class a pronoun may point at. */
export type FocusReferenceClass = "person" | "thing" | "topic" | "place";

/** How a pronoun binding settled. */
export type PronounResolution = "single" | "ambiguous" | "missing";

/** One bound pronoun occurrence group (distinct forms, first-appearance order). */
export interface PronounBinding {
  readonly pronoun: string;
  readonly classes: readonly FocusReferenceClass[];
  readonly preposition: string | null;
  readonly candidates: readonly string[];
  readonly mention: { readonly surface: string; readonly turnSeq: number } | null;
  readonly resolution: PronounResolution;
}

/** Third-person forms: dual person/thing except neuter-only оно. */
const DUAL_FORMS: ReadonlySet<string> = new Set([
  "он", "она", "они",
  "его", "ее", "их",
  "ему", "ей", "им", "ими",
  "нем", "ней",
  "него", "нее", "них", "ним", "ними", "нему",
]);

/** Neuter-only form pointing at things. */
const THING_FORMS: ReadonlySet<string> = new Set(["оно"]);

/** Demonstratives pointing at topics. */
const TOPIC_FORMS: ReadonlySet<string> = new Set([
  "это", "этот", "эта", "этом", "этим", "этой", "этого", "того",
  "такой", "такая", "такое", "такие",
]);

/** Locative adverbs pointing at routes/destinations. */
const PLACE_FORMS: ReadonlySet<string> = new Set([
  "туда", "сюда", "там", "здесь", "тут", "оттуда", "отсюда",
]);

/** Prepositions captured before a pronoun for later relation mapping. */
const PREPOSITIONS: ReadonlySet<string> = new Set([
  "за", "у", "о", "об", "к", "с", "в", "на", "под", "над",
  "перед", "между", "про", "через", "из", "от", "до", "для",
]);

/**
 * Speech-verb stems (any conjugation): a replica governed by one addresses
 * a person, so dual-class pronouns narrow to person. "Осмотрю её" keeps both
 * classes; "спрошу у него" does not.
 */
const SPEECH_STEMS: readonly string[] = [
  "спрош", "спроси", "скаж", "сказа", "обращ", "обрати",
  "позов", "позва", "позову", "оклик", "говор", "шепч", "шепт", "прошепт",
];

function isSpeechGoverned(words: readonly string[]): boolean {
  return words.some((word) => SPEECH_STEMS.some((stem) => word.startsWith(stem)));
}

/** Russian declension tails stripped longest-first for stem matching. */
const STEM_TAILS: readonly string[] = [
  "ей", "ой", "ую", "юю", "его", "ого", "ому", "ем", "ом",
  "ах", "ях", "ами", "ями", "а", "я", "у", "ю", "о", "е", "и", "ы", "й", "ь",
];

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/ё/gu, "е");
}

function splitWords(text: string): readonly string[] {
  return normalizeWord(text).split(/[^a-zа-я0-9]+/iu).filter((word) => word.length > 0);
}

/** Deterministic stem for matching declined surfaces to nominative labels. */
function stem(word: string): string {
  for (const tail of STEM_TAILS) {
    if (word.length > tail.length + 2 && word.endsWith(tail)) return word.slice(0, -tail.length);
  }
  return word;
}

function classesFor(pronoun: string): readonly FocusReferenceClass[] | null {
  if (DUAL_FORMS.has(pronoun)) return ["person", "thing"];
  if (THING_FORMS.has(pronoun)) return ["thing"];
  if (TOPIC_FORMS.has(pronoun)) return ["topic"];
  if (PLACE_FORMS.has(pronoun)) return ["place"];
  return null;
}

/**
 * Binds every distinct bindable pronoun form in the replica to ranked
 * scene candidates. Returns [] when the replica needs no binding.
 */
export function bindTurnPronouns(
  input: string,
  conversation: MasterConversationContext,
  scene: MasterTurnSceneContext,
): readonly PronounBinding[] {
  const words = splitWords(input);
  const speechGoverned = isSpeechGoverned(words);
  const seen = new Set<string>();
  const bindings: PronounBinding[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const pronoun = words[index]!;
    if (seen.has(pronoun)) continue;
    const rawClasses = classesFor(pronoun);
    if (!rawClasses) continue;
    // A speech-governed replica addresses a person: narrow dual forms.
    const classes = speechGoverned && rawClasses.includes("person")
      ? rawClasses.filter((kind) => kind !== "thing")
      : rawClasses;
    if (classes.length === 0) continue;
    seen.add(pronoun);
    const previous = index > 0 ? words[index - 1]! : null;
    bindings.push(freeze({
      pronoun,
      classes,
      preposition: previous && PREPOSITIONS.has(previous) ? previous : null,
      ...rankCandidates(classes, conversation, scene),
    }));
  }
  return freeze(bindings);
}

function rankCandidates(
  classes: readonly FocusReferenceClass[],
  conversation: MasterConversationContext,
  scene: MasterTurnSceneContext,
): Pick<PronounBinding, "candidates" | "mention" | "resolution"> {
  const wantsPerson = classes.includes("person");
  const wantsThing = classes.includes("thing");
  const wantsTopic = classes.includes("topic");
  const wantsPlace = classes.includes("place");

  const people = wantsPerson ? scene.knownPeople : [];
  const objects = wantsThing ? scene.visibleObjects : [];
  const topics = wantsTopic ? scene.knownTopics : [];
  const routes = wantsPlace ? scene.knownRoutes : [];

  // Newest conversation mention stem-matched into the scene boosts first.
  const boosted: string[] = [];
  let mention: PronounBinding["mention"] = null;
  for (const focus of conversation.recentFocus) {
    if (!mention) mention = freeze({ surface: focus.surface, turnSeq: focus.turnSeq });
    const focusStem = stem(normalizeWord(focus.surface));
    if (focusStem.length < 2) continue;
    for (const referent of [...people, ...objects]) {
      if (boosted.includes(referent.observerRef)) continue;
      const words = [referent.label, ...referent.knownAs].flatMap((label) => splitWords(label).map(stem));
      if (words.some((word) => word === focusStem)) boosted.push(referent.observerRef);
    }
  }

  const rest: string[] = [];
  for (const referent of [...objects, ...people]) {
    if (!boosted.includes(referent.observerRef)) rest.push(referent.observerRef);
  }
  const candidates = freeze([
    ...boosted,
    ...rest,
    ...topics.map((topic) => topic.observerRef),
    ...routes.map((route) => route.observerRef),
  ]);

  // The newest mention is kept even when it matches nothing: it marks
  // a stale referent for the clarification question.
  if (!mention && conversation.recentFocus.length > 0) {
    const newest = conversation.recentFocus[0]!;
    mention = freeze({ surface: newest.surface, turnSeq: newest.turnSeq });
  }

  const resolution: PronounResolution =
    candidates.length === 0 ? "missing" : candidates.length === 1 ? "single" : "ambiguous";
  return { candidates, mention, resolution };
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}
