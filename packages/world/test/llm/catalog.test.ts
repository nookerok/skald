import { describe, expect, it, vi } from "vitest";
import { discoverLiveRoutes, discoverOllamaRoutes, discoverOpenCodeRoutes, discoverOpenRouterRoutes, fetchOpenCodeCatalog } from "../../src/llm/catalog.js";

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const preferred = ["big-pickle", "muse-spark-1.3-contributor-free", "mimo-v2.5-free"];

describe("OpenCode Zen live catalogue selection", () => {
  it("fetches model ids through the authenticated catalogue endpoint", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("https://opencode.ai/zen/v1/models");
      return response({ data: [{ id: "big-pickle" }, { id: "mimo-v2.5-free" }, { id: "big-pickle" }] });
    });
    const report = await fetchOpenCodeCatalog({ apiKey: "zen-key", fetchImpl });
    expect(report).toMatchObject({ provider: "opencode_zen", status: "ok", phase: "response_shape", modelIds: ["big-pickle", "mimo-v2.5-free"] });
    expect(fetchImpl).toHaveBeenCalledWith("https://opencode.ai/zen/v1/models", expect.objectContaining({ method: "GET", headers: { Authorization: "Bearer zen-key", Accept: "application/json" } }));
  });

  it("fails closed on catalogue auth failure without probing models", async () => {
    const fetchImpl = vi.fn(async () => response({ error: { code: "invalid_api_key" } }, 401));
    const probe = vi.fn();
    const report = await discoverOpenCodeRoutes({ apiKey: "bad-key", preferredModels: preferred, fetchImpl, probe: probe as any });
    expect(report.status).toBe("misconfigured");
    expect(report.catalog).toMatchObject({ status: "auth_failure", httpStatus: 401, providerCode: "invalid_api_key" });
    expect(report.activeModel).toBeUndefined();
    expect(report.excluded).toEqual(preferred.map((model) => ({ model, reason: "catalog_auth_failure" })));
    expect(probe).not.toHaveBeenCalled();
  });

  it("reports a missing credential without attempting catalogue or model probes", async () => {
    const fetchImpl = vi.fn();
    const probe = vi.fn();
    const report = await discoverOpenCodeRoutes({ preferredModels: preferred, fetchImpl, probe: probe as any });
    expect(report.status).toBe("misconfigured");
    expect(report.catalog).toMatchObject({ status: "auth_failure", phase: "configuration" });
    expect(report.excluded).toEqual(preferred.map((model) => ({ model, reason: "missing_credential" })));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });

  it("probes every catalog-present preferred model for both routes and activates only complete pairs", async () => {
    const fetchImpl = vi.fn(async () => response({ data: preferred.map((id) => ({ id })) }));
    const probe = vi.fn(async (category: "interpret" | "narrate", model: string) => {
      if (model === "mimo-v2.5-free" && category === "narrate") return { status: "model_unavailable", phase: "response_status", httpStatus: 404 };
      return { status: "ok", phase: "schema_validation" };
    });
    const report = await discoverOpenCodeRoutes({ apiKey: "zen-key", preferredModels: preferred, fetchImpl, probe: probe as any });
    expect(probe).toHaveBeenCalledTimes(6);
    expect(report.status).toBe("ready");
    expect(report.activeModel).toBe("big-pickle");
    expect(report.backupModel).toBe("muse-spark-1.3-contributor-free");
    expect(report.routes.interpret.map((candidate) => candidate.model)).toEqual(["big-pickle", "muse-spark-1.3-contributor-free"]);
    expect(report.routes.narrate.map((candidate) => candidate.model)).toEqual(["big-pickle", "muse-spark-1.3-contributor-free"]);
    expect(report.excluded).toEqual([{ model: "mimo-v2.5-free", reason: "model_unavailable" }]);
  });

  it("uses the real no-world transport for both probe routes without retrying", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models")) return response({ data: [{ id: "big-pickle" }] });
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      return body.messages?.[0]?.content?.includes("marker")
        ? response({ choices: [{ message: { content: "SKALD_PROBE_OK" } }], model: "big-pickle" })
        : response({ choices: [{ message: { content: '{"schemaVersion":1,"probe":true}' } }], model: "big-pickle" });
    });
    const report = await discoverOpenCodeRoutes({ apiKey: "zen-key", preferredModels: ["big-pickle"], fetchImpl });
    expect(report.status).toBe("degraded");
    expect(report.activeModel).toBe("big-pickle");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.slice(1).map((call) => String(call[0]))).toEqual([
      "https://opencode.ai/zen/v1/chat/completions",
      "https://opencode.ai/zen/v1/chat/completions",
    ]);
    expect(fetchImpl.mock.calls.slice(1).every((call) => (call[1] as RequestInit).method === "POST")).toBe(true);
  });

  it("classifies a transport-backed HTTP 400 model refusal as unavailable", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models")) return response({ data: [{ id: "big-pickle" }] });
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      if (body.messages?.[0]?.content?.includes("schemaVersion")) {
        return response({ error: { message: "Model unavailable" } }, 400);
      }
      return response({ choices: [{ message: { content: "SKALD_PROBE_OK" } }], model: "big-pickle" });
    });
    const report = await discoverOpenCodeRoutes({ apiKey: "zen-key", preferredModels: ["big-pickle"], fetchImpl });
    expect(report.status).toBe("unavailable");
    expect(report.candidates[0]).toMatchObject({ active: false, exclusionReason: "model_unavailable", interpret: { status: "model_unavailable", httpStatus: 400 } });
    expect(report.excluded).toEqual([{ model: "big-pickle", reason: "model_unavailable" }]);
  });

  it("excludes preferred ids absent from live catalog without probing them", async () => {
    const fetchImpl = vi.fn(async () => response({ data: [{ id: "big-pickle" }] }));
    const probe = vi.fn(async () => ({ status: "ok", phase: "schema_validation" }));
    const report = await discoverOpenCodeRoutes({ apiKey: "zen-key", preferredModels: preferred, fetchImpl, probe: probe as any });
    expect(probe).toHaveBeenCalledTimes(2);
    expect(report.status).toBe("degraded");
    expect(report.excluded).toEqual([
      { model: "muse-spark-1.3-contributor-free", reason: "not_in_catalog" },
      { model: "mimo-v2.5-free", reason: "not_in_catalog" },
    ]);
  });

  it("does not retry an unavailable model and records auth/model reasons", async () => {
    const fetchImpl = vi.fn(async () => response({ data: preferred }));
    const probe = vi.fn(async (_category: "interpret" | "narrate", model: string) => {
      if (model === "big-pickle") return { status: "auth_failure", phase: "response_status", httpStatus: 401 };
      if (model === "muse-spark-1.3-contributor-free") return { status: "model_unavailable", phase: "response_status", httpStatus: 400, providerCode: "model_unavailable" };
      return { status: "failed", phase: "response_shape" };
    });
    const report = await discoverOpenCodeRoutes({ apiKey: "zen-key", preferredModels: preferred, fetchImpl, probe: probe as any });
    expect(probe).toHaveBeenCalledTimes(6);
    expect(report.status).toBe("misconfigured");
    expect(report.excluded).toEqual([
      { model: "big-pickle", reason: "auth_failure" },
      { model: "muse-spark-1.3-contributor-free", reason: "model_unavailable" },
      { model: "mimo-v2.5-free", reason: "interpret_probe_failed" },
    ]);
  });

  it("probes muse-spark via Responses and ling via Chat Completions with per-model live protocols", async () => {    const urls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models")) {
        return response({ data: [{ id: "muse-spark-1.3-contributor-free" }, { id: "ling-3.0-flash-fin-free" }] });
      }
      urls.push(url);
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      if (url.endsWith("/responses")) {
        expect(body.model).toBe("muse-spark-1.3-contributor-free");
        expect(body).toHaveProperty("input");
        expect(body).toHaveProperty("max_output_tokens");
        expect(body).not.toHaveProperty("messages");
        const marker = body.input?.[1]?.content ?? body.input?.[0]?.content ?? "";
        const text = String(marker).includes("SKALD_PROBE_OK") || String(marker).includes("marker")
          ? "SKALD_PROBE_OK"
          : '{"schemaVersion":1,"probe":true}';
        return response({ output_text: text, model: "muse-spark-1.3-contributor-free" });
      }
      expect(url.endsWith("/chat/completions")).toBe(true);
      expect(body.model).toBe("ling-3.0-flash-fin-free");
      expect(body).toHaveProperty("messages");
      expect(body).toHaveProperty("max_tokens");
      expect(body).not.toHaveProperty("input");
      const marker = body.messages?.[1]?.content ?? body.messages?.[0]?.content ?? "";
      const text = String(marker).includes("SKALD_PROBE_OK") || String(marker).includes("marker")
        ? "SKALD_PROBE_OK"
        : '{"schemaVersion":1,"probe":true}';
      return response({ choices: [{ message: { content: text } }], model: "ling-3.0-flash-fin-free" });
    });
    const report = await discoverOpenCodeRoutes({
      apiKey: "zen-key",
      preferredModels: ["muse-spark-1.3-contributor-free", "ling-3.0-flash-fin-free"],
      fetchImpl,
    });
    expect(report.status).toBe("ready");
    expect(report.activeModel).toBe("muse-spark-1.3-contributor-free");
    expect(report.backupModel).toBe("ling-3.0-flash-fin-free");
    expect(report.routes.interpret.map((candidate) => `${candidate.model}:${candidate.protocol}`)).toEqual([
      "muse-spark-1.3-contributor-free:openai_responses",
      "ling-3.0-flash-fin-free:openai_chat",
    ]);
    expect(report.routes.narrate.map((candidate) => `${candidate.model}:${candidate.protocol}`)).toEqual([
      "muse-spark-1.3-contributor-free:openai_responses",
      "ling-3.0-flash-fin-free:openai_chat",
    ]);
    expect(urls.filter((url) => url.endsWith("/responses"))).toHaveLength(2);
    expect(urls.filter((url) => url.endsWith("/chat/completions"))).toHaveLength(2);
  });

  it("budgets probes for reasoning traces, not just marker text", async () => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models")) return response({ data: [{ id: "muse-spark-1.3-contributor-free" }] });
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      seen.push({ url, body });
      return response({ output_text: "SKALD_PROBE_OK", model: "muse-spark-1.3-contributor-free" });
    });
    await discoverOpenCodeRoutes({ apiKey: "zen-key", preferredModels: ["muse-spark-1.3-contributor-free"], fetchImpl });
    expect(seen).toHaveLength(2);
    for (const { url, body } of seen) {
      if (url.endsWith("/responses")) expect(body.max_output_tokens as number).toBeGreaterThanOrEqual(512);
      else expect(body.max_tokens as number).toBeGreaterThanOrEqual(512);
    }
  });

  it("keeps the region gate code on a 403 probe instead of reporting a bare credential failure", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/models")) return response({ data: [{ id: "muse-spark-1.3-contributor-free" }] });
      return response({ error: { message: "This model is not available in your country.", type: "RegionError" } }, 403);
    });
    const report = await discoverOpenCodeRoutes({
      apiKey: "zen-key",
      preferredModels: ["muse-spark-1.3-contributor-free"],
      fetchImpl,
    });
    expect(report.status).toBe("misconfigured");
    expect(report.candidates[0]).toMatchObject({
      active: false,
      exclusionReason: "auth_failure",
      interpret: { status: "auth_failure", httpStatus: 403, providerCode: "region_unavailable" },
      narrate: { status: "auth_failure", httpStatus: 403, providerCode: "region_unavailable" },
    });
    expect(report.excluded).toEqual([{ model: "muse-spark-1.3-contributor-free", reason: "auth_failure" }]);
  });
});

