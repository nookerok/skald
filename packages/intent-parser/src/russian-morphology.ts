/**
 * Light Russian nominal stemming for observer-safe matching.
 *
 * Mechanical tail-stripping only (no dictionary, no POS tagging): declined
 * surfaces meet nominative labels ("воде"/"воду" → "вод", "переправу" →
 * "переправ"). Shared by the parser-side focus guard, the world target
 * resolver and the journey route matcher so declined forms behave
 * identically everywhere. Conservative by construction: stems shorter
 * than three letters never match, and callers always try exact equality
 * first — stemming only rescues inflection, never invents referents.
 */

const STEM_TAILS: readonly string[] = [
  "иями", "ами", "ями", "ового", "евому", "ому", "ему", "ого", "его",
  "ыми", "ими", "ах", "ях", "ами", "ями", "ов", "ев", "ей",
  "ая", "яя", "ое", "ее", "ые", "ие",
  "ую", "юю", "ой", "ый", "ий", "ью", "ию", "ия", "ие",
  "ам", "ям", "ом", "ем", "а", "я", "у", "ю", "о", "е", "и", "ы", "й", "ь",
];

/** Smallest stem that may participate in matching. */
export const RUSSIAN_STEM_MIN_LENGTH = 3;

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/ё/gu, "е");
}

/**
 * Deterministic stem of one word form. Returns the input unchanged when no
 * known tail applies or the stem would become too short.
 */
export function stemRussianToken(word: string): string {
  const normalized = normalizeWord(word.trim());
  for (const tail of STEM_TAILS) {
    if (normalized.length > tail.length + 2 && normalized.endsWith(tail)) {
      return normalized.slice(0, -tail.length);
    }
  }
  return normalized;
}

/** True when two word forms share a usable stem (inflection, not coincidence). */
export function sameRussianStem(left: string, right: string): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const stemmedLeft = stemRussianToken(left);
  const stemmedRight = stemRussianToken(right);
  return stemmedLeft.length >= RUSSIAN_STEM_MIN_LENGTH && stemmedLeft === stemmedRight;
}
