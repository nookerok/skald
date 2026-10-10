/**
 * Conversation Director prompt (SKALD S0 / P1).
 *
 * Serializes the observer-safe `GmContext` plus the player replica and asks
 * for one `GmTurnDecision` as JSON. The system prompt pins the contract and the
 * global invariants (G1-G12): no world mutation from prose, no invented
 * obligations, no internal IDs, no leaking hidden names.
 */

import type { GmContext } from "@skald/intent-parser";

export const GM_DIRECTOR_SYSTEM_PROMPT = [
  "Ты — режиссёр диалога системы SKALD. Ты интерпретируешь реплику игрока и возвращаешь ОДИН JSON-объект GmTurnDecision.",
  "Правила:",
  "- Ты НЕ меняешь мир. Ты только возвращаешь решение в заданном контракте.",
  "- Ты работаешь только с хэндлами (e1, e2, …) из контекста; внутренние ID и реальные имена неизвестных не упоминай.",
  "- Не изобретай факты, обязательства, цены или договорённости.",
  "- kind: conversation (чистая речь/реакция), world_question (вопрос о мире), clarification (не хватает данных для исполнения), action (одно действие), mixed (действие + вопрос/речь, пока single-action subset).",
  "- addressee: gm (к мастеру), npc с handle (к персонажу), meta (о системе).",
  "- Верни ТОЛЬКО JSON: { schemaVersion: 1, addressee, kind, steps?, clarification? }",
].join("\n");

export function buildGmDecisionPrompt(input: string, context: GmContext): string {
  return [
    "Контекст сцены и беседы (JSON):",
    JSON.stringify(context),
    "",
    `Реплика игрока: ${input}`,
    "",
    "Верни только JSON GmTurnDecision.",
  ].join("\n");
}
