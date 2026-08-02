/** Deterministic vocabulary adapter for normal player-facing read models. */

const OBSERVATION_LABELS: Record<string, string> = {
  risk_taken: "Тревожный след", wall_caution: "Память преграды", edge_awareness: "Граница пути",
  impatience: "След поспешности", world_reaction_fear: "Ответ мира",
};
const CONSEQUENCE_LABELS: Record<string, string> = { audacity: "Ответ мира", noise_attention: "Отзвук шума" };
const SITUATION_LABELS: Record<string, string> = { forest_fire: "Лесной пожар" };
const RELATION_TARGET_LABELS: Record<string, string> = { guild: "Местная община" };
const RELATION_KIND_LABELS: Record<string, string> = { help: "Помощь", respect: "Уважение", fear: "Опасение", trust: "Доверие" };
const BLOCK_REASON_LABELS: Record<string, string> = { boundary: "Край доступного пути", wall: "Преграда" };
const OPERATION_LABELS: Record<string, string> = { examine: "осмотреть", apply_force: "воздействовать силой", heat: "применить тепло", move: "двигаться", give: "изменить отношения" };

function safeLookup(table: Record<string, string>, value: unknown, fallback: string): string {
  return typeof value === "string" && table[value] ? table[value]! : fallback;
}

/**
 * Humanized fallback for unknown situation types: the raw snake_case key is
 * turned into plain words so internal identifiers never leak into player text
 * even when no dictionary entry exists yet.
 */
function humanizeKey(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "Ситуация";
  const words = value.split("_").filter((part) => part.length > 0).join(" ");
  return words.length > 0 ? words : "Ситуация";
}
export function observationLabel(key: unknown): string { return safeLookup(OBSERVATION_LABELS, key, "Наблюдаемое явление"); }
export function consequenceLabel(type: unknown): string { return safeLookup(CONSEQUENCE_LABELS, type, "Последствие"); }
export function situationLabel(type: unknown): string { return safeLookup(SITUATION_LABELS, type, humanizeKey(type)); }
export function relationTargetLabel(target: unknown): string { return safeLookup(RELATION_TARGET_LABELS, target, "Другой участник"); }
export function relationKindLabel(kind: unknown): string { return safeLookup(RELATION_KIND_LABELS, kind, "Связь"); }
export function blockedReasonLabel(reason: unknown): string { return safeLookup(BLOCK_REASON_LABELS, reason, "Путь преграждён"); }
export function operationLabel(operation: unknown): string { return safeLookup(OPERATION_LABELS, operation, "действовать"); }

const INTERNAL_LABELS: readonly [string, string][] = [
  ["risk_taken", "рискованный поступок"],
  ["heat:nearby", "тепло рядом"],
  ["world_reaction_fear", "тревога мира"],
  ["edge_awareness", "граница мира"],
  ["audacity", "смелый поступок"],
  ["boundary", "край пути"],
  ["guild", "местная община"],
  ["forest_fire", "лесной пожар"],
  ["wall_caution", "память преграды"],
];

export function sanitizePlayerFacingText(text: string): string {
  let result = text;
  for (const [internal, label] of INTERNAL_LABELS) result = result.split(internal).join(label);
  return result;
}
