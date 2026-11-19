import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBootstrapEvents, ProviderRequestError } from "@skald/world";
import { createMultiWorldStore } from "../src/persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../src/runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../src/http/world-handlers.js";
import { createP3TransportTrace } from "../src/acceptance/gm-p3-transport-trace.js";
import { createOpenCodeGenerationBudget, openCodeRequestDelta } from "../src/acceptance/opencode-live-budget.js";
import type { ModelInfo } from "@opencode/client";
import {
  isOpenCodeServerEnabled,
  openCodeServerCandidate,
  openCodeServerCandidates,
  parseOpenCodeServerModelRef,
  OPENCODE_SERVER_FALLBACK_MODEL_ENV,
  OPENCODE_SERVER_ALLOW_PAID_FALLBACK_ENV,
  OPENCODE_SERVER_ALLOW_PAID_PRIMARY_ENV,
  OPENCODE_SERVER_MAX_CONCURRENCY_ENV,
  OPENCODE_SERVER_MAX_CONTEXT_TOKENS,
  OPENCODE_SERVER_MAX_MESSAGE_BYTES,
  OPENCODE_SERVER_MAX_OUTPUT_TOKENS,
  OPENCODE_SERVER_ENABLE_ENV,
  OPENCODE_SERVER_MODEL_ENV,
  OpenCodeServerProvider,
  type OpenCodeServerTransport,
} from "../src/runtime/opencode-server-provider.js";

interface FakeRequest {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown>;
  readonly authorization: string | undefined;
}

function generationRequests(server: Awaited<ReturnType<typeof startFakeServer>>): FakeRequest[] {
  return server.requests.filter((request) => /^\/api\/session\/[^/]+\/generate$/u.test(request.path));
}

