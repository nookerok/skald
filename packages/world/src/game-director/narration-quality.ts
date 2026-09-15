/**
 * Game narration quality guard (plan_9 §13).
 *
 * A deterministic post-generation check over LLM prose. It never touches
 * the world: it only accepts or rejects a candidate narration string
 * against the observer-safe material the model was allowed to use. On
 * rejection callers must fall back to the quality deterministic text
 * (the personalized template), never to an empty string.
 *
 * Checks, in order:
 * - empty: blank prose is never playable;
 * - internal_id_leak: adapter keys, event ids and snake_case internals;
 * - too_long: the game UI reads 2–4 sentences, hard cap above that;
 * - outcome_lost: no content word shared with the deterministic outcome;
 * - missing_reaction: no content word shared with the player's replica;
 * - new_proper_name: a mid-sentence capitalised word outside the allowed
 *   vocabulary (sentence-initial capitals are ordinary orthography);
 * - new_item_claim: acquisition phrasing for an object outside the allowed
 *   vocabulary (the model may rephrase items, never create them).
 *
 * Conservative by design: short function words never count, and every
 * check degrades to "pass" when its reference material is absent — the
 * guard only constrains what the caller actually provided.
 */

/** Hard UI cap: narration stays a short game-interface paragraph. */
export const GAME_NARRATION_MAX_CHARS = 1400;
/** Hard sentence cap: the voice is 2–4 sentences, six is the defect line. */
export const GAME_NARRATION_MAX_SENTENCES = 6;
/** Content words shorter than this never link prose to facts. */
export const GAME_NARRATION_MIN_WORD = 5;

/** Inputs for one quality check. All reference prose is observer-safe. */
export interface GameNarrationQualityInput {
  readonly narration: string;
  readonly playerAction: string;
  /** Deterministic outcome prose; when absent the outcome check passes. */
  readonly outcomeText?: string | null | undefined;
  /** Observer-safe facts the model was allowed to rephrase. */
  readonly allowedFacts?: readonly string[] | undefined;
}

/** Machine-readable rejection reasons; the UI never sees these codes. */
export type GameNarrationQualityReason =
  | "empty"
  | "internal_id_leak"
  | "too_long"
  | "outcome_lost"
  | "missing_reaction"
  | "new_proper_name"
  | "new_item_claim";

/** Quality verdict: ok, or rejected with one reason. */
export type GameNarrationQualityResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: GameNarrationQualityReason };

const INTERNAL_PATTERN = /(?:\b(?:contact|item|event|world|background|entrypoint|situation|hypothesis|knowledge|testimony):[A-Za-z0-9_.#:-]+|\bboot#[A-Za-z0-9_.#:-]+|\b(?:event|evt)-[A-Za-z0-9_-]+|\b(?:sourceEventIds?|eventId|canonicalRef)\s*[:=]|[A-Za-z]+_[A-Za-z0-9]+)/u;

const ACQUISITION_PHRASES: readonly string[] = [
  "у тебя теперь есть",
  "у тебя появился",
  "у тебя появилась",
  "ты нашёл",
  "ты нашел",
  "ты нашла",
  "ты получил",
  "ты получила",
  "в твоих руках появил",
  "ты обрёл",
  "ты обрела",
];

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/ё/gu, "е").replace(/^[^a-zа-я0-9]+|[^a-zа-я0-9]+$/gu, "");
}

function contentWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const raw of text.toLowerCase().replace(/ё/gu, "е").split(/[^a-zа-я0-9]+/u)) {
    if (raw.length >= GAME_NARRATION_MIN_WORD) words.add(raw);
  }
  return words;
}

/**
 * Russian-leaning stem sharing: exact match, or the same five-letter
 * prefix (перевозчик/перевозчика, течение/течения). Deliberately crude —
 * the guard must survive ordinary inflection, not parse morphology.
 */
