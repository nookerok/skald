import { describe, it, expect, vi } from "vitest";
import type { TurnPresentation } from "../src/presentation/types.js";

const PRIMARY_TEXT = "Ты шагнул на тропу, и лес насторожился.";

function pres(primary: boolean): TurnPresentation {
  return {
    response: null,
    primary: primary
      ? { kind: "action", importance: "primary", discoveryMark: null, epistemicClass: "observed_fact", text: PRIMARY_TEXT, timestamp: 7, sourceEventIds: ["e-1"], threadKey: null, threadLabel: null }
      : null,
    notable: [],
    background: [],
    suppressedEventCount: 0,
    worldTime: 7,
    playerPosition: { x: 1, y: 2 },
  };
}

function narrationJson(narration: string, claims: unknown[] = [{ text: narration, sourceFactId: "primary", epistemicClass: "observed_fact" }]): string {
  return JSON.stringify({ narration, claims });
}

async function mockRouter(text: string = narrationJson("Дерзкий шаг взбудоражил тёмный лес у дороги.")) {
  const { ModelRouter } = await import("../src/llm/router.js");
  const router = new ModelRouter({ apiKey: "test-key" });
  vi.spyOn(router, "chat").mockResolvedValue({
    text,
    model: "deepseek-v4-flash-free",
    configuredModel: "deepseek-v4-flash-free",
    responseModel: "deepseek-v4-flash-free",
    usedFallback: false,
    latencyMs: 120,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    provider: "opencode_zen",
  });
  return router;
}