describe("Ollama Cloud fallback discovery", () => {
  const GEMMA = "gemma4:31b-cloud";

  it("reports a missing credential without touching the network", async () => {
    const fetchImpl = vi.fn();
    const report = await discoverOllamaRoutes({ fetchImpl });
    expect(report.provider).toBe("ollama_cloud");
    expect(report.status).toBe("misconfigured");
    expect(report.candidates[0]).toMatchObject({ active: false, exclusionReason: "missing_credential" });
    expect(report.routes.interpret).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("activates the pinned model through the Ollama chat surface with bounded budgets", async () => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      seen.push({ url, body });
      const marker = body.messages?.[1]?.content ?? body.messages?.[0]?.content ?? "";
      const content = String(marker).includes("SKALD_PROBE_OK") || String(marker).includes("marker")
        ? "SKALD_PROBE_OK"
        : '{"schemaVersion":1,"probe":true}';
      return response({
        message: { content },
        model: GEMMA,
        prompt_eval_count: 10,
        eval_count: 2,
      });
    });
    const report = await discoverOllamaRoutes({ apiKey: "ollama-key", fetchImpl });
    expect(report.provider).toBe("ollama_cloud");
    expect(report.status).toBe("degraded");
    expect(report.activeModel).toBe(GEMMA);
    expect(report.backupModel).toBeUndefined();
    expect(report.routes.interpret).toEqual([{ provider: "ollama_cloud", model: GEMMA, protocol: "ollama_chat", tier: "live_primary" }]);
    expect(report.routes.narrate).toEqual([{ provider: "ollama_cloud", model: GEMMA, protocol: "ollama_chat", tier: "live_primary" }]);
    expect(seen).toHaveLength(2);
    expect(seen.every(({ url }) => url === "https://ollama.com/api/chat")).toBe(true);
    expect(seen.every(({ body }) => body.model === GEMMA && body.stream === false)).toBe(true);
    const budgets = Object.fromEntries(seen.map(({ body }) => {
      const messages = (body as { messages?: Array<{ content?: unknown }> }).messages ?? [];
      const marker = String(messages[1]?.content ?? messages[0]?.content ?? "");
      return [
        marker.includes("SKALD_PROBE_OK") || marker.includes("marker") ? "narrate" : "interpret",
        (body.options as { num_predict?: number } | undefined)?.num_predict,
      ];
    }));
    expect(budgets).toEqual({ interpret: 256, narrate: 64 });
  });

  it("classifies credential rejection as misconfigured and probe failures as unavailable", async () => {
    const denied = await discoverOllamaRoutes({
      apiKey: "bad-key",
      fetchImpl: vi.fn(async () => response({ error: { message: "Unauthorized" } }, 401)),
    });
    expect(denied.status).toBe("misconfigured");
    expect(denied.candidates[0]).toMatchObject({ active: false, exclusionReason: "auth_failure" });

    const failing = await discoverOllamaRoutes({
      apiKey: "ollama-key",
      fetchImpl: vi.fn(async () => response({ error: { message: "Nope" } }, 500)),
    });
    expect(failing.status).toBe("unavailable");
    expect(failing.excluded).toEqual([{ model: GEMMA, reason: "interpret_probe_failed" }]);
  });
});

