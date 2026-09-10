import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelRouter } from "@skald/world";
import {
  DISCOVERY_REFRESH_INTERVAL_MS,
  DiscoveryRefresher,
  MIN_DISCOVERY_REFRESH_INTERVAL_MS,
  resolveRefreshIntervalMs,
  type DiscoveryRefreshEvent,
} from "../src/runtime/discovery-refresh.js";
import type { LiveModelSelectionReport } from "@skald/world";

function candidate(model: string, protocol: "openai_chat" | "openai_responses" = "openai_chat") {
  return { provider: "opencode_zen" as const, model, protocol, tier: "live_primary" as const };
}

function selection(models: readonly string[], status: LiveModelSelectionReport["status"] = "ready"): LiveModelSelectionReport {
  const routes = Object.freeze(models.map((model, index) => ({
    provider: "opencode_zen" as const,
    model,
    protocol: (model.includes("muse-spark") ? "openai_responses" : "openai_chat") as "openai_chat" | "openai_responses",
    tier: (index === 0 ? "live_primary" : "live_backup") as "live_primary" | "live_backup",
  })));
  return {
    provider: "opencode_zen",
    status,
    checkedAt: "2026-09-06T00:00:00.000Z",
    durationMs: 5,
    catalog: { provider: "opencode_zen", status: "ok", phase: "response_shape", modelIds: [...models] },
    ...(models[0] ? { activeModel: models[0] } : {}),
    ...(models[1] ? { backupModel: models[1] } : {}),
    candidates: models.map((model) => ({
      model,
      inCatalog: true,
      interpret: { status: "ok", phase: "schema_validation" },
      narrate: { status: "ok", phase: "response_shape" },
      active: true,
    })),
    excluded: [],
    routes: { interpret: routes, narrate: routes },
  };
}

function emptySelection(): LiveModelSelectionReport {
  return {
    provider: "opencode_zen",
    status: "unavailable",
    checkedAt: "2026-09-06T00:00:00.000Z",
    durationMs: 5,
    catalog: { provider: "opencode_zen", status: "ok", phase: "response_shape", modelIds: [] },
    candidates: [],
    excluded: [{ model: "ling-3.0-flash-fin-free", reason: "not_in_catalog" }],
    routes: { interpret: [], narrate: [] },
  };
}