describe("narrateTurnLLM outcome and metadata in diagnostics", () => {
  it("emits outcome=success and model/configuredModel on successful call", async () => {
    const router = await mockRouter(narrationJson("Тихий вечер."));
    const events: unknown[] = [];
    const sink = (e: unknown) => events.push(e);

    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("идти на восток", pres(true), router, {
      diagnostics: sink,
      worldId: "w-diag-1",
      correlationId: "cmd-42",
    });
    expect(result.usedFallback).toBe(false);

    const llmEvents = events.filter((e: any) => e.kind === "llm");
    expect(llmEvents.length).toBe(1);
    const evt = llmEvents[0] as any;
    expect(evt.category).toBe("success");
    expect(evt.outcome).toBe("success");
    expect(evt.model).toBe("deepseek-v4-flash-free");
    expect(evt.configuredModel).toBe("deepseek-v4-flash-free");
    expect(evt.worldId).toBe("w-diag-1");
    expect(evt.correlationId).toBe("cmd-42");
    expect(evt.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("emits outcome=deterministic_fallback for no_api_key", async () => {
    const events: unknown[] = [];
    const sink = (e: unknown) => events.push(e);

    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("идти на восток", pres(true), null, {
      diagnostics: sink,
      worldId: "w-nokey",
      correlationId: "cmd-nokey",
    });
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("no_api_key");

    const llmEvents = events.filter((e: any) => e.kind === "llm");
    expect(llmEvents.length).toBe(1);
    const evt = llmEvents[0] as any;
    expect(evt.outcome).toBe("deterministic_fallback");
    expect(evt.category).toBe("no_api_key");
    expect(evt.worldId).toBe("w-nokey");
    expect(evt.correlationId).toBe("cmd-nokey");
  });

  it("emits outcome=deterministic_fallback for schema_rejection (epistemic violation)", async () => {
    const badClaim = { text: "точно", sourceFactId: "primary", epistemicClass: "established_fact" };
    const router = await mockRouter(narrationJson("Точно.", [badClaim]));
    const events: unknown[] = [];
    const sink = (e: unknown) => events.push(e);

    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("идти на восток", pres(true), router, {
      diagnostics: sink,
      worldId: "w-schema",
    });
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toMatch("epistemic_violation:");

    const llmEvents = events.filter((e: any) => e.kind === "llm");
    const evt = llmEvents[0] as any;
    expect(evt.outcome).toBe("deterministic_fallback");
    expect(evt.category).toBe("schema_rejection");
    expect(evt.model).toBeDefined();
    expect(evt.configuredModel).toBeDefined();
  });

  it("emits outcome=deterministic_fallback on chat error (non-transient)", async () => {
    const router = await mockRouter();
    vi.spyOn(router, "chat").mockRejectedValue(new Error("empty response"));
    const events: unknown[] = [];
    const sink = (e: unknown) => events.push(e);

    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("идти на восток", pres(true), router, {
      diagnostics: sink,
      worldId: "w-error",
      maxRetries: 1,
      retryBaseMs: 1,
    });
    expect(result.usedFallback).toBe(true);

    const llmEvents = events.filter((e: any) => e.kind === "llm");
    const evt = llmEvents[0] as any;
    expect(evt.outcome).toBe("deterministic_fallback");
    expect(evt.category).toBe("empty_response");
  });

  it("emits outcome=retry_exhausted on transient errors after max retries", async () => {
    const { ModelRouter } = await import("../src/llm/router.js");
    const router = new ModelRouter({ apiKey: "test-key" });
    vi.spyOn(router, "chat").mockRejectedValue(new Error("HTTP 503: Service Unavailable"));
    const events: unknown[] = [];
    const sink = (e: unknown) => events.push(e);

    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("идти на восток", pres(true), router, {
      diagnostics: sink,
      worldId: "w-exhaust",
      maxRetries: 2,
      retryBaseMs: 1,
    });
    expect(result.usedFallback).toBe(true);

    const llmEvents = events.filter((e: any) => e.kind === "llm");
    expect(llmEvents.length).toBe(3);
    // Last attempt has outcome=retry_exhausted
    const lastEvt = llmEvents[2] as any;
    expect(lastEvt.outcome).toBe("retry_exhausted");
    expect(lastEvt.retryOutcome).toBe("exhausted");
    // Earlier attempts are explicitly marked as retrying, not as a completed
    // deterministic fallback.
    const firstEvt = llmEvents[0] as any;
    expect(firstEvt.outcome).toBe("retrying");
  });

  it("emits outcome=provider_failover when router uses a non-configured model successfully", async () => {
    const { ModelRouter } = await import("../src/llm/router.js");
    const router = new ModelRouter({ apiKey: "test-key" });
    vi.spyOn(router, "chat").mockResolvedValue({
      text: narrationJson("Оллима ответила."),
      model: "gemma4:31b",
      configuredModel: "deepseek-v4-flash-free",
      responseModel: "gemma4:31b",
      usedFallback: true,
      configuredProvider: "opencode_zen",
      latencyMs: 200,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      provider: "ollama_cloud",
    });
    const events: unknown[] = [];
    const sink = (e: unknown) => events.push(e);

    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("идти на восток", pres(true), router, {
      diagnostics: sink,
      worldId: "w-failover",
    });
    expect(result.usedFallback).toBe(false);

    const llmEvents = events.filter((e: any) => e.kind === "llm");
    const evt = llmEvents[0] as any;
    expect(evt.outcome).toBe("provider_failover");
    expect(evt.category).toBe("success");
    expect(evt.model).toBe("gemma4:31b");
    expect(evt.configuredModel).toBe("deepseek-v4-flash-free");
    expect(evt.worldId).toBe("w-failover");
  });

  it("does not call a same-provider model fallback provider_failover", async () => {
    const { ModelRouter } = await import("../src/llm/router.js");
    const router = new ModelRouter({ apiKey: "test-key", providerId: "opencode_zen" });
    vi.spyOn(router, "chat").mockResolvedValue({
      text: narrationJson("Другой моделью, но тем же провайдером."),
      model: "nemotron-3-ultra-free",
      configuredModel: "deepseek-v4-flash-free",
      configuredProvider: "opencode_zen",
      responseModel: "nemotron-3-ultra-free",
      usedFallback: true,
      latencyMs: 100,
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      provider: "opencode_zen",
    });
    const events: unknown[] = [];

    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    await narrateTurnLLM("идти на восток", pres(true), router, { diagnostics: (e) => events.push(e) });

    const evt = events.find((e: any) => e.kind === "llm") as any;
    expect(evt.outcome).toBe("success");
    expect(evt.model).toBe("nemotron-3-ultra-free");
    expect(evt.configuredModel).toBe("deepseek-v4-flash-free");
  });

  it("includes attempted and configured model metadata on provider failure", async () => {
    const { ModelRouter } = await import("../src/llm/router.js");
    const router = new ModelRouter({ apiKey: "test-key", providerId: "opencode_zen" });
    const failure = Object.assign(new Error("HTTP 503: Service Unavailable"), {
      provider: "ollama_cloud",
      model: "gemma4:31b",
      configuredModel: "deepseek-v4-flash-free",
    });
    vi.spyOn(router, "chat").mockRejectedValue(failure);
    const events: unknown[] = [];

    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    await narrateTurnLLM("идти на восток", pres(true), router, { maxRetries: 0, diagnostics: (e) => events.push(e) });

    const evt = events.find((e: any) => e.kind === "llm") as any;
    expect(evt.model).toBe("gemma4:31b");
    expect(evt.configuredModel).toBe("deepseek-v4-flash-free");
  });
});