function wordsShare(left: string, right: string): boolean {
  if (left === right) return true;
  return left.length >= 5 && right.length >= 5 && left.slice(0, 5) === right.slice(0, 5);
}

function setsShare(left: Set<string>, right: Set<string>): boolean {
  for (const a of left) {
    for (const b of right) {
      if (wordsShare(a, b)) return true;
    }
  }
  return false;
}

function allowedVocabulary(input: GameNarrationQualityInput): Set<string> {
  const vocab = new Set<string>();
  for (const source of [input.playerAction, input.outcomeText ?? "", ...(input.allowedFacts ?? [])]) {
    for (const word of contentWords(source)) vocab.add(word);
  }
  return vocab;
}

function splitSentences(text: string): string[] {
  return text.split(/[.!?…]+/u).map((part) => part.trim()).filter((part) => part.length > 0);
}

function firstWord(sentence: string): string {
  return sentence.split(/\s+/u)[0] ?? "";
}

function midSentenceCapitals(sentence: string): string[] {
  const words = sentence.split(/\s+/u).filter((word) => word.length > 0);
  const found: string[] = [];
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index]!;
    if (/^[А-ЯЁ]/u.test(word)) found.push(word);
  }
  return found;
}

/**
 * Verifies one candidate narration. Pure and total: the same inputs
 * always yield the same verdict, and an absent reference disables only
 * its own check. Document every branch with a test.
 */
export function verifyGameNarration(input: GameNarrationQualityInput): GameNarrationQualityResult {
  const narration = input.narration.trim();
  if (narration.length === 0) return { ok: false, reason: "empty" };
  if (INTERNAL_PATTERN.test(narration)) return { ok: false, reason: "internal_id_leak" };
  if (narration.length > GAME_NARRATION_MAX_CHARS) return { ok: false, reason: "too_long" };
  const sentences = splitSentences(narration);
  if (sentences.length > GAME_NARRATION_MAX_SENTENCES) return { ok: false, reason: "too_long" };

  const outcome = (input.outcomeText ?? "").trim();
  if (outcome.length >= 20) {
    if (!setsShare(contentWords(narration), contentWords(outcome))) {
      return { ok: false, reason: "outcome_lost" };
    }
  }

  const action = input.playerAction.trim();
  if (action.length >= 4) {
    const narrationWords = contentWords(narration);
    const actionWords = contentWords(action);
    if (actionWords.size > 0 && !setsShare(narrationWords, actionWords)) {
      const outcomeWords = outcome.length > 0 ? contentWords(outcome) : new Set<string>();
      if (!setsShare(narrationWords, outcomeWords)) return { ok: false, reason: "missing_reaction" };
    }
  }

  const vocab = allowedVocabulary(input);
  const vocabList = [...vocab];
  const grounded = (normalized: string): boolean =>
    vocabList.some((entry) => wordsShare(normalized, entry));
  for (const sentence of sentences) {
    void firstWord(sentence);
    for (const capital of midSentenceCapitals(sentence)) {
      const normalized = normalizeWord(capital);
      if (normalized.length >= 3 && !grounded(normalized)) {
        return { ok: false, reason: "new_proper_name" };
      }
    }
  }

  // An acquisition sentence may only use known words (besides the
  // acquisition verb itself): the model rephrases items, never creates
  // them. One ungrounded content word here is a created object, even when
  // the rest of the narration honestly rephrases the scene.
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase().replace(/ё/gu, "е");
    const matched = ACQUISITION_PHRASES.find((phrase) => lower.includes(phrase));
    if (!matched) continue;
    const phraseWords = new Set(
      matched.split(/[^a-zа-я0-9]+/u).map(normalizeWord).filter((word) => word.length > 0),
    );
    const candidates = [...contentWords(sentence)].filter((word) => !phraseWords.has(word));
    for (const word of candidates) {
      if (!grounded(word)) return { ok: false, reason: "new_item_claim" };
    }
  }

  return { ok: true };
}
