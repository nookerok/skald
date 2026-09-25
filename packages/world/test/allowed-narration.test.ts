/**
 * Composed answer over `AllowedNarrativeFacts` (ADR-0037 / T3): the model gets
 * only the closed set, citations must resolve, mandatory results must be
 * covered, and a claim may not exceed its fact's assertion.
 */

import { describe, expect, it, vi } from "vitest";
import { buildAllowedNarrativeFacts, narrateAllowedAnswerLLM, verifyAllowedNarration } from "@skald/world";

function allowed() {
  return buildAllowedNarrativeFacts({
    question: "почему я здесь?",
    context: {
      character: { name: "Зоя", backgroundTitle: "Изгнанник", formerRole: "Бывший дорожный проводник.", rupture: "—", obligation: "—" },
      arrival: { reason: "Ты пришёл по следу неверного знака.", personalHook: "Тебя ждут объяснения.", startingLocation: "river_waystation" },
      visibleSituation: { facts: [], sensoryContext: [] },
      accessibleItems: [],
      contacts: [],
      knowledge: { observed: [], testimony: [{ id: "t1", text: "Свидетель видел знак.", epistemicClass: "testimony", source: "testimony", usableNow: true, sourceEventIds: [] }], hypotheses: [] },
      unresolvedSituation: [],
    } as never,
    mandatory: ["путь заблокирован"],
  });
}

function response(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ narration: "Ты пришёл по следу знака.", claims: [{ text: "Ты пришёл по следу знака.", ref: "f5", assertion: "established" }], coveredMandatory: ["путь заблокирован"], ...overrides });
}

async function mockRouter(text: string) {
  const { ModelRouter } = await import("../src/llm/router.js");
  const router = new ModelRouter({ apiKey: "test-key" });
  const spy = vi.spyOn(router, "chat").mockResolvedValue({
    text, model: "m", configuredModel: "m", responseModel: "m", usedFallback: false, latencyMs: 1,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, provider: "opencode_zen",
  });
  return { router, spy };
}

describe("verifyAllowedNarration", () => {
  it("accepts a valid composed answer", () => {
    const result = verifyAllowedNarration(response(), allowed());
    expect(result.ok).toBe(true);
    expect(result.usedRefs).toEqual(["f5"]);
  });
  it("rejects an unknown reference", () => {
    const result = verifyAllowedNarration(response({ claims: [{ text: "x", ref: "f99", assertion: "observed" }] }), allowed());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown_ref");
  });
  it("rejects an epistemic-class upgrade", () => {
    // f7 is testimony (assertion "told"); claiming it as established is an upgrade.
    const result = verifyAllowedNarration(response({ claims: [{ text: "x", ref: "f7", assertion: "established" }] }), allowed());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("class_upgrade");
  });
  it("rejects a missing mandatory result", () => {
    const result = verifyAllowedNarration(response({ coveredMandatory: [] }), allowed());
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_mandatory");
  });
  it("rejects internal references and invalid json", () => {
    expect(verifyAllowedNarration(response({ narration: "Контакт contact:keeper здесь." }), allowed()).reason).toBe("internal_reference");
    expect(verifyAllowedNarration("not json", allowed()).reason).toBe("invalid_json");
  });
  it("accepts an answer wrapped in a markdown fence or surrounding prose", () => {
    expect(verifyAllowedNarration("```json\n" + response() + "\n```", allowed()).ok).toBe(true);
    expect(verifyAllowedNarration("Конечно. " + response() + " Надеюсь, помог.", allowed()).ok).toBe(true);
    expect(verifyAllowedNarration("Вот объект: {так нет}", allowed()).reason).toBe("invalid_json");
  });
  it("accepts a multi-sentence narration where every sentence is declared", () => {
    const narration = "Ты пришёл по следу знака. Перевозчик ждёт у самой воды.";
    const result = verifyAllowedNarration(JSON.stringify({
      narration,
      claims: [
        { text: "Ты пришёл по следу знака.", ref: "f5", assertion: "established" },
        { text: "Перевозчик ждёт у самой воды.", ref: "f5", assertion: "established" },
      ],
      coveredMandatory: ["путь заблокирован"],
    }), allowed());
    expect(result.ok).toBe(true);
  });
  it("rejects a claim that is absent from the final text", () => {
    const result = verifyAllowedNarration(
      response({ narration: "Совсем другой текст без единого слова из заявленного предложенного." }),
      allowed(),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("claim_not_in_narration");
  });
  it("rejects the regression «correct reference — false content»", () => {
    // The portrait ref is cited correctly, but the narration adds a cloak no
    // allowed fact mentions and no claim declares.
    const result = verifyAllowedNarration(
      response({
        narration: "Ты пришёл по следу знака. На плечах у тебя золотой плащ с вышитой дорогой.",
        claims: [{ text: "Ты пришёл по следу знака.", ref: "f5", assertion: "established" }],
      }),
      allowed(),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("undeclared_content");
  });
});

describe("narrateAllowedAnswerLLM", () => {
  it("falls back with no api key", async () => {
    const result = await narrateAllowedAnswerLLM(allowed(), 1, null);
    expect(result.usedFallback).toBe(true);
    expect(result.text).toBe("");
  });
  it("returns the composed text when valid", async () => {
    const { router } = await mockRouter(response());
    const result = await narrateAllowedAnswerLLM(allowed(), 1, router);
    expect(result.usedFallback).toBe(false);
    expect(result.text).toBe("Ты пришёл по следу знака.");
  });
  it("falls back when the model cites an unknown ref", async () => {
    const { router } = await mockRouter(response({ claims: [{ text: "x", ref: "f99", assertion: "observed" }] }));
    const result = await narrateAllowedAnswerLLM(allowed(), 1, router);
    expect(result.usedFallback).toBe(true);
  });
  it("repairs an old-format first answer into the new contract", async () => {
    const { ModelRouter } = await import("../src/llm/router.js");
    const router = new ModelRouter({ apiKey: "test-key" });
    let call = 0;
    vi.spyOn(router, "chat").mockImplementation(async () => {
      call += 1;
      const text = call === 1
        ? JSON.stringify({ narration: "x", claims: [{ text: "x", sourceFactId: "answer", epistemicClass: "observed_fact" }] })
        : response();
      return { text, model: "m", configuredModel: "m", responseModel: "m", usedFallback: false, latencyMs: 1, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, provider: "opencode_zen" };
    });
    const result = await narrateAllowedAnswerLLM(allowed(), 1, router);
    expect(result.usedFallback).toBe(false);
    expect(call).toBe(2);
  });
  it("sends only the closed allowed set to the model", async () => {
    const { router, spy } = await mockRouter(response());
    await narrateAllowedAnswerLLM(allowed(), 1, router);
    const user = (spy.mock.calls[0]![1] as readonly { role: string; content: string }[]).find((m) => m.role === "user")!.content;
    expect(user).toContain("\"allowed\"");
    expect(user).toContain("Ты пришёл по следу неверного знака.");
    // The raw NarrativeAdapterContext shape never reaches the prompt.
    expect(user).not.toContain("\"character\"");
    expect(user).not.toContain("\"arrival\"");
    expect(user).not.toContain("personalHook");
  });
});
