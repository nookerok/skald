import { interpretIntent } from "./deterministic-interpreter.js";
import { sameRussianStem } from "./russian-morphology.js";

/**
 * Journey continuation phrases (plan_9 §4).
 *
 * A pure, closed-vocabulary classifier: it recognizes only replicas that
 * name no new destination and only continue an already active journey
 * ("продолжаю путь", "иду дальше", "не останавливаюсь"). It never reads the
 * world and never decides anything: the caller applies it only when a
 * journey is actually active, otherwise the replica flows through the
 * normal interpretation path (and an unknown destination still blocks
 * honestly). Matching is anchored to the whole replica so a trailing
 * destination ("продолжаю путь к реке") stays a normal journey request.
 */

const CONTINUATION_PATTERNS: readonly RegExp[] = [
  /^продолжаю (путь|идти|движение|дорогу|двигаться)$/iu,
  /^продолжить путь$/iu,
  /^продолжать (путь|движение|идти)$/iu,
  /^продолжаем (идти|двигаться|путь)$/iu,
  /^(иду|двигаюсь|движемся|двигаемся|идем) дальше$/iu,
  /^дальше (иду|двигаюсь|движемся|двигаемся|идем)$/iu,
  /^(иду|двигаюсь|движемся|двигаемся) вперед$/iu,
  /^вперед (иду|двигаюсь|движемся|двигаемся)$/iu,
  /^продолжаю (идти|двигаться)( не останавливаясь)?$/iu,
  /^(иду|двигаюсь) не останавливаясь$/iu,
  /^не останавливаюсь$/iu,
  /^не останавливаться$/iu,
  /^без остановки$/iu,
  /^не стою на месте$/iu,
];

function normalizeContinuation(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/ё/gu, "е")
    .replace(/[!?.,;:]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * True when the replica continues an active journey without naming a new
 * destination. World-free: the caller must check that a journey is active.
 */
export function isJourneyContinuation(input: string): boolean {
  const normalized = normalizeContinuation(input);
  if (normalized.length === 0) return false;
  return CONTINUATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function contentWords(value: string): readonly string[] {
  return value
    .toLowerCase()
    .replace(/ё/gu, "е")
    .split(/[^a-zа-я0-9]+/iu)
    .filter((word) => word.length >= 3);
}

/**
 * True when the replica is a journey request naming the ALREADY ACTIVE
 * destination (any declension; a trailing manner tail is tolerated):
 * "Продолжаю путь к Речному Стражу, держась ближе к реке" while bound
 * for the city is a progress signal, not a new journey — the wording
 * survives verbatim in the transcript. A different destination ("к
 * реке") stays a normal journey request. The caller supplies the active
 * destination name and must check that a journey is actually active.
 */
export function isContinuingJourneyTo(input: string, activeDestinationName: string | null): boolean {
  if (!activeDestinationName || !activeDestinationName.trim()) return false;
  const destinationWords = contentWords(activeDestinationName);
  if (destinationWords.length === 0) return false;
  const matches = (words: readonly string[]): boolean =>
    destinationWords.every((word) => words.some((candidate) => candidate === word || sameRussianStem(candidate, word)));
  // Parsed journey requests ("Иду в Речной Страж").
  let parsed: ReturnType<typeof interpretIntent> | null = null;
  try {
    parsed = interpretIntent(input);
  } catch {
    parsed = null;
  }
  if (parsed?.type === "JourneyIntent") {
    if (matches(contentWords(parsed.destination.raw))) return true;
  }
  // "Продолжаю путь к X": the travel-verb parser does not own
  // продолжаю-forms, so strip the leading continuation anchor and compare
  // the remainder directly. Bare "продолжаю путь" belongs to
  // isJourneyContinuation, not here.
  const stripped = normalizeContinuation(input)
    .replace(/^(?:продолжаю|продолжить|продолжать|продолжим|продолжаем)\s+(?:путь|идти|двигаться|движение|дорогу|дорога)\s*/u, "")
    .trim();
  if (!stripped || stripped === normalizeContinuation(input).trim()) return false;
  return matches(contentWords(stripped));
}
