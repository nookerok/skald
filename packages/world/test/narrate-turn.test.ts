import { describe, it, expect, vi } from "vitest";
import type { TurnPresentation } from "../src/presentation/types.js";

const PRIMARY_TEXT = "Ты шагнул на тропу, и лес насторожился.";

function pres(primary: boolean, notable: readonly string[] = []): TurnPresentation {
  return {
    primary: primary
      ? { kind: "action", importance: "primary", discoveryMark: null, epistemicClass: "observed_fact", text: PRIMARY_TEXT, timestamp: 7, sourceEventIds: ["e-1"], threadKey: null, threadLabel: null }
      : null,
    notable: notable.map((text) => ({ kind: "observation", importance: "notable", discoveryMark: null, epistemicClass: "observed_fact", text, timestamp: 7, sourceEventIds: ["e-n"], threadKey: null, threadLabel: null })),
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
    const router = await mockRouter(narrationJson("Тьма сомкнулась вокруг твоего шага."));
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("идти на восток", pres(true), router);
    expect(result.usedFallback).toBe(false);
    expect(result.text).toBe("Тьма сомкнулась вокруг твоего шага.");
    expect(result.model).toBe("deepseek-v4-flash-free");
    expect(result.latencyMs).toBe(120);
  });

  it("trims the LLM text", async () => {
    const router = await mockRouter(narrationJson("  Дорога шепчет.  "));
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
      primary: { kind: "action", importance: "primary", discoveryMark: null, epistemicClass: "observed_fact", text: "шаг", timestamp: 7, sourceEventIds: ["e-1"], threadKey: null, threadLabel: null },
      notable: [{ kind: "consequence", importance: "notable", discoveryMark: null, epistemicClass: "observed_fact", text: "последствие дерзости", timestamp: 7, sourceEventIds: ["e-2"], threadKey: null, threadLabel: null }],
      background: [{ kind: "world", importance: "background", discoveryMark: null, epistemicClass: "observed_fact", text: "фон", timestamp: 7, sourceEventIds: [], threadKey: null, threadLabel: null }],
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
    expect(user.turnFacts.find((f: any) => f.text === "шаг")?.id).toBe("primary");
    expect(user.turnFacts.find((f: any) => f.text === "последствие дерзости")?.id).toBe("notable-0");
    expect(user.turnFacts.find((f: any) => f.text === "последствие дерзости")?.epistemicClass).toBe("observed_fact");
    expect(user.turnFacts.find((f: any) => f.text === "последствие дерзости")?.sourceEventIds).toEqual(["e-2"]);
  });

  it("binds the LLM to facts and forbids deciding the outcome", async () => {
    const router = await mockRouter();
    const chatSpy = vi.spyOn(router, "chat");
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    await narrateTurnLLM(" шагать", pres(true), router);
    const system = chatSpy.mock.calls[0]?.[1]?.[0] as any;
    expect(system.content).toContain("ничего не придумывай");
    expect(system.content).toContain("не выбирай за игрока");
    expect(system.content).toContain("testimony");
    expect(system.content).toContain("не повышай класс");
    expect(system.content).toContain("sourceFactId");
    expect(system.content).toContain("epistemicClass");
  });

  it("rejects narration that upgrades a testimony fact to established_fact", async () => {
    const testimony = { text: "старец сказал", sourceFactId: "notable-0", epistemicClass: "established_fact" };
    const router = await mockRouter(narrationJson("Старец подтвердил, что это правда.", [testimony]));
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const presentation: TurnPresentation = {
      primary: { kind: "action", importance: "primary", discoveryMark: null, epistemicClass: "observed_fact", text: PRIMARY_TEXT, timestamp: 7, sourceEventIds: ["e-1"], threadKey: null, threadLabel: null },
      notable: [{ kind: "observation", importance: "notable", discoveryMark: null, epistemicClass: "testimony", text: "слух от старца", timestamp: 7, sourceEventIds: ["e-2"], threadKey: null, threadLabel: null }],
      background: [], suppressedEventCount: 0, worldTime: 7, playerPosition: { x: 1, y: 2 },
    };
    const result = await narrateTurnLLM("идти на восток", presentation, router);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("epistemic_violation:class_upgrade");
    expect(result.text).toBe(PRIMARY_TEXT);
  });

  it("rejects narration claiming an established fact when the source is only an interpretation", async () => {
    const interpretation = { text: "это знак", sourceFactId: "notable-0", epistemicClass: "established_fact" };
    const router = await mockRouter(narrationJson("Точно известно, что это знак.", [interpretation]));
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const presentation: TurnPresentation = {
      primary: { kind: "action", importance: "primary", discoveryMark: null, epistemicClass: "observed_fact", text: PRIMARY_TEXT, timestamp: 7, sourceEventIds: ["e-1"], threadKey: null, threadLabel: null },
      notable: [{ kind: "observation", importance: "notable", discoveryMark: null, epistemicClass: "interpretation", text: "это может быть знаком", timestamp: 7, sourceEventIds: ["e-2"], threadKey: null, threadLabel: null }],
      background: [], suppressedEventCount: 0, worldTime: 7, playerPosition: { x: 1, y: 2 },
    };
    const result = await narrateTurnLLM("идти на восток", presentation, router);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("epistemic_violation:class_upgrade");
  });

  it("rejects a claim tied to an unknown source fact id", async () => {
    const claim = { text: "что-то", sourceFactId: "bogus", epistemicClass: "observed_fact" };
    const router = await mockRouter(narrationJson("Что-то произошло.", [claim]));
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("идти на восток", pres(true), router);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("epistemic_violation:unknown_source");
  });

  it("rejects a non-JSON LLM response", async () => {
    const router = await mockRouter("Просто художественный текст без структуры.");
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("идти на восток", pres(true), router);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("epistemic_violation:invalid_json");
  });

  it("rejects narration with an invalid epistemic class", async () => {
    const claim = { text: "это точно", sourceFactId: "primary", epistemicClass: "factual_certainty" };
    const router = await mockRouter(narrationJson("Это точно.", [claim]));
    const { narrateTurnLLM } = await import("../src/narrative-llm.js");
    const result = await narrateTurnLLM("идти на восток", pres(true), router);
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBe("epistemic_violation:invalid_json");
  });
});

