import type { NarrativeSnapshot, NarrativeEntry } from "./narrative.js";
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

  const systemPrompt = "Skald — симуляция живого мира. Ты — повествователь. Описывай события мира в художественной форме, на русском, 2-3 предложения. Переформулируй строго по переданным фактам — не добавляй новые события, не изменяй мир, не принимай решений, не описывай мысли или намерения игрока.";

  const userContent = JSON.stringify({ entries: snapshot.entries, worldTime: snapshot.worldTime, playerPosition: snapshot.playerPosition });

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
