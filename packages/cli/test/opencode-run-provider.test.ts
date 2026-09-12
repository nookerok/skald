import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  OPENCODE_RUN_DEFAULT_AGENT,
  OPENCODE_RUN_DEFAULT_BINARY,
  OPENCODE_RUN_DEFAULT_MODEL,
  OPENCODE_RUN_ISOLATED_CONFIG_JSON,
  OPENCODE_RUN_SESSION_TITLE,
  OpenCodeRunProvider,
  buildOpenCodeRunArgs,
  extractOpenCodeSessionId,
  isOpenCodeRunEnabled,
  openCodeRunCandidate,
  parseOpenCodeNdjsonEvents,
  runOpencodeChat,
  sanitizeEnv,
  sanitizeSessionId,
  spawnChildProcess,
} from "../src/runtime/opencode-run-provider.js";
import type {
  SpawnExit,
  SpawnFn,
} from "../src/runtime/opencode-run-provider.js";
import type { Category, ChatMessage, RouteCandidate } from "@skald/world";
import { ProviderRequestError } from "@skald/world";

const NARRATE_MODEL = "opencode/muse-spark-1.3-contributor-free";

function candidate(model = NARRATE_MODEL): RouteCandidate {
  return { provider: "opencode_run", model, protocol: "opencode_run", tier: "catalog_candidate" };
}

function messages(text = "hello"): ChatMessage[] {
  return [
    { role: "system", content: "speak" },
    { role: "user", content: text },
  ];
}

function ndjsonOk(text: string, sessionId = "ses_abc123", usage?: { total: number; input: number; output: number }): string {
  const usagePart = usage ? `,"tokens":{"total":${usage.total},"input":${usage.input},"output":${usage.output}}` : "";
  return [
    `{"type":"step_start","timestamp":1,"sessionID":"${sessionId}","part":{"type":"step-start"}}`,
    `{"type":"text","timestamp":2,"sessionID":"${sessionId}","part":{"type":"text","text":${JSON.stringify(text)}}}`,
    `{"type":"step_finish","timestamp":3,"sessionID":"${sessionId}","part":{"type":"step-finish","reason":"stop"${usagePart}}}`,
  ].join("\n");
}

interface ScriptStep {
  readonly stdout?: string;
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly hang?: boolean;
  readonly spawnErrorCode?: string;
  readonly delayMs?: number;
}

