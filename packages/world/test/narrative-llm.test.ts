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
      { kind: "world", timestamp: 5, text: "Ты находишься на позиции (0, 0).", sourceEventIds: [], importance: "background", discoveryMark: null },
    ],
    presentation: {
      primary: null, notable: [], background: [], suppressedEventCount: 0,
      worldTime: 5, playerPosition: { x: 0, y: 0 },
    },
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

  it("prompt contains primary+notable but NOT background", async () => {
    const router = await mockRouter();
    const chatSpy = vi.spyOn(router, "chat");
    const { narrateLLM } = await import("../src/narrative-llm.js");
    const snapshot: NarrativeSnapshot = {
      entries: [
        { kind: "world", timestamp: 5, text: "background entry", sourceEventIds: [], importance: "background", discoveryMark: null },
      ],
      presentation: {
        primary: { kind: "action", importance: "primary", discoveryMark: null, text: "primary text", timestamp: 5, sourceEventIds: ["e-1"] },
        notable: [{ kind: "observation", importance: "notable", discoveryMark: null, text: "notable text", timestamp: 5, sourceEventIds: ["e-2"] }],
        background: [{ kind: "world", importance: "background", discoveryMark: null, text: "bg", timestamp: 5, sourceEventIds: [] }],
        suppressedEventCount: 2,
        worldTime: 5,
        playerPosition: { x: 0, y: 0 },
      },
      worldTime: 5,
      playerPosition: { x: 0, y: 0 },
    };
    await narrateLLM(snapshot, router);
    const messages = chatSpy.mock.calls[0]?.[1] as any[];
    const userContent = messages[1]!.content as string;
    const parsed = JSON.parse(userContent);
    // Should contain primary and notable
    expect(parsed.entries.some((e: any) => e.text === "primary text")).toBe(true);
    expect(parsed.entries.some((e: any) => e.text === "notable text")).toBe(true);
    // Should NOT contain background entries
    expect(parsed.entries.some((e: any) => e.text === "bg")).toBe(false);
    expect(parsed.entries.some((e: any) => e.text === "background entry")).toBe(false);
  });
});