describe("OpenRouter last-resort discovery", () => {
  const NEMO = "nvidia/nemotron-3-super-120b-a12b:free";
  const LAGUNA = "poolside/laguna-s-2.1:free";

  function openrouterOk(models: readonly string[] = [NEMO]) {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://openrouter.ai/")) {
        return { ok: false, status: 404, json: async () => ({}), text: async () => "{}" } as unknown as Response;
      }
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      expect(models).toContain(body.model);
      const marker = body.messages?.[1]?.content ?? "";
      const content = String(marker).includes("SKALD_PROBE_OK") || String(marker).includes("marker")
        ? "SKALD_PROBE_OK"
        : '{"schemaVersion":1,"probe":true}';
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content } }], model: body.model }),
      } as unknown as Response;
    });
  }

  it("reports a missing credential without touching the network", async () => {
    const fetchImpl = vi.fn();
    const report = await discoverOpenRouterRoutes({ fetchImpl });
    expect(report.provider).toBe("openrouter");
    expect(report.status).toBe("misconfigured");
    expect(report.candidates.every((candidate) => candidate.exclusionReason === "missing_credential")).toBe(true);
    expect(report.routes.interpret).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("activates the first dual-ok model and stops spending free quota", async () => {
    const fetchImpl = openrouterOk([NEMO, LAGUNA]);
    const report = await discoverOpenRouterRoutes({ apiKey: "or-key", models: [NEMO, LAGUNA], fetchImpl });
    expect(report.provider).toBe("openrouter");
    expect(report.status).toBe("degraded");
    expect(report.activeModel).toBe(NEMO);
    expect(report.backupModel).toBeUndefined();
    expect(report.routes.interpret).toEqual([{ provider: "openrouter", model: NEMO, protocol: "openai_chat", tier: "live_primary" }]);
    expect(report.routes.narrate).toEqual([{ provider: "openrouter", model: NEMO, protocol: "openai_chat", tier: "live_primary" }]);
    // Exactly one interpret+narrate pair: the winner stops further probes.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every((call) => String(call[0]).startsWith("https://openrouter.ai/api/v1/chat/completions"))).toBe(true);
    expect(report.excluded).toEqual([]);
  });

  it("skips a dead first model and activates the next one", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      if (body.model === NEMO) {
        return { ok: false, status: 500, json: async () => ({}), text: async () => "{}" } as unknown as Response;
      }
      return openrouterOk([LAGUNA])(input, init);
    });
    const report = await discoverOpenRouterRoutes({ apiKey: "or-key", models: [NEMO, LAGUNA], fetchImpl });
    expect(report.status).toBe("degraded");
    expect(report.activeModel).toBe(LAGUNA);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(report.excluded).toEqual([{ model: NEMO, reason: "interpret_probe_failed" }]);
  });

  it("maps credential rejection to misconfigured and empty balance to quota_exceeded", async () => {
    const denied = await discoverOpenRouterRoutes({
      apiKey: "bad-key",
      models: [NEMO],
      fetchImpl: vi.fn(async () => response({ error: { message: "Unauthorized" } }, 401)),
    });
    expect(denied.status).toBe("misconfigured");
    expect(denied.candidates[0]).toMatchObject({ active: false, exclusionReason: "auth_failure" });

    const broke = await discoverOpenRouterRoutes({
      apiKey: "or-key",
      models: [NEMO],
      fetchImpl: vi.fn(async () => response({ error: { message: "Insufficient credits. Please add funds." } }, 402)),
    });
    expect(broke.status).toBe("unavailable");
    expect(broke.candidates[0]).toMatchObject({
      active: false,
      exclusionReason: "quota_exceeded",
      interpret: { status: "failed", httpStatus: 402, providerCode: "insufficient_credits" },
    });
  });

  it("rejects a swapped response model instead of routing it", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "SKALD_PROBE_OK" } }], model: "openrouter/free" }),
    } as unknown as Response));
    const report = await discoverOpenRouterRoutes({ apiKey: "or-key", models: [NEMO], fetchImpl });
    expect(report.status).toBe("unavailable");
    expect(report.candidates[0]?.narrate).toMatchObject({ status: "failed", phase: "model_selection", responseModel: "openrouter/free" });
  });
});

