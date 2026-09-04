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
});
