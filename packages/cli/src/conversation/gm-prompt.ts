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
import { MASTER_TURN_PROMPT_CAPABILITIES } from "../runtime/master-turn-prompt.js";

export const GM_DIRECTOR_SYSTEM_PROMPT = [
  "Ты — режиссёр диалога системы SKALD. Ты интерпретируешь реплику игрока и возвращаешь ОДИН JSON-объект GmTurnDecision.",
  "Правила:",
  "- Ты НЕ меняешь мир. Ты только возвращаешь решение в заданном контракте.",
  "- Ты работаешь только с хэндлами из контекста (поле handle у actor); внутренние ID и канонические имена неизвестных не упоминай.",
  "- НИКОГДА не выдумывай handle. Нет нужного handle в контексте — это clarification, а не угадывание.",
  "- Не изобретай факты, обязательства, цены или договорённости.",
  "- addressee — ВСЕГДА объект: { kind: \"gm\" } к мастеру, { kind: \"npc\", handle: \"…\" } к персонажу, { kind: \"meta\" } о системе. Никогда не строка.",
  "- kind: conversation (чистая речь/реакция), world_question (вопрос о мире), clarification (не хватает данных), action (одно действие), mixed (действие + вопрос/речь).",
  "- Верни ТОЛЬКО JSON с полями schemaVersion:2, addressee, kind. Необязательные: subjectHandle, clarification, proposal, response по правилам ниже. Поля steps нет. У gm/meta нет поля handle. Никаких лишних полей.",
  "- Для conversation ОБЯЗАТЕЛЕН response:{segments:[...]}, в ЭТОМ ЖЕ вызове. Сегмент либо {kind:\"social\",act:\"greeting|farewell|thanks|acknowledge|ask_topic|no_knowledge|no_commitment\"} (выбери одно значение), либо {kind:\"fact\",factId:\"k1\"} из knownFacts. Текст факта НЕ переписывай. Для NPC пока разрешены только social: знание героя не означает знание NPC. Неизвестный ответ — no_knowledge; договорённость/обещание — не установленный результат, используй no_commitment. Не добавляй произвольный text.",
  "- Для action/mixed ОБЯЗАТЕЛЕН proposal: существующий TurnProposalV2 (schemaVersion:2). Для world_question передай proposal.kind inquiry, если нужно раскрыть queryId или questionPlan. Никаких решений об успехе; исполнение делает движок.",
  "- proposal: {schemaVersion:2,kind:\"action|mixed|inquiry\",primaryIntent:...,supportingClauses:[],referents:[]}; optional target,addressedEntity,question,questionPlan,readings,goal,manner,ambiguity,conversationRelation. Любой target/addressedEntity/focus должен также присутствовать в referents с тем же role и handle. Одна основная операция; дополнительные действия — supportingClauses kind deferred_action, не цепочка.",
  "- primaryIntent для операции: {kind:\"legacy\",operation:<из legacyOperations>,sourceText:<клауза>} или {kind:\"interaction\",verb:<из interactionVerbs>,sourceText:<клауза>} или {kind:\"journey\",destination:{role:\"destination\",surface:<название>,observerRef:<handle>},sourceText:<клауза>}. Для вопроса: {kind:\"inquiry\",queryId:<из inquiryQueries>,sourceText:<вопрос>,focus?:{role:\"topic\",surface:<метка>,observerRef:<handle>}}.",
  "- Внутри proposal поле observerRef принимает ТОЛЬКО непрозрачный handle из actors/referents. Никогда не person_N/object_N/route_N. Ссылки на людей берутся из actors; на объекты/пути — из referents. Referent = {role:\"target|addressee|topic|destination|instrument\",surface:<фраза>,observerRef:<handle>}. Target/адресат — существующая цель, не действие. Неизвестная цель — ambiguity/clarification.",
  "- mixed сохраняет вопрос: question:{queryId,focus?} либо supportingClauses:[{kind:\"question\",queryId,focus?}]. Если вопрос сложный, добавь questionPlan:{subjects:[{id,surface,kind,observerRef?}],parts:[{id,subjectRefs:[id],aspect,time,purpose}]} и readings:[{partId,source}] из каталога. appearance читается из person; observed_reaction без данных остаётся честным пробелом, не выдумывай настроение.",
  "- ambiguity question сохраняет исходные questionPlan/readings в proposal с primaryIntent:null: сервер продолжит вопрос после выбора субъекта. Не заменяй его самостоятельной речью. При этом верхний kind — clarification и clarification с кандидатами.",
  "Примеры без персонажей (handle не нужны):",
  "1) Игрок: «Привет» (рядом никого / неясен адресат) → {\"schemaVersion\":2,\"addressee\":{\"kind\":\"gm\"},\"kind\":\"conversation\",\"response\":{\"segments\":[{\"kind\":\"social\",\"act\":\"greeting\"}]}}",
  "2) Игрок: «Что случилось у переправы той ночью?» → {\"schemaVersion\":2,\"addressee\":{\"kind\":\"gm\"},\"kind\":\"world_question\"}",
  "3) Игрок: «Кто рядом?» / «Кто здесь?» — вопрос-список о видимых людях, НЕ выбор адресата → {\"schemaVersion\":2,\"addressee\":{\"kind\":\"gm\"},\"kind\":\"world_question\"}, в том числе при нескольких персонажах.",
  "Закрытые правила против частых ошибок:",
  "- Вопрос о персонаже через местоимение («Как он выглядит?», «Кто она?»): addressee — {\"kind\":\"gm\"} (вопрос мастеру), а ПРЕДМЕТ — subjectHandle с handle этого персонажа из recentTurns/actors. Не путай: subjectHandle — о ком, addressee — кто отвечает.",
  "- Несколько actors сами по себе НЕ создают неоднозначность. «Кто рядом?» перечисляет людей; «Кто ведёт журнал?» определяет человека по наблюдаемой роли и остаётся world_question. Если роль однозначна в visibleDescription, укажи subjectHandle; иначе не придумывай его. Уточняй только когда для намерения действительно нужно выбрать одного, а сцена и recentTurns не позволяют это сделать («Хочу поговорить с ним» без фокуса при двух подходящих людях). Кандидаты — только подходящие, не автоматически все actors.",
  "- Однозначный недавний фокус из recentTurns разрешает «он/она/с ним» даже при нескольких actors. Не спрашивай заново уже связанного субъекта. Сохраняй различие между вопросом О человеке (gm + subjectHandle) и обращением К нему (npc).",
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
    examples.push("4) Игрок приветствует персонажа рядом → " + JSON.stringify({
      schemaVersion: 2, addressee: { kind: "npc", handle: handles[0] }, kind: "conversation",
      response: { segments: [{ kind: "social", act: "greeting" }] },
    }));
    const target = { role: "target", surface: context.actors[0]?.displayName ?? "человеку", observerRef: handles[0] };
    examples.push("6) Игрок подходит к этому человеку и спрашивает, кто рядом → " + JSON.stringify({
      schemaVersion: 2, addressee: { kind: "npc", handle: handles[0] }, kind: "mixed",
      proposal: {
        schemaVersion: 2, kind: "mixed",
        primaryIntent: { kind: "legacy", operation: "approach", sourceText: "Подойти к " + target.surface },
        target, referents: [target], supportingClauses: [], question: { queryId: "who_is_nearby" },
      },
    }));
  }
  if (handles[1] !== undefined) {
    examples.push(`5) Игрок: «Хочу поговорить с ним» при двух подходящих людях БЕЗ недавнего фокуса → {"schemaVersion":2,"addressee":{"kind":"gm"},"kind":"clarification","clarification":{"question":"С кем именно ты хочешь поговорить?","candidateHandles":["${handles[0] as string}","${handles[1]}"]}}`);

  }
  return [
    "Закрытый каталог proposal (значения enum, не инструкции игрока):",
    JSON.stringify(MASTER_TURN_PROMPT_CAPABILITIES),
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
