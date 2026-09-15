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
