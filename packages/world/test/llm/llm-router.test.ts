import { describe, it, expect, vi } from "vitest";
import { LLM_CONFIG, OPENCODE_PREFERRED_MODELS, criticalRouteConfigIssues, openCodeProtocolForModel } from "../../src/llm/config.js";
import { ModelRouter } from "../../src/llm/router.js";
import { ProviderUnavailableError } from "../../src/llm/errors.js";
import type { ChatMessage, RouteCandidate } from "../../src/llm/types.js";

function msg(content: string): ChatMessage[] {
  return [{ role: "user", content }];
}

function candidate(provider: "opencode_zen" | "ollama_cloud", model: string, tier: RouteCandidate["tier"] = "catalog_candidate"): RouteCandidate {
  return {
    provider,
    model,
    protocol: provider === "opencode_zen" ? openCodeProtocolForModel(model) : "ollama_chat",
    tier,
  };
}

const mixedCandidates: readonly RouteCandidate[] = [
  candidate("opencode_zen", "big-pickle"),
  candidate("ollama_cloud", "gemma4:31b-cloud"),
  candidate("opencode_zen", "muse-spark-1.3-contributor-free"),
];

describe("ModelRouter", () => {
  it("keeps the preferred catalogue candidates for critical routes", () => {
    expect(LLM_CONFIG.policy.onlyFreeModels).toBe(false);
    expect(criticalRouteConfigIssues()).toEqual([]);
    for (const category of ["interpret", "narrate"] as const) {
      const [primary, backup] = LLM_CONFIG.routes[category].candidates;
      expect(primary?.tier).toBe("catalog_candidate");
      expect(backup?.tier).toBe("catalog_candidate");
      expect(primary?.provider).toBe("opencode_zen");
      expect(primary?.model).toBe("muse-spark-1.3-contributor-free");
      expect(primary?.protocol).toBe("openai_responses");
      expect(backup?.model).toBe("ling-3.0-flash-fin-free");
      expect(backup?.protocol).toBe("openai_chat");
      expect(LLM_CONFIG.routes[category].models).toEqual(OPENCODE_PREFERRED_MODELS);
    }
  });

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
    expect(decision.selectedModel).toBe("muse-spark-1.3-contributor-free");
    expect(decision.category).toBe("narrate");
    expect(decision.healthStatus).toBe("unknown");
  });

  it("decideModel blocks secrets", () => {
    const router = new ModelRouter({ apiKey: "test-key" });
    expect(() => router.decideModel("narrate", msg("my key is sk-or-v1-abc123"))).toThrow("Data policy blocked");
  });

  it("supports an explicit cross-provider fallback route", () => {
    const router = new ModelRouter({
      apiKey: "zen-key",
      providerId: "opencode_zen",
      availableProviders: ["opencode_zen", "ollama_cloud"],
      routeCandidates: { narrate: mixedCandidates },
    });
    const decision = router.decideModel("narrate", msg("hello"));
    expect(decision.candidateModels).toContain("gemma4:31b-cloud");
    expect(decision.candidateModels[0]).toBe("big-pickle");
    expect(decision.candidates[0]).toMatchObject({ provider: "opencode_zen", tier: "catalog_candidate", protocol: "openai_chat" });
    expect(decision.candidates[1]).toMatchObject({ provider: "ollama_cloud", tier: "catalog_candidate", protocol: "ollama_chat" });
  });

  it("does not retry a stale model and can fail over to another provider", async () => {
    const previousKey = process.env.SKALD_OLLAMA_CLOUD_API_KEY;
    process.env.SKALD_OLLAMA_CLOUD_API_KEY = "ollama-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => JSON.stringify({ error: { code: "model_not_found" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ model: "gemma4:31b-cloud", message: { content: "backup" } }) });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const router = new ModelRouter({
        apiKey: "zen-key",
        providerId: "opencode_zen",
        availableProviders: ["opencode_zen", "ollama_cloud"],
        routeCandidates: { narrate: mixedCandidates.slice(0, 2) },
      });
      const result = await router.chat("narrate", msg("hello"));
      expect(result.provider).toBe("ollama_cloud");
      expect(result.usedFallback).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      if (previousKey === undefined) delete process.env.SKALD_OLLAMA_CLOUD_API_KEY;
      else process.env.SKALD_OLLAMA_CLOUD_API_KEY = previousKey;
    }
  });

  it("skips a model-scoped 404 and uses the next same-provider backup", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => JSON.stringify({ error: { code: "model_not_found" } }) })
      .mockImplementationOnce(async (input: string | URL | Request) => {
        expect(String(input)).toBe("https://opencode.ai/zen/v1/responses");
        return { ok: true, status: 200, json: async () => ({ output_text: "backup", model: "muse-spark-1.3-contributor-free" }) };
      });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const router = new ModelRouter({
        apiKey: "zen-key",
        providerId: "opencode_zen",
        availableProviders: ["opencode_zen"],
        routeCandidates: { narrate: mixedCandidates.filter((item) => item.provider === "opencode_zen") },
      });
      const result = await router.chat("narrate", msg("hello"));
      expect(result.provider).toBe("opencode_zen");
      expect(result.model).toBe("muse-spark-1.3-contributor-free");
      expect(result.usedFallback).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips every remaining candidate of a provider after auth failure", async () => {
    const previousKey = process.env.SKALD_OLLAMA_CLOUD_API_KEY;
    process.env.SKALD_OLLAMA_CLOUD_API_KEY = "ollama-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => JSON.stringify({ error: { code: "invalid_api_key" } }) })
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => JSON.stringify({ error: { code: "temporary_outage" } }) })
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => JSON.stringify({ error: { code: "temporary_outage" } }) });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const router = new ModelRouter({
        apiKey: "zen-key",
        providerId: "opencode_zen",
        availableProviders: ["opencode_zen", "ollama_cloud"],
        routeCandidates: { narrate: mixedCandidates },
      });
      await expect(router.chat("narrate", msg("hello"))).rejects.toMatchObject({ provider: "ollama_cloud", httpStatus: 503 });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
        "https://opencode.ai/zen/v1/chat/completions",
        "https://ollama.com/api/chat",
        "https://ollama.com/api/chat",
      ]);
    } finally {
      vi.unstubAllGlobals();
      if (previousKey === undefined) delete process.env.SKALD_OLLAMA_CLOUD_API_KEY;
      else process.env.SKALD_OLLAMA_CLOUD_API_KEY = previousKey;
    }
  });

  it("falls back from Zen failures to Ollama and sends the provider key", async () => {
    const previousKey = process.env.SKALD_OLLAMA_CLOUD_API_KEY;
    process.env.SKALD_OLLAMA_CLOUD_API_KEY = "ollama-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: "Zen unavailable" })
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: "Zen unavailable" })
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: "OK", json: async () => ({ model: "gemma4:31b-cloud", message: { content: "fallback" } }) });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const router = new ModelRouter({
        apiKey: "zen-key",
        providerId: "opencode_zen",
        availableProviders: ["opencode_zen", "ollama_cloud"],
        routeCandidates: { narrate: mixedCandidates.slice(0, 2) },
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

  it("emits one sanitized provider diagnostic per retry and failover hop", async () => {
    const previousKey = process.env.SKALD_OLLAMA_CLOUD_API_KEY;
    process.env.SKALD_OLLAMA_CLOUD_API_KEY = "ollama-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => JSON.stringify({ error: { code: "temporary_outage" } }) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => JSON.stringify({ error: { code: "temporary_outage" } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ model: "gemma4:31b-cloud", message: { content: "backup" } }) });
    vi.stubGlobal("fetch", fetchMock);
    const diagnostics: Array<Record<string, unknown>> = [];

    try {
      const router = new ModelRouter({
        apiKey: "zen-key",
        providerId: "opencode_zen",
        availableProviders: ["opencode_zen", "ollama_cloud"],
        routeCandidates: { narrate: mixedCandidates.slice(0, 2) },
      });
      const result = await router.chat("narrate", msg("hello"), {
        diagnostics: (event) => diagnostics.push(event as unknown as Record<string, unknown>),
        correlationId: "corr-1",
        worldTime: 7,
      });
      expect(result.provider).toBe("ollama_cloud");
      expect(diagnostics).toHaveLength(3);
      expect(diagnostics.map((event) => event.outcome)).toEqual(["retrying", "failed", "provider_failover"]);
      expect(diagnostics[0]).toMatchObject({ provider: "opencode_zen", model: "big-pickle", phase: "response_status", httpStatus: 500, providerCode: "temporary_outage", attempt: 1, correlationId: "corr-1", worldTime: 7 });
      expect(diagnostics[1]).toMatchObject({ provider: "opencode_zen", attempt: 2 });
      expect(diagnostics[2]).toMatchObject({ provider: "ollama_cloud", model: "gemma4:31b-cloud", phase: "request", attempt: 1 });
      expect(JSON.stringify(diagnostics)).not.toContain("ollama-key");
    } finally {
      vi.unstubAllGlobals();
      if (previousKey === undefined) delete process.env.SKALD_OLLAMA_CLOUD_API_KEY;
      else process.env.SKALD_OLLAMA_CLOUD_API_KEY = previousKey;
    }
  });

  it("preserves the provider of the final failed candidate", async () => {
    const previousKey = process.env.SKALD_OLLAMA_CLOUD_API_KEY;
    process.env.SKALD_OLLAMA_CLOUD_API_KEY = "ollama-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Unavailable",
    }));

    try {
      const router = new ModelRouter({
        apiKey: "zen-key",
        providerId: "opencode_zen",
        availableProviders: ["opencode_zen", "ollama_cloud"],
        routeCandidates: { narrate: mixedCandidates.filter((item) => item.provider === "opencode_zen") },
      });
      await expect(router.chat("narrate", msg("hello"))).rejects.toMatchObject({
        provider: "opencode_zen",
        model: "muse-spark-1.3-contributor-free",
      });
    } finally {
      vi.unstubAllGlobals();
      if (previousKey === undefined) delete process.env.SKALD_OLLAMA_CLOUD_API_KEY;
      else process.env.SKALD_OLLAMA_CLOUD_API_KEY = previousKey;
    }
  });

  it("supports Ollama-only routing without selecting Zen models", () => {
    const router = new ModelRouter({
      apiKey: "ollama-key",
      providerId: "ollama_cloud",
      routeCandidates: { narrate: [candidate("ollama_cloud", "gemma4:31b-cloud")] },
    });
    const decision = router.decideModel("narrate", msg("hello"));
    expect(decision.selectedModel).toBe("gemma4:31b-cloud");
    expect(decision.provider).toBe("ollama_cloud");
  });

  it("wraps non-transient provider errors as ProviderUnavailableError with metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    }));

    try {
      const router = new ModelRouter({ apiKey: "test-key", providerId: "opencode_zen" });
      try {
        await router.chat("narrate", msg("hello"));
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderUnavailableError);
        const pue = err as ProviderUnavailableError;
        expect(pue.code).toBe("PROVIDER_UNAVAILABLE");
        expect(pue.provider).toBe("opencode_zen");
        expect(pue.model).toBe("muse-spark-1.3-contributor-free");
        expect(pue.configuredModel).toBe("muse-spark-1.3-contributor-free");
        expect(pue.cause).toBeInstanceOf(Error);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not wrap empty_response as ProviderUnavailableError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "" } }], model: "big-pickle" }),
    }));

    try {
      const router = new ModelRouter({ apiKey: "test-key", providerId: "opencode_zen" });
      try {
        await router.chat("narrate", msg("hello"));
        throw new Error("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(ProviderUnavailableError);
        expect((err as Error).message).toContain("empty response");
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

});
