import { describe, it, expect, vi } from "vitest";

const ANSWER = "Рядом с тобой: «Перевозчик у переправы».";

function answerJson(narration: string, claims: unknown[] = [{ text: narration, sourceFactId: "answer", epistemicClass: "observed_fact" }]): string {
  return JSON.stringify({ narration, claims });
}

async function mockRouter(text: string) {
  const { ModelRouter } = await import("../src/llm/router.js");
  const router = new ModelRouter({ apiKey: "test-key" });
  const spy = vi.spyOn(router, "chat").mockResolvedValue({
    text,
    model: "deepseek-v4-flash-free",
    configuredModel: "deepseek-v4-flash-free",
    responseModel: "deepseek-v4-flash-free",
    usedFallback: false,
    latencyMs: 90,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    provider: "opencode_zen",
  });
  return { router, spy };
}

describe("narrateAnswerLLM (full-master Stage 3)", () => {
  it("falls back with no text when there is no api key, so the exact answer stays", async () => {
    const { narrateAnswerLLM } = await import("../src/narrative-llm.js");
    const result = await narrateAnswerLLM("кто рядом?", ANSWER, "inquiry_answer", 3, null);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("no_api_key");
    expect(result.text).toBe("");
  });

  it("falls back for an empty answer", async () => {
    const { narrateAnswerLLM } = await import("../src/narrative-llm.js");
    const result = await narrateAnswerLLM("кто рядом?", "   ", "inquiry_answer", 3, null);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("empty_answer");
  });

  it("returns the rephrase on success", async () => {
    const { router } = await mockRouter(answerJson("Перевозчик стоит рядом у плоскодонки."));
    const { narrateAnswerLLM } = await import("../src/narrative-llm.js");
    const result = await narrateAnswerLLM("кто рядом?", ANSWER, "inquiry_answer", 3, router);
    expect(result.usedFallback).toBe(false);
    expect(result.text).toBe("Перевозчик стоит рядом у плоскодонки.");
    expect(result.model).toBe("deepseek-v4-flash-free");
  });

  it("rejects a claim that cites a fact the answer never provided", async () => {
    const { router } = await mockRouter(answerJson("Новая выдумка.", [{ text: "Новая выдумка.", sourceFactId: "primary", epistemicClass: "observed_fact" }]));
    const { narrateAnswerLLM } = await import("../src/narrative-llm.js");
    const result = await narrateAnswerLLM("кто рядом?", ANSWER, "inquiry_answer", 3, router);
    expect(result.usedFallback).toBe(true);
    expect(result.text).toBe("");
  });

  it("rejects an epistemic upgrade above the answer fact", async () => {
    const { router } = await mockRouter(answerJson("Безусловно, перевозчик здесь.", [{ text: "Безусловно, перевозчик здесь.", sourceFactId: "answer", epistemicClass: "established_fact" }]));
    const { narrateAnswerLLM } = await import("../src/narrative-llm.js");
    const result = await narrateAnswerLLM("кто рядом?", ANSWER, "inquiry_answer", 3, router);
    expect(result.usedFallback).toBe(true);
  });

  it("uses a kind-aware system prompt that asks for a rephrase", async () => {
    const { router, spy } = await mockRouter(answerJson("Перевозчик рядом."));
    const { narrateAnswerLLM } = await import("../src/narrative-llm.js");
    await narrateAnswerLLM("кто рядом?", ANSWER, "inquiry_answer", 3, router);
    const messages = spy.mock.calls[0]![1] as readonly { role: string; content: string }[];
    const system = messages.find((message) => message.role === "system")!.content;
    const user = messages.find((message) => message.role === "user")!.content;
    expect(system).toContain("Перефразируй");
    expect(system).toContain('"answer"');
    expect(system).not.toContain("2-4 предложения");
    expect(JSON.parse(user)).toMatchObject({ answer: ANSWER, kind: "inquiry_answer" });

    await narrateAnswerLLM("что я умею?", "Ты умеешь читать дорожные знаки.", "meta_answer", 3, router);
    const metaSystem = (spy.mock.calls[1]![1] as readonly { role: string; content: string }[]).find((message) => message.role === "system")!.content;
    expect(metaSystem).not.toBe(system);
  });
});
