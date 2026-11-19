import { describe, expect, it, vi } from "vitest";
import { ProviderRequestError } from "@skald/world";
import { createP3TransportTrace } from "../src/acceptance/gm-p3-transport-trace.js";
import { createOpenCodeGenerationBudget, openCodeRequestDelta } from "../src/acceptance/opencode-live-budget.js";

const loopback = "http://127.0.0.1:43127";

function instrument(fetchImpl: typeof fetch) {
  const trace = createP3TransportTrace();
  const budget = createOpenCodeGenerationBudget({
    baseUrl: loopback, maxGenerationRequests: 1, maxReservedCostUsd: 0,
    maxInputTokens: 900, maxOutputTokens: 100,
    fetchImpl, observeHttp: trace.observeHttp,
  });
  return { trace, budget };
}

describe("P3 OpenCode transport trace", () => {
  it("attributes overlapping HTTP completions to their own async phase and category", async () => {
    let completeWarmup!: (r: Response) => void;
    const slow = new Promise<Response>((resolve) => { completeWarmup = resolve; });
    const { trace, budget } = instrument(vi.fn<typeof fetch>(async (input) =>
      String(input).includes("/api/model") ? slow : new Response(null, { status: 201 })));

    const warm = trace.run("initial_prewarm", null, () => budget.fetch(loopback + "/api/model"));
    await trace.run("router_call", "interpret", () => budget.fetch(loopback + "/api/session", { method: "POST" }));
    completeWarmup(new Response(null, { status: 503, headers: { "Retry-After": "7" } }));
    await warm;
    await budget.fetch(loopback + "/api/info");

    expect(trace.snapshot().entries.filter((row) => row.type === "http")).toEqual([
      expect.objectContaining({ scopeId: 2, phase: "router_call", category: "interpret", operation: "session_create", httpStatus: 201 }),
      expect.objectContaining({ scopeId: 1, phase: "initial_prewarm", category: null, operation: "model_catalog", httpStatus: 503, retryAfterHeader: "7" }),
      expect.objectContaining({ scopeId: null, phase: "unscoped", operation: "server_info", httpStatus: 201 }),
    ]);
  });

  it("does not inherit an earlier HTTP failure or log raw provider, URL, header or request data", async () => {
    const { trace, budget } = instrument(vi.fn<typeof fetch>(async () => new Response("provider-body-secret", {
      status: 503, headers: { "Retry-After": "raw-header-secret" },
    })));
    await trace.run("initial_prewarm", null, () => budget.fetch(loopback + "/api/model?hidden=secret", {
      headers: { authorization: "Bearer auth-secret" },
    }));
    const before = budget.snapshot();
    const checkpoint = trace.checkpoint();
    const error = new ProviderRequestError({
      provider: "opencode_server", model: "opencode/fake", phase: "request",
      providerCode: "input_byte_limit", reason: "prompt-and-error-secret",
    });

    await expect(trace.run("router_call", "interpret", async () => { throw error; }, 24_786)).rejects.toBe(error);
    expect(openCodeRequestDelta(before, budget.snapshot())).toMatchObject({
      modelCatalogRequests: 0, modelCatalogFailures: 0, sessionCreateRequests: 0, generationRequests: 0,
    });
    const snapshot = trace.snapshot();
    expect(snapshot.entries.filter((row) => row.sequence > checkpoint)).toEqual([
      expect.objectContaining({ phase: "router_call", type: "started", messageBytes: 24_786 }),
      expect.objectContaining({ phase: "router_call", type: "finished", outcome: "threw",
        failure: { kind: "unknown_error", name: "ProviderRequestError", code: "PROVIDER_REQUEST_FAILED",
          phase: "request", providerCode: "input_byte_limit", retryable: false } }),
    ]);
    expect(snapshot.entries).toContainEqual(expect.objectContaining({ type: "http", httpStatus: 503, retryAfterHeader: null }));
    expect(JSON.stringify(snapshot)).not.toContain("secret");
    expect(JSON.stringify(snapshot)).not.toContain(loopback);
  });
});
