import { describe, it, expect, vi } from "vitest";
import { ModelRouter } from "../../src/llm/router.js";
import type { ChatMessage } from "../../src/llm/types.js";

function msg(content: string): ChatMessage[] {
  return [{ role: "user", content }];
}

describe("ModelRouter", () => {
  it("constructor does not throw without api key", () => {
    const router = new ModelRouter({ apiKey: "" });
    expect(router.apiKey).toBe("");
  });

  it("diagnostics returns entries", () => {
    const router = new ModelRouter({ apiKey: "test-key" });
    const diag = router.diagnostics();
    expect(diag.length).toBeGreaterThan(0);
  });

  it("diagnostics warns on empty key", () => {
    const router = new ModelRouter({ apiKey: "" });
    const diag = router.diagnostics();
    expect(diag.some((d) => d.level === "WARN")).toBe(true);
  });

  it("decideModel throws on unknown category", () => {
    const router = new ModelRouter({ apiKey: "test-key" });
    expect(() => (router as any).decideModel("unknown" as any, msg("hello"))).toThrow();
  });

  it("decideModel selects first model when health is unknown", () => {
    const router = new ModelRouter({ apiKey: "test-key" });
    const decision = router.decideModel("narrate", msg("hello"));
    expect(decision.selectedModel).toBe("deepseek-v4-flash-free");
    expect(decision.category).toBe("narrate");
    expect(decision.healthStatus).toBe("unknown");
  });

  it("decideModel blocks secrets", () => {
    const router = new ModelRouter({ apiKey: "test-key" });
    expect(() => router.decideModel("narrate", msg("my key is sk-or-v1-abc123"))).toThrow("Data policy blocked");
  });

  it("keeps Ollama as a fallback when both providers are configured", () => {
    const router = new ModelRouter({
      apiKey: "zen-key",
      providerId: "opencode_zen",
      availableProviders: ["opencode_zen", "ollama_cloud"],
    });
    const decision = router.decideModel("narrate", msg("hello"));
    expect(decision.candidateModels).toContain("gemma4:31b");
    expect(decision.candidateModels[0]).toBe("deepseek-v4-flash-free");
  });

  it("falls back from Zen failures to Ollama and sends the provider key", async () => {
    const previousKey = process.env.SKALD_OLLAMA_CLOUD_API_KEY;
    process.env.SKALD_OLLAMA_CLOUD_API_KEY = "ollama-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: "Zen unavailable" })
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: "Zen unavailable" })
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK", json: async () => ({ model: "gemma4:31b", message: { content: "fallback" } }) });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const router = new ModelRouter({
        apiKey: "zen-key",
        providerId: "opencode_zen",
        availableProviders: ["opencode_zen", "ollama_cloud"],
      });
      const result = await router.chat("narrate", msg("hello"));
      expect(result.provider).toBe("ollama_cloud");
      expect(result.usedFallback).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[0]![0]).toContain("opencode.ai");
      expect(fetchMock.mock.calls[2]![0]).toContain("ollama.com");
      expect(fetchMock.mock.calls[2]![1]?.headers).toMatchObject({ Authorization: "Bearer ollama-key" });
    } finally {
      vi.unstubAllGlobals();
      if (previousKey === undefined) delete process.env.SKALD_OLLAMA_CLOUD_API_KEY;
      else process.env.SKALD_OLLAMA_CLOUD_API_KEY = previousKey;
    }
  });

  it("supports Ollama-only routing without selecting Zen models", () => {
    const router = new ModelRouter({ apiKey: "ollama-key", providerId: "ollama_cloud" });
    const decision = router.decideModel("narrate", msg("hello"));
    expect(decision.selectedModel).toBe("gemma4:31b");
    expect(decision.provider).toBe("ollama_cloud");
  });

});