async function startFakeServer(options?: {
  readonly generateStatus?: number;
  readonly retryAfter?: string;
  readonly modelPrice?: number;
  readonly modelOutputPrice?: number;
  readonly fallbackModelPrice?: number;
  readonly generateDelayMs?: number;
  readonly errorCode?: string;
  readonly traceId?: string;
  readonly generateText?: string;
  readonly generateCost?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly createSessionStatus?: number;
  readonly modelUnavailableCount?: number;
  readonly modelUnavailableFromRead?: number;
  readonly errorEnvelope?: Record<string, unknown>;
  readonly modelRetryAfter?: string;
}) {
  const requests: FakeRequest[] = [];
  let activeGenerations = 0;
  let maxActiveGenerations = 0;
  let modelReads = 0;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const body = rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {};
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      requests.push({
        method: request.method ?? "GET",
        path,
        body,
        authorization: request.headers.authorization,
      });
      response.setHeader("content-type", "application/json");
      if (path === "/api/info") {
        response.end(JSON.stringify({ version: "2.3.0", pid: 123, urls: [], paths: { tmp: "/tmp" } }));
        return;
      }
      if (path === "/api/model") {
        modelReads += 1;
        if (modelReads <= (options?.modelUnavailableCount ?? 0)
          || (options?.modelUnavailableFromRead !== undefined && modelReads >= options.modelUnavailableFromRead)) {
          response.statusCode = 503;
          if (options?.modelRetryAfter) response.setHeader("retry-after", options.modelRetryAfter);
          response.end(JSON.stringify({ error: { code: "service_unavailable" } }));
          return;
        }
        const model: ModelInfo = {
          id: "free-model",
          modelID: "free-model",
          providerID: "opencode",
          name: "Free model",
          capabilities: {} as ModelInfo["capabilities"],
          variants: [],
          time: { released: 0 },
          cost: [{ input: options?.modelPrice ?? 0, output: options?.modelOutputPrice ?? 0, cache: { read: 0, write: 0 } }],
          status: "active",
          enabled: true,
          limit: { context: 32_768, output: 512 },
          type: "chat",
        };
        const data: ModelInfo[] = [model];
        if (options?.fallbackModelPrice !== undefined) {
          data.push({
            ...model,
            id: "paid-fallback",
            modelID: "paid-fallback",
            name: "Fallback model",
            cost: [{ input: options.fallbackModelPrice, output: 0, cache: { read: 0, write: 0 } }],
          });
        }
        response.end(JSON.stringify({ location: { directory: "/tmp/skald-test" }, data }));
        return;
      }
      if (path === "/api/session" && request.method === "POST") {
        if (options?.createSessionStatus) {
          response.statusCode = options.createSessionStatus;
          response.end(JSON.stringify({ error: { code: "session_create_failed" } }));
          return;
        }
        response.end(JSON.stringify({ data: { id: body.id, title: body.title } }));
        return;
      }
      if (/^\/api\/session\/[^/]+\/generate$/u.test(path) && request.method === "POST") {
        activeGenerations += 1;
        maxActiveGenerations = Math.max(maxActiveGenerations, activeGenerations);
        const send = () => {
          activeGenerations -= 1;
          if (response.destroyed) return;
          if (options?.traceId) response.setHeader("x-request-id", options.traceId);
        if (options?.generateStatus && options.generateStatus !== 200) {
          response.statusCode = options.generateStatus;
          if (options.retryAfter) response.setHeader("retry-after", options.retryAfter);
          response.end(JSON.stringify(options.errorEnvelope ?? { error: { code: options.errorCode ?? "free_tier_limit" } }));
          return;
        }
        response.end(JSON.stringify({ data: {
          text: options?.generateText ?? "Короткий ответ.",
          cost: options?.generateCost ?? 0,
          tokens: {
            input: options?.inputTokens ?? 8,
            output: options?.outputTokens ?? 3,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        } }));
        };
        if (options?.generateDelayMs) setTimeout(send, options.generateDelayMs);
        else send();
        return;
      }
      if (/^\/api\/session\/[^/]+$/u.test(path) && request.method === "DELETE") {
        response.statusCode = 204;
        response.end();
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: { code: "not_found" } }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    requests,
    get maxActiveGenerations() { return maxActiveGenerations; },
    url: "http://127.0.0.1:" + address.port,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function provider(baseUrl: string, extra?: {
  readonly generateStatus?: number;
  readonly retryAfter?: string;
  readonly fallbackModel?: string;
  readonly allowPaidFallback?: boolean;
  readonly allowPaidPrimary?: boolean;
  readonly maxConcurrency?: number;
  readonly random?: () => number;
  readonly now?: () => number;
  readonly fetchImpl?: typeof fetch;
  readonly maxMessageBytes?: number;
}) {
  return new OpenCodeServerProvider({
    providerId: "opencode_server",
    availableProviders: ["opencode_server"],
    providerKeys: { opencode_server: "test-key" },
    routeCandidates: { interpret: [candidate], narrate: [candidate] },
    opencodeServer: {
      enabled: true,
      model: "opencode/free-model",
      ...(extra?.fallbackModel ? { fallbackModel: extra.fallbackModel } : {}),
      ...(extra?.allowPaidFallback !== undefined ? { allowPaidFallback: extra.allowPaidFallback } : {}),
      ...(extra?.allowPaidPrimary !== undefined ? { allowPaidPrimary: extra.allowPaidPrimary } : {}),
      ...(extra?.maxConcurrency !== undefined ? { maxConcurrency: extra.maxConcurrency } : {}),
      ...(extra?.random ? { random: extra.random } : {}),
      ...(extra?.now ? { now: extra.now } : {}),
      ...(extra?.fetchImpl ? { fetchImpl: extra.fetchImpl } : {}),
      ...(extra?.maxMessageBytes !== undefined ? { maxMessageBytes: extra.maxMessageBytes } : {}),
      apiKey: "test-key",
      password: "test-password",
      baseUrl,
    },
  });
}

const candidate = {
  provider: "opencode_server" as const,
  model: "opencode/free-model",
  protocol: "opencode_server" as const,
  tier: "catalog_candidate" as const,
};

function tracedBudget(baseUrl: string) {
  const trace = createP3TransportTrace();
  const budget = createOpenCodeGenerationBudget({
    baseUrl,
    maxGenerationRequests: 1,
    maxReservedCostUsd: 0,
    maxInputTokens: OPENCODE_SERVER_MAX_CONTEXT_TOKENS,
    maxOutputTokens: OPENCODE_SERVER_MAX_OUTPUT_TOKENS,
    observeHttp: trace.observeHttp,
  });
  const httpTrace = () => trace.snapshot().entries
    .filter((entry) => entry.type === "http")
    .map(({ phase, category, operation, httpStatus }) => [phase, category, operation, httpStatus]);
  return { budget, trace, httpTrace };
}

describe("OpenCode Server provider", () => {
  const servers: Array<Awaited<ReturnType<typeof startFakeServer>>> = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it.each([
    { label: "invalid decision JSON", generateText: "{not valid JSON" },
    { label: "fabricated world mutation", generateText: JSON.stringify({
      schemaVersion: 2, addressee: { kind: "gm" }, kind: "action",
      proposal: { schemaVersion: 2, kind: "action", primaryIntent: { operation: "grant_reward", amount: 9999 } },
    }) },
    { label: "empty generation", generateText: "" },
    { label: "authorization rejection", generateStatus: 403, errorCode: "unauthorized" },
    { label: "rate limit", generateStatus: 429, retryAfter: "60" },
  ])("keeps Events/time unchanged through the real handler on $label and replays durably", async (options) => {
    const server = await startFakeServer(options);
    servers.push(server);
    const instance = provider(server.url);
    const root = mkdtempSync(join(tmpdir(), "skald-opencode-handler-"));
    const path = join(root, "events.sqlite");
    const store = createMultiWorldStore(path);
    vi.stubEnv("GM_DIRECTOR_LIVE", "1");
    vi.stubEnv("GM_DIRECTOR_SHADOW", "0");
    vi.stubEnv("SKALD_INTENT_LLM_MODE", "fallback");
    store.createWorld({
      worldId: "opencode-handler", idempotencyKey: "create", requestHash: "create", saveLabel: "SDK boundary test",
      characterName: "Tester", characterPresetId: "wanderer", worldTemplateId: "living_region",
      characterWound: "none", characterPromise: "observe", characterPrinciple: "care", characterProfileVersion: 1,
      bootstrapEvents: buildBootstrapEvents("living_region"),
    });
    let reopened: ReturnType<typeof createMultiWorldStore> | undefined;
    try {
      const runtime = await new WorldRuntimeManager(store, instance).get("opencode-handler");
      const before = runtime.projection.getSnapshot().time;
      const events = store.loadEvents("opencode-handler");
      const request = { input: "Что именно известно о ночном следе?", idempotencyKey: "invalid-model-reply" };
      const response = await handleWorldCommand(runtime, request);
      expect(response.statusCode, response.body).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("clarification");
      expect(body.masterTurn.kind).not.toBe("action_outcome");
      expect(store.loadEvents("opencode-handler")).toEqual(events);
      expect(runtime.projection.getSnapshot().time).toBe(before);
      expect(store.listConversationTurns("opencode-handler")).toHaveLength(1);
      expect(generationRequests(server)).toHaveLength(1);
      const callCount = server.requests.length;
      store.close();
      reopened = createMultiWorldStore(path);
      const restarted = await new WorldRuntimeManager(reopened, instance).get("opencode-handler");
      const replay = await handleWorldCommand(restarted, request);
      expect(replay.statusCode).toBe(200);
      expect(JSON.parse(replay.body)).toMatchObject({ replayed: true, masterTurn: body.masterTurn });
      expect(server.requests).toHaveLength(callCount);
      expect(reopened.loadEvents("opencode-handler")).toEqual(events);
      expect(restarted.projection.getSnapshot().time).toBe(before);
      expect(reopened.listConversationTurns("opencode-handler")).toHaveLength(1);
      expect((await handleWorldCommand(restarted, { ...request, input: "Другая реплика." })).statusCode).toBe(409);
      expect(server.requests).toHaveLength(callCount);
    } finally {
      if (reopened) reopened.close();
      else store.close();
      await instance.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("parses only an explicit provider/model ref and requires opt-in plus credentials", () => {
    expect(parseOpenCodeServerModelRef("opencode/free-model")).toEqual({ providerID: "opencode", id: "free-model" });
    expect(parseOpenCodeServerModelRef("openrouter/anthropic/claude-sonnet-4-5:free")).toEqual({
      providerID: "openrouter",
      id: "anthropic/claude-sonnet-4-5:free",
    });
    expect(parseOpenCodeServerModelRef("")).toBeNull();
    expect(parseOpenCodeServerModelRef("free-model")).toBeNull();
    expect(parseOpenCodeServerModelRef("opencode/")).toBeNull();
    expect(parseOpenCodeServerModelRef("openrouter//model")).toBeNull();
    expect(parseOpenCodeServerModelRef("openrouter/vendor/../model")).toBeNull();
    expect(parseOpenCodeServerModelRef("../model")).toBeNull();
    expect(openCodeServerCandidate({
      [OPENCODE_SERVER_ENABLE_ENV]: "1",
      [OPENCODE_SERVER_MODEL_ENV]: "opencode/free-model",
    })?.provider).toBe("opencode_server");
    expect(isOpenCodeServerEnabled({
      [OPENCODE_SERVER_ENABLE_ENV]: "1",
      [OPENCODE_SERVER_MODEL_ENV]: "opencode/free-model",
      SKALD_OPENCODE_ZEN_API_KEY: "configured",
    })).toBe(true);
    const fallbackConfig = {
      [OPENCODE_SERVER_ENABLE_ENV]: "1",
      [OPENCODE_SERVER_MODEL_ENV]: "opencode/free-model",
      [OPENCODE_SERVER_FALLBACK_MODEL_ENV]: "opencode/free-fallback",
      [OPENCODE_SERVER_MAX_CONCURRENCY_ENV]: "2",
      SKALD_OPENCODE_ZEN_API_KEY: "configured",
    };
    expect(isOpenCodeServerEnabled(fallbackConfig)).toBe(true);
    expect(isOpenCodeServerEnabled({ ...fallbackConfig, [OPENCODE_SERVER_ALLOW_PAID_PRIMARY_ENV]: "yes" })).toBe(false);
    expect(openCodeServerCandidates(fallbackConfig).map((entry) => entry.model)).toEqual([
      "opencode/free-model", "opencode/free-fallback",
    ]);
    expect(isOpenCodeServerEnabled({
      ...fallbackConfig,
      [OPENCODE_SERVER_FALLBACK_MODEL_ENV]: "opencode/free-model",
    })).toBe(false);
    expect(isOpenCodeServerEnabled({
      [OPENCODE_SERVER_ENABLE_ENV]: "1",
      [OPENCODE_SERVER_MODEL_ENV]: "opencode/free-model",
      [OPENCODE_SERVER_ALLOW_PAID_FALLBACK_ENV]: "1",
      SKALD_OPENCODE_ZEN_API_KEY: "configured",
    })).toBe(false);
    expect(isOpenCodeServerEnabled({
      ...fallbackConfig,
      [OPENCODE_SERVER_MAX_CONCURRENCY_ENV]: "5",
    })).toBe(false);
    expect(isOpenCodeServerEnabled({
      [OPENCODE_SERVER_ENABLE_ENV]: "1",
      [OPENCODE_SERVER_MODEL_ENV]: "opencode/free-model",
    })).toBe(false);
  });

  it("uses an official transient session, returns usage/cost, and deletes session state", async () => {
    const server = await startFakeServer({ generateCost: 0.000123 });
    servers.push(server);
    const instance = provider(server.url);
    const result = await instance.chatCandidate("narrate", candidate, [{ role: "user", content: "Опиши ответ кратко." }]);
    expect(result).toMatchObject({
      text: "Короткий ответ.",
      provider: "opencode_server",
      usage: { promptTokens: 8, completionTokens: 3, totalTokens: 11 },
      reportedCostUsd: 0.000123,
    });
    expect(server.requests.map((request) => request.path)).toEqual([
      "/api/info",
      "/api/model",
      "/api/session",
      expect.stringMatching(/^\/api\/session\/ses_[a-f0-9]{32}\/generate$/u),
      expect.stringMatching(/^\/api\/session\/ses_[a-f0-9]{32}$/u),
    ]);
    expect(server.requests.every((request) => request.authorization === "Basic " + Buffer.from("opencode:test-password").toString("base64"))).toBe(true);
    expect(server.requests[2]?.body.model).toEqual({ providerID: "opencode", id: "free-model" });
    expect(server.requests[2]?.body.agent).toBe("skald_narrator");
    expect(server.requests[2]?.body.permissions).toEqual([{ action: "*", resource: "*", effect: "deny" }]);
    expect((server.requests[3]?.body.prompt as string)).toContain("Опиши ответ кратко.");
    expect(server.requests.some((request) => request.path.includes("/experimental"))).toBe(false);
    expect(JSON.stringify(server.requests)).not.toContain("test-key");
    await instance.close();
  });

  it("selects distinct tool-free category agents for interpretation, narration and analysis", async () => {
    const server = await startFakeServer();
    servers.push(server);
    const instance = provider(server.url);
    try {
      for (const category of ["interpret", "narrate", "analyze"] as const) {
        await instance.chatCandidate(category, candidate, [{ role: "user", content: "probe" }]);
      }
      expect(server.requests.filter((request) => request.path === "/api/session").map((request) => request.body.agent))
        .toEqual(["skald_interpreter", "skald_narrator", "skald_analyzer"]);
      expect(server.requests.filter((request) => request.path === "/api/session")
        .every((request) => JSON.stringify(request.body.permissions) === JSON.stringify([{ action: "*", resource: "*", effect: "deny" }]))).toBe(true);
    } finally {
      await instance.close();
    }
  });

  it("starts the pinned CLI with an allowlisted environment and isolated OpenCode state", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "skald-opencode-server-spawn-"));
    const paths: string[] = [];
    let observedSpawn: { command: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv } | undefined;
    const child = new EventEmitter() as unknown as ChildProcess;
    Object.assign(child, {
      exitCode: null,
      signalCode: null,
      killed: false,
      kill: (signal?: NodeJS.Signals) => {
        queueMicrotask(() => child.emit("exit", null, signal ?? null));
        return true;
      },
    });
    const spawnImpl = ((command: string, args: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
      observedSpawn = { command, args, cwd: options.cwd ?? "", env: options.env ?? {} };
      return child;
    }) as NonNullable<OpenCodeServerTransport["spawnImpl"]>;
    const model: ModelInfo = {
      id: "free-model",
      modelID: "free-model",
      providerID: "opencode",
      name: "Free model",
      capabilities: {} as ModelInfo["capabilities"],
      variants: [],
      time: { released: 0 },
      cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
      status: "active",
      enabled: true,
      limit: { context: 32_768, output: 512 },
      type: "chat",
    };
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const path = new URL(url).pathname;
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const requestBody = typeof init?.body === "string"
        ? JSON.parse(init.body) as Record<string, unknown>
        : input instanceof Request ? await input.clone().json() as Record<string, unknown> : {};
      paths.push(path);
      if (path === "/api/info") return new Response(JSON.stringify({ version: "2.3.0" }), { headers: { "content-type": "application/json" } });
      if (path === "/api/model") return new Response(JSON.stringify({ data: [model] }), { headers: { "content-type": "application/json" } });
      if (path === "/api/session" && method === "POST") {
        return new Response(JSON.stringify({ data: { id: requestBody.id, title: "test" } }), { headers: { "content-type": "application/json" } });
      }
      if (/^\/api\/session\/[^/]+\/generate$/u.test(path) && method === "POST") return new Response(JSON.stringify({ data: { text: "Изолированный ответ.", cost: 0, tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } } }), { headers: { "content-type": "application/json" } });
      if (/^\/api\/session\/[^/]+$/u.test(path) && method === "DELETE") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ error: { code: "not_found" } }), { status: 404, headers: { "content-type": "application/json" } });
    };
    const instance = new OpenCodeServerProvider({
      providerId: "opencode_server",
      availableProviders: ["opencode_server"],
      providerKeys: { opencode_server: "test-key" },
      opencodeServer: {
        enabled: true,
        model: "opencode/free-model",
        apiKey: "test-key",
        password: "test-password",
        binary: "/home/nooker/bin/opencode",
        port: 49371,
        stateDir,
        spawnImpl,
        fetchImpl,
      },
    });
    try {
      await expect(instance.chatCandidate("narrate", candidate, [{ role: "user", content: "probe" }]))
        .resolves.toMatchObject({ text: "Изолированный ответ." });
      expect(observedSpawn).toMatchObject({
        command: "/home/nooker/bin/opencode",
        args: ["serve", "--hostname", "127.0.0.1", "--port", "49371"],
        cwd: join(stateDir, "workdir"),
      });
      const configHome = observedSpawn?.env.XDG_CONFIG_HOME ?? "";
      const configRoot = join(stateDir, "config") + "/";
      expect(configHome.startsWith(configRoot)).toBe(true);
      expect(configHome.slice(configRoot.length)).toMatch(/^[a-f0-9]{64}$/u);
      expect(Object.keys(observedSpawn?.env ?? {}).sort()).toEqual([
        "HOME", "OPENCODE_API_KEY", "OPENCODE_SERVER_PASSWORD", "PATH", "TMPDIR",
        "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME",
      ]);
      expect(observedSpawn?.env.OPENCODE_API_KEY).toBe("test-key");
      expect(observedSpawn?.env.SKALD_DB_PATH).toBeUndefined();
      expect(observedSpawn?.env.SKALD_OPENCODE_ZEN_API_KEY).toBeUndefined();
      expect(observedSpawn?.env.OLLAMA_CLOUD_API_KEY).toBeUndefined();
      const isolatedConfig = JSON.parse(readFileSync(join(observedSpawn?.env.XDG_CONFIG_HOME ?? "", "opencode", "opencode.json"), "utf8"));
      expect(Object.keys(isolatedConfig.agents).sort()).toEqual([
        "skald_analyzer", "skald_interpreter", "skald_narrator",
      ]);
      expect(isolatedConfig.agents.skald_interpreter).toMatchObject({
        mode: "primary",
        permissions: [{ action: "*", resource: "*", effect: "deny" }],
      });
      expect(isolatedConfig.agents.skald_interpreter.system).toContain("proposal for deterministic server validation");
      expect(isolatedConfig.agents.skald_narrator.system).toContain("Do not invent events");
      expect(isolatedConfig.permissions).toEqual([{ action: "*", resource: "*", effect: "deny" }]);
      expect(paths).toEqual(["/api/info", "/api/model", "/api/session", expect.stringMatching(/^\/api\/session\/ses_[a-f0-9]{32}\/generate$/u), expect.stringMatching(/^\/api\/session\/ses_[a-f0-9]{32}$/u)]);
    } finally {
      await instance.close();
      rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("refuses a pinned model unless the official catalog explicitly reports zero price", async () => {
    const server = await startFakeServer({ modelPrice: 0.01 });
    servers.push(server);
    const instance = provider(server.url);
    await expect(instance.chatCandidate("narrate", candidate, [{ role: "user", content: "probe" }]))
      .rejects.toMatchObject({ phase: "model_selection", retryable: false });
    expect(generationRequests(server)).toHaveLength(0);
    await instance.close();
  });

  it("preserves provider Retry-After and stops repeated 429 requests during cooldown", async () => {
    const server = await startFakeServer({ generateStatus: 429, retryAfter: "60", traceId: "oc-trace-123" });
    servers.push(server);
    const now = vi.fn(() => 1_800_000_000_000);
    const instance = new OpenCodeServerProvider({
      providerId: "opencode_server",
      availableProviders: ["opencode_server"],
      providerKeys: { opencode_server: "test-key" },
      opencodeServer: {
        enabled: true,
        model: "opencode/free-model",
        apiKey: "test-key",
        password: "test-password",
        baseUrl: server.url,
        now,
      },
    });
    const call = () => instance.chatCandidate("narrate", candidate, [{ role: "user", content: "probe" }]);
    await expect(call()).rejects.toMatchObject({
      httpStatus: 429,
      providerCode: "free_tier_limit",
      retryAfterHeaderRaw: "60",
      retryAfterMsParsed: 60_000,
      retryAfterMsApplied: 60_000,
      providerTraceId: "oc-trace-123",
      retryable: false,
    });
    const before = server.requests.length;
    await expect(call()).rejects.toBeInstanceOf(ProviderRequestError);
    expect(server.requests).toHaveLength(before);
    expect(generationRequests(server)).toHaveLength(1);
    await instance.close();
  });

  it("does not shorten a valid provider Retry-After longer than one day", async () => {
    const server = await startFakeServer({ generateStatus: 429, retryAfter: "172800" });
    servers.push(server);
    const instance = new OpenCodeServerProvider({
      providerId: "opencode_server",
      availableProviders: ["opencode_server"],
      providerKeys: { opencode_server: "test-key" },
      opencodeServer: {
        enabled: true,
        model: "opencode/free-model",
        apiKey: "test-key",
        password: "test-password",
        baseUrl: server.url,
        now: () => 1_000,
      },
    });
    const call = () => instance.chatCandidate("narrate", candidate, [{ role: "user", content: "probe" }]);
    try {
      await expect(call()).rejects.toMatchObject({
        httpStatus: 429,
        retryAfterHeaderRaw: "172800",
        retryAfterMsParsed: 172_800_000,
        retryAfterMsApplied: 172_800_000,
      });
      await expect(call()).rejects.toMatchObject({
        httpStatus: 429,
        retryAfterMsApplied: 172_800_000,
      });
      expect(generationRequests(server)).toHaveLength(1);
    } finally {
      await instance.close();
    }
  });

  it("retries transient catalogue readiness with a finite backoff and keeps the later generation error attribution", async () => {
    const server = await startFakeServer({ modelUnavailableCount: 3, generateStatus: 429, retryAfter: "60" });
    servers.push(server);
    const instance = provider(server.url, { random: () => 0.5 });
    try {
      await expect(instance.chatCandidate("narrate", candidate, [{ role: "user", content: "probe" }]))
        .rejects.toMatchObject({ httpStatus: 429, retryAfterMsParsed: 60_000, retryable: false });
      expect(server.requests.filter((request) => request.path === "/api/model")).toHaveLength(4);
      expect(generationRequests(server)).toHaveLength(1);
    } finally { await instance.close(); }
  });

  it("prewarms the pinned model catalogue without creating a session or generating", async () => {
    const server = await startFakeServer({ modelUnavailableCount: 3 });
    servers.push(server);
    const instance = provider(server.url, { random: () => 0.5 });
    try {
      await instance.prewarm(5_000);
      expect(server.requests.filter((request) => request.path === "/api/model")).toHaveLength(4);
      expect(server.requests.filter((request) => request.path === "/api/session")).toHaveLength(0);
      expect(generationRequests(server)).toHaveLength(0);
    } finally { await instance.close(); }
  });

  it.each([0, 1])("reuses startup model verification after %i transient catalogue failures", async (failures) => {
    const server = await startFakeServer({
      modelUnavailableCount: failures, modelUnavailableFromRead: failures + 2, modelRetryAfter: "0",
    });
    servers.push(server);
    const { budget, trace, httpTrace } = tracedBudget(server.url);
    const instance = provider(server.url, { fetchImpl: budget.fetch });
    const startupRequests = ["GET /api/info", ...Array<string>(failures + 1).fill("GET /api/model")];
    const requestPaths = () => server.requests.map(({ method, path }) => `${method} ${path}`);
    const startupTrace = [
      ["initial_prewarm", null, "server_info", 200],
      ...(failures === 1 ? [["initial_prewarm", null, "model_catalog", 503]] : []),
      ["initial_prewarm", null, "model_catalog", 200],
    ];
    try {
      const before = budget.snapshot();
      await trace.run("initial_prewarm", null, () => instance.prewarm(5_000));
      expect(requestPaths()).toEqual(startupRequests);
      expect(httpTrace()).toEqual(startupTrace);
      const warmed = budget.snapshot();
      expect(openCodeRequestDelta(before, warmed)).toMatchObject({
        modelCatalogRequests: failures + 1, modelCatalogFailures: failures,
        sessionCreateRequests: 0, generationRequests: 0,
      });

      const result = await trace.run("router_call", "interpret", () =>
        instance.chatCandidate("interpret", candidate, [{ role: "user", content: "probe" }]));

      expect(result.text).toBe("Короткий ответ.");
      expect(requestPaths()).toEqual([
        ...startupRequests,
        "POST /api/session",
        expect.stringMatching(/^POST \/api\/session\/[^/]+\/generate$/u),
        expect.stringMatching(/^DELETE \/api\/session\/[^/]+$/u),
      ]);
      expect(httpTrace()).toEqual([
        ...startupTrace,
        ["router_call", "interpret", "session_create", 200],
        ["router_call", "interpret", "generation", 200],
        ["router_call", "interpret", "session_delete", 204],
      ]);
      expect(openCodeRequestDelta(warmed, budget.snapshot())).toMatchObject({
        modelCatalogRequests: 0, modelCatalogFailures: 0, sessionCreateRequests: 1,
        generationRequests: 1, successfulGenerationResponses: 1, sessionDeleteRequests: 1,
      });
    } finally { await instance.close(); }
  });

  it("rejects an oversized request locally after prewarm recovered from a catalogue 503", async () => {
    const server = await startFakeServer({ modelUnavailableCount: 1, modelRetryAfter: "0" });
    servers.push(server);
    const { budget, trace, httpTrace } = tracedBudget(server.url);
    const instance = provider(server.url, { fetchImpl: budget.fetch });
    const requestPaths = () => server.requests.map(({ method, path }) => `${method} ${path}`);
    const startupRequests = ["GET /api/info", "GET /api/model", "GET /api/model"];
    try {
      await trace.run("initial_prewarm", null, () => instance.prewarm(5_000));
      expect(requestPaths()).toEqual(startupRequests);
      const warmed = budget.snapshot();

      await expect(trace.run("router_call", "interpret", () => instance.chatCandidate("interpret", candidate, [
        { role: "user", content: "a".repeat(OPENCODE_SERVER_MAX_MESSAGE_BYTES + 1) },
      ]))).rejects.toMatchObject({ phase: "request", providerCode: "input_byte_limit", retryable: false, httpStatus: undefined });

      expect(requestPaths()).toEqual(startupRequests);
      expect(httpTrace()).toEqual([
        ["initial_prewarm", null, "server_info", 200],
        ["initial_prewarm", null, "model_catalog", 503],
        ["initial_prewarm", null, "model_catalog", 200],
      ]);
      expect(trace.snapshot().entries.at(-1)).toMatchObject({
        type: "finished", outcome: "threw", phase: "router_call", category: "interpret",
        failure: { phase: "request", providerCode: "input_byte_limit" },
      });
      expect(openCodeRequestDelta(warmed, budget.snapshot())).toMatchObject({
        modelCatalogRequests: 0, modelCatalogFailures: 0, sessionCreateRequests: 0,
        generationRequests: 0, sessionDeleteRequests: 0,
      });
    } finally { await instance.close(); }
  });

  it("keeps a riverwatch keeper greeting read-only when its Director prompt hits the local byte guard", async () => {
    const server = await startFakeServer({ modelUnavailableCount: 1, modelRetryAfter: "0" });
    servers.push(server);
    const { budget, trace, httpTrace } = tracedBudget(server.url);
    // Exercise the same guard independently of future prompt compaction.
    const maxMessageBytes = 1_024;
    const instance = provider(server.url, { fetchImpl: budget.fetch, maxMessageBytes });
    const chat = instance.chat.bind(instance);
    const measuredBytes: number[] = [];
    vi.spyOn(instance, "chat").mockImplementation((category, messages, opts) => {
      measuredBytes.push(Buffer.byteLength(JSON.stringify(messages), "utf8"));
      return trace.run("router_call", category, () => chat(category, messages, opts));
    });
    const store = createMultiWorldStore(":memory:");
    const worldId = "opencode-keeper";
    vi.stubEnv("GM_DIRECTOR_LIVE", "1");
    vi.stubEnv("GM_DIRECTOR_SHADOW", "0");
    vi.stubEnv("SKALD_INTENT_LLM_MODE", "fallback");
    try {
      await trace.run("initial_prewarm", null, () => instance.prewarm(5_000));
      const warmed = budget.snapshot();
      store.createWorld({
        worldId, idempotencyKey: "create", requestHash: "create", saveLabel: "SDK keeper test",
        characterName: "Tester", characterPresetId: "keeper", worldTemplateId: "living_region",
        characterWound: "none", characterPromise: "observe", characterPrinciple: "care", characterProfileVersion: 1,
        bootstrapEvents: buildBootstrapEvents({ templateId: "living_region", entrypointId: "riverwatch_city_arrival", backgroundId: "keeper" }),
      });
      const manager = new WorldRuntimeManager(store, instance);
      const runtime = await manager.get(worldId);
      const events = store.loadEvents(worldId);
      const beforeTime = runtime.projection.getSnapshot().time;
      const result = await handleWorldCommand(runtime, { input: "Привет, смотритель", idempotencyKey: "byte-limit" });
      expect(result.statusCode, result.body).toBe(200);
      expect(JSON.parse(result.body).conversationTurn).toMatchObject({ responseKind: "speech_reaction" });
      expect(measuredBytes).toHaveLength(1);
      expect(measuredBytes[0]).toBeGreaterThan(maxMessageBytes);
      expect(manager.narrationDiagnostics().filter((entry) => entry.category === "gm_director")).toMatchObject([{
        outcome: "fallback", providerPhase: "request", providerCode: "input_byte_limit", providerRetryable: false,
      }]);
      expect(httpTrace()).toEqual([
        ["initial_prewarm", null, "server_info", 200],
        ["initial_prewarm", null, "model_catalog", 503],
        ["initial_prewarm", null, "model_catalog", 200],
      ]);
      expect(budget.snapshot()).toEqual(warmed);
      expect(store.loadEvents(worldId)).toEqual(events);
      expect(runtime.projection.getSnapshot().time).toBe(beforeTime);
    } finally {
      store.close();
      await instance.close();
    }
  });

  it("rechecks the model catalogue after the successful-verification cache expires", async () => {
    const server = await startFakeServer({ modelUnavailableFromRead: 2 });
    servers.push(server);
    let now = 1_000;
    const instance = provider(server.url, { random: () => 0.5, now: () => now });
    try {
      await instance.prewarm(5_000);
      now += 60_001;

      await expect(instance.chatCandidate("narrate", candidate, [{ role: "user", content: "probe" }]))
        .rejects.toMatchObject({ httpStatus: 503, retryable: true });

      expect(server.requests.filter((request) => request.path === "/api/model")).toHaveLength(5);
      expect(generationRequests(server)).toHaveLength(0);
    } finally { await instance.close(); }
  });

  it("bounds catalogue-readiness retries and never generates while metadata remains unavailable", async () => {
    const server = await startFakeServer({ modelUnavailableCount: 100 });
    servers.push(server);
    const instance = provider(server.url, { random: () => 0.5 });
    try {
      await expect(instance.chatCandidate("narrate", candidate, [{ role: "user", content: "probe" }]))
        .rejects.toMatchObject({ httpStatus: 503, retryable: true });
      expect(server.requests.filter((request) => request.path === "/api/model")).toHaveLength(4);
      expect(generationRequests(server)).toHaveLength(0);
    } finally { await instance.close(); }
  });

  it("does not retry catalogue requests before a long upstream Retry-After", async () => {
    const server = await startFakeServer({ modelUnavailableCount: 100, modelRetryAfter: "60" });
    servers.push(server);
    const instance = provider(server.url);
    try {
      await expect(instance.chatCandidate("narrate", candidate, [{ role: "user", content: "probe" }]))
        .rejects.toMatchObject({ httpStatus: 503, retryable: true });
      expect(server.requests.filter((request) => request.path === "/api/model")).toHaveLength(1);
      expect(generationRequests(server)).toHaveLength(0);
    } finally { await instance.close(); }
  });

  it.each([
    { status: 401, errorCode: "unauthorized", providerCode: "auth_failure" },
    { status: 403, errorCode: "free_tier_session_required", providerCode: "free_tier_session_required" },
  ])("preserves authorization failure $status without retrying", async ({ status, errorCode, providerCode }) => {
    const server = await startFakeServer({ generateStatus: status, errorCode });
    servers.push(server);
    const instance = provider(server.url);
    await expect(instance.chatCandidate("narrate", candidate, [{ role: "user", content: "probe" }]))
      .rejects.toMatchObject({ httpStatus: status, providerCode, retryable: false });
    expect(generationRequests(server)).toHaveLength(1);
    await instance.close();
  });

  it("does not use a paid fallback unless the separate opt-in is set", async () => {
    const server = await startFakeServer({ fallbackModelPrice: 0.01 });
    servers.push(server);
    const instance = provider(server.url, {
      fallbackModel: "opencode/paid-fallback",
      allowPaidFallback: false,
    });
    const fallbackCandidate = { ...candidate, model: "opencode/paid-fallback" };
    await expect(instance.chatCandidate("narrate", fallbackCandidate, [{ role: "user", content: "probe" }]))
      .rejects.toMatchObject({ phase: "model_selection", retryable: false });
    expect(generationRequests(server)).toHaveLength(0);
    await instance.close();
  });

  it.each([
    { allowPaidPrimary: false, allowPaidFallback: false },
    { allowPaidPrimary: true, allowPaidFallback: false },
    { allowPaidPrimary: false, allowPaidFallback: true },
    { allowPaidPrimary: true, allowPaidFallback: true },
  ])("keeps paid slot permissions independent: primary=$allowPaidPrimary fallback=$allowPaidFallback", async (permissions) => {
    const server = await startFakeServer({ modelPrice: 0.01, fallbackModelPrice: 0.02 });
    servers.push(server);
    const instance = provider(server.url, { ...permissions, fallbackModel: "opencode/paid-fallback" });
    try {
      for (const [model, permitted] of [
        [candidate.model, permissions.allowPaidPrimary],
        ["opencode/paid-fallback", permissions.allowPaidFallback],
      ] as const) {
        const call = instance.chatCandidate("narrate", { ...candidate, model }, [{ role: "user", content: "probe" }]);
        if (permitted) await expect(call).resolves.toMatchObject({ text: "Короткий ответ." });
        else await expect(call).rejects.toMatchObject({ phase: "model_selection", retryable: false });
      }
      expect(generationRequests(server))
        .toHaveLength(Number(permissions.allowPaidPrimary) + Number(permissions.allowPaidFallback));
    } finally { await instance.close(); }
  });

  it("allows the explicitly pinned paid fallback only after exact price metadata is checked", async () => {
    const server = await startFakeServer({ fallbackModelPrice: 0.01 });
    servers.push(server);
    const instance = provider(server.url, {
      fallbackModel: "opencode/paid-fallback",
      allowPaidFallback: true,
    });
    const fallbackCandidate = { ...candidate, model: "opencode/paid-fallback" };
    await expect(instance.chatCandidate("narrate", fallbackCandidate, [{ role: "user", content: "probe" }]))
      .resolves.toMatchObject({ text: "Короткий ответ.", provider: "opencode_server" });
    expect(server.requests.find((request) => request.path === "/api/session")?.body.model)
      .toEqual({ providerID: "opencode", id: "paid-fallback" });
    await instance.close();
  });

  it("keeps provider codes allowlisted and preserves only a safe trace id", async () => {
    const server = await startFakeServer({ generateStatus: 502, errorCode: "secret key with spaces", traceId: "bad trace id" });
    servers.push(server);
    const instance = provider(server.url);
    await expect(instance.chatCandidate("narrate", candidate, [{ role: "user", content: "probe" }]))
      .rejects.toMatchObject({ httpStatus: 502, providerCode: undefined, providerTraceId: undefined, retryable: true });
    await instance.close();
  });

  it.each([
    { status: 402, reason: "provider", code: "provider_error", retryAfterMs: undefined },
    { status: 429, reason: "rate_limit", code: "rate_limited", retryAfterMs: 90_000 },
  ])("unwraps official Server 502 into upstream $status without retaining error text", async ({ status, reason, code, retryAfterMs }) => {
    const server = await startFakeServer({ generateStatus: 502, errorEnvelope: {
      _tag: "ProviderRequestError", providerID: "opencode", reason, status,
      message: "private upstream body must never be retained", ...(retryAfterMs ? { retryAfterMs } : {}),
    } });
    servers.push(server);
    const instance = provider(server.url);
    try {
      const call = () => instance.chatCandidate("narrate", candidate, [{ role: "user", content: "probe" }]);
      const failure = await call().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ProviderRequestError);
      expect(failure).toMatchObject({ httpStatus: status, gatewayHttpStatus: 502, providerCode: code, retryable: false });
      const safe = (failure as ProviderRequestError).toFailure();
      expect(safe.gatewayHttpStatus).toBe(502);
      expect(JSON.stringify(safe)).not.toContain("private upstream");
      if (status === 429) {
        expect(safe).toMatchObject({ retryAfterMsParsed: 90_000, retryAfterMsApplied: 90_000 });
        expect(safe.retryAfterHeaderRaw).toBeUndefined();
        await expect(call()).rejects.toMatchObject({ httpStatus: 429, retryable: false });
        expect(generationRequests(server)).toHaveLength(1);
      }
    } finally { await instance.close(); }
  });

  it("bounds concurrent generations and rejects excess queued work", async () => {
    const server = await startFakeServer({ generateDelayMs: 25 });
    servers.push(server);
    const instance = provider(server.url, { maxConcurrency: 1 });
    const calls = Array.from({ length: 10 }, () => instance.chatCandidate("narrate", candidate, [{ role: "user", content: "probe" }]));
    const settled = await Promise.allSettled(calls);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(9);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = settled.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" ? rejected.reason : null).toMatchObject({ phase: "transport", retryable: false });
    expect(server.maxActiveGenerations).toBe(1);
    await instance.close();
  });

  it("cancels a queued caller without dispatching another provider request", async () => {
    const server = await startFakeServer({ generateDelayMs: 50 });
    servers.push(server);
    const instance = provider(server.url, { maxConcurrency: 1 });
    const first = instance.chatCandidate("narrate", candidate, [{ role: "user", content: "first" }]);
    const controller = new AbortController();
    const queued = instance.chatCandidate("narrate", candidate, [{ role: "user", content: "queued" }], { signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    await expect(queued).rejects.toMatchObject({ phase: "transport", retryable: false });
    await first;
    expect(generationRequests(server)).toHaveLength(1);
    await instance.close();
  });

  it("maps an active timeout as a bounded retryable transport failure", async () => {
    const server = await startFakeServer({ generateDelayMs: 100 });
    servers.push(server);
    const instance = provider(server.url);
    await expect(instance.chatCandidate("narrate", candidate, [{ role: "user", content: "timeout" }], { timeoutMs: 15 }))
      .rejects.toMatchObject({ phase: "transport", retryable: true });
    await instance.close();
  });

  it("expires the caller budget while queued without waiting for the active generation", async () => {
    const server = await startFakeServer({ generateDelayMs: 200 });
    servers.push(server);
    const instance = provider(server.url, { maxConcurrency: 1 });
    let firstCompleted = false;
    const first = instance.chatCandidate("narrate", candidate, [{ role: "user", content: "first" }])
      .then(() => { firstCompleted = true; });
    try {
      await expect(instance.chatCandidate("narrate", candidate, [{ role: "user", content: "queued" }], { timeoutMs: 20 }))
        .rejects.toMatchObject({ phase: "transport", retryable: true, message: "request timeout after 20ms (phase=transport)" });
      expect(firstCompleted).toBe(false);
      await first;
      expect(generationRequests(server)).toHaveLength(1);
    } finally {
      await first;
      await instance.close();
    }
  });
});
