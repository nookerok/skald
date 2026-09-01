/**
 * Deterministic, player-facing wording used when an action has no richer
 * presentation yet. This is deliberately read-side text: it does not infer
 * or apply a world outcome.
 */
export function actionFallbackText(playerAction: string, kind: "outcome" | "rejection" = "outcome"): string {
  const action = playerAction.trim().toLowerCase();
  const startsWithOneOf = (words: readonly string[]): boolean => words.some((word) =>
    action === word || action.startsWith(`${word} `) || action.startsWith(`${word},`) || action.startsWith(`${word}:`));
  const containsOneOf = (stems: readonly string[]): boolean => stems.some((stem) => action.includes(stem));

  if (kind === "rejection") {
    return "Мир не дал этому намерению отклика; уточни, что именно хочешь проверить или изменить.";
  }
  if (startsWithOneOf(["wait", "подождать", "подожди", "ждать", "выждать", "погодить", "погоди"]) || containsOneOf(["ждать", "подождать", "подожди", "выждать", "погодить"])) {
    return "Ты даёшь времени пройти и всматриваешься в перемены вокруг.";
  }
  if (startsWithOneOf(["observe", "осмотреть", "осмотр", "оглядеться", "look", "смотреть"]) || containsOneOf(["осмотр", "огляд", "наблюд", "посмотр"])) {
    return "Ты осматриваешься, но пока не замечаешь ясного отклика.";
  }
  if (startsWithOneOf(["listen", "слушать", "прислушаться"]) || containsOneOf(["слуш", "прислуш"])) {
    return "Ты прислушиваешься, но пока слышишь лишь обычный шум вокруг.";
  }
  if (startsWithOneOf(["inspect", "изучить", "исследовать", "рассмотреть"]) || containsOneOf(["изуч", "исслед", "рассмотр"])) {
    return "Ты изучаешь следы, но пока не находишь новой зацепки.";
  }
  if (startsWithOneOf(["move", "travel", "journey", "идти", "двигаться", "направиться"]) || containsOneOf(["идти", "двиг", "направ"])) {
    return "Ты выбираешь путь, но пока не видишь, куда он ведёт.";
  }
  return "Ты пробуешь изменить ситуацию, но пока не замечаешь ясного отклика.";
}

/** Return true for legacy placeholders that should not be repeated to a player. */
export function isGenericActionFallback(text: string): boolean {
  const normalized = text.trim();
  return normalized === "Твоя попытка не удалась. Опиши, что именно хочешь проверить или изменить."
    || normalized === "Ты начинаешь действовать, но пока не видишь заметного результата."
    || normalized === "Ничего не изменилось заметно — осмотрись и выбери, что проверить дальше."
    || normalized === "Попытка не меняет ситуацию.";
}