interface RecordedCall {
  readonly binary: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

/** Scripted fake for SpawnFn: deterministic outcomes without processes. */
function fakeSpawn(script: readonly ScriptStep[] = [{}]): { fn: SpawnFn; calls: RecordedCall[]; kills: Array<NodeJS.Signals | undefined> } {
  const calls: RecordedCall[] = [];
  const kills: Array<NodeJS.Signals | undefined> = [];
  const steps = [...script];
  const fn: SpawnFn = (binary, args, opts) => {
    calls.push({ binary, args, cwd: opts.cwd, env: opts.env });
    const step = steps.shift() ?? {};
    const done = new Promise<SpawnExit>((resolve, reject) => {
      if (step.spawnErrorCode !== undefined) {
        const error = new Error(`spawn fake ${step.spawnErrorCode}`) as NodeJS.ErrnoException;
        error.code = step.spawnErrorCode;
        setTimeout(() => reject(error), step.delayMs ?? 0);
        return;
      }
      if (step.hang === true) return;
      setTimeout(() => {
        resolve({
          stdout: step.stdout ?? "",
          exitCode: step.exitCode ?? 0,
          signal: step.signal ?? null,
          outputTruncated: false,
        });
      }, step.delayMs ?? 0);
    });
    return {
      done,
      kill: (signal?: NodeJS.Signals) => {
        kills.push(signal);
      },
    };
  };
  return { fn, calls, kills };
}

function baseInput(overrides: Partial<Parameters<typeof runOpencodeChat>[0]> = {}) {
  return {
    binary: "opencode-test-binary",
    agent: "narrative",
    model: NARRATE_MODEL,
    messages: messages(),
    category: "narrate" as Category,
    timeoutMs: 1000,
    killGraceMs: 10,
    maxMessageBytes: 96 * 1024,
    maxOutputBytes: 256 * 1024,
    isolateHome: false,
    cleanupSession: false,
    cleanupTimeoutMs: 50,
    spawnImpl: fakeSpawn().fn,
    ...overrides,
  };
}

describe("opencode run argv and environment", () => {
  it("builds the verified CLI shape with the message last", () => {
    expect(buildOpenCodeRunArgs({ agent: "narrative", model: NARRATE_MODEL, workdir: "/tmp/w", message: "hi" })).toEqual([
      "run", "--format", "json", "--agent", "narrative", "-m", NARRATE_MODEL, "--title", "skald-narrate", "--dir", "/tmp/w", "hi",
    ]);
  });

  it("passes defaults for binary, agent and model", () => {
    expect(OPENCODE_RUN_DEFAULT_BINARY).toBe("opencode");
    expect(OPENCODE_RUN_DEFAULT_AGENT).toBe("narrative");
    expect(OPENCODE_RUN_DEFAULT_MODEL).toBe(NARRATE_MODEL);
    expect(OPENCODE_RUN_SESSION_TITLE).toBe("skald-narrate");
  });

  it("scrubs secrets from the child environment and keeps the allowlist", () => {
    const env = sanitizeEnv({
      PATH: "/usr/bin",
      HOME: "/home/nooker",
      SKALD_OPENCODE_ZEN_API_KEY: "zen-secret",
      SKALD_OLLAMA_CLOUD_API_KEY: "ollama-secret",
      OPENROUTER_API_KEY: "sk-or-v1-secret",
      CUSTOM_SECRET: "shh",
      EMPTY_OK: "",
    });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/nooker" });
    expect(JSON.stringify(env)).not.toContain("secret");
    expect(JSON.stringify(env)).not.toContain("shh");
  });

  it("enables the transport only on explicit opt-in", () => {
    expect(isOpenCodeRunEnabled({})).toBe(false);
    expect(isOpenCodeRunEnabled({ SKALD_OPENCODE_RUN: "0" })).toBe(false);
    expect(isOpenCodeRunEnabled({ SKALD_OPENCODE_RUN: "yes" })).toBe(false);
    expect(isOpenCodeRunEnabled({ SKALD_OPENCODE_RUN: "1" })).toBe(true);
  });

  it("builds a backup-tier candidate honouring the model override", () => {
    expect(openCodeRunCandidate({})).toEqual({
      provider: "opencode_run",
      model: NARRATE_MODEL,
      protocol: "opencode_run",
      tier: "catalog_candidate",
    });
    expect(openCodeRunCandidate({ SKALD_OPENCODE_RUN_MODEL: "custom/model" }).model).toBe("custom/model");
  });

  it("accepts only tight session ids for cleanup", () => {
    expect(sanitizeSessionId("ses_f6d8373c5ffeT5F4jUJ56azrW9")).toBe("ses_f6d8373c5ffeT5F4jUJ56azrW9");
    expect(sanitizeSessionId("ses a; rm -rf /")).toBeUndefined();
    expect(sanitizeSessionId("")).toBeUndefined();
    expect(sanitizeSessionId(42)).toBeUndefined();
    expect(sanitizeSessionId("x".repeat(129))).toBeUndefined();
  });
});

describe("parseOpenCodeNdjsonEvents", () => {
  it("joins text parts, captures session and usage, ignores unknown events", () => {
    const stdout = [
      `{"type":"step_start","sessionID":"ses_1","part":{"type":"step-start"}}`,
      ``,
      `{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"Вода "}}`,
      `{"type":"queue_update","sessionID":"ses_1","part":{"note":"future"}}`,
      `{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"поднялась."}}`,
      `{"type":"step_finish","sessionID":"ses_1","part":{"type":"step-finish","reason":"stop","tokens":{"total":10,"input":7,"output":3}}}`,
    ].join("\n");
    expect(parseOpenCodeNdjsonEvents(stdout)).toEqual({
      ok: true,
      texts: ["Вода ", "поднялась."],
      sessionId: "ses_1",
      usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
    });
  });

  it("fails closed on malformed lines, run errors, tool activity and empty text", () => {
    expect(parseOpenCodeNdjsonEvents(`{"type":"text", broken`)).toEqual({ ok: false, reason: "decode" });
    expect(parseOpenCodeNdjsonEvents(`[1,2]`)).toEqual({ ok: false, reason: "decode" });
    expect(parseOpenCodeNdjsonEvents(`{"type":"error","part":{"message":"boom"}}`)).toEqual({ ok: false, reason: "run_error" });
    expect(parseOpenCodeNdjsonEvents(`{"type":"tool_call","part":{"tool":"bash"}}`)).toEqual({ ok: false, reason: "tool_activity" });
    expect(parseOpenCodeNdjsonEvents(`{"type":"TOOL_RESULT","part":{}}`)).toEqual({ ok: false, reason: "tool_activity" });
    expect(parseOpenCodeNdjsonEvents(`\n  \n`)).toEqual({ ok: false, reason: "empty" });
    expect(parseOpenCodeNdjsonEvents(`{"type":"text","part":{"type":"text","text":"   "}}`)).toEqual({
      ok: true,
      texts: ["   "],
      sessionId: undefined,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
  });
});

describe("runOpencodeChat", () => {
  it("runs one call and maps the result without touching the network", async () => {
    const fake = fakeSpawn([{ stdout: ndjsonOk("Тихая вода.", "ses_9", { total: 30, input: 25, output: 5 }) }]);
    const result = await runOpencodeChat({ ...baseInput(), spawnImpl: fake.fn });
    expect(result.text).toBe("Тихая вода.");
    expect(result.usage).toEqual({ promptTokens: 25, completionTokens: 5, totalTokens: 30 });
    expect(typeof result.latencyMs).toBe("number");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.binary).toBe("opencode-test-binary");
    expect(fake.calls[0]?.args.slice(0, 10)).toEqual([
      "run", "--format", "json", "--agent", "narrative", "-m", NARRATE_MODEL, "--title", "skald-narrate", "--dir",
    ]);
    // The prompt travels as one argv entry (no shell), and no secrets leak.
    const message = fake.calls[0]?.args[11];
    expect(message).toContain("speak");
    expect(message).toContain("hello");
    expect(JSON.stringify(fake.calls[0]?.env)).not.toContain("secret");
    expect(fake.calls[0]?.env.PATH).toBeDefined();
  });

  it("creates and removes a temp workdir by default, keeps an explicit one", async () => {
    const before = new Set(readdirSync(tmpdir()));
    await runOpencodeChat({ ...baseInput(), spawnImpl: fakeSpawn([{ stdout: ndjsonOk("x") }]).fn });
    const after = readdirSync(tmpdir()).filter((name) => name.startsWith("skald-narrate-") && !before.has(name));
    expect(after).toEqual([]);

    const owned = join(mkdtempSync(join(tmpdir(), "skald-run-owned-")));
    try {
      const fake = fakeSpawn([{ stdout: ndjsonOk("x") }]);
      await runOpencodeChat({ ...baseInput(), spawnImpl: fake.fn, workdir: owned });
      expect(fake.calls[0]?.cwd).toBe(owned);
      expect(readdirSync(owned)).toEqual([]);
    } finally {
      rmSync(owned, { recursive: true, force: true });
    }
  });

  it("refuses oversized messages without spawning", async () => {
    const fake = fakeSpawn();
    const big = "я".repeat(100 * 1024);
    const error = await runOpencodeChat({ ...baseInput(), spawnImpl: fake.fn, messages: messages(big), maxMessageBytes: 1024 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderRequestError);
    expect(error as ProviderRequestError).toMatchObject({ provider: "opencode_run", phase: "configuration", retryable: false });
    expect(fake.calls).toHaveLength(0);
  });

  it("maps a missing binary to a configuration error naming the env override", async () => {
    const fake = fakeSpawn([{ spawnErrorCode: "ENOENT" }]);
    const error = await runOpencodeChat({ ...baseInput(), spawnImpl: fake.fn }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderRequestError);
    expect(error as ProviderRequestError).toMatchObject({ phase: "configuration", retryable: false });
    expect((error as Error).message).toContain("SKALD_OPENCODE_BIN");
  });

  it("maps a nonzero exit without retry", async () => {
    const fake = fakeSpawn([{ stdout: "oops", exitCode: 1 }]);
    const error = await runOpencodeChat({ ...baseInput(), spawnImpl: fake.fn }).catch((e: unknown) => e);
    expect(error as ProviderRequestError).toMatchObject({
      provider: "opencode_run",
      phase: "request",
      retryable: false,
    });
    expect((error as Error).message).toContain("exit code 1");
  });

  it("kills on timeout with SIGTERM then SIGKILL and reports retryable transport", async () => {
    const fake = fakeSpawn([{ hang: true }]);
    const error = await runOpencodeChat({ ...baseInput(), spawnImpl: fake.fn, timeoutMs: 40 }).catch((e: unknown) => e);
    expect(error as ProviderRequestError).toMatchObject({ phase: "transport", retryable: true });
    expect((error as Error).message).toContain("request timeout after 40ms");
    await vi.waitFor(() => expect(fake.kills).toEqual(["SIGTERM", "SIGKILL"]), { timeout: 2000 });
  });

  it("kills on output budget and reports a decode error", async () => {
    // Fakes ignore budgets by contract; a truncating fake stands in for the
    // real spawn enforcing maxOutputBytes (covered live by the cap test below).
    const truncating = (): ReturnType<SpawnFn> => ({
      done: Promise.resolve({ stdout: "", exitCode: null, signal: "SIGKILL", outputTruncated: true }),
      kill: () => undefined,
    });
    const error = await runOpencodeChat({ ...baseInput(), spawnImpl: truncating }).catch((e: unknown) => e);
    expect(error as ProviderRequestError).toMatchObject({ phase: "response_decode", retryable: false });
  });

  it("enforces the output budget against a real child process", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "skald-run-cap-")));
    try {
      const script = "let s=''; while (s.length < 4096) s+='0123456789abcdef'; process.stdout.write(s);";
      const handle = spawnChildProcess(process.execPath, ["-e", script], {
        cwd: dir,
        env: {},
        maxOutputBytes: 64,
      });
      const exit = await handle.done;
      expect(exit.outputTruncated).toBe(true);
      expect(exit.signal).toBe("SIGKILL");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs a real child end to end and surfaces spawn errors", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "skald-run-real-")));
    try {
      const ok = spawnChildProcess(process.execPath, ["-e", "process.stdout.write('hi');"], {
        cwd: dir,
        env: {},
        maxOutputBytes: 1024,
      });
      expect(await ok.done).toMatchObject({ stdout: "hi", exitCode: 0, outputTruncated: false });

      const missing = spawnChildProcess("definitely-not-a-real-binary-xyz", [], {
        cwd: dir,
        env: {},
        maxOutputBytes: 1024,
      });
      const error = await missing.done.catch((e: unknown) => e);
      expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("maps a real missing binary to the configuration error", async () => {
    const error = await runOpencodeChat({
      ...baseInput(),
      binary: "definitely-not-a-real-binary-xyz",
      spawnImpl: undefined,
    }).catch((e: unknown) => e);
    expect(error as ProviderRequestError).toMatchObject({ phase: "configuration", retryable: false });
    expect((error as Error).message).toContain("SKALD_OPENCODE_BIN");
  });

  it("rejects tool activity and run errors without retry", async () => {
    const tool = fakeSpawn([{ stdout: `{"type":"tool_call","part":{"tool":"bash"}}\n${ndjsonOk("x")}` }]);
    await expect(runOpencodeChat({ ...baseInput(), spawnImpl: tool.fn })).rejects.toMatchObject({
      phase: "schema_validation",
      retryable: false,
    });
    const failed = fakeSpawn([{ stdout: `{"type":"error","part":{"message":"boom"}}` }]);
    await expect(runOpencodeChat({ ...baseInput(), spawnImpl: failed.fn })).rejects.toMatchObject({
      phase: "request",
      retryable: false,
    });
  });

  it("deletes the session row best-effort and swallows cleanup failures", async () => {
    const fake = fakeSpawn([
      { stdout: ndjsonOk("x", "ses_cleanup_me") },
      { spawnErrorCode: "EPIPE" },
    ]);
    const result = await runOpencodeChat({ ...baseInput(), spawnImpl: fake.fn, cleanupSession: true });
    expect(result.text).toBe("x");
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]?.args).toEqual(["session", "delete", "ses_cleanup_me"]);
  });

  it("skips cleanup without a session id or when disabled", async () => {
    const noId = fakeSpawn([{ stdout: `{"type":"text","part":{"type":"text","text":"x"}}` }]);
    await runOpencodeChat({ ...baseInput(), spawnImpl: noId.fn });
    expect(noId.calls).toHaveLength(1);

    const off = fakeSpawn([{ stdout: ndjsonOk("x", "ses_nope") }]);
    await runOpencodeChat({ ...baseInput(), spawnImpl: off.fn, cleanupSession: false });
    expect(off.calls).toHaveLength(1);
  });

  it("never deletes on a hostile session id", async () => {
    const fake = fakeSpawn([{ stdout: ndjsonOk("x", "ses a; rm -rf /") }]);
    // sanitizeSessionId rejects it, so only the narrative call happens.
    await runOpencodeChat({ ...baseInput(), spawnImpl: fake.fn });
    expect(fake.calls).toHaveLength(1);
  });
});

describe("OpenCodeRunProvider", () => {
  function provider(overrides: ConstructorParameters<typeof OpenCodeRunProvider>[0] = {}) {
    return new OpenCodeRunProvider({
      apiKey: "",
      providerId: "opencode_zen",
      availableProviders: ["opencode_run"],
      routeCandidates: { narrate: [candidate()] },
      ...overrides,
    });
  }

  it("reports the keyless transport as keyed and delegates the rest", () => {
    const router = provider();
    expect(router.hasProviderKey("opencode_run")).toBe(true);
    expect(router.hasProviderKey("opencode_zen")).toBe(false);
  });

  it("serves opencode_run candidates through the subprocess", async () => {
    const fake = fakeSpawn([{ stdout: ndjsonOk("Река спит.", "ses_chat") }]);
    const router = new OpenCodeRunProvider({
      apiKey: "",
      providerId: "opencode_zen",
      availableProviders: ["opencode_run"],
      routeCandidates: { narrate: [candidate()] },
      opencodeRun: { binary: "opencode-test-binary", spawnImpl: fake.fn, cleanupSession: false, isolateHome: false },
    });
    const result = await router.chatCandidate("narrate", candidate(), messages("скажи"), { timeoutMs: 1000 });
    expect(result).toMatchObject({
      model: NARRATE_MODEL,
      configuredModel: NARRATE_MODEL,
      configuredProvider: "opencode_run",
      responseModel: NARRATE_MODEL,
      usedFallback: false,
      text: "Река спит.",
      provider: "opencode_run",
      tier: "catalog_candidate",
    });
    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it("delegates other providers to the base router without spawning", async () => {
    const fake = fakeSpawn();
    const router = new OpenCodeRunProvider({
      apiKey: "",
      providerId: "opencode_zen",
      availableProviders: ["opencode_zen", "opencode_run"],
      routeCandidates: {
        narrate: [{ provider: "opencode_zen", model: "big-pickle", protocol: "openai_chat", tier: "catalog_candidate" }],
      },
      opencodeRun: { binary: "opencode-test-binary", spawnImpl: fake.fn, isolateHome: false },
    });
    const zen = { provider: "opencode_zen", model: "big-pickle", protocol: "openai_chat", tier: "catalog_candidate" } as const;
    await expect(router.chatCandidate("narrate", zen, messages(), { timeoutMs: 50 })).rejects.toThrow("provider is not configured");
    expect(fake.calls).toHaveLength(0);
  });

  it("emits provider diagnostics through chat with the subprocess candidate", async () => {
    const fake = fakeSpawn([{ stdout: ndjsonOk("Луна.", "ses_diag", { total: 5, input: 4, output: 1 }) }]);
    const router = new OpenCodeRunProvider({
      apiKey: "",
      providerId: "opencode_zen",
      availableProviders: ["opencode_run"],
      routeCandidates: { narrate: [candidate()] },
      opencodeRun: { binary: "opencode-test-binary", spawnImpl: fake.fn, cleanupSession: false, isolateHome: false },
    });
    const seen: unknown[] = [];
    const result = await router.chat("narrate", messages(), {
      diagnostics: (event) => seen.push(event),
    });
    expect(result.provider).toBe("opencode_run");
    expect(result.usage).toEqual({ promptTokens: 4, completionTokens: 1, totalTokens: 5 });
    expect(seen).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "provider", outcome: "success", provider: "opencode_run", model: NARRATE_MODEL }),
      ]),
    );
  });

  it("routes chatOnce by explicit provider or pinned model", async () => {
    const fake = fakeSpawn([
      { stdout: ndjsonOk("один", "ses_a") },
      { stdout: ndjsonOk("два", "ses_b") },
    ]);
    const router = new OpenCodeRunProvider({
      apiKey: "",
      providerId: "opencode_zen",
      availableProviders: ["opencode_zen", "opencode_run"],
      routeCandidates: { narrate: [candidate()] },
      opencodeRun: { binary: "opencode-test-binary", spawnImpl: fake.fn, cleanupSession: false, isolateHome: false },
    });
    const explicit = await router.chatOnce("anything", messages(), { provider: "opencode_run", timeoutMs: 1000 });
    expect(explicit.text).toBe("один");
    const pinned = await router.chatOnce(NARRATE_MODEL, messages(), { timeoutMs: 1000 });
    expect(pinned.text).toBe("два");
    expect(fake.calls).toHaveLength(2);
  });
});

