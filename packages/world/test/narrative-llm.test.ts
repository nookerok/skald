import { describe, it, expect, vi } from "vitest";
import type { NarrativeSnapshot } from "../src/narrative.js";

async function mockRouter(text = "Художественное описание.") {
  const { ModelRouter } = await import("../src/llm/router.js");
  const router = new ModelRouter({ apiKey: "test-key" });
  vi.spyOn(router, "chat").mockResolvedValue({
    text,
    model: "deepseek-v4-flash-free",
    configuredModel: "deepseek-v4-flash-free",
    responseModel: "deepseek-v4-flash-free",
    usedFallback: false,
    latencyMs: 100,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    provider: "opencode_zen",
  });
  return router;
}

function emptySnapshot(): NarrativeSnapshot {
  return {
    entries: [
      { kind: "world", timestamp: 5, text: "Ты находишься на позиции (0, 0).", sourceEventIds: [] },
    ],
    worldTime: 5,
    playerPosition: { x: 0, y: 0 },
  };
}

describe("narrateLLM", () => {
  it("falls back to template when no api key", async () => {
    const { narrateLLM } = await import("../src/narrative-llm.js");
    const result = await narrateLLM(emptySnapshot(), null);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("no_api_key");
    expect(result.text).toContain("находишься");
    expect(result.model).toBe("");
  });

  it("returns LLM text on success", async () => {
    const router = await mockRouter("Красивый текст.");
    const { narrateLLM } = await import("../src/narrative-llm.js");
    const result = await narrateLLM(emptySnapshot(), router);
    expect(result.usedFallback).toBe(false);
    expect(result.text).toBe("Красивый текст.");
    expect(result.model).toBe("deepseek-v4-flash-free");
  });

  it("falls back to template on LLM error", async () => {
    const router = await mockRouter();
    vi.spyOn(router, "chat").mockRejectedValue(new Error("network error"));
    const { narrateLLM } = await import("../src/narrative-llm.js");
    const result = await narrateLLM(emptySnapshot(), router);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("chat_error");
    expect(result.text).toContain("находишься");
  });

  it("system prompt forbids decision-making", async () => {
    const router = await mockRouter();
    const chatSpy = vi.spyOn(router, "chat");
    const { narrateLLM } = await import("../src/narrative-llm.js");
    await narrateLLM(emptySnapshot(), router);
    const messages = chatSpy.mock.calls[0]?.[1] as any[];
    expect(messages[0]!.content).toContain("не принимай решений");
  });

  it("does not mutate snapshot", async () => {
    const router = await mockRouter();
    const { narrateLLM } = await import("../src/narrative-llm.js");
    const snapshot = emptySnapshot();
    const entriesBefore = snapshot.entries.length;
    await narrateLLM(snapshot, router);
    expect(snapshot.entries.length).toBe(entriesBefore);
  });
});