describe("verifyEpistemicNarration", () => {
  const facts = [
    { id: "primary", epistemicClass: "established_fact" as const },
    { id: "notable-0", epistemicClass: "testimony" as const },
  ];

  it("accepts a claim that does not upgrade its source class", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({ narration: "Река течёт.", claims: [{ text: "Река течёт.", sourceFactId: "primary", epistemicClass: "observed_fact" }] });
    expect(verifyEpistemicNarration(response, facts)).toEqual({ ok: true, narration: "Река течёт." });
  });

  it("rejects a claim that upgrades testimony to established_fact", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({ narration: "Правда.", claims: [{ text: "Правда.", sourceFactId: "notable-0", epistemicClass: "established_fact" }] });
    expect(verifyEpistemicNarration(response, facts).ok).toBe(false);
    expect(verifyEpistemicNarration(response, facts)).toMatchObject({ ok: false, reason: "class_upgrade" });
  });

  it("accepts a same-class claim", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({ narration: "Старец сказал.", claims: [{ text: "Старец сказал.", sourceFactId: "notable-0", epistemicClass: "testimony" }] });
    expect(verifyEpistemicNarration(response, facts)).toEqual({ ok: true, narration: "Источник сообщает: «Старец сказал.»" });
  });

  it("rejects a claim referencing an unknown fact", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({ narration: "x", claims: [{ text: "x", sourceFactId: "nope", epistemicClass: "observed_fact" }] });
    expect(verifyEpistemicNarration(response, facts)).toEqual({ ok: false, reason: "unknown_source" });
  });

  it("rejects non-JSON input", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    expect(verifyEpistemicNarration("просто текст", facts)).toEqual({ ok: false, reason: "invalid_json" });
  });

  it("drops an unclaimed proposition from the free-form narration field", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({
      narration: "Башня пуста, спору нет.",
      claims: [{ text: "Река течёт.", sourceFactId: "primary", epistemicClass: "observed_fact" }],
    });
    expect(verifyEpistemicNarration(response, facts)).toEqual({ ok: true, narration: "Река течёт." });
  });

  it("rejects narration with no claims when facts were provided", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({ narration: "Красиво.", claims: [] });
    expect(verifyEpistemicNarration(response, facts)).toEqual({ ok: false, reason: "missing_claims" });
  });

  it("rejects claims when no facts were provided at all", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({ narration: "Красиво.", claims: [{ text: "Красиво.", sourceFactId: "x", epistemicClass: "observed_fact" }] });
    expect(verifyEpistemicNarration(response, [])).toEqual({ ok: false, reason: "unexpected_claims" });
  });

  it("accepts an empty-claims narration when no facts were provided", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({ narration: "Мир дышит.", claims: [] });
    expect(verifyEpistemicNarration(response, [])).toEqual({ ok: true, narration: "Мир дышит." });
  });

  it("extracts JSON from a response with surrounding prose", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = `Здесь пояснение.\n\`\`\`json\n${JSON.stringify({ narration: "Река.", claims: [{ text: "Река.", sourceFactId: "primary", epistemicClass: "observed_fact" }] })}\n\`\`\`\nконец.`;
    expect(verifyEpistemicNarration(response, facts)).toEqual({ ok: true, narration: "Река." });
  });

  it("ranks epistemic classes so established_fact is stronger than testimony", async () => {
    const { epistemicStrength } = await import("../src/narrative-llm.js");
    expect(epistemicStrength("established_fact")).toBeGreaterThan(epistemicStrength("testimony"));
    expect(epistemicStrength("testimony")).toBeGreaterThan(epistemicStrength("interpretation"));
  });

  it("isEpistemicClass accepts only the five canonical classes", async () => {
    const { isEpistemicClass } = await import("../src/narrative-llm.js");
    expect(isEpistemicClass("established_fact")).toBe(true);
    expect(isEpistemicClass("interpretation")).toBe(true);
    expect(isEpistemicClass("certainty")).toBe(false);
  });

  it("rejects the Russian certainty formulation that previously bypassed the guard", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({
      narration: "Достоверно установлено, что башня пуста.",
      claims: [{ text: "Достоверно установлено, что башня пуста.", sourceFactId: "notable-0", epistemicClass: "testimony" }],
    });
    expect(verifyEpistemicNarration(response, facts)).toEqual({ ok: false, reason: "certainty_overclaim" });
  });

  it("keeps an unlisted certainty formulation explicitly source-scoped", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({
      narration: "Башня пуста, спору нет.",
      claims: [{ text: "Башня пуста.", sourceFactId: "notable-0", epistemicClass: "testimony" }],
    });
    expect(verifyEpistemicNarration(response, facts)).toEqual({
      ok: true,
      narration: "Источник сообщает: «Башня пуста.»",
    });
  });

  it("rejects a claim whose text asserts absolute certainty but is labeled testimony", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({
      narration: "Старец рассказал эту историю.",
      claims: [{ text: "This is unquestionably established truth.", sourceFactId: "notable-0", epistemicClass: "testimony" }],
    });
    expect(verifyEpistemicNarration(response, facts)).toEqual({ ok: false, reason: "certainty_overclaim" });
  });

  it("rejects a claim that upgrades testimony to established_fact by wording alone", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({
      narration: "Старец рассказал эту историю.",
      claims: [{ text: "Это несомненно так.", sourceFactId: "notable-0", epistemicClass: "testimony" }],
    });
    expect(verifyEpistemicNarration(response, facts)).toEqual({ ok: false, reason: "certainty_overclaim" });
  });

  it("accepts a weak-class claim without absolute-certainty phrasing", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({
      narration: "Старец рассказал, что где-то в горах шумят воды.",
      claims: [{ text: "Старец рассказал, что где-то в горах шумят воды.", sourceFactId: "notable-0", epistemicClass: "testimony" }],
    });
    expect(verifyEpistemicNarration(response, facts)).toEqual({ ok: true, narration: "Источник сообщает: «Старец рассказал, что где-то в горах шумят воды.»" });
  });

  it("rejects a narration whose text asserts absolute certainty without an established-fact claim", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({
      narration: "There is no doubt: старец видел это.",
      claims: [{ text: "Старец видел это.", sourceFactId: "primary", epistemicClass: "observed_fact" }],
    });
    expect(verifyEpistemicNarration(response, facts)).toEqual({ ok: false, reason: "certainty_overclaim" });
  });

  it("accepts absolute-certainty narration backed by an established-fact claim", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({
      narration: "This is unquestionably true.",
      claims: [{ text: "Река течёт.", sourceFactId: "primary", epistemicClass: "established_fact" }],
    });
    expect(verifyEpistemicNarration(response, facts)).toEqual({ ok: true, narration: "Река течёт." });
  });

  it("rejects absolute-certainty narration when no facts were provided", async () => {
    const { verifyEpistemicNarration } = await import("../src/narrative-llm.js");
    const response = JSON.stringify({ narration: "Это бесспорно так.", claims: [] });
    expect(verifyEpistemicNarration(response, [])).toEqual({ ok: false, reason: "certainty_overclaim" });
  });

  it("assertedEpistemicStrength treats absolute-certainty phrasing as established_fact", async () => {
    const { assertedEpistemicStrength, epistemicStrength } = await import("../src/narrative-llm.js");
    expect(assertedEpistemicStrength("This is unquestionably true.", "testimony")).toBe(epistemicStrength("established_fact"));
    expect(assertedEpistemicStrength("Старец предположил.", "interpretation")).toBe(epistemicStrength("interpretation"));
  });
});
