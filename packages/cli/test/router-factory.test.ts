import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveRouterConfiguration, createRouterConfiguration, openCodeRunIdentity, refreshRouterSelection } from "../src/runtime/router-factory.js";
import { OpenCodeRunProvider } from "../src/runtime/opencode-run-provider.js";

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
    expect(config.router?.hasProviderKey("openrouter")).toBe(false);
    expect(config.missingProviders).toEqual([]);
    expect(config.router?.configFingerprint()).toBe(config.configFingerprint);
    expect(JSON.stringify(config)).not.toContain("zen-secret");
  });

  it("captures the OpenRouter key alongside the other providers", () => {
    const config = createRouterConfiguration({
      SKALD_OPENCODE_ZEN_API_KEY: "zen-secret",
      SKALD_OLLAMA_CLOUD_API_KEY: "ollama-secret",
      SKALD_OPENROUTER_API_KEY: "or-secret",
      SKALD_AI_REQUIRED: "0",
    });

    expect(config.router?.hasProviderKey("openrouter")).toBe(true);
    expect(JSON.stringify(config)).not.toContain("or-secret");
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

  it("reapplies a fresh selection to a live router with a recomputed fingerprint", async () => {
    const preferred = ["muse-spark-1.3-contributor-free"];
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: preferred.map((id) => ({ id })) }),
    } as unknown as Response);
    const probe = async () => ({ status: "ok", phase: "schema_validation" } as const);
    const env = { SKALD_OPENCODE_ZEN_API_KEY: "zen-secret", SKALD_AI_REQUIRED: "1" };
    const config = await createLiveRouterConfiguration(env, { preferredModels: preferred, fetchImpl, probe });
    const router = config.router!;
    const before = router.configFingerprint();
    const ling = {
      provider: "opencode_zen",
      model: "ling-3.0-flash-fin-free",
      protocol: "openai_chat",
      tier: "live_primary",
    } as const;
    const refreshed = {
      ...config.selectionReport!,
      checkedAt: "2026-09-06T12:00:00.000Z",
      activeModel: "ling-3.0-flash-fin-free",
      routes: { interpret: [ling], narrate: [ling] },
    };
    const fingerprint = refreshRouterSelection(router, refreshed as any, env);
    expect(fingerprint).not.toBe(before);
    expect(router.configFingerprint()).toBe(fingerprint);
    expect(router.routeCandidates("interpret").map((candidate) => candidate.model)).toEqual(["ling-3.0-flash-fin-free"]);
    expect(router.liveModelSelection()?.checkedAt).toBe("2026-09-06T12:00:00.000Z");
    expect(JSON.stringify(router.diagnostics())).not.toContain("zen-secret");
  });

  it("falls back to Ollama Cloud when Zen activates nothing, keeping the Zen miss visible", async () => {
    const GEMMA = "gemma4:31b-cloud";
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models")) {
        return { ok: true, status: 200, json: async () => ({ data: [{ id: "big-pickle" }] }) } as unknown as Response;
      }
      if (url.startsWith("https://ollama.com/")) {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        const marker = body.messages?.[1]?.content ?? "";
        const content = String(marker).includes("SKALD_PROBE_OK") || String(marker).includes("marker")
          ? "SKALD_PROBE_OK"
          : '{"schemaVersion":1,"probe":true}';
        return { ok: true, status: 200, json: async () => ({ message: { content }, model: GEMMA }) } as unknown as Response;
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => JSON.stringify({ error: { type: "MissingSessionID" } }),
      } as unknown as Response;
    };
    const config = await createLiveRouterConfiguration({
      SKALD_OPENCODE_ZEN_API_KEY: "zen-secret",
      SKALD_OLLAMA_CLOUD_API_KEY: "ollama-secret",
      SKALD_AI_REQUIRED: "1",
    }, { preferredModels: ["big-pickle"], fetchImpl });

    expect(config.selectionReport?.provider).toBe("ollama_cloud");
    expect(config.selectionReport?.activeModel).toBe(GEMMA);
    expect(config.selectionReport?.excluded).toEqual(expect.arrayContaining([
      { model: "big-pickle", reason: "model_unavailable" },
    ]));
    expect(config.selectionReport?.candidates[0]?.interpret).toMatchObject({ status: "ok" });
    expect(config.router?.routeCandidates("interpret")).toEqual([
      { provider: "ollama_cloud", model: GEMMA, protocol: "ollama_chat", tier: "live_primary" },
    ]);
    expect(config.router?.routeCandidates("narrate")).toEqual([
      { provider: "ollama_cloud", model: GEMMA, protocol: "ollama_chat", tier: "live_primary" },
    ]);
    expect(config.router?.hasProviderKey("ollama_cloud")).toBe(true);
    expect(JSON.stringify(config)).not.toContain("zen-secret");
    expect(JSON.stringify(config)).not.toContain("ollama-secret");
  });

  it("falls through to OpenRouter when Zen and Ollama both activate nothing", async () => {
    const NEMO = "nvidia/nemotron-3-super-120b-a12b:free";
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models")) {
        return { ok: true, status: 200, json: async () => ({ data: [{ id: "big-pickle" }] }) } as unknown as Response;
      }
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
    };
    const config = await createLiveRouterConfiguration({
      SKALD_OPENCODE_ZEN_API_KEY: "zen-secret",
      SKALD_OLLAMA_CLOUD_API_KEY: "ollama-secret",
      SKALD_OPENROUTER_API_KEY: "or-secret",
      SKALD_AI_REQUIRED: "1",
    }, { preferredModels: ["big-pickle"], openrouterModels: [NEMO], fetchImpl });

    expect(config.selectionReport?.provider).toBe("openrouter");
    expect(config.selectionReport?.activeModel).toBe(NEMO);
    expect(config.router?.routeCandidates("interpret")).toEqual([
      { provider: "openrouter", model: NEMO, protocol: "openai_chat", tier: "live_primary" },
    ]);
    expect(config.router?.hasProviderKey("openrouter")).toBe(true);
    expect(JSON.stringify(config)).not.toContain("or-secret");
  });

  it("appends the opencode_run narrate backup only on explicit opt-in", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as unknown as Response);
    const enabled = await createLiveRouterConfiguration({
      SKALD_AI_REQUIRED: "0",
      SKALD_OPENCODE_RUN: "1",
    }, { fetchImpl });
    expect(enabled.router).toBeInstanceOf(OpenCodeRunProvider);
    expect(enabled.router?.routeCandidates("narrate")).toEqual([
      { provider: "opencode_run", model: "opencode/muse-spark-1.3-contributor-free", protocol: "opencode_run", tier: "catalog_candidate" },
    ]);
    expect(enabled.router?.routeCandidates("interpret")).toEqual([]);
    expect(enabled.router?.hasProviderKey("opencode_run")).toBe(true);

    const disabled = await createLiveRouterConfiguration({
      SKALD_OPENCODE_ZEN_API_KEY: "zen-secret",
      SKALD_AI_REQUIRED: "0",
    }, { fetchImpl });
    expect(disabled.router?.routeCandidates("narrate")).toEqual([]);
    expect(disabled.router).not.toBeInstanceOf(OpenCodeRunProvider);
  });

  it("keeps the opencode_run backup across selection refresh when enabled", async () => {    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as unknown as Response);
    const env = { SKALD_AI_REQUIRED: "0", SKALD_OPENCODE_RUN: "1" };
    const config = await createLiveRouterConfiguration(env, { fetchImpl });
    const router = config.router!;
    const refreshed = {
      ...config.selectionReport!,
      routes: { interpret: [], narrate: [] as const },
    };
    refreshRouterSelection(router, refreshed as any, env);
    expect(router.routeCandidates("narrate").map((candidate) => candidate.provider)).toEqual(["opencode_run"]);
  });

  it("keeps Zen behavior identical when no Ollama credential is configured", async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/models")) {
        return { ok: true, status: 200, json: async () => ({ data: [{ id: "big-pickle" }] }) } as unknown as Response;
      }
      return {
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => "{}",
      } as unknown as Response;
    };
    const config = await createLiveRouterConfiguration({
      SKALD_OPENCODE_ZEN_API_KEY: "zen-secret",
      SKALD_AI_REQUIRED: "1",
    }, { preferredModels: ["big-pickle"], fetchImpl });

    expect(config.selectionReport?.provider).toBe("opencode_zen");
    expect(config.selectionReport?.status).toBe("unavailable");
    expect(config.router?.routeCandidates("interpret")).toEqual([]);
  });

  it("changes the fingerprint when the opencode_run transport changes", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as unknown as Response);
    const enabled = await createLiveRouterConfiguration({
      SKALD_AI_REQUIRED: "0",
      SKALD_OPENCODE_RUN: "1",
    }, { fetchImpl });
    const disabled = await createLiveRouterConfiguration({ SKALD_AI_REQUIRED: "0" }, { fetchImpl });
    expect(enabled.configFingerprint).not.toBe(disabled.configFingerprint);

    const otherModel = await createLiveRouterConfiguration({
      SKALD_AI_REQUIRED: "0",
      SKALD_OPENCODE_RUN: "1",
      SKALD_OPENCODE_RUN_MODEL: "other/model",
    }, { fetchImpl });
    expect(otherModel.configFingerprint).not.toBe(enabled.configFingerprint);

    const otherAgent = await createLiveRouterConfiguration({
      SKALD_AI_REQUIRED: "0",
      SKALD_OPENCODE_RUN: "1",
      SKALD_OPENCODE_RUN_AGENT: "other",
    }, { fetchImpl });
    expect(otherAgent.configFingerprint).not.toBe(enabled.configFingerprint);
  });

  it("keeps startup and refresh fingerprints equal for the same effective selection", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as unknown as Response);
    const env = { SKALD_AI_REQUIRED: "0", SKALD_OPENCODE_RUN: "1" };
    const config = await createLiveRouterConfiguration(env, { fetchImpl });
    const second = refreshRouterSelection(config.router!, config.selectionReport!, env);
    expect(second).toBe(config.configFingerprint);
    expect(config.router!.routeCandidates("narrate").filter((candidate) => candidate.provider === "opencode_run")).toHaveLength(1);
  });

  it("keeps key values out of the transport identity", () => {
    const identity = openCodeRunIdentity({ SKALD_OPENCODE_RUN: "1", SKALD_OPENCODE_ZEN_API_KEY: "zen-secret" });
    expect(identity).toContain("opencode_run:enabled");
    expect(identity).not.toContain("zen-secret");
    expect(identity).not.toContain("skald-data");
    expect(identity).not.toContain(".opencode");
  });

  it("fingerprints the served manifest bytes across file replacement", async () => {
    // Deploy pull racing live traffic: the file changes from A to B while
    // the old provider still serves A. Refresh must keep identifying A;
    // only a new provider identifies B.
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as unknown as Response);
    const dir = mkdtempSync(join(tmpdir(), "skald-manifest-fp-race-"));
    const file = join(dir, "narrative.md");
    writeFileSync(file, "manifest-A", "utf8");
    const env = { SKALD_AI_REQUIRED: "0", SKALD_OPENCODE_RUN: "1", SKALD_OPENCODE_AGENT_MANIFEST: file };
    const config = await createLiveRouterConfiguration(env, { fetchImpl });
    const before = config.configFingerprint;
    const servedA = (config.router as OpenCodeRunProvider).agentManifestDigest();

    writeFileSync(file, "manifest-B", "utf8");
    const afterRefresh = refreshRouterSelection(config.router!, config.selectionReport!, env);
    expect(afterRefresh).toBe(before);
    expect((config.router as OpenCodeRunProvider).agentManifestDigest()).toBe(servedA);

    const rebuilt = await createLiveRouterConfiguration(env, { fetchImpl });
    expect(rebuilt.configFingerprint).not.toBe(before);
    expect((rebuilt.router as OpenCodeRunProvider).agentManifestDigest()).not.toBe(servedA);
  });

  it("rotates the fingerprint on isolation and manifest changes", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as unknown as Response);
    const base = { SKALD_AI_REQUIRED: "0", SKALD_OPENCODE_RUN: "1" };
    const isolated = await createLiveRouterConfiguration(base, { fetchImpl });
    const shared = await createLiveRouterConfiguration({ ...base, SKALD_OPENCODE_ISOLATE_HOME: "0" }, { fetchImpl });
    expect(shared.configFingerprint).not.toBe(isolated.configFingerprint);

    const dir = mkdtempSync(join(tmpdir(), "skald-manifest-fp-"));
    const first = join(dir, "first.md");
    const second = join(dir, "second.md");
    const renamed = join(dir, "renamed.md");
    writeFileSync(first, "agent manifest one", "utf8");
    writeFileSync(second, "agent manifest two", "utf8");
    writeFileSync(renamed, "agent manifest one", "utf8");
    const withFirst = await createLiveRouterConfiguration({ ...base, SKALD_OPENCODE_AGENT_MANIFEST: first }, { fetchImpl });
    const withSecond = await createLiveRouterConfiguration({ ...base, SKALD_OPENCODE_AGENT_MANIFEST: second }, { fetchImpl });
    const withRenamed = await createLiveRouterConfiguration({ ...base, SKALD_OPENCODE_AGENT_MANIFEST: renamed }, { fetchImpl });
    // Content change rotates; same content under another path does not.
    expect(withSecond.configFingerprint).not.toBe(withFirst.configFingerprint);
    expect(withRenamed.configFingerprint).toBe(withFirst.configFingerprint);

    const missing = await createLiveRouterConfiguration(
      { ...base, SKALD_OPENCODE_AGENT_MANIFEST: join(dir, "absent.md") },
      { fetchImpl },
    );
    expect(missing.configFingerprint).not.toBe(withFirst.configFingerprint);
  });
});
