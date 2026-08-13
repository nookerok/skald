import { ModelRouter } from "@skald/world";
import type { ChatMessage, ChatResult } from "@skald/world";

/**
 * Stable non-network router for deterministic acceptance runs.
 * It narrates only the facts selected by Presentation and never interprets
 * player input, so the acceptance path still exercises the production intent
 * gateway in deterministic mode.
 */
export class FixedNarrationProvider extends ModelRouter {
  constructor() {
    super({
      apiKey: "acceptance-fixed",
      providerId: "opencode_zen",
      availableProviders: ["opencode_zen"],
      timeoutMs: 1,
    });
  }

  override async chat(category: "narrate" | "analyze" | "interpret", messages: readonly ChatMessage[]): Promise<ChatResult> {
    if (category !== "narrate") throw new Error(`fixed provider does not serve ${category}`);
    const user = messages.find((message) => message.role === "user")?.content ?? "";
    let fact = "Мир ответил на твой выбор.";
    try {
      const parsed = JSON.parse(user) as { turnFacts?: readonly { text?: unknown }[] };
      const candidate = parsed.turnFacts?.find((entry) => typeof entry.text === "string")?.text;
      if (typeof candidate === "string" && candidate.length > 0) fact = candidate;
    } catch {
      // Keep the deterministic sentence when the request shape changes.
    }
    return {
      model: "acceptance-fixed-narrator",
      configuredModel: "acceptance-fixed-narrator",
      responseModel: "acceptance-fixed-narrator",
      usedFallback: false,
      text: `[Фиксированный мастер] ${fact}`,
      latencyMs: 0,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      provider: "opencode_zen",
    };
  }
}
