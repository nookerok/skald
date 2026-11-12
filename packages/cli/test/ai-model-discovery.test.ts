import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderRequestError } from "@skald/world";
import type { OpenCodeCatalogModel, OpenCodeCatalogReport } from "@skald/world";
import {
  loadDiscoveryServiceEnvironment,
  screenOpenCodeFreeModels,
} from "../src/admin/ai-model-discovery.js";

const roots: string[] = [];
const probeEnvironment = { SKALD_OPENCODE_RUN: "1", OPENCODE_API_KEY: "probe-secret" };

function makeModel(id: string, overrides: Partial<OpenCodeCatalogModel> = {}): OpenCodeCatalogModel {
  return {
    id,
    type: "chat",
    name: "Screen test model",
    inputModalities: ["text"],
    outputModalities: ["text"],
    apiFamilies: ["chat-completions"],
    textInputPrice: 0,
    textOutputPrice: 0,
    hasConditionalTextPricing: false,
    zeroPriceTextChat: true,
    clientRestriction: "opencode_cli",
    ...overrides,
  };
}

function makeCatalog(models: readonly OpenCodeCatalogModel[]): OpenCodeCatalogReport {
  return {
    provider: "opencode_zen",
    status: "ok",
    phase: "response_decode",
    modelIds: models.map((model) => model.id),
    models,
    eligibleFreeChatIds: models.filter((model) => model.zeroPriceTextChat === true).map((model) => model.id),
    sourceUrl: "https://opencode.ai/inference/v1/models",
    catalogDigest: "a".repeat(64),
  };
}

function marker(category: "interpret" | "narrate"): string {
  return category === "interpret"
    ? "{\"schemaVersion\":1,\"probe\":true}"
    : "Лада стоит у стойки. На стойке лежит серебряный ключ, а дверь за стойкой закрыта.";
}