describe("provider-ordered live discovery", () => {
  const GEMMA = "gemma4:31b-cloud";

  function zenCatalog(ids: readonly string[]) {
    return async (input: string | URL | Request) => String(input).endsWith("/models")
      ? { ok: true, status: 200, json: async () => ({ data: ids.map((id) => ({ id })) }) } as unknown as Response
      : { ok: false, status: 400, json: async () => ({}), text: async () => "{}" } as unknown as Response;
  }

  function ollamaOk() {
    return async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.startsWith("https://ollama.com/")) {
        return { ok: false, status: 400, json: async () => ({}), text: async () => "{}" } as unknown as Response;
      }
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      const marker = body.messages?.[1]?.content ?? "";
      const content = String(marker).includes("SKALD_PROBE_OK") || String(marker).includes("marker")
        ? "SKALD_PROBE_OK"
        : '{"schemaVersion":1,"probe":true}';
      return { ok: true, status: 200, json: async () => ({ message: { content }, model: GEMMA }) } as unknown as Response;
    };
  }

  it("keeps a working Zen selection without touching Ollama", async () => {
    const probe = vi.fn(async (_category: "interpret" | "narrate", _model: string) => ({ status: "ok", phase: "schema_validation" as const }));
    const report = await discoverLiveRoutes({
      apiKey: "zen-key",
      ollamaKey: "ollama-key",
      preferredModels: ["big-pickle", "muse-spark-1.3-contributor-free"],
      fetchImpl: zenCatalog(["big-pickle", "muse-spark-1.3-contributor-free"]),
      probe: probe as any,
    });
    expect(report.provider).toBe("opencode_zen");
    expect(report.status).toBe("ready");
    expect(probe.mock.calls.every((call) => (call[1] as string) !== GEMMA)).toBe(true);
  });

  it("falls back to Ollama when Zen activates nothing, keeping both exclusion stories", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models")) return { ok: true, status: 200, json: async () => ({ data: [{ id: "big-pickle" }] }) } as unknown as Response;
      if (url.startsWith("https://ollama.com/")) return ollamaOk()(input, init);
      return {
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => JSON.stringify({ error: { type: "MissingSessionID", message: "free tier can only be used in OpenCode" } }),
      } as unknown as Response;
    });
    const report = await discoverLiveRoutes({
      apiKey: "zen-key",
      ollamaKey: "ollama-key",
      preferredModels: ["big-pickle"],
      fetchImpl,
    });
    expect(report.provider).toBe("ollama_cloud");
    expect(report.status).toBe("degraded");
    expect(report.activeModel).toBe(GEMMA);
    expect(report.catalog?.status).toBe("ok");
    expect(report.routes.interpret).toEqual([{ provider: "ollama_cloud", model: GEMMA, protocol: "ollama_chat", tier: "live_primary" }]);
    expect(report.excluded).toEqual(expect.arrayContaining([
      { model: "big-pickle", reason: "model_unavailable" },
    ]));
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0]).toMatchObject({
      model: GEMMA,
      active: true,
      interpret: expect.objectContaining({ status: "ok" }),
    });
  });

  it("returns the Zen report unchanged when no Ollama credential is configured", async () => {
    const fetchImpl = vi.fn(zenCatalog(["big-pickle"]));
    const probe = vi.fn(async () => ({ status: "model_unavailable", phase: "response_status", httpStatus: 400 }));
    const report = await discoverLiveRoutes({
      apiKey: "zen-key",
      preferredModels: ["big-pickle"],
      fetchImpl,
      probe: probe as any,
    });
    expect(report.provider).toBe("opencode_zen");
    expect(report.status).toBe("unavailable");
    expect(report.excluded).toEqual([{ model: "big-pickle", reason: "model_unavailable" }]);
  });

  it("falls through to OpenRouter only after Zen and Ollama both fail", async () => {
    const NEMO = "nvidia/nemotron-3-super-120b-a12b:free";
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models")) return { ok: true, status: 200, json: async () => ({ data: [{ id: "big-pickle" }] }) } as unknown as Response;
      if (url.startsWith("https://ollama.com/")) {
        return { ok: false, status: 500, json: async () => ({}), text: async () => "{}" } as unknown as Response;
      }
      if (url.startsWith("https://openrouter.ai/")) {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        const marker = body.messages?.[1]?.content ?? "";
        const content = String(marker).includes("SKALD_PROBE_OK") || String(marker).includes("marker")
          ? "SKALD_PROBE_OK"
          : '{"schemaVersion":1,"probe":true}';
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }], model: NEMO }) } as unknown as Response;
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => JSON.stringify({ error: { type: "MissingSessionID" } }),
      } as unknown as Response;
    });
    const report = await discoverLiveRoutes({
      apiKey: "zen-key",
      ollamaKey: "ollama-key",
      openrouterKey: "or-key",
      openrouterModels: [NEMO],
      preferredModels: ["big-pickle"],
      fetchImpl,
    });
    expect(report.provider).toBe("openrouter");
    expect(report.status).toBe("degraded");
    expect(report.activeModel).toBe(NEMO);
    expect(report.catalog?.status).toBe("ok");
    expect(report.routes.interpret).toEqual([{ provider: "openrouter", model: NEMO, protocol: "openai_chat", tier: "live_primary" }]);
    expect(report.excluded).toEqual(expect.arrayContaining([
      { model: "big-pickle", reason: "model_unavailable" },
      { model: "gemma4:31b-cloud", reason: "interpret_probe_failed" },
    ]));
    const openrouterCalls = fetchImpl.mock.calls.filter((call) => String(call[0]).startsWith("https://openrouter.ai/"));
    expect(openrouterCalls).toHaveLength(2);
  });

  it("merges every checked rung when all rungs including OpenRouter fail", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/models")) return { ok: true, status: 200, json: async () => ({ data: [{ id: "big-pickle" }] }) } as unknown as Response;
      if (url.startsWith("https://ollama.com/") || url.startsWith("https://openrouter.ai/")) {
        return { ok: false, status: 500, json: async () => ({}), text: async () => "{}" } as unknown as Response;
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => JSON.stringify({ error: { type: "MissingSessionID" } }),
      } as unknown as Response;
    });
    const report = await discoverLiveRoutes({
      apiKey: "zen-key",
      ollamaKey: "ollama-key",
      openrouterKey: "or-key",
      preferredModels: ["big-pickle"],
      fetchImpl,
    });
    // Zen dead, Ollama dead, OpenRouter dead: no routes served, but every
    // miss stays explainable instead of collapsing to the Zen report.
    expect(report.provider).toBe("openrouter");
    expect(report.status).toBe("unavailable");
    expect(report.activeModel).toBeUndefined();
    expect(report.routes).toEqual({ interpret: [], narrate: [] });
    expect(report.candidates.map((candidate) => candidate.model)).toEqual(
      expect.arrayContaining(["big-pickle", "gemma4:31b-cloud"]),
    );
    expect(report.excluded).toEqual(expect.arrayContaining([
      { model: "big-pickle", reason: "model_unavailable" },
      { model: "gemma4:31b-cloud", reason: expect.any(String) },
    ]));
    expect(report.catalog?.status).toBe("ok");
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).startsWith("https://openrouter.ai/"))).toBe(true);
  });

  it("never spends OpenRouter quota while Ollama answers", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models")) return { ok: true, status: 200, json: async () => ({ data: [{ id: "big-pickle" }] }) } as unknown as Response;
      if (url.startsWith("https://openrouter.ai/")) throw new Error("OpenRouter quota must not be spent while Ollama answers");
      if (url.startsWith("https://ollama.com/")) {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        const marker = body.messages?.[1]?.content ?? "";
        const content = String(marker).includes("SKALD_PROBE_OK") || String(marker).includes("marker")
          ? "SKALD_PROBE_OK"
          : '{"schemaVersion":1,"probe":true}';
        return { ok: true, status: 200, json: async () => ({ message: { content }, model: "gemma4:31b-cloud" }) } as unknown as Response;
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => JSON.stringify({ error: { type: "MissingSessionID" } }),
      } as unknown as Response;
    });
    const report = await discoverLiveRoutes({
      apiKey: "zen-key",
      ollamaKey: "ollama-key",
      openrouterKey: "or-key",
      preferredModels: ["big-pickle"],
      fetchImpl,
    });
    expect(report.provider).toBe("ollama_cloud");
  });

  it("merges Zen and Ollama misses when no OpenRouter credential is configured", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/models")) return { ok: true, status: 200, json: async () => ({ data: [{ id: "big-pickle" }] }) } as unknown as Response;
      if (url.startsWith("https://openrouter.ai/")) throw new Error("OpenRouter must not be touched without a credential");
      return {
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => JSON.stringify({ error: { type: "MissingSessionID" } }),
      } as unknown as Response;
    });
    const probe = vi.fn(async () => ({ status: "model_unavailable", phase: "response_status", httpStatus: 400 }));
    const report = await discoverLiveRoutes({
      apiKey: "zen-key",
      ollamaKey: "ollama-key",
      preferredModels: ["big-pickle"],
      fetchImpl,
      probe: probe as any,
    });
    expect(report.provider).toBe("ollama_cloud");
    expect(report.status).toBe("unavailable");
    expect(report.routes).toEqual({ interpret: [], narrate: [] });
    expect(report.candidates.map((candidate) => candidate.model)).toEqual(
      expect.arrayContaining(["big-pickle", "gemma4:31b-cloud"]),
    );
    expect(report.excluded).toEqual(expect.arrayContaining([
      { model: "big-pickle", reason: "model_unavailable" },
      { model: "gemma4:31b-cloud", reason: "model_unavailable" },
    ]));
  });
});
