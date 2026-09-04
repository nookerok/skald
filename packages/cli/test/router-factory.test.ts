import { describe, expect, it } from "vitest";
import { createLiveRouterConfiguration, createRouterConfiguration } from "../src/runtime/router-factory.js";

describe("router factory", () => {
  it("captures provider-scoped keys in the runtime router without returning them", () => {
    const config = createRouterConfiguration({
      SKALD_OPENCODE_ZEN_API_KEY: "zen-secret",
      SKALD_OLLAMA_CLOUD_API_KEY: "ollama-secret",
      SKALD_AI_REQUIRED: "1",
    });

    expect(config.required).toBe(true);
    expect(config.missingProviders).toEqual([]);
    expect(config.router).not.toBeNull();
    expect(config.router?.hasProviderKey("opencode_zen")).toBe(true);
    expect(config.router?.hasProviderKey("ollama_cloud")).toBe(true);
    expect(config.router?.configFingerprint()).toBe(config.configFingerprint);
    expect("providerKeys" in config).toBe(false);
    expect(JSON.stringify(config)).not.toContain("secret");
  });

  it("reports required providers as missing without leaking key values", () => {
    const config = createRouterConfiguration({
      SKALD_OPENCODE_ZEN_API_KEY: "zen-secret",
      SKALD_AI_REQUIRED: "1",
    });

    expect(config.router?.hasProviderKey("opencode_zen")).toBe(true);
    expect(config.router?.hasProviderKey("ollama_cloud")).toBe(false);
    expect(config.missingProviders).toEqual([]);
    expect(config.router?.configFingerprint()).toBe(config.configFingerprint);
    expect(JSON.stringify(config)).not.toContain("zen-secret");
  });

  it("fingerprints key presence, not key values", () => {
    const first = createRouterConfiguration({
      SKALD_OPENCODE_ZEN_API_KEY: "first",
      SKALD_OLLAMA_CLOUD_API_KEY: "second",
      SKALD_AI_REQUIRED: "0",
    });
    const second = createRouterConfiguration({
      SKALD_OPENCODE_ZEN_API_KEY: "rotated-first",
      SKALD_OLLAMA_CLOUD_API_KEY: "rotated-second",
      SKALD_AI_REQUIRED: "0",
    });
    const missing = createRouterConfiguration({
      SKALD_OPENCODE_ZEN_API_KEY: "first",
      SKALD_AI_REQUIRED: "0",
    });

    expect(second.configFingerprint).toBe(first.configFingerprint);
    expect(missing.configFingerprint).not.toBe(first.configFingerprint);
  });

  it("activates only catalog-present models that pass both live route probes", async () => {
    const preferred = ["big-pickle", "muse-spark-1.3-contributor-free", "mimo-v2.5-free"];
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: preferred.map((id) => ({ id })) }),
    } as unknown as Response);
    const probe = async () => ({ status: "ok", phase: "schema_validation" } as const);
    const config = await createLiveRouterConfiguration({
      SKALD_OPENCODE_ZEN_API_KEY: "zen-secret",
      SKALD_AI_REQUIRED: "1",
    }, { preferredModels: preferred, fetchImpl, probe });

    expect(config.selectionReport?.activeModel).toBe("big-pickle");
    expect(config.selectionReport?.backupModel).toBe("muse-spark-1.3-contributor-free");
    expect(config.router?.routeCandidates("interpret").map((candidate) => candidate.model)).toEqual(preferred);
    expect(JSON.stringify(config)).not.toContain("zen-secret");
    expect(config.router?.configFingerprint()).toBe(config.configFingerprint);
  });
});
