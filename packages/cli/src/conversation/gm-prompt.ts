/**
 * Conversation Director prompt (SKALD S0 / P1).
 *
 * Serializes the observer-safe `GmContext` plus the player replica and asks
 * for one `GmTurnDecision` as JSON. The system prompt pins the contract and the
 * global invariants (G1-G12): no world mutation from prose, no invented
 * obligations, no internal IDs, no leaking hidden names.
 *
 * Few-shot examples that reference an actor are built in `buildGmDecisionPrompt`
 * from the REAL handles of the current scene, never from literal placeholders:
 * a fabricated example handle teaches the model to invent one, which can only
 * end in a schema fallback.
 */

import type { GmContext } from "@skald/intent-parser";

export const GM_DIRECTOR_SYSTEM_PROMPT = [
  "Ты — режиссёр диалога системы SKALD. Ты интерпретируешь реплику игрока и возвращаешь ОДИН JSON-объект GmTurnDecision.",
  "Правила:",
  "- Ты НЕ меняешь мир. Ты только возвращаешь решение в заданном контракте.",
  "- Ты работаешь только с хэндлами из контекста (поле handle у actor); внутренние ID и канонические имена неизвестных не упоминай.",
  "- НИКОГДА не выдумывай handle. Нет нужного handle в контексте — это clarification, а не угадывание.",
  "- Не изобретай факты, обязательства, цены или договорённости.",
  "- addressee — ВСЕГДА объект: { kind: \"gm\" } к мастеру, { kind: \"npc\", handle: \"…\" } к персонажу, { kind: \"meta\" } о системе. Никогда не строка.",
  "- kind: conversation (чистая речь/реакция), world_question (вопрос о мире), clarification (не хватает данных), action (одно действие), mixed (действие + вопрос/речь).",
  "- Верни ТОЛЬКО JSON с точными полями: schemaVersion, addressee, kind (плюс steps/clarification только когда они нужны). Никаких лишних полей.",
  "Примеры без персонажей (handle не нужны):",
  "1) Игрок: «Привет» (рядом никого / неясен адресат) → {\"schemaVersion\":1,\"addressee\":{\"kind\":\"gm\"},\"kind\":\"conversation\"}",
  "2) Игрок: «Что случилось у переправы той ночью?» → {\"schemaVersion\":1,\"addressee\":{\"kind\":\"gm\"},\"kind\":\"world_question\"}",
  "3) Игрок: «Как узнать местных?» → {\"schemaVersion\":1,\"addressee\":{\"kind\":\"gm\"},\"kind\":\"clarification\",\"clarification\":{\"question\":\"Кого именно ты имеешь в виду?\"}}",
  "Закрытые правила против частых ошибок:",
  "- Вопрос о персонаже через местоимение («Как он выглядит?», «Кто она?»): addressee — {\"kind\":\"gm\"} (вопрос мастеру), а ПРЕДМЕТ — subjectHandle с handle этого персонажа из recentTurns/actors. Не путай: subjectHandle — о ком, addressee — кто отвечает.",
  "- Если реплика обращена к нескольким видимым кандидатам и не называет одного — это clarification со списком их handle, а не world_question.",
  "- Приказ, требование или просьба к персонажу («отдай», «принеси», «скажи») — kind action или mixed, никогда conversation.",
  "- «Повтори», «скажи ещё раз», «что ты сказал» — адресат тот, кто говорил последним: если последний ход master — это addressee gm, conversation.",
  "Для адресата-персонажа и для clarification с кандидатами ниже — примеры собраны из handle РЕАЛЬНОЙ сцены; подставляй только handle из контекста.",
].join("\n");

/**
 * Builds the user prompt: scene JSON, the player replica, and scene-derived
 * few-shot examples (real handles of up to two visible actors).
 */
export function buildGmDecisionPrompt(input: string, context: GmContext): string {
  const handles = context.actors.slice(0, 2).map((actor) => actor.handle);
  const examples: string[] = [];
  if (handles[0] !== undefined) {
    examples.push(`4) Игрок обращается к персонажу рядом → {"schemaVersion":1,"addressee":{"kind":"npc","handle":"${handles[0]}"},"kind":"conversation"}`);
  }
  if (handles[1] !== undefined) {
    examples.push(`5) Игрок: «Кто это?» (два видимых кандидата) → {"schemaVersion":1,"addressee":{"kind":"gm"},"kind":"clarification","clarification":{"question":"Кто именно?","candidateHandles":["${handles[0] as string}","${handles[1]}"]}}`);
    examples.push(`6) Игрок: «Подхожу и спрашиваю…» → {"schemaVersion":1,"addressee":{"kind":"npc","handle":"${handles[0]}"},"kind":"mixed"}`);
  }
  return [
    "Контекст сцены и беседы (JSON):",
    JSON.stringify(context),
    "",
    "Примеры решений для ЭТОЙ сцены (handle уже настоящие):",
    ...examples,
    "",
    `Реплика игрока: ${input}`,
    "",
    "Верни только JSON GmTurnDecision.",
  ].join("\n");
}
