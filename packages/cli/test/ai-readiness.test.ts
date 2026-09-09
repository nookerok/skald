import { describe, expect, it, vi } from "vitest";
import { AIReadinessService } from "../src/runtime/ai-readiness.js";
import { LLM_CONFIG } from "@skald/world";

describe("AIReadinessService", () => {
  it("serializes concurrent probes and returns the cached report during cooldown", async () => {
    let now = 100;
    const resolvers: Array<(value: { text: string }) => void> = [];
    const router = {
      routeCandidates: (category: "interpret" | "narrate") => LLM_CONFIG.routes[category].candidates,
      hasProviderKey: () => true,
      chatCandidate: vi.fn((_category: "interpret" | "narrate") => new Promise<{ text: string }>((resolve) => {
        resolvers.push((value) => resolve(value));
      })),
    } as any;
    const service = new AIReadinessService(router, { now: () => now, cooldownMs: 1_000 });
    const first = service.probe();
    const second = service.probe();
    expect(router.chatCandidate).toHaveBeenCalledTimes(2);
    expect(resolvers).toHaveLength(2);
    for (let i = 0; i < 2; i += 1) {
      resolvers[i]!({ text: '{"schemaVersion":1,"probe":true}' });
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(router.chatCandidate).toHaveBeenCalledTimes(4);
    expect(resolvers).toHaveLength(4);
    for (let i = 2; i < resolvers.length; i += 1) {
      resolvers[i]!({ text: "SKALD_PROBE_OK" });
    }
    const firstReport = await first;
    await expect(second).resolves.toEqual(firstReport);
    expect(firstReport.status).toBe("ready");
    now = 500;
    await expect(service.probe()).resolves.toEqual(firstReport);
    expect(router.chatCandidate).toHaveBeenCalledTimes(4);
  });

  it("exposes no cached report before the first probe", () => {
    const service = new AIReadinessService(null);
    expect(service.cached()).toBeNull();
    expect(service.isProbing()).toBe(false);
  });

  it("retains the factory fingerprint even when no router is available", async () => {
    const service = new AIReadinessService(null, { configFingerprint: "factory-missing-keys" });
    const report = await service.probe();
    expect(report.configFingerprint).toBe("factory-missing-keys");
  });

  it("returns the sanitized startup selection in the readiness report", async () => {
    const selectionReport = {
      provider: "opencode_zen" as const,
      status: "misconfigured" as const,
      checkedAt: "2026-09-03T00:00:00.000Z",
      durationMs: 12,
      catalog: { provider: "opencode_zen" as const, status: "auth_failure" as const, phase: "response_status" as const, modelIds: [], httpStatus: 401 },
      candidates: [],
      excluded: [{ model: "big-pickle", reason: "catalog_auth_failure" as const }],
      routes: { interpret: [], narrate: [] },
    };
    const service = new AIReadinessService(null, { selectionReport });
    const report = await service.probe();
    expect(report.modelSelection).toEqual(selectionReport);
    expect(report.excludedModels).toEqual(selectionReport.excluded);
  });

  it("prefers the router live selection over the stale startup snapshot", async () => {
    const staleSelection = {
      provider: "opencode_zen" as const,
      status: "unavailable" as const,
      checkedAt: "2026-09-06T00:00:00.000Z",
      durationMs: 5,
      candidates: [],
      excluded: [{ model: "big-pickle", reason: "model_unavailable" as const }],
      routes: { interpret: [], narrate: [] },
    };
    const liveSelection = {
      provider: "ollama_cloud" as const,
      status: "degraded" as const,
      checkedAt: "2026-09-08T00:00:00.000Z",
      durationMs: 7,
      candidates: [],
      excluded: [],
      routes: { interpret: [], narrate: [] },
    };
    const router = {
      routeCandidates: (_category: "interpret" | "narrate") => [{
        provider: "ollama_cloud",
        model: "gemma4:31b-cloud",
        protocol: "ollama_chat",
        tier: "live_primary",
      }],
      configFingerprint: () => "live-fingerprint",
      liveModelSelection: () => liveSelection,
      hasProviderKey: () => true,
      chatCandidate: vi.fn(async (category: "interpret" | "narrate") => ({
        text: category === "interpret" ? '{"schemaVersion":1,"probe":true}' : "SKALD_PROBE_OK",
      })),
    } as any;
    const service = new AIReadinessService(router, {
      configFingerprint: "stale-fingerprint",
      selectionReport: staleSelection,
    });
    const report = await service.probe();
    expect(report.modelSelection).toEqual(liveSelection);
    expect(report.configFingerprint).toBe("live-fingerprint");
    expect(report.status).toBe("degraded");
  });
});