function makeProbe(calls: string[] = []) {
  return async (model: string, category: "interpret" | "narrate") => {
    calls.push(model + ":" + category);
    return { text: marker(category), latencyMs: 17 };
  };
}

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "skald-ai-model-discovery-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("screenOpenCodeFreeModels", () => {
  it("discovers a new zero-price id outside the preference list and screens both supported routes", async () => {
    const calls: string[] = [];
    const report = await screenOpenCodeFreeModels({
      catalog: makeCatalog([makeModel("newly-published-free-model")]),
      preferredModels: ["old-missing-model"],
      env: probeEnvironment,
      probe: makeProbe(calls),
    });
    expect(report.status).toBe("complete");
    expect(report.candidates.map((candidate) => candidate.id)).toEqual(["newly-published-free-model"]);
    expect(report.candidates[0]?.preferred).toBe(false);
    expect(report.candidates[0]?.screening).toBe("pass");
    expect(calls).toEqual([
      "newly-published-free-model:interpret",
      "newly-published-free-model:narrate",
    ]);
    expect(report.candidates[0]?.activation).toBe("not_approved");
  });

  it("excludes models documented as unavailable in the configured region before inference", async () => {
    const calls: string[] = [];
    const catalog = makeCatalog([
      makeModel("beam-free"),
      makeModel("inkling-2-small-free"),
      makeModel("available-in-russia"),
    ]);
    const report = await screenOpenCodeFreeModels({
      catalog,
      preferredModels: [],
      env: { ...probeEnvironment, SKALD_OPENCODE_REGION: "RU" },
      probe: makeProbe(calls),
    });
    expect(report.source.region).toBe("RU");
    expect(report.candidates.map((candidate) => candidate.id)).toEqual(["available-in-russia"]);
    expect(report.exclusions).toEqual(expect.arrayContaining([
      { id: "beam-free", reason: "region_restriction" },
      { id: "inkling-2-small-free", reason: "region_restriction" },
    ]));
    expect(report.catalogSnapshot?.filter((entry) => entry.eligibility === "excluded")
      .map((entry) => [entry.id, entry.exclusionReason])).toEqual(expect.arrayContaining([
      ["beam-free", "region_restriction"],
      ["inkling-2-small-free", "region_restriction"],
    ]));
    expect(calls).toEqual(["available-in-russia:interpret", "available-in-russia:narrate"]);
  });

  it("does not call inference for unknown, paid, unsupported, or direct-HTTP-only candidates", async () => {
    const paid = makeModel("paid", { textOutputPrice: 0.01, zeroPriceTextChat: false, clientRestriction: "direct_http" });
    const unknown = makeModel("unknown-price", { textInputPrice: null, zeroPriceTextChat: null, clientRestriction: "unknown" });
    const unsupported = makeModel("embedding", { type: "embedding", zeroPriceTextChat: false, clientRestriction: "direct_http" });
    const wrongTransport = makeModel("direct-only", { clientRestriction: "direct_http" });
    const calls: string[] = [];
    const report = await screenOpenCodeFreeModels({
      catalog: makeCatalog([paid, unknown, unsupported, wrongTransport]),
      env: probeEnvironment,
      probe: makeProbe(calls),
    });
    expect(report.candidates).toEqual([]);
    expect(calls).toEqual([]);
    expect(report.exclusions).toEqual(expect.arrayContaining([
      { id: "paid", reason: "not_free" },
      { id: "unknown-price", reason: "price_unknown" },
      { id: "embedding", reason: "unsupported_type" },
      { id: "direct-only", reason: "transport_restriction" },
    ]));
  });

  it("fails closed without native transport or credentials and makes no probes", async () => {
    const calls: string[] = [];
    const report = await screenOpenCodeFreeModels({
      catalog: makeCatalog([makeModel("candidate")]),
      env: {},
      probe: makeProbe(calls),
    });
    expect(report.status).toBe("blocked");
    expect(report.circuitBreaker).toBe("native_transport_disabled");
    expect(report.providerCallCount).toBe(0);
    expect(calls).toEqual([]);
  });

  it("requires exact JSON schema and exact narration marker", async () => {
    const report = await screenOpenCodeFreeModels({
      catalog: makeCatalog([makeModel("candidate")]),
      env: probeEnvironment,
      probe: async (_model, category) => ({
        text: category === "interpret" ? "{\"schemaVersion\":1,\"probe\":true,\"extra\":\"bad\"}" : "Лада открыла дверь и взяла ключ.",
        latencyMs: 1,
      }),
    });
    expect(report.candidates[0]?.interpret.status).toBe("marker_mismatch");
    expect(report.candidates[0]?.narrate.status).toBe("marker_mismatch");
    expect(report.candidates[0]?.narrate.reason).toBe("grounding_mismatch");
    expect(report.candidates[0]?.screening).toBe("fail");
  });

  it("respects max candidate count, max concurrency, and records the untested remainder", async () => {
    const models = [makeModel("a"), makeModel("b"), makeModel("c"), makeModel("d")];
    let inFlight = 0;
    let peak = 0;
    let calls = 0;
    const report = await screenOpenCodeFreeModels({
      catalog: makeCatalog(models),
      env: probeEnvironment,
      maxCandidates: 2,
      probe: async (_model, category) => {
        calls += 1;
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return { text: marker(category), latencyMs: 5 };
      },
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(calls).toBe(4);
    expect(report.status).toBe("partial");
    expect(report.providerCallCount).toBe(4);
    expect(report.exclusions.filter((item) => item.reason === "candidate_budget")).toHaveLength(2);
    expect(report.candidates.filter((item) => item.screening === "not_run")).toHaveLength(2);
    expect(report.candidates.slice(2).every((item) => item.interpret.reason === "candidate_budget")).toBe(true);
  });

  it("enforces one monotonic wall-clock budget across concurrent candidates", async () => {
    let clockMs = 0;
    const timeouts: number[] = [];
    let calls = 0;
    const report = await screenOpenCodeFreeModels({
      catalog: makeCatalog([makeModel("a"), makeModel("b"), makeModel("c")]),
      env: probeEnvironment,
      maxCandidates: 3,
      maxDurationMs: 15_000,
      monotonicNow: () => clockMs,
      probe: async (_model, category, timeoutMs) => {
        calls += 1;
        timeouts.push(timeoutMs);
        clockMs += 6_000;
        return { text: marker(category), latencyMs: 5 };
      },
    });
    expect(calls).toBeLessThanOrEqual(2);
    expect(timeouts.every((timeout) => timeout <= 8_000)).toBe(true);
    expect(report.status).toBe("partial");
    expect(report.policy.maxDurationMs).toBe(15_000);
    expect(report.candidates.some((candidate) => candidate.interpret.reason === "run_time_budget"
      || candidate.narrate.reason === "run_time_budget")).toBe(true);
  });

  it("uses a provider-wide fail-closed circuit breaker without serializing raw error text", async () => {
    const secret = "private-upstream-error";
    const report = await screenOpenCodeFreeModels({
      catalog: makeCatalog([makeModel("a"), makeModel("b"), makeModel("c")]),
      env: probeEnvironment,
      probe: async (model, category) => {
        if (model === "a" && category === "interpret") throw new Error(secret);
        return { text: marker(category), latencyMs: 5 };
      },
    });
    expect(report.circuitBreaker).toBe("provider_transport_error");
    expect(report.providerCallCount).toBeLessThan(6);
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("retries one 429 using a bounded Retry-After delay", async () => {
    const calls: string[] = [];
    const delays: number[] = [];
    const report = await screenOpenCodeFreeModels({
      catalog: makeCatalog([makeModel("rate-limited-once")]),
      env: probeEnvironment,
      maxCandidates: 1,
      sleepImpl: async (ms) => { delays.push(ms); },
      probe: async (model, category) => {
        calls.push(model + ":" + category);
        if (calls.length === 1) {
          throw new ProviderRequestError({
            provider: "opencode_run",
            model: "opencode/" + model,
            category,
            phase: "response_status",
            httpStatus: 429,
            providerCode: "rate_limited",
            retryAfterMs: 2_000,
          });
        }
        return { text: marker(category), latencyMs: 5 };
      },
    });
    expect(delays).toEqual([2_000]);
    expect(calls).toEqual([
      "rate-limited-once:interpret",
      "rate-limited-once:interpret",
      "rate-limited-once:narrate",
    ]);
    expect(report.providerCallCount).toBe(3);
    expect(report.policy.maxCalls).toBe(4);
    expect(report.candidates[0]?.screening).toBe("pass");
    expect(report.circuitBreaker).toBeUndefined();
  });

  it.each([
    [401, "provider_auth_failure", "provider_auth"],
    [403, "provider_auth_failure", "provider_auth"],
    [402, "provider_quota_exhausted", "provider_quota"],
  ] as const)("does not retry provider-wide status %i", async (httpStatus, breaker, reason) => {
    let calls = 0;
    const report = await screenOpenCodeFreeModels({
      catalog: makeCatalog([makeModel("provider-refused"), makeModel("not-started")]),
      env: probeEnvironment,
      maxCandidates: 1,
      probe: async (_model, category) => {
        calls += 1;
        throw new ProviderRequestError({
          provider: "opencode_run",
          model: "opencode/provider-refused",
          category,
          phase: "response_status",
          httpStatus,
          providerCode: "account_unavailable",
        });
      },
    });
    expect(calls).toBe(1);
    expect(report.providerCallCount).toBe(1);
    expect(report.circuitBreaker).toBe(breaker);
    expect(report.candidates[0]?.interpret).toMatchObject({ status: "provider_error", httpStatus, reason });
    expect(report.candidates[0]?.narrate.status).toBe("not_run");
    expect(report.candidates[0]?.screening).toBe("not_run");
    expect(report.candidates[1]?.screening).toBe("not_run");
  });

  it("never shortens a long upstream cooldown or sends narration to the cooled-down model", async () => {
    const calls: string[] = [];
    const delays: number[] = [];
    const report = await screenOpenCodeFreeModels({
      catalog: makeCatalog([makeModel("long-cooldown"), makeModel("available-model")]),
      env: probeEnvironment,
      sleepImpl: async (ms) => { delays.push(ms); },
      probe: async (model, category) => {
        calls.push(model + ":" + category);
        if (model === "long-cooldown") throw new ProviderRequestError({ provider: "opencode_run", model, category, phase: "response_status", httpStatus: 429, retryAfterMs: 60_000 });
        return { text: marker(category), latencyMs: 1 };
      },
    });
    expect(delays).toEqual([]);
    expect(calls.filter((call) => call.startsWith("long-cooldown:"))).toEqual(["long-cooldown:interpret"]);
    expect(report.candidates.find((candidate) => candidate.id === "long-cooldown")?.interpret.retryAfterMs).toBe(60_000);
    expect(report.candidates.find((candidate) => candidate.id === "available-model")?.screening).toBe("pass");
    expect(report.status).toBe("partial");
  });

  it("continues other candidates after a model-scoped 429 while retaining partial status", async () => {
    let limitedCalls = 0;
    const report = await screenOpenCodeFreeModels({
      catalog: makeCatalog([makeModel("rate-limited-model"), makeModel("available-model")]),
      env: probeEnvironment,
      sleepImpl: async () => undefined,
      probe: async (model, category) => {
        if (model === "rate-limited-model") {
          limitedCalls += 1;
          throw new ProviderRequestError({ provider: "opencode_run", model, category, phase: "response_status", httpStatus: 429 });
        }
        return { text: marker(category), latencyMs: 1 };
      },
    });
    expect(report.circuitBreaker).toBeUndefined();
    expect(report.status).toBe("partial");
    expect(report.candidates.find((candidate) => candidate.id === "available-model")?.screening).toBe("pass");
    expect(limitedCalls).toBe(2);
  });

  it("opens a shared breaker only when 429 explicitly identifies an account rate limit", async () => {
    let calls = 0;
    const report = await screenOpenCodeFreeModels({
      catalog: makeCatalog([makeModel("account-limited")]),
      env: probeEnvironment,
      sleepImpl: async () => undefined,
      probe: async (model, category) => {
        calls += 1;
        throw new ProviderRequestError({ provider: "opencode_run", model, category, phase: "response_status", httpStatus: 429, providerCode: "account_rate_limited" });
      },
    });
    expect(calls).toBe(1);
    expect(report.circuitBreaker).toBe("provider_rate_limited");
    expect(report.candidates[0]?.narrate.status).toBe("not_run");
  });

  it("treats model-unavailable status as candidate-scoped and continues the catalogue", async () => {
    const report = await screenOpenCodeFreeModels({
      catalog: makeCatalog([makeModel("unavailable-model"), makeModel("available-model")]),
      env: probeEnvironment,
      probe: async (model, category) => {
        if (model === "unavailable-model") {
          throw new ProviderRequestError({
            provider: "opencode_run",
            model: "opencode/" + model,
            category,
            phase: "response_status",
            httpStatus: 404,
            providerCode: "model_not_found",
          });
        }
        return { text: marker(category), latencyMs: 5 };
      },
    });
    expect(report.circuitBreaker).toBeUndefined();
    const missing = report.candidates.find((candidate) => candidate.id === "unavailable-model");
    const available = report.candidates.find((candidate) => candidate.id === "available-model");
    expect(missing?.interpret).toMatchObject({ status: "provider_error", reason: "model_unavailable", httpStatus: 404 });
    expect(missing?.narrate).toMatchObject({ status: "not_run", reason: "model_unavailable" });
    expect(available?.screening).toBe("pass");
  });

  it("reloads a rotated service env file for a manual run without exposing its value", () => {
    const envFile = join(makeRoot(), "service.env");
    writeFileSync(envFile, "OPENCODE_API_KEY=rotated-secret\nSKALD_OPENCODE_RUN=1\n");
    const env: NodeJS.ProcessEnv = {
      SKALD_ENV_FILE: envFile,
      OPENCODE_API_KEY: "old-secret",
      SKALD_OPENCODE_RUN: "0",
    };
    expect(loadDiscoveryServiceEnvironment(env).ok).toBe(true);
    expect(env.OPENCODE_API_KEY).toBe("rotated-secret");
    expect(env.SKALD_OPENCODE_RUN).toBe("1");
    expect(JSON.stringify(env)).toContain("rotated-secret");
    expect(JSON.stringify({ generation: env.OPENCODE_API_KEY ? "configured" : "missing" })).not.toContain("rotated-secret");
  });

  it("does not retain credentials or native-transport opt-ins removed from the service env file", () => {
    const envFile = join(makeRoot(), "service.env");
    writeFileSync(envFile, "LANG=ru_RU.UTF-8\n");
    const env: NodeJS.ProcessEnv = {
      SKALD_ENV_FILE: envFile,
      OPENCODE_API_KEY: "removed-old-secret",
      SKALD_OPENCODE_ZEN_API_KEY: "removed-old-zen-secret",
      SKALD_OPENCODE_RUN: "1",
      SKALD_OPENCODE_BIN: "/old/opencode",
    };
    expect(loadDiscoveryServiceEnvironment(env).ok).toBe(true);
    expect(env.OPENCODE_API_KEY).toBeUndefined();
    expect(env.SKALD_OPENCODE_ZEN_API_KEY).toBeUndefined();
    expect(env.SKALD_OPENCODE_BIN).toBeUndefined();
    expect(env.SKALD_OPENCODE_RUN).toBeUndefined();
  });

  it("rejects malformed environment files before replacing current values", () => {
    const envFile = join(makeRoot(), "bad.env");
    writeFileSync(envFile, "OPENCODE_API_KEY=first\nOPENCODE_API_KEY=second\n");
    const env: NodeJS.ProcessEnv = { SKALD_ENV_FILE: envFile, OPENCODE_API_KEY: "current" };
    expect(loadDiscoveryServiceEnvironment(env).ok).toBe(false);
    expect(env.OPENCODE_API_KEY).toBe("current");
  });
});
