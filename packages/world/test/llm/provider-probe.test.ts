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

  it("reports degraded when a paid primary fails but backup passes", async () => {
    const router = fakeRouter({
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
});
