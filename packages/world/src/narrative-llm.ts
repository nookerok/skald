import type { NarrativeSnapshot, NarrativeEntry } from "./narrative.js";
import type { EpistemicNarrativeFact, TurnPresentation } from "./presentation/types.js";
import { ModelRouter } from "./llm/router.js";
import type { ChatMessage, ChatResult } from "./llm/types.js";

export interface NarrativeLLMResult {
  readonly text: string;
  readonly usedFallback: boolean;
  readonly fallbackReason: string | null;
  readonly model: string;
  readonly latencyMs: number;
}

function templateText(entries: readonly NarrativeEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    if (e.kind !== "world" && e.kind !== "tick") {
      lines.push(e.text);
    }
  }
  // add world state entries at end
  for (const e of entries) {
    if (e.kind === "world") {
      lines.push(e.text);
    }
  }
  return lines.join("\n");
}

/**
 * §6 Authority Hierarchy: этот адаптер — самый нижний уровень иерархии.
 * Он НЕ имеет доступа к EventBus, Projection (кроме read-only snapshot'а на входе),
 * RuleEngine или кому бы то ни было из infra/игрового кода, способному менять мир.
 * Единственный output — строка текста для игрока. Архитектурная граница,
 * а не system prompt, гарантирует §6. Prompt — дополнительное ограничение.
 */
export async function narrateLLM(
  snapshot: NarrativeSnapshot,
  router: ModelRouter | null,
  _opts?: { locale?: "ru" | "en" },
): Promise<NarrativeLLMResult> {
  if (!router || !router.apiKey) {
    return {
      text: templateText(snapshot.entries),
      usedFallback: true,
      fallbackReason: "no_api_key",
      model: "",
      latencyMs: 0,
    };
  }

  const systemPrompt = "Skald — симуляция живого мира. Ты — повествователь. Описывай события мира в художественной форме, на русском, 2-3 предложения. Переформулируй строго по переданным фактам — не добавляй новые события, не изменяй мир, не принимай решений, не описывай мысли или намерения игрока." + EPISTEMIC_PROMPT;

  // Only primary and notable — no background, no world-state projection entries
  const llmEntries = snapshot.presentation?.primary
    ? [snapshot.presentation.primary, ...snapshot.presentation.notable]
    : [];
  const userContent = JSON.stringify({ entries: llmEntries.map((entry): EpistemicNarrativeFact => ({ text: entry.text, epistemicClass: entry.epistemicClass, sourceEventIds: entry.sourceEventIds })), worldTime: snapshot.worldTime, playerPosition: snapshot.playerPosition });

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  try {
    const result: ChatResult = await router.chat("narrate", messages);
    return {
      text: result.text,
      usedFallback: false,
      fallbackReason: null,
      model: result.model,
      latencyMs: result.latencyMs,
    };
  } catch (err) {
    return {
      text: templateText(snapshot.entries),
      usedFallback: true,
      fallbackReason: "chat_error",
      model: "",
      latencyMs: 0,
    };
  }
}

/**
 * Non-authoritative literary narration for one player turn (ADR-0024 voices).
 * The LLM rephrases only the facts already selected by the deterministic
 * Presentation logic (turn `primary` + up to three `notable`s) and the player's
 * own action as a given cause. It never selects facts/importance, never emits
 * Domain Events, never writes Projection, and never decides an outcome — it
 * only produces prose text (alignment with AGENTS §4). Callers persist this as
 * a read-side journal decoration.
 */
export interface TurnNarration {
  readonly text: string;
  readonly model: string;
  readonly usedFallback: boolean;
  readonly fallbackReason: string | null;
  readonly latencyMs: number;
}

const EPISTEMIC_PROMPT = "Сохраняй классы epistemic: established_fact утверждай прямо; observed_fact подавай как увиденное; testimony привязывай к источнику; inference и interpretation оформляй как предположение. Никогда не повышай класс и не превращай testimony, belief или interpretation в установленный факт.";
const DND_SYSTEM_PROMPT =
  "Ты — рассказчик тёмного мира в духе D&D. Опиши этот ход художественно, по-русски, 2-4 предложения, в прошедшем времени, с атмосферой. " +
  "Перескажи только факты ниже и результат действия: ничего не придумывай, не выбирай за игрока, не описывай его мысли или будущие намерения. Твоё описание ничего не меняет в симуляции." + EPISTEMIC_PROMPT;

function fallbackNarration(presentation: TurnPresentation, reason: string): TurnNarration {
  return {
    text: presentation.primary?.text ?? "Мир продолжал дышать вокруг тебя.",
    model: "",
    usedFallback: true,
    fallbackReason: reason,
    latencyMs: 0,
  };
}

export async function narrateTurnLLM(
  playerAction: string,
  presentation: TurnPresentation,
  router: ModelRouter | null,
): Promise<TurnNarration> {
  if (!router || !router.apiKey) {
    return fallbackNarration(presentation, "no_api_key");
  }

  const facts = [
    { role: "primary", text: presentation.primary?.text ?? null, epistemicClass: presentation.primary?.epistemicClass ?? "observed_fact", sourceEventIds: presentation.primary?.sourceEventIds ?? [] },
    ...presentation.notable.slice(0, 3).map((e) => ({ role: "notable", text: e.text, epistemicClass: e.epistemicClass, sourceEventIds: e.sourceEventIds })),
  ].filter((f) => f.text !== null);

  const userContent = JSON.stringify({
    playerAction,
    turnFacts: facts.map((f) => ({ role: f.role, text: f.text, epistemicClass: f.epistemicClass, sourceEventIds: f.sourceEventIds })),
    worldTime: presentation.worldTime,
    playerPosition: presentation.playerPosition,
  });

  const messages: ChatMessage[] = [
    { role: "system", content: DND_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];

  try {
    const result: ChatResult = await router.chat("narrate", messages);
    return {
      text: result.text.trim(),
      model: result.model,
      usedFallback: false,
      fallbackReason: null,
      latencyMs: result.latencyMs,
    };
  } catch (err) {
    return fallbackNarration(presentation, "chat_error");
  }
}