describe("home isolation and agent manifest", () => {
  function manifestFile(content = "pinned-agent-bytes"): string {
    const dir = mkdtempSync(join(tmpdir(), "skald-manifest-"));
    const path = join(dir, "narrative.md");
    writeFileSync(path, content, "utf8");
    return path;
  }

  it("runs with an empty per-call HOME carrying only the pinned skeleton", async () => {
    const manifest = manifestFile();
    const fake = fakeSpawn([{ stdout: ndjsonOk("Тихо.", "ses_iso") }]);
    const result = await runOpencodeChat({
      ...baseInput(),
      spawnImpl: fake.fn,
      isolateHome: true,
      agentManifestPath: manifest,
      cleanupSession: false,
    });
    expect(result.text).toBe("Тихо.");
    const call = fake.calls[0]!;
    const home = call.env.HOME!;
    expect(home).not.toBe(process.env.HOME);
    expect(home.startsWith(tmpdir())).toBe(true);
    const dirIndex = call.args.indexOf("--dir");
    expect(call.args[dirIndex + 1]!.startsWith(home)).toBe(true);
    expect(existsSync(home)).toBe(false);
  });

  it("copies the pinned manifest and inert config into the skeleton", async () => {
    const manifest = manifestFile("pinned-agent-bytes");
    let seenHome = "";
    let skeletonOk = false;
    const probing: SpawnFn = (_binary, _args, opts) => {
      seenHome = opts.env.HOME ?? "";
      skeletonOk =
        readFileSync(join(seenHome, ".config", "opencode", "agents", "narrative.md"), "utf8") === "pinned-agent-bytes" &&
        readFileSync(join(seenHome, ".config", "opencode", "opencode.jsonc"), "utf8") === OPENCODE_RUN_ISOLATED_CONFIG_JSON &&
        existsSync(join(seenHome, "work"));
      return {
        done: Promise.resolve({ stdout: ndjsonOk("x"), exitCode: 0, signal: null, outputTruncated: false }),
        kill: () => undefined,
      };
    };
    await runOpencodeChat({ ...baseInput(), spawnImpl: probing, isolateHome: true, agentManifestPath: manifest });
    expect(skeletonOk).toBe(true);
    expect(existsSync(seenHome)).toBe(false);
  });

  it("fails closed when the manifest is missing", async () => {
    const fake = fakeSpawn();
    const error = await runOpencodeChat({
      ...baseInput(),
      spawnImpl: fake.fn,
      isolateHome: true,
      agentManifestPath: join(tmpdir(), "definitely-no-manifest-xyz.md"),
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ provider: "opencode_run", phase: "configuration", retryable: false });
    expect(fake.calls).toHaveLength(0);
  });

  it("rejects an agent name that cannot become a skeleton path", async () => {
    const fake = fakeSpawn();
    const error = await runOpencodeChat({
      ...baseInput(),
      spawnImpl: fake.fn,
      isolateHome: true,
      agent: "../evil",
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ provider: "opencode_run", phase: "configuration", retryable: false });
    expect(fake.calls).toHaveLength(0);
  });

  it("isolates HOME by default and keeps the process HOME on opt-out", async () => {
    const manifest = manifestFile("m");
    const isolated = fakeSpawn([{ stdout: ndjsonOk("a") }]);
    const routerOn = new OpenCodeRunProvider({
      apiKey: "",
      providerId: "opencode_zen",
      availableProviders: ["opencode_run"],
      routeCandidates: { narrate: [candidate()] },
      opencodeRun: { binary: "opencode-test-binary", spawnImpl: isolated.fn, cleanupSession: false, agentManifestPath: manifest },
    });
    await routerOn.chatCandidate("narrate", candidate(), messages(), { timeoutMs: 1000 });
    expect(isolated.calls[0]?.env.HOME).not.toBe(process.env.HOME);

    const plain = fakeSpawn([{ stdout: ndjsonOk("b") }]);
    const routerOff = new OpenCodeRunProvider({
      apiKey: "",
      providerId: "opencode_zen",
      availableProviders: ["opencode_run"],
      routeCandidates: { narrate: [candidate()] },
      opencodeRun: { binary: "opencode-test-binary", spawnImpl: plain.fn, cleanupSession: false, isolateHome: false },
    });
    await routerOff.chatCandidate("narrate", candidate(), messages(), { timeoutMs: 1000 });
    expect(plain.calls[0]?.env.HOME).toBe(process.env.HOME);
  });
});