function testRouter() {
  return new ModelRouter({
    apiKey: "zen-key",
    providerId: "opencode_zen",
    routeCandidates: {
      interpret: [candidate("muse-spark-1.3-contributor-free", "openai_responses")],
      narrate: [candidate("muse-spark-1.3-contributor-free", "openai_responses")],
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveRefreshIntervalMs", () => {
  it("defaults to daily and clamps bad values", () => {
    expect(resolveRefreshIntervalMs({})).toBe(DISCOVERY_REFRESH_INTERVAL_MS);
    expect(resolveRefreshIntervalMs({ SKALD_AI_DISCOVERY_REFRESH_MS: "" })).toBe(DISCOVERY_REFRESH_INTERVAL_MS);
    expect(resolveRefreshIntervalMs({ SKALD_AI_DISCOVERY_REFRESH_MS: "nope" })).toBe(DISCOVERY_REFRESH_INTERVAL_MS);
    expect(resolveRefreshIntervalMs({ SKALD_AI_DISCOVERY_REFRESH_MS: "1000" })).toBe(DISCOVERY_REFRESH_INTERVAL_MS);
    expect(resolveRefreshIntervalMs({ SKALD_AI_DISCOVERY_REFRESH_MS: String(MIN_DISCOVERY_REFRESH_INTERVAL_MS) })).toBe(MIN_DISCOVERY_REFRESH_INTERVAL_MS);
    expect(resolveRefreshIntervalMs({ SKALD_AI_DISCOVERY_REFRESH_MS: String(2 * MIN_DISCOVERY_REFRESH_INTERVAL_MS) })).toBe(2 * MIN_DISCOVERY_REFRESH_INTERVAL_MS);
  });
});

describe("DiscoveryRefresher", () => {
  it("applies a fresh selection with actives and reports secret-free metadata", async () => {
    const router = testRouter();
    const events: DiscoveryRefreshEvent[] = [];
    const refresher = new DiscoveryRefresher({
      apiKey: "zen-secret",
      router,
      discover: async () => selection(["ling-3.0-flash-fin-free"]),
      onEvent: (event) => events.push(event),
    });
    const summary = await refresher.refreshNow();
    expect(summary.outcome).toBe("applied");
    expect(summary.activeModel).toBe("ling-3.0-flash-fin-free");
    expect(router.routeCandidates("interpret").map((c) => c.model)).toEqual(["ling-3.0-flash-fin-free"]);
    expect(router.liveModelSelection()?.activeModel).toBe("ling-3.0-flash-fin-free");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "discovery_refresh", outcome: "applied" });
    expect(JSON.stringify([summary, ...events])).not.toContain("zen-secret");
    expect(refresher.lastResult()).toEqual(summary);
  });

  it("keeps last-good routes when discovery activates nothing", async () => {
    const router = testRouter();
    const refresher = new DiscoveryRefresher({
      apiKey: "zen-key",
      router,
      discover: async () => emptySelection(),
    });
    const summary = await refresher.refreshNow();
    expect(summary.outcome).toBe("skipped_empty");
    expect(router.routeCandidates("interpret").map((c) => c.model)).toEqual(["muse-spark-1.3-contributor-free"]);
  });

  it("keeps last-good routes when discovery throws", async () => {
    const router = testRouter();
    const events: DiscoveryRefreshEvent[] = [];
    const refresher = new DiscoveryRefresher({
      apiKey: "zen-key",
      router,
      discover: async () => { throw new Error("catalog boom"); },
      onEvent: (event) => events.push(event),
    });
    const summary = await refresher.refreshNow();
    expect(summary.outcome).toBe("skipped_failed");
    expect(router.routeCandidates("interpret")).toHaveLength(1);
    expect(events[0]?.outcome).toBe("skipped_failed");
  });

  it("skips without a router", async () => {
    const refresher = new DiscoveryRefresher({ apiKey: "", router: null, discover: async () => selection(["x"]) });
    expect((await refresher.refreshNow()).outcome).toBe("skipped_no_router");
  });

  it("serializes concurrent refreshes into one discovery pass", async () => {
    const router = testRouter();
    let calls = 0;
    const refresher = new DiscoveryRefresher({
      apiKey: "zen-key",
      router,
      discover: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return selection(["ling-3.0-flash-fin-free"]);
      },
    });
    const [first, second] = await Promise.all([refresher.refreshNow(), refresher.refreshNow()]);
    expect(calls).toBe(1);
    expect(first).toEqual(second);
  });

  it("runs on the cadence and stops on demand", async () => {
    vi.useFakeTimers();
    const router = testRouter();
    let calls = 0;
    const refresher = new DiscoveryRefresher({
      apiKey: "zen-key",
      router,
      intervalMs: MIN_DISCOVERY_REFRESH_INTERVAL_MS,
      discover: async () => {
        calls += 1;
        return selection(["ling-3.0-flash-fin-free"]);
      },
    });
    refresher.start();
    await vi.advanceTimersByTimeAsync(MIN_DISCOVERY_REFRESH_INTERVAL_MS);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(MIN_DISCOVERY_REFRESH_INTERVAL_MS);
    expect(calls).toBe(2);
    refresher.stop();
    await vi.advanceTimersByTimeAsync(4 * MIN_DISCOVERY_REFRESH_INTERVAL_MS);
    expect(calls).toBe(2);
  });

  it("falls back to Ollama on the default path when Zen activates nothing", async () => {
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
    const router = new ModelRouter({
      apiKey: "zen-key",
      providerId: "opencode_zen",
      availableProviders: ["opencode_zen", "ollama_cloud"],
      providerKeys: { opencode_zen: "zen-key", ollama_cloud: "ollama-key" },
      routeCandidates: {
        interpret: [candidate("muse-spark-1.3-contributor-free", "openai_responses")],
        narrate: [candidate("muse-spark-1.3-contributor-free", "openai_responses")],
      },
    });
    const refresher = new DiscoveryRefresher({
      apiKey: "zen-secret",
      ollamaKey: "ollama-secret",
      router,
      fetchImpl,
    });
    const summary = await refresher.refreshNow();
    expect(summary.outcome).toBe("applied");
    expect(summary.activeModel).toBe(GEMMA);
    expect(router.routeCandidates("interpret").map((c) => c.model)).toEqual([GEMMA]);
    expect(router.liveModelSelection()?.provider).toBe("ollama_cloud");
  });

  it("reaches OpenRouter on refresh only after Zen and Ollama fail", async () => {
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
    const router = new ModelRouter({
      apiKey: "zen-key",
      providerId: "opencode_zen",
      availableProviders: ["opencode_zen", "ollama_cloud", "openrouter"],
      providerKeys: { opencode_zen: "zen-key", ollama_cloud: "ollama-key", openrouter: "or-key" },
      routeCandidates: {
        interpret: [candidate("muse-spark-1.3-contributor-free", "openai_responses")],
        narrate: [candidate("muse-spark-1.3-contributor-free", "openai_responses")],
      },
    });
    const refresher = new DiscoveryRefresher({
      apiKey: "zen-secret",
      ollamaKey: "ollama-secret",
      openrouterKey: "or-secret",
      openrouterModels: [NEMO],
      router,
      fetchImpl,
    });
    const summary = await refresher.refreshNow();
    expect(summary.outcome).toBe("applied");
    expect(summary.activeModel).toBe(NEMO);
    expect(router.routeCandidates("interpret").map((c) => c.model)).toEqual([NEMO]);
    expect(router.liveModelSelection()?.provider).toBe("openrouter");
    expect(JSON.stringify(summary)).not.toContain("or-secret");
  });
});
