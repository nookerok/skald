import { describe, expect, it, vi } from "vitest";
import { LLM_CONFIG } from "../../src/llm/config.js";
import { probeAIReadiness } from "../../src/llm/provider-probe.js";

function fakeRouter(responses: Record<string, string | Error>) {
  const candidates = (category: "interpret" | "narrate") => LLM_CONFIG.routes[category].candidates;
  return {
    routeCandidates: candidates,
    configFingerprint: () => "test-fingerprint",
    hasProviderKey: () => true,
    chatCandidate: vi.fn(async (category: "interpret" | "narrate", candidate: { provider: string; model: string }) => {
      const key = `${category}:${candidate.model}`;
      const response = responses[key];
      if (response instanceof Error) throw response;
      return { text: response ?? (category === "interpret" ? '{"schemaVersion":1,"probe":true}' : "SKALD_PROBE_OK") };
    }),
  } as any;
}

describe("no-world AI readiness probe", () => {
  it("checks both required candidates for both routes", async () => {
    const router = fakeRouter({});
    const report = await probeAIReadiness(router);
    expect(report.status).toBe("ready");
    expect(report.routes.interpret).toHaveLength(2);
    expect(report.routes.narrate).toHaveLength(2);
    expect(router.chatCandidate).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(report)).not.toContain("schemaVersion");
    expect(JSON.stringify(report)).not.toContain("SKALD_PROBE_OK");
  });

  it("reports degraded when a paid primary fails but backup passes", async () => {    const router = fakeRouter({
      "interpret:muse-spark-1.3-contributor-free": new Error("HTTP 503 (secret response body must not leak)"),
      "narrate:muse-spark-1.3-contributor-free": new Error("HTTP 503 (secret response body must not leak)"),
    });
    const report = await probeAIReadiness(router);
    expect(report.status).toBe("degraded");
    const failures = [...report.routes.interpret, ...report.routes.narrate].filter((result) => result.status === "failed");
    expect(failures).toHaveLength(2);
    expect(JSON.stringify(report)).not.toContain("secret");
  });

  it("fails closed without a router or a provider key", async () => {
    const missing = await probeAIReadiness(null);
    expect(missing.status).toBe("misconfigured");
    const router = fakeRouter({});
    router.hasProviderKey = () => false;
    const report = await probeAIReadiness(router);
    expect(report.status).toBe("misconfigured");
    expect(report.routes.interpret.every((result: any) => result.phase === "configuration")).toBe(true);
  });

  it("classifies malformed interpret JSON without exposing response text", async () => {
    const router = fakeRouter({ "interpret:muse-spark-1.3-contributor-free": "not-json" });
    const diagnostics: unknown[] = [];
    const report = await probeAIReadiness(router, { diagnostics: (event) => diagnostics.push(event) });
    expect(report.routes.interpret[0]).toMatchObject({ status: "failed", phase: "response_decode" });
    expect(diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "probe", model: "muse-spark-1.3-contributor-free", phase: "response_decode" })]));
  });

  it("fails closed when a provider returns a different model id", async () => {
    const router = fakeRouter({});
    router.chatCandidate.mockImplementationOnce(async () => ({
      text: '{"schemaVersion":1,"probe":true}',
      responseModel: "unexpected-model",
    }));
    const report = await probeAIReadiness(router);
    expect(report.routes.interpret[0]).toMatchObject({ status: "failed", phase: "model_selection" });
    expect(report.status).toBe("degraded");
  });

  it("reports degraded for one working model with no backup instead of unavailable", async () => {
    const router = {
      routeCandidates: (_category: "interpret" | "narrate") => [{
        provider: "ollama_cloud",
        model: "gemma4:31b-cloud",
        protocol: "ollama_chat",
        tier: "live_primary",
      }],
      configFingerprint: () => "test-fingerprint",
      hasProviderKey: () => true,
      chatCandidate: vi.fn(async (_category: "interpret" | "narrate") => ({
        text: _category === "interpret" ? '{"schemaVersion":1,"probe":true}' : "SKALD_PROBE_OK",
      })),
    } as any;
    const report = await probeAIReadiness(router);
    expect(report.routes.interpret).toHaveLength(2);
    expect(report.routes.interpret[0]).toMatchObject({ status: "ok", model: "gemma4:31b-cloud" });
    expect(report.routes.interpret[1]).toMatchObject({ status: "unavailable", phase: "configuration" });
    expect(report.status).toBe("degraded");
  });

  it("never masks a live total failure with a stale degraded selection", async () => {
    const router = {
      routeCandidates: (_category: "interpret" | "narrate") => [{
        provider: "ollama_cloud",
        model: "gemma4:31b-cloud",
        protocol: "ollama_chat",
        tier: "live_primary",
      }],
      configFingerprint: () => "test-fingerprint",
      hasProviderKey: () => true,
      chatCandidate: vi.fn(async () => {
        throw new Error("HTTP 500 (phase=response_status)");
      }),
    } as any;
    const staleDegraded = {
      provider: "ollama_cloud",
      status: "degraded",
      checkedAt: "2026-09-08T00:00:00.000Z",
      durationMs: 7,
      candidates: [],
      excluded: [],
      routes: { interpret: [], narrate: [] },
    } as any;
    const report = await probeAIReadiness(router, { selectionReport: staleDegraded });
    expect(report.status).toBe("unavailable");
    expect(report.modelSelection).toEqual(staleDegraded);
  });

  it("marks playable only when both routes have a working candidate", async () => {
    const router = fakeRouter({});
    const report = await probeAIReadiness(router);
    expect(report.status).toBe("ready");
    expect(report.routeStatus).toEqual({ interpret: "ok", narrate: "ok" });
    expect(report.playable).toBe(true);
  });

  it("rejects deployment when interpret is dead even though narrate answers", async () => {
    const router = fakeRouter({
      "interpret:muse-spark-1.3-contributor-free": new Error("HTTP 400 (phase=response_status)"),
      "interpret:ling-3.0-flash-fin-free": new Error("HTTP 400 (phase=response_status)"),
    });
    const report = await probeAIReadiness(router);
    expect(report.status).toBe("degraded");
    expect(report.routeStatus).toEqual({ interpret: "failed", narrate: "ok" });
    expect(report.playable).toBe(false);
  });

  it("reports not playable without a router", async () => {
    const report = await probeAIReadiness(null);
    expect(report.playable).toBe(false);
    expect(report.routeStatus).toEqual({ interpret: "failed", narrate: "failed" });
  });
});