describe("failure-path session cleanup", () => {
  function recordingLate(stdout: string, delayMs: number, exitCode: number | null = 1) {
    const calls: { binary: string; args: readonly string[] }[] = [];
    const fn: SpawnFn = (binary, args) => {
      calls.push({ binary, args: [...args] });
      if (args[0] === "session") {
        return { done: Promise.resolve({ stdout: "", exitCode: 0, signal: null, outputTruncated: false }), kill: () => undefined };
      }
      return {
        done: new Promise((resolve) => setTimeout(
          () => resolve({ stdout, exitCode, signal: null, outputTruncated: false }),
          delayMs,
        )),
        kill: () => undefined,
      };
    };
    return { fn, calls };
  }

  it("deletes the session when a timed-out child settles late with an id", async () => {
    const { fn, calls } = recordingLate(ndjsonOk("too late", "ses_late_timeout"), 30);
    const error = await runOpencodeChat({
      ...baseInput(),
      spawnImpl: fn,
      timeoutMs: 10,
      killGraceMs: 500,
      cleanupSession: true,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ provider: "opencode_run", phase: "transport", retryable: true });
    expect(calls.map((call) => call.args[0])).toEqual(["run", "session"]);
    expect(calls[1]?.args).toEqual(["session", "delete", "ses_late_timeout"]);
  });

  it("deletes the session on malformed output carrying an id", async () => {
    const { fn, calls } = recordingLate(`broken\n{"sessionID":"ses_late_malformed"}`, 0, 0);
    const error = await runOpencodeChat({
      ...baseInput(),
      spawnImpl: fn,
      cleanupSession: true,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ phase: "response_decode", retryable: false });
    expect(calls.map((call) => call.args[0])).toEqual(["run", "session"]);
    expect(calls[1]?.args).toEqual(["session", "delete", "ses_late_malformed"]);
  });

  it("deletes the session on tool activity carrying an id", async () => {
    const { fn, calls } = recordingLate(`{"type":"tool_call","part":{"tool":"bash"}}\n${ndjsonOk("x", "ses_late_tool")}`, 0, 0);
    const error = await runOpencodeChat({
      ...baseInput(),
      spawnImpl: fn,
      cleanupSession: true,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ phase: "schema_validation", retryable: false });
    expect(calls[1]?.args).toEqual(["session", "delete", "ses_late_tool"]);
  });

  it("never masks the original error with a cleanup failure", async () => {
    const failingDelete: SpawnFn = (_binary, args) => {
      if (args[0] === "session") {
        return {
          done: Promise.reject(new Error("delete exploded")),
          kill: () => undefined,
        };
      }
      return {
        done: Promise.resolve({ stdout: ndjsonOk("x", "ses_mask_me"), exitCode: 1, signal: null, outputTruncated: false }),
        kill: () => undefined,
      };
    };
    const error = await runOpencodeChat({
      ...baseInput(),
      spawnImpl: failingDelete,
      cleanupSession: true,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ phase: "request", retryable: false });
    expect((error as Error).message).toContain("exit code 1");
  });

  it("skips cleanup when no id was ever emitted", async () => {
    const { fn, calls } = recordingLate("", 0, 0);
    const error = await runOpencodeChat({
      ...baseInput(),
      spawnImpl: fn,
      cleanupSession: true,
    }).catch((e: unknown) => e);
    expect(error).toMatchObject({ phase: "response_decode", retryable: false });
    expect(calls).toHaveLength(1);
  });

  it("recovers session ids from partial stdout and rejects hostile ones", () => {
    expect(extractOpenCodeSessionId(`{"sessionID":"ses_abc123"}`)).toBe("ses_abc123");
    expect(extractOpenCodeSessionId(`line1\n{"sessionID":"ses_partial_9"}\n{"type":"text"`)).toBe("ses_partial_9");
    expect(extractOpenCodeSessionId(`{"sessionID":"ses a; rm -rf /"}`)).toBeUndefined();
    expect(extractOpenCodeSessionId("no ids here")).toBeUndefined();
    expect(extractOpenCodeSessionId("")).toBeUndefined();
  });
});
