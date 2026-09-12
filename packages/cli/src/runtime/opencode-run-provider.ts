/**
 * Local-subprocess narrative transport via the OpenCode CLI.
 *
 * `OpenCodeRunProvider` extends `ModelRouter` (the same seam as the
 * acceptance `FixedNarrationProvider`) and serves route candidates with
 * provider `opencode_run` by spawning one `opencode run --format json`
 * subprocess per call. Every other provider flows through the base
 * implementation untouched.
 *
 * Why a subprocess and not the serve daemon: no daemon lifecycle, no ports,
 * no passwords and no cross-turn session state on a small host. Each call
 * starts clean, which mirrors the narrative invariant (read-only, never
 * authoritative), and crash isolation is per call. The price is
 * process-startup latency (~15s wall on Orange Pi, mostly session init),
 * so this transport suits detached decoration traffic, not the
 * latency-critical command path.
 *
 * Containment contract (all enforced here, all tested):
 * - the child never sees secrets: the prompt travels as one argv entry
 *   with no shell in between (no shell injection by construction), and the
 *   environment is reduced to {@link OPENCODE_RUN_ENV_ALLOWLIST};
 * - the child runs in a fresh empty temp dir (caller-owned when overridden);
 * - only exact contract text is accepted back: the NDJSON stream must parse,
 *   must contain no tool activity, and the joined text must be non-empty —
 *   anything else fails closed to the existing deterministic fallback via
 *   `ProviderRequestError`;
 * - timeouts kill (SIGTERM, then SIGKILL after a grace period);
 * - the spawned session row is deleted best-effort afterwards so
 *   `opencode.db` does not grow without bound.
 *
 * The prompt contract itself stays versioned in Skald code: the CLI message
 * is the same system+user text the HTTP path sends, and the agent file on
 * the host only carries containment role instructions. Wiring (which routes
 * gain this candidate) lives in `router-factory.ts` behind an explicit
 * opt-in flag; this module never decides routing policy.
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LLM_CONFIG, ModelRouter, ProviderRequestError } from "@skald/world";
import type {
  Category,
  ChatCandidateOptions,
  ChatMessage,
  ChatResult,
  ModelRouterOptions,
  ProviderId,
  RouteCandidate,
} from "@skald/world";

/** Provider id for the local-subprocess transport. */
export const OPENCODE_RUN_PROVIDER_ID: ProviderId = "opencode_run";

/** Binary resolved when `SKALD_OPENCODE_BIN` is unset. */
export const OPENCODE_RUN_DEFAULT_BINARY = "opencode";

/** Containment agent. Must exist on the host with all tools denied. */
export const OPENCODE_RUN_DEFAULT_AGENT = "narrative";

/** Pinned model; also passed explicitly via `-m` on every call. */
export const OPENCODE_RUN_DEFAULT_MODEL = "opencode/muse-spark-1.3-contributor-free";

/** Grace period between SIGTERM and SIGKILL on timeout. */
export const OPENCODE_RUN_KILL_GRACE_MS = 2_000;

/** Best-effort budget for the post-run session delete. */
export const OPENCODE_RUN_CLEANUP_TIMEOUT_MS = 5_000;

/** Refuse to spawn when a single argv message would risk truncation. */
export const OPENCODE_RUN_MAX_MESSAGE_BYTES = 96 * 1024;

/** Kill the child instead of buffering unbounded stdout. */
export const OPENCODE_RUN_MAX_OUTPUT_BYTES = 256 * 1024;

/**
 * Environment allowlist: only these names cross into the child. Everything
 * else — including every `*_API_KEY` — stays behind, so a compromised or
 * curious subprocess cannot exfiltrate operator credentials.
 */
export const OPENCODE_RUN_ENV_ALLOWLIST: readonly string[] = Object.freeze([
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SYSTEMROOT",
  "USERPROFILE",
  "OS",
  "HOMEDRIVE",
  "HOMEPATH",
]);

/** Explicit opt-in; the transport is never on by default. */
export const OPENCODE_RUN_ENABLE_ENV = "SKALD_OPENCODE_RUN";

/** Binary override (required when `opencode` is not on the service PATH). */
export const OPENCODE_RUN_BINARY_ENV = "SKALD_OPENCODE_BIN";

/** Agent override. */
export const OPENCODE_RUN_AGENT_ENV = "SKALD_OPENCODE_RUN_AGENT";

/** Model override (also becomes the candidate model id). */
export const OPENCODE_RUN_MODEL_ENV = "SKALD_OPENCODE_RUN_MODEL";

/** Result of one spawned child process. */
export interface SpawnExit {
  /** Raw stdout bytes decoded as UTF-8. */
  readonly stdout: string;
  /** Process exit code; null when killed by signal or on spawn failure paths. */
  readonly exitCode: number | null;
  /** Terminating signal, if any. */
  readonly signal: NodeJS.Signals | null;
  /** True when stdout hit the budget and the child was killed for it. */
  readonly outputTruncated: boolean;
}

/** Live handle to a spawned child. */
export interface SpawnHandle {
  /** Settles with the process outcome. Never rejects on spawn success. */
  readonly done: Promise<SpawnExit>;
  /** Best-effort signal delivery; never throws. */
  kill(signal?: NodeJS.Signals): void;
}

/** Options for one spawn call. */
export interface SpawnCallOptions {
  /** Working directory; must already exist. */
  readonly cwd: string;
  /** Already-sanitized environment for the child. */
  readonly env: NodeJS.ProcessEnv;
  /** Kill the child instead of buffering past this many stdout bytes. */
  readonly maxOutputBytes: number;
}

/**
 * Process-spawning hook. The default implementation shells out to the real
 * binary; tests inject scripted fakes. The hook owns timeout-free execution
 * only — timeouts and kills are orchestrated by the caller so the policy
 * stays in one place and stays testable.
 */
export type SpawnFn = (
  binary: string,
  args: readonly string[],
  opts: SpawnCallOptions,
) => SpawnHandle;

/** Transport knobs; everything optional with documented defaults. */
export interface OpenCodeRunTransport {
  readonly binary?: string | undefined;
  readonly agent?: string | undefined;
  readonly model?: string | undefined;
  /** Caller-owned directory when set; otherwise a fresh temp dir per call. */
  readonly workdir?: string | undefined;
  readonly killGraceMs?: number | undefined;
  readonly maxMessageBytes?: number | undefined;
  readonly maxOutputBytes?: number | undefined;
  /** Best-effort `session delete` afterwards; default true. */
  readonly cleanupSession?: boolean | undefined;
  readonly cleanupTimeoutMs?: number | undefined;
  readonly spawnImpl?: SpawnFn | undefined;
}

/** `ModelRouter` options plus the transport block. */
export interface OpenCodeRunProviderOptions extends ModelRouterOptions {
  readonly opencodeRun?: OpenCodeRunTransport | undefined;
}

/**
 * Whether the local-subprocess transport is explicitly enabled.
 * Default-off: production must opt in deliberately per host.
 */
export function isOpenCodeRunEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[OPENCODE_RUN_ENABLE_ENV] === "1";
}

/** Route candidate for the local transport (backup tier by convention). */
export function openCodeRunCandidate(env: NodeJS.ProcessEnv = process.env): RouteCandidate {
  return {
    provider: OPENCODE_RUN_PROVIDER_ID,
    model: env[OPENCODE_RUN_MODEL_ENV] ?? OPENCODE_RUN_DEFAULT_MODEL,
    protocol: "opencode_run",
    tier: "catalog_candidate",
  };
}

/**
 * CLI argv for one narrative call. The message travels as a single argv
 * entry with no shell in between, so prompt text can never become a shell
 * command. Shape verified live against `opencode run --help` output.
 */
export function buildOpenCodeRunArgs(input: {
  readonly agent: string;
  readonly model: string;
  readonly workdir: string;
  readonly message: string;
}): readonly string[] {
  return Object.freeze([
    "run",
    "--format",
    "json",
    "--agent",
    input.agent,
    "-m",
    input.model,
    "--dir",
    input.workdir,
    input.message,
  ]);
}

/**
 * Reduce an environment to the explicit allowlist. Returns a fresh object;
 * the input is never mutated.
 */
export function sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of OPENCODE_RUN_ENV_ALLOWLIST) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return out;
}

/** Token usage parsed from a `step_finish` event; zeros when absent. */
export interface ParsedRunUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/** Outcome of parsing one `--format json` stdout blob. */
export type NdjsonParseResult =
  | {
    readonly ok: true;
    readonly texts: readonly string[];
    readonly sessionId: string | undefined;
    readonly usage: ParsedRunUsage;
  }
  | { readonly ok: false; readonly reason: "decode" | "run_error" | "tool_activity" | "empty" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/**
 * Parse one `--format json` NDJSON stdout blob. Pure and total: blank lines
 * are skipped and unknown non-tool event types are ignored for forward
 * compatibility, but anything malformed, any reported run error and any
 * tool-shaped activity fails closed — the caller maps those to
 * `ProviderRequestError` and the existing deterministic fallback engages.
 */
export function parseOpenCodeNdjsonEvents(stdout: string): NdjsonParseResult {
  const texts: string[] = [];
  let sessionId: string | undefined;
  let usage: ParsedRunUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  for (const line of stdout.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      return { ok: false, reason: "decode" };
    }
    if (!isRecord(event) || typeof event.type !== "string") return { ok: false, reason: "decode" };
    if (sessionId === undefined) {
      const candidate = asNonEmptyString(event.sessionID);
      if (candidate !== undefined) sessionId = candidate;
    }
    const type = event.type;
    if (type === "error") return { ok: false, reason: "run_error" };
    if (type.toLowerCase().includes("tool")) return { ok: false, reason: "tool_activity" };
    if (type !== "text" && type !== "step_start" && type !== "step_finish") continue;
    const part = (event as { part?: unknown }).part;
    if (type === "text") {
      const text = isRecord(part) ? asNonEmptyString(part.text) : undefined;
      // Empty text parts carry nothing; a wholly empty reply is rejected below.
      if (text !== undefined) texts.push(text);
      continue;
    }
    if (type === "step_finish" && isRecord(part)) {
      const tokens = (part as { tokens?: unknown }).tokens;
      if (isRecord(tokens)) {
        usage = {
          promptTokens: asCount(tokens.input),
          completionTokens: asCount(tokens.output),
          totalTokens: asCount(tokens.total),
        };
      }
    }
  }
  if (texts.length === 0) return { ok: false, reason: "empty" };
  return { ok: true, texts: Object.freeze([...texts]), sessionId, usage };
}

/**
 * Session ids flow back into a shell-free `session delete` argv. Only a
 * tight allowlist shape is accepted; anything else skips cleanup silently
 * instead of risking argument smuggling.
 */
export function sanitizeSessionId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : undefined;
}

function safeKill(handle: { kill(signal?: NodeJS.Signals): void }, signal: NodeJS.Signals): void {
  try {
    handle.kill(signal);
  } catch {
    // A dead child is the desired end state; never fail the narration for it.
  }
}

/**
 * Real `SpawnFn`: `child_process.spawn` with streaming stdout, stderr drain,
 * output-budget kill and spawn-error rejection. Exported for direct testing;
 * production code should prefer {@link runOpencodeChat}.
 */
export function spawnChildProcess(binary: string, args: readonly string[], opts: SpawnCallOptions): SpawnHandle {
  let child: ChildProcess;
  try {
    child = spawn(binary, [...args], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    return {
      done: Promise.reject(error),
      kill: () => undefined,
    };
  }
  let settled = false;
  let truncated = false;
  const chunks: Buffer[] = [];
  let buffered = 0;
  const done = new Promise<SpawnExit>((resolve, reject) => {
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      buffered += bytes.length;
      if (buffered > opts.maxOutputBytes) {
        if (!settled) {
          settled = true;
          truncated = true;
          safeKill(child, "SIGKILL");
        }
        return;
      }
      chunks.push(bytes);
    });
    // Drain stderr so a chatty child can never block on a full pipe. The
    // content is deliberately never stored: diagnostics must not carry
    // provider output.
    child.stderr?.resume();
    child.on("error", (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        if (truncated) {
          resolve({ stdout: Buffer.concat(chunks).toString("utf8"), exitCode: null, signal: "SIGKILL", outputTruncated: true });
        }
        return;
      }
      settled = true;
      resolve({ stdout: Buffer.concat(chunks).toString("utf8"), exitCode: code, signal, outputTruncated: false });
    });
  });
  return {
    done,
    kill: (signal: NodeJS.Signals = "SIGTERM") => safeKill(child, signal),
  };
}

/** Input for one subprocess chat round-trip. */
export interface RunOpenCodeChatInput {
  readonly binary: string;
  readonly agent: string;
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly category: Category;
  readonly timeoutMs: number;
  readonly killGraceMs: number;
  /** Already-sanitized environment override; defaults to the scrubbed process env. */
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly workdir?: string | undefined;
  readonly maxMessageBytes: number;
  readonly maxOutputBytes: number;
  readonly cleanupSession: boolean;
  readonly cleanupTimeoutMs: number;
  readonly spawnImpl?: SpawnFn | undefined;
}

/** Successful subprocess chat output. Failures throw `ProviderRequestError`. */
export interface RunOpenCodeChatResult {
  readonly text: string;
  readonly latencyMs: number;
  readonly usage: ParsedRunUsage;
}

function providerError(
  model: string,
  category: Category,
  phase: "configuration" | "request" | "transport" | "response_decode" | "response_shape" | "schema_validation",
  reason: string,
  retryable: boolean,
): ProviderRequestError {
  return new ProviderRequestError({
    provider: OPENCODE_RUN_PROVIDER_ID,
    model,
    category,
    phase,
    reason,
    retryable,
  });
}

function withTimeoutGuard(ms: number, onFire: () => void): () => void {
  const timer = setTimeout(onFire, Math.max(1, Math.floor(ms)));
  if (typeof timer.unref === "function") timer.unref();
  return () => clearTimeout(timer);
}

async function deleteSessionBestEffort(input: {
  readonly binary: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly spawnImpl: SpawnFn;
}): Promise<void> {
  const child = input.spawnImpl(input.binary, ["session", "delete", input.sessionId], {
    cwd: input.cwd,
    env: input.env,
    maxOutputBytes: 4096,
  });
  await Promise.race([
    child.done.then(
      (): true => true,
      (): false => false,
    ),
    new Promise<false>((resolve) => {
      withTimeoutGuard(input.timeoutMs, () => {
        safeKill(child, "SIGKILL");
        resolve(false);
      });
    }),
  ]).catch((): false => false);
}

/**
 * One subprocess chat round-trip: build argv, spawn in a fresh empty dir,
 * enforce timeouts and output budgets, parse NDJSON, clean up the session
 * row and the temp dir. Throws `ProviderRequestError` on every failure mode
 * so the router's existing retry/failover/fallback machinery applies
 * unchanged (timeout is retryable, everything else fails fast).
 */
export async function runOpencodeChat(input: RunOpenCodeChatInput): Promise<RunOpenCodeChatResult> {
  const startedAt = performance.now();
  const message = input.messages.map((part) => part.content).join("\n\n");
  if (Buffer.byteLength(message, "utf8") > input.maxMessageBytes) {
    throw providerError(input.model, input.category, "configuration", "message exceeds spawn budget", false);
  }
  const env = input.env ?? sanitizeEnv(process.env);
  let workdir = input.workdir;
  let ownedWorkdir = false;
  if (workdir === undefined) {
    workdir = mkdtempSync(join(tmpdir(), "skald-narrate-"));
    ownedWorkdir = true;
  }
  const args = buildOpenCodeRunArgs({ agent: input.agent, model: input.model, workdir, message });
  const spawnImpl = input.spawnImpl ?? spawnChildProcess;
  const child = spawnImpl(input.binary, args, { cwd: workdir, env, maxOutputBytes: input.maxOutputBytes });
  // The timeout must reject even when `done` never settles (a hung child
  // whose kill is a no-op in a fake, or an unkillable process): race, then
  // let the kill timers do their best-effort work in the background.
  const timeoutError = providerError(input.model, input.category, "transport", `request timeout after ${input.timeoutMs}ms`, true);
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined = undefined;
  const timeoutOutcome = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      safeKill(child, "SIGTERM");
      withTimeoutGuard(input.killGraceMs, () => safeKill(child, "SIGKILL"));
      reject(timeoutError);
    }, Math.max(1, Math.floor(input.timeoutMs)));
    if (typeof timeoutHandle.unref === "function") timeoutHandle.unref();
  });
  try {
    // A timeout rejects the race above; reaching here means the child won.
    const exit = await Promise.race([child.done, timeoutOutcome]);
    if (exit.outputTruncated) {
      throw providerError(input.model, input.category, "response_decode", "output budget exceeded", false);
    }
    if (exit.exitCode !== 0) {
      throw providerError(input.model, input.category, "request", `exit code ${exit.exitCode ?? "unknown"}`, false);
    }
    const parsed = parseOpenCodeNdjsonEvents(exit.stdout);
    if (!parsed.ok) {
      if (parsed.reason === "tool_activity") {
        throw providerError(input.model, input.category, "schema_validation", "unexpected tool activity", false);
      }
      if (parsed.reason === "run_error") {
        throw providerError(input.model, input.category, "request", "run reported error", false);
      }
      throw providerError(input.model, input.category, "response_decode", "malformed NDJSON response", false);
    }
    const text = parsed.texts.join("");
    if (text.trim().length === 0) {
      throw providerError(input.model, input.category, "response_shape", "empty response", false);
    }
    const sessionId = sanitizeSessionId(parsed.sessionId);
    if (input.cleanupSession && sessionId !== undefined) {
      await deleteSessionBestEffort({
        binary: input.binary,
        sessionId,
        cwd: workdir,
        env,
        timeoutMs: input.cleanupTimeoutMs,
        spawnImpl,
      });
    }
    return { text, latencyMs: Math.round(performance.now() - startedAt), usage: parsed.usage };
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error;
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT" || code === "EACCES") {
      throw providerError(
        input.model,
        input.category,
        "configuration",
        `cannot execute opencode binary (check ${OPENCODE_RUN_BINARY_ENV})`,
        false,
      );
    }
    throw providerError(input.model, input.category, "transport", "process spawn failed", false);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    if (ownedWorkdir) {
      try {
        rmSync(workdir, { recursive: true, force: true });
      } catch {
        // Best effort; the OS reaps temp dirs eventually.
      }
    }
  }
}

/**
 * `ModelRouter` subclass serving `opencode_run` candidates through one local
 * subprocess per call. Constructor and routing surface are identical to the
 * base class; only the three send-adjacent methods branch, and only for this
 * provider id. Follows the `FixedNarrationProvider` precedent.
 */
export class OpenCodeRunProvider extends ModelRouter {
  private readonly runBinary: string;
  private readonly runAgent: string;
  private readonly runModel: string;
  private readonly runWorkdir: string | undefined;
  private readonly runKillGraceMs: number;
  private readonly runMaxOutputBytes: number;
  private readonly runMaxMessageBytes: number;
  private readonly runCleanupSession: boolean;
  private readonly runCleanupTimeoutMs: number;
  private readonly runSpawnImpl: SpawnFn;

  constructor(opts?: OpenCodeRunProviderOptions) {
    super(opts);
    const transport = opts?.opencodeRun;
    this.runBinary = transport?.binary ?? OPENCODE_RUN_DEFAULT_BINARY;
    this.runAgent = transport?.agent ?? OPENCODE_RUN_DEFAULT_AGENT;
    this.runModel = transport?.model ?? OPENCODE_RUN_DEFAULT_MODEL;
    this.runWorkdir = transport?.workdir;
    this.runKillGraceMs = transport?.killGraceMs ?? OPENCODE_RUN_KILL_GRACE_MS;
    this.runMaxOutputBytes = transport?.maxOutputBytes ?? OPENCODE_RUN_MAX_OUTPUT_BYTES;
    this.runMaxMessageBytes = transport?.maxMessageBytes ?? OPENCODE_RUN_MAX_MESSAGE_BYTES;
    this.runCleanupSession = transport?.cleanupSession ?? true;
    this.runCleanupTimeoutMs = transport?.cleanupTimeoutMs ?? OPENCODE_RUN_CLEANUP_TIMEOUT_MS;
    this.runSpawnImpl = transport?.spawnImpl ?? spawnChildProcess;
  }

  /**
   * Keyless by design: availability is proven per call (a missing binary
   * fails fast as a transport error), so readiness probes exercise the real
   * path instead of short-circuiting on configuration.
   */
  override hasProviderKey(provider: ProviderId): boolean {
    if (provider === OPENCODE_RUN_PROVIDER_ID) return true;
    return super.hasProviderKey(provider);
  }

  override async chatCandidate(
    category: Category,
    candidate: RouteCandidate,
    messages: readonly ChatMessage[],
    opts?: ChatCandidateOptions,
  ): Promise<ChatResult> {
    if (candidate.provider !== OPENCODE_RUN_PROVIDER_ID) {
      return super.chatCandidate(category, candidate, messages, opts);
    }
    const timeoutMs = opts?.timeoutMs ?? LLM_CONFIG.routes[category]?.timeoutMs ?? this.timeoutSeconds * 1000;
    const result = await runOpencodeChat({
      binary: this.runBinary,
      agent: this.runAgent,
      model: candidate.model,
      messages,
      category,
      timeoutMs,
      killGraceMs: this.runKillGraceMs,
      ...(this.runWorkdir !== undefined ? { workdir: this.runWorkdir } : {}),
      maxMessageBytes: this.runMaxMessageBytes,
      maxOutputBytes: this.runMaxOutputBytes,
      cleanupSession: this.runCleanupSession,
      cleanupTimeoutMs: this.runCleanupTimeoutMs,
      spawnImpl: this.runSpawnImpl,
    });
    return {
      model: candidate.model,
      configuredModel: candidate.model,
      configuredProvider: candidate.provider,
      responseModel: candidate.model,
      usedFallback: false,
      text: result.text,
      latencyMs: result.latencyMs,
      usage: result.usage,
      provider: candidate.provider,
      tier: candidate.tier,
    };
  }

  override async chatOnce(
    model: string,
    messages: readonly ChatMessage[],
    opts: { provider?: ProviderId; maxTokens?: number; timeoutMs?: number; category?: Category } = {},
  ): Promise<{ text: string; responseModel: string; latencyMs: number; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    if (opts.provider !== OPENCODE_RUN_PROVIDER_ID && model !== this.runModel) {
      return super.chatOnce(model, messages, opts);
    }
    const result = await runOpencodeChat({
      binary: this.runBinary,
      agent: this.runAgent,
      model,
      messages,
      category: opts.category ?? "narrate",
      timeoutMs: opts.timeoutMs ?? this.timeoutSeconds * 1000,
      killGraceMs: this.runKillGraceMs,
      ...(this.runWorkdir !== undefined ? { workdir: this.runWorkdir } : {}),
      maxMessageBytes: this.runMaxMessageBytes,
      maxOutputBytes: this.runMaxOutputBytes,
      cleanupSession: this.runCleanupSession,
      cleanupTimeoutMs: this.runCleanupTimeoutMs,
      spawnImpl: this.runSpawnImpl,
    });
    return { text: result.text, responseModel: model, latencyMs: result.latencyMs, usage: result.usage };
  }
}
