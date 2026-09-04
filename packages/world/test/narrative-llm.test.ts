import { describe, it, expect, vi } from "vitest";
import type { NarrativeSnapshot } from "../src/narrative.js";

function narrationJson(narration: string, claims: unknown[] = [{ text: narration, sourceFactId: "primary", epistemicClass: "observed_fact" }]): string {
  return JSON.stringify({ narration, claims });
}

async function mockRouter(text: string = narrationJson("Художественное описание.")) {
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
      response: null,
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
    const router = await mockRouter(narrationJson("Красивый текст."));
    const { narrateLLM } = await import("../src/narrative-llm.js");
    const result = await narrateLLM(emptySnapshot(), router);
    expect(result.usedFallback).toBe(false);
    expect(result.text).toBe("Красивый текст.");
    expect(result.model).toBe("deepseek-v4-flash-free");
  });

  it("falls back when the response upgrades an epistemic class", async () => {
    const claim = { text: "это точно факт", sourceFactId: "notable-0", epistemicClass: "established_fact" };
    const router = await mockRouter(narrationJson("Это точно факт.", [claim]));
    const { narrateLLM } = await import("../src/narrative-llm.js");
    const snapshot: NarrativeSnapshot = {
      entries: [{ kind: "world", timestamp: 5, text: "Ты на позиции.", sourceEventIds: [], importance: "background", discoveryMark: null }],
      presentation: {
        response: null,
        primary: { kind: "action", importance: "primary", discoveryMark: null, epistemicClass: "observed_fact", text: "ты шагнул", timestamp: 5, sourceEventIds: ["e-1"], threadKey: null, threadLabel: null },
        notable: [{ kind: "observation", importance: "notable", discoveryMark: null, epistemicClass: "testimony", text: "старец говорил", timestamp: 5, sourceEventIds: ["e-9"], threadKey: null, threadLabel: null }],
        background: [], suppressedEventCount: 0, worldTime: 5, playerPosition: { x: 0, y: 0 },
      },
      worldTime: 5,
      playerPosition: { x: 0, y: 0 },
    };
    const result = await narrateLLM(snapshot, router);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("epistemic_violation:class_upgrade");
    expect(result.text).toContain("Ты на позиции.");
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
        response: null,
        primary: { kind: "action", importance: "primary", discoveryMark: null, epistemicClass: "observed_fact", text: "primary text", timestamp: 5, sourceEventIds: ["e-1"], threadKey: null, threadLabel: null },
        notable: [{ kind: "observation", importance: "notable", discoveryMark: null, epistemicClass: "observed_fact", text: "notable text", timestamp: 5, sourceEventIds: ["e-2"], threadKey: null, threadLabel: null }],
        background: [{ kind: "world", importance: "background", discoveryMark: null, epistemicClass: "observed_fact", text: "bg", timestamp: 5, sourceEventIds: [], threadKey: null, threadLabel: null }],
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

describe("narrateLLM retry and diagnostics", () => {
  it("retries on transient network error and succeeds on second attempt", async () => {
    const { ModelRouter } = await import("../src/llm/router.js");
    const router = new ModelRouter({ apiKey: "test-key" });
    const goodResult = {
      text: narrationJson("Тьма отступила."),
      model: "deepseek-v4-flash-free",
      configuredModel: "deepseek-v4-flash-free",
      responseModel: "deepseek-v4-flash-free",
      usedFallback: false,
      latencyMs: 100,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      provider: "opencode_zen" as const,
    };
    const chatSpy = vi.spyOn(router, "chat")
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(goodResult);

    const { narrateLLM } = await import("../src/narrative-llm.js");
    const result = await narrateLLM(emptySnapshot(), router, { maxRetries: 2, retryBaseMs: 1 });
    expect(result.usedFallback).toBe(false);
    expect(result.text).toBe("Тьма отступила.");
    expect(chatSpy).toHaveBeenCalledTimes(2);
  });

  it("exhausts retries on persistent transient errors", async () => {
    const { ModelRouter } = await import("../src/llm/router.js");
    const router = new ModelRouter({ apiKey: "test-key" });
    vi.spyOn(router, "chat").mockRejectedValue(new Error("HTTP 503: Service Unavailable"));

    const { narrateLLM } = await import("../src/narrative-llm.js");
    const result = await narrateLLM(emptySnapshot(), router, { maxRetries: 2, retryBaseMs: 1 });
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("chat_error");
    expect(router.chat).toHaveBeenCalledTimes(3);
  });

  it("does not retry on non-transient errors", async () => {
    const { ModelRouter } = await import("../src/llm/router.js");
    const router = new ModelRouter({ apiKey: "test-key" });
    vi.spyOn(router, "chat").mockRejectedValue(new Error("empty response"));

    const { narrateLLM } = await import("../src/narrative-llm.js");
    const result = await narrateLLM(emptySnapshot(), router, { maxRetries: 2, retryBaseMs: 1 });
    expect(result.usedFallback).toBe(true);
    expect(router.chat).toHaveBeenCalledTimes(1);
  });

  it("emits diagnostic events through the sink", async () => {
    const { ModelRouter } = await import("../src/llm/router.js");
    const router = new ModelRouter({ apiKey: "test-key" });
    vi.spyOn(router, "chat").mockRejectedValue(new Error("fetch failed"));

    const events: unknown[] = [];
    const sink = (e: unknown) => events.push(e);

    const { narrateLLM } = await import("../src/narrative-llm.js");
    await narrateLLM(emptySnapshot(), router, { maxRetries: 2, retryBaseMs: 1, diagnostics: sink });

    const llmEvents = events.filter((e: any) => e.kind === "llm");
    expect(llmEvents.length).toBe(3); // 3 attempts, no separate exhaustion event
    expect((llmEvents[0] as any).retryOutcome).toBe("none");
    expect((llmEvents[1] as any).retryOutcome).toBe("none");
    expect((llmEvents[2] as any).retryOutcome).toBe("exhausted");
  });

  it("no_api_key emits diagnostic and does not retry", async () => {
    const events: unknown[] = [];
    const sink = (e: unknown) => events.push(e);

    const { narrateLLM } = await import("../src/narrative-llm.js");
    const result = await narrateLLM(emptySnapshot(), null, { maxRetries: 2, retryBaseMs: 1, diagnostics: sink });
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("no_api_key");
    const llmEvents = events.filter((e: any) => e.kind === "llm");
    expect(llmEvents.length).toBe(1);
    expect((llmEvents[0] as any).category).toBe("no_api_key");
  });

  it("emits success category on successful LLM call", async () => {
    const router = await mockRouter(narrationJson("Тихий вечер."));
    const events: unknown[] = [];
    const sink = (e: unknown) => events.push(e);

    const { narrateLLM } = await import("../src/narrative-llm.js");
    const result = await narrateLLM(emptySnapshot(), router, { diagnostics: sink });
    expect(result.usedFallback).toBe(false);
    const llmEvents = events.filter((e: any) => e.kind === "llm");
    expect(llmEvents.length).toBe(1);
    expect((llmEvents[0] as any).category).toBe("success");
    expect((llmEvents[0] as any).provider).toBe("opencode_zen");
    expect((llmEvents[0] as any).timeout).toBeGreaterThan(0);
  });

  it("reports the provider attached to the actual router failure", async () => {
    const { ModelRouter } = await import("../src/llm/router.js");
    const router = new ModelRouter({ apiKey: "test-key", providerId: "opencode_zen" });
    const failure = Object.assign(new Error("HTTP 503: Service Unavailable"), { provider: "ollama_cloud" });
    vi.spyOn(router, "chat").mockRejectedValue(failure);
    const events: unknown[] = [];

    const { narrateLLM } = await import("../src/narrative-llm.js");
    await narrateLLM(emptySnapshot(), router, { maxRetries: 0, diagnostics: (e) => events.push(e) });

    const llmEvent = events.find((e: any) => e.kind === "llm") as any;
    expect(llmEvent.provider).toBe("ollama_cloud");
  });

  it("emits real timeout value from router", async () => {
    const { ModelRouter } = await import("../src/llm/router.js");
    const router = new ModelRouter({ apiKey: "test-key", timeoutMs: 5000 });
    vi.spyOn(router, "chat").mockResolvedValue({
      text: narrationJson("Тихий вечер."),
      model: "deepseek-v4-flash-free",
      configuredModel: "deepseek-v4-flash-free",
      responseModel: "deepseek-v4-flash-free",
      usedFallback: false,
      latencyMs: 100,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      provider: "opencode_zen",
    });
    const events: unknown[] = [];
    const sink = (e: unknown) => events.push(e);

    const { narrateLLM } = await import("../src/narrative-llm.js");
    await narrateLLM(emptySnapshot(), router, { diagnostics: sink });
    const llmEvents = events.filter((e: any) => e.kind === "llm");
    expect(llmEvents.length).toBe(1);
    expect((llmEvents[0] as any).timeout).toBe(5000);
  });

  it("passes provider diagnostics through turn narration failover", async () => {
    const { ModelRouter } = await import("../src/llm/router.js");
    const router = new ModelRouter({
      apiKey: "zen-key",
      providerId: "opencode_zen",
      providerKeys: { opencode_zen: "zen-key", ollama_cloud: "ollama-key" },
      availableProviders: ["opencode_zen", "ollama_cloud"],
      routeCandidates: {
        narrate: [
          { provider: "opencode_zen", model: "big-pickle", protocol: "openai_chat", tier: "catalog_candidate" },
          { provider: "ollama_cloud", model: "gemma4:31b-cloud", protocol: "ollama_chat", tier: "catalog_candidate" },
        ],
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => JSON.stringify({ error: { code: "model_not_found" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ model: "gemma4:31b-cloud", message: { content: narrationJson("Тихий вечер.") } }) });
    vi.stubGlobal("fetch", fetchMock);
    const events: unknown[] = [];

    try {
      const { narrateTurnLLM } = await import("../src/narrative-llm.js");
      const result = await narrateTurnLLM("осмотреться", emptySnapshot().presentation!, router, {
        diagnostics: (event) => events.push(event),
        correlationId: "turn-1",
      });
      expect(result.usedFallback).toBe(false);
      const providerEvents = events.filter((event: any) => event.kind === "provider") as any[];
      expect(providerEvents).toHaveLength(2);
      expect(providerEvents[0]).toMatchObject({ provider: "opencode_zen", model: "big-pickle", phase: "response_status", httpStatus: 404, providerCode: "model_not_found", outcome: "failed" });
      expect(providerEvents[1]).toMatchObject({ provider: "ollama_cloud", model: "gemma4:31b-cloud", outcome: "provider_failover", correlationId: "turn-1" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
