import { describe, it, expect, vi } from "vitest";
import type { TurnPresentation } from "../src/presentation/types.js";

const PRIMARY_TEXT = "Ты шагнул на тропу, и лес насторожился.";

function pres(primary: boolean, notable: readonly string[] = []): TurnPresentation {
  return {
    primary: primary
      ? { kind: "action", importance: "primary", discoveryMark: null, text: PRIMARY_TEXT, timestamp: 7, sourceEventIds: ["e-1"], threadKey: null, threadLabel: null }
      : null,
    notable: notable.map((text) => ({ kind: "observation", importance: "notable", discoveryMark: null, text, timestamp: 7, sourceEventIds: ["e-n"], threadKey: null, threadLabel: null })),
    background: [],
    suppressedEventCount: 0,
    worldTime: 7,
    playerPosition: { x: 1, y: 2 },
  };
}

async function mockRouter(text = "Дерзкий шаг взбудоражил тёмный лес у дороги.") {
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

describe("narrateTurnLLM", () => {
  it("falls back to the primary template when there is no api key", async () => {
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("идти на восток", pres(true), null);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("no_api_key");
    expect(result.text).toBe(PRIMARY_TEXT);
    expect(result.model).toBe("");
  });

  it("uses the atmospheric fallback when there is no primary and no key", async () => {
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("подождать", pres(false), null);
    expect(result.usedFallback).toBe(true);
    expect(result.text).toBe("Мир продолжал дышать вокруг тебя.");
  });

  it("returns the LLM text on success with usedFallback false", async () => {
    const router = await mockRouter("Тьма сомкнулась вокруг твоего шага.");
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("идти на восток", pres(true), router);
    expect(result.usedFallback).toBe(false);
    expect(result.text).toBe("Тьма сомкнулась вокруг твоего шага.");
    expect(result.model).toBe("deepseek-v4-flash-free");
    expect(result.latencyMs).toBe(120);
  });

  it("trims the LLM text", async () => {
    const router = await mockRouter("  Дорога шепчет.  ");
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("идти на восток", pres(true), router);
    expect(result.text).toBe("Дорога шепчет.");
  });

  it("falls back to the template on LLM error", async () => {
    const router = await mockRouter();
    vi.spyOn(router, "chat").mockRejectedValue(new Error("network error"));
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("идти на восток", pres(true), router);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("chat_error");
    expect(result.text).toBe(PRIMARY_TEXT);
  });

  it("sends the player action and only primary+notable facts, never background", async () => {
    const router = await mockRouter();
    const chatSpy = vi.spyOn(router, "chat");
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const presentation: TurnPresentation = {
      primary: { kind: "action", importance: "primary", discoveryMark: null, text: "шаг", timestamp: 7, sourceEventIds: ["e-1"], threadKey: null, threadLabel: null },
      notable: [{ kind: "consequence", importance: "notable", discoveryMark: null, text: "последствие дерзости", timestamp: 7, sourceEventIds: ["e-2"], threadKey: null, threadLabel: null }],
      background: [{ kind: "world", importance: "background", discoveryMark: null, text: "фон", timestamp: 7, sourceEventIds: [], threadKey: null, threadLabel: null }],
      suppressedEventCount: 0,
      worldTime: 7,
      playerPosition: { x: 1, y: 2 },
    };
    await narrateTurnLLM("осмотреть тропу", presentation, router);
    const messages = chatSpy.mock.calls[0]?.[1] as any[];
    const user = JSON.parse(messages[1]!.content);
    expect(user.playerAction).toBe("осмотреть тропу");
    expect(user.turnFacts.some((f: any) => f.text === "шаг")).toBe(true);
    expect(user.turnFacts.some((f: any) => f.text === "последствие дерзости")).toBe(true);
    expect(user.turnFacts.some((f: any) => f.text === "фон")).toBe(false);
  });

  it("binds the LLM to facts and forbids deciding the outcome", async () => {
    const router = await mockRouter();
    const chatSpy = vi.spyOn(router, "chat");
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    await narrateTurnLLM(" шагать", pres(true), router);
    const system = chatSpy.mock.calls[0]?.[1]?.[0] as any;
    expect(system.content).toContain("ничего не придумывай");
    expect(system.content).toContain("не выбирай за игрока");
  });
});