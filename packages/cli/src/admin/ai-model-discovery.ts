/**
 * Daily, bounded screening for OpenCode's explicitly zero-price chat models.
 * The public catalog is metadata only; inference goes through the official
 * OpenCode CLI so free-tier client restrictions are respected.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnvFile } from "../../deploy/env-policy.js";
import {
  fetchOpenCodeCatalog,
  OPENCODE_PREFERRED_MODELS,
  ProviderRequestError,
  type OpenCodeCatalogModel,
  type OpenCodeCatalogReport,
} from "@skald/world";
import { applyServiceEnv } from "../acceptance/service-env.js";
import {
  OPENCODE_RUN_DEFAULT_AGENT,
  OPENCODE_RUN_DEFAULT_BINARY,
  OPENCODE_RUN_KILL_GRACE_MS,
  OPENCODE_RUN_MAX_MESSAGE_BYTES,
  OPENCODE_RUN_MAX_OUTPUT_BYTES,
  OPENCODE_RUN_CLEANUP_TIMEOUT_MS,
  isOpenCodeRunEnabled,
  loadAgentManifestSnapshot,
  runOpencodeChat,
  sanitizeEnv,
} from "../runtime/opencode-run-provider.js";

export const AI_DISCOVERY_SCHEMA = "SKALD_AI_MODEL_DISCOVERY_V1" as const;
export const AI_DISCOVERY_MAX_CONCURRENCY = 2;
export const AI_DISCOVERY_MAX_CANDIDATES = 24;
export const AI_DISCOVERY_PROBE_TIMEOUT_MS = 25_000;
export const AI_DISCOVERY_MAX_RETRIES_PER_PROBE = 1;
export const AI_DISCOVERY_MAX_RETRY_DELAY_MS = 5_000;
export const AI_DISCOVERY_MAX_CALLS = AI_DISCOVERY_MAX_CANDIDATES * 2 * (1 + AI_DISCOVERY_MAX_RETRIES_PER_PROBE);
export const AI_DISCOVERY_MAX_DURATION_MS = 12 * 60_000;
export const AI_DISCOVERY_DIR_ENV = "SKALD_AI_DISCOVERY_DIR";
export const AI_DISCOVERY_ENV_FILE_ENV = "SKALD_ENV_FILE";
export const AI_DISCOVERY_REGION_ENV = "SKALD_OPENCODE_REGION";
export const AI_DISCOVERY_DEFAULT_REGION = "RU";
const KNOWN_REGION_RESTRICTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "inkling-2-small-free": Object.freeze(["RU"]),
  "beam-free": Object.freeze(["RU"]),
});
const DISCOVERY_ENV_KEYS = [
  "OPENCODE_API_KEY",
  "SKALD_OPENCODE_ZEN_API_KEY",
  "SKALD_OPENCODE_RUN",
  "SKALD_OPENCODE_BIN",
  "SKALD_OPENCODE_RUN_AGENT",
  "SKALD_OPENCODE_AGENT_MANIFEST",
  AI_DISCOVERY_REGION_ENV,
] as const;

const INTERPRET_PROBE_MESSAGES = Object.freeze([
  { role: "system" as const, content: "Skald operational probe. Return only JSON with schemaVersion 1 and probe true." },
  { role: "user" as const, content: "Return exactly {\"schemaVersion\":1,\"probe\":true}." },
]);
const NARRATE_PROBE_MESSAGES = Object.freeze([
  { role: "system" as const, content: "Skald operational screening. Write one short neutral Russian sentence using only the provided observations. Do not add actions, speech, emotion, intent, cause, or hidden facts. Return prose only." },
  { role: "user" as const, content: "Observed facts: Лада стоит у стойки. На стойке лежит серебряный ключ. Дверь за стойкой закрыта. Nothing else is known. Describe only these facts in one short Russian sentence." },
]);

export type NativeProbeStatus = "ok" | "marker_mismatch" | "provider_error" | "not_run";

export interface NativeProbeResult {
  readonly status: NativeProbeStatus;
  readonly latencyMs?: number;
  readonly reason?: "timeout_or_process_failure" | "schema_mismatch" | "marker_mismatch" | "grounding_mismatch" | "circuit_breaker" | "candidate_budget" | "run_time_budget" | "provider_auth" | "provider_quota" | "rate_limited" | "model_unavailable" | "provider_error";
  readonly httpStatus?: number;
  readonly providerCode?: string;
  readonly retryAfterMs?: number;
}

export interface ScreenedOpenCodeModel {
  readonly id: string;
  readonly model: string;
  readonly name?: string;
  readonly preferred: boolean;
  readonly textInputPrice: number;
  readonly textOutputPrice: number;
  readonly transport: "opencode_cli";
  readonly interpret: NativeProbeResult;
  readonly narrate: NativeProbeResult;
  readonly screening: "pass" | "fail" | "not_run";
  readonly taskEvaluation: "not_run";
  readonly activation: "not_approved";
}

export interface OpenCodeDiscoveryReport {
  readonly schema: typeof AI_DISCOVERY_SCHEMA;
  readonly status: "complete" | "partial" | "blocked" | "failed";
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly source: {
    readonly url?: string;
    readonly catalogFetchedAt?: string;
    readonly catalogDigest?: string;
    readonly region: string;
    readonly catalogModelCount: number;
    readonly freeChatCount: number;
  };
  readonly policy: {
    readonly maxConcurrency: number;
    readonly maxCandidates: number;
    readonly maxCalls: number;
    readonly timeoutMs: number;
    readonly maxDurationMs: number;
    readonly transport: "opencode_cli";
  };
  readonly providerCallCount: number;
  readonly circuitBreaker?: "credential_missing" | "native_transport_disabled" | "provider_auth_failure" | "provider_quota_exhausted" | "provider_rate_limited" | "provider_transport_error";
  readonly failureReason?: "environment_invalid" | "catalog_failed" | "screening_failed";
  readonly catalogSnapshot?: readonly DiscoveryCatalogEntry[];
  readonly changes?: DiscoveryChangeSummary;
  readonly candidates: readonly ScreenedOpenCodeModel[];
  readonly exclusions: readonly { readonly id: string; readonly reason: "unsupported_type" | "unsupported_modality" | "unsupported_api" | "price_unknown" | "not_free" | "transport_restriction" | "region_restriction" | "candidate_budget" }[];
}

export interface DiscoveryCatalogEntry {
  readonly id: string;
  readonly type: string | null;
  readonly inputModalities: readonly string[];
  readonly outputModalities: readonly string[];
  readonly apiFamilies: readonly string[];
  readonly textInputPrice: number | null;
  readonly textOutputPrice: number | null;
  readonly hasConditionalTextPricing: boolean;
  readonly eligibility: "eligible" | "excluded";
  readonly exclusionReason?: OpenCodeDiscoveryReport["exclusions"][number]["reason"];
  readonly transport: OpenCodeCatalogModel["clientRestriction"];
}

export interface DiscoveryPriceChange {
  readonly id: string;
  readonly previous: { readonly input: number | null; readonly output: number | null };
  readonly current: { readonly input: number | null; readonly output: number | null };
}

export interface DiscoveryChangeSummary {
  readonly comparison: "baseline" | "compared" | "unavailable";
  readonly baselineRunId: string | null;
  readonly previousCatalogDigest?: string;
  readonly currentCatalogDigest?: string;
  readonly observedModelIds: readonly string[];
  readonly newModelIds: readonly string[];
  readonly removedModelIds: readonly string[];
  readonly priceChanged: readonly DiscoveryPriceChange[];
  readonly eligibilityChanged: readonly { readonly id: string; readonly previous: boolean; readonly current: boolean }[];
  readonly screeningChanged: readonly { readonly id: string; readonly previous: "pass" | "fail" | "not_run"; readonly current: "pass" | "fail" | "not_run" }[];
  readonly testedModelIds: readonly string[];
  readonly rejectedModelIds: readonly string[];
  readonly servingRouteChanged: false;
}

export interface OpenCodeDiscoveryOptions {
  readonly catalog?: OpenCodeCatalogReport;
  readonly fetchImpl?: typeof fetch;
  readonly probe?: (model: string, category: "interpret" | "narrate", timeoutMs: number) => Promise<{ readonly text: string; readonly latencyMs: number }>;
  readonly env?: NodeJS.ProcessEnv;
  readonly preferredModels?: readonly string[];
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly maxCandidates?: number;
  readonly maxDurationMs?: number;
  readonly sleepImpl?: (ms: number) => Promise<void>;
  readonly monotonicNow?: () => number;
}

interface SafeProbeFailure {
  readonly httpStatus?: number;
  readonly providerCode?: string;
  readonly retryAfterMs?: number;
}

function safeProbeFailure(error: unknown): SafeProbeFailure {
  if (error instanceof ProviderRequestError) {
    return {
      ...(error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}),
      ...(error.providerCode ? { providerCode: error.providerCode } : {}),
      ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
    };
  }
  if (error !== null && typeof error === "object") {
    const candidate = error as { httpStatus?: unknown; providerCode?: unknown; retryAfterMs?: unknown };
    return {
      ...(typeof candidate.httpStatus === "number" && Number.isInteger(candidate.httpStatus) ? { httpStatus: candidate.httpStatus } : {}),
      ...(typeof candidate.providerCode === "string" && /^[A-Za-z0-9_.:-]{1,80}$/u.test(candidate.providerCode) ? { providerCode: candidate.providerCode } : {}),
      ...(typeof candidate.retryAfterMs === "number" && Number.isFinite(candidate.retryAfterMs) ? { retryAfterMs: Math.max(0, Math.min(60_000, Math.floor(candidate.retryAfterMs))) } : {}),
    };
  }
  return {};
}

function retryDelayMs(failure: SafeProbeFailure): number {
  const requested = failure.retryAfterMs ?? 1_000;
  return Math.max(100, Math.min(AI_DISCOVERY_MAX_RETRY_DELAY_MS, Math.floor(requested)));
}

function metadataCandidates(catalog: OpenCodeCatalogReport, preferredModels: readonly string[]): OpenCodeCatalogModel[] {
  const free = (catalog.models ?? []).filter((model) => model.type === "chat"
    && model.inputModalities.includes("text")
    && model.outputModalities.includes("text")
    && model.apiFamilies.includes("chat-completions")
    && model.zeroPriceTextChat === true
    && model.clientRestriction === "opencode_cli");
  const order = new Map(preferredModels.map((model, index) => [model, index]));
  return free.sort((a, b) => {
    const rankA = order.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rankB = order.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return rankA - rankB || a.id.localeCompare(b.id);
  });
}

/** Whether OpenCode's published regional restrictions allow this catalogue ID. */
export function isOpenCodeModelAvailableInRegion(modelId: string, region: string): boolean {
  return !(KNOWN_REGION_RESTRICTIONS[modelId] ?? []).includes(region.trim().toUpperCase());
}

function exclusionFor(model: OpenCodeCatalogModel, region: string): OpenCodeDiscoveryReport["exclusions"][number]["reason"] | undefined {
  if (model.type !== "chat") return "unsupported_type";
  if (!model.inputModalities.includes("text") || !model.outputModalities.includes("text")) return "unsupported_modality";
  if (!model.apiFamilies.includes("chat-completions")) return "unsupported_api";
  if (model.textInputPrice === null || model.textOutputPrice === null || model.zeroPriceTextChat === null || model.hasConditionalTextPricing) return "price_unknown";
  if (model.textInputPrice !== 0 || model.textOutputPrice !== 0) return "not_free";
  if (model.clientRestriction !== "opencode_cli") return "transport_restriction";
  if (!isOpenCodeModelAvailableInRegion(model.id, region)) return "region_restriction";
  return undefined;
}

function makeCatalogSnapshot(catalog: OpenCodeCatalogReport, region: string): readonly DiscoveryCatalogEntry[] {
  return Object.freeze((catalog.models ?? []).map((model) => {
    const exclusionReason = exclusionFor(model, region);
    return Object.freeze({
      id: model.id,
      type: model.type,
      inputModalities: Object.freeze([...model.inputModalities]),
      outputModalities: Object.freeze([...model.outputModalities]),
      apiFamilies: Object.freeze([...model.apiFamilies]),
      textInputPrice: model.textInputPrice,
      textOutputPrice: model.textOutputPrice,
      hasConditionalTextPricing: model.hasConditionalTextPricing,
      eligibility: exclusionReason ? "excluded" as const : "eligible" as const,
      ...(exclusionReason ? { exclusionReason } : {}),
      transport: model.clientRestriction,
    });
  }));
}

function recordMap(value: unknown, key: string): Map<string, Record<string, unknown>> {
  if (!isDiscoveryRecord(value) || !Array.isArray(value[key])) return new Map();
  const entries = value[key] as unknown[];
  return new Map(entries.filter(isDiscoveryRecord).filter((entry) => typeof entry.id === "string").map((entry) => [entry.id as string, entry]));
}

function isDiscoveryRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Attach a sanitized day-over-day delta; it never selects or changes a route. */
export function withDiscoveryChanges(
  report: OpenCodeDiscoveryReport,
  previous?: { readonly runId: string; readonly report: unknown },
): OpenCodeDiscoveryReport {
  const current = report.catalogSnapshot ?? [];
  if (report.status === "failed" || !report.source.catalogDigest || current.length === 0) {
    return {
      ...report,
      changes: {
        comparison: "unavailable",
        baselineRunId: previous?.runId ?? null,
        observedModelIds: Object.freeze(current.map((entry) => entry.id)),
        newModelIds: Object.freeze([]),
        removedModelIds: Object.freeze([]),
        priceChanged: Object.freeze([]),
        eligibilityChanged: Object.freeze([]),
        screeningChanged: Object.freeze([]),
        testedModelIds: Object.freeze([]),
        rejectedModelIds: Object.freeze([]),
        servingRouteChanged: false,
      },
    };
  }
  const currentById = new Map(current.map((entry) => [entry.id, entry]));
  const previousCatalog = recordMap(previous?.report, "catalogSnapshot");
  const previousCandidates = recordMap(previous?.report, "candidates");
  const baselineAvailable = previous !== undefined && previousCatalog.size > 0;
  const newModelIds = baselineAvailable
    ? [...currentById.keys()].filter((id) => !previousCatalog.has(id)).sort()
    : [];
  const removedModelIds = baselineAvailable
    ? [...previousCatalog.keys()].filter((id) => !currentById.has(id)).sort()
    : [];
  const priceChanged: DiscoveryPriceChange[] = [];
  const eligibilityChanged: DiscoveryChangeSummary["eligibilityChanged"][number][] = [];
  if (baselineAvailable) {
    for (const [id, entry] of currentById) {
      const prior = previousCatalog.get(id);
      if (!prior) continue;
      const oldInput = typeof prior.textInputPrice === "number" ? prior.textInputPrice : null;
      const oldOutput = typeof prior.textOutputPrice === "number" ? prior.textOutputPrice : null;
      if (oldInput !== entry.textInputPrice || oldOutput !== entry.textOutputPrice) {
        priceChanged.push({ id, previous: { input: oldInput, output: oldOutput }, current: { input: entry.textInputPrice, output: entry.textOutputPrice } });
      }
      if (typeof prior.eligibility === "string") {
        const oldEligible = prior.eligibility === "eligible";
        const newEligible = entry.eligibility === "eligible";
        if (oldEligible !== newEligible) eligibilityChanged.push({ id, previous: oldEligible, current: newEligible });
      }
    }
  }
  const currentCandidates = report.candidates;
  const screeningChanged: DiscoveryChangeSummary["screeningChanged"][number][] = [];
  if (baselineAvailable) {
    for (const candidate of currentCandidates) {
      const prior = previousCandidates.get(candidate.id);
      if (!prior || (prior.screening !== "pass" && prior.screening !== "fail" && prior.screening !== "not_run")) continue;
      if (prior.screening !== candidate.screening) {
        screeningChanged.push({ id: candidate.id, previous: prior.screening, current: candidate.screening });
      }
    }
  }
  return {
    ...report,
    changes: {
      comparison: baselineAvailable ? "compared" : "baseline",
      baselineRunId: previous?.runId ?? null,
      ...(previous?.report && isDiscoveryRecord(previous.report) && typeof previous.report.source === "object"
        && previous.report.source !== null && typeof (previous.report.source as Record<string, unknown>).catalogDigest === "string"
        ? { previousCatalogDigest: (previous.report.source as Record<string, string>).catalogDigest }
        : {}),
      currentCatalogDigest: report.source.catalogDigest,
      observedModelIds: Object.freeze([...currentById.keys()].sort()),
      newModelIds: Object.freeze(newModelIds),
      removedModelIds: Object.freeze(removedModelIds),
      priceChanged: Object.freeze(priceChanged),
      eligibilityChanged: Object.freeze(eligibilityChanged),
      screeningChanged: Object.freeze(screeningChanged),
      testedModelIds: Object.freeze(currentCandidates.filter((candidate) => candidate.interpret.status !== "not_run" || candidate.narrate.status !== "not_run").map((candidate) => candidate.id).sort()),
      rejectedModelIds: Object.freeze(currentCandidates.filter((candidate) => candidate.screening === "fail").map((candidate) => candidate.id).sort()),
      servingRouteChanged: false,
    },
  };
}

function validInterpret(text: string): boolean {
  try {
    const parsed = JSON.parse(text.trim()) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const fields = parsed as Record<string, unknown>;
    return Object.keys(fields).length === 2 && fields.schemaVersion === 1 && fields.probe === true;
  } catch {
    return false;
  }
}

function validNarrate(text: string): boolean {
  const normalized = text.toLowerCase().replace(/ё/gu, "е");
  const letters = normalized.match(/\p{L}/gu) ?? [];
  const russianLetters = normalized.match(/[а-я]/gu) ?? [];
  if (letters.length < 15 || letters.length > 400 || russianLetters.length / letters.length < 0.65) return false;
  const required = ["лад", "стойк", "ключ", "двер", "закрыт"];
  if (required.some((stem) => !normalized.includes(stem))) return false;
  const unsupported = ["взя", "откры", "вош", "сказ", "улыб", "испуг", "ждал", "позвал", "пошел", "зашел"];
  if (unsupported.some((stem) => normalized.includes(stem))) return false;
  if (/\b(?:person|object|route|location)[_-][a-z0-9_-]+\b|\b(?:targetRef|locationId|internalId)\b/iu.test(text)) return false;
  return true;
}

async function nativeProbe(model: string, category: "interpret" | "narrate", timeoutMs: number, env: NodeJS.ProcessEnv): Promise<{ text: string; latencyMs: number }> {
  const binary = env.SKALD_OPENCODE_BIN ?? OPENCODE_RUN_DEFAULT_BINARY;
  const agent = env.SKALD_OPENCODE_RUN_AGENT ?? OPENCODE_RUN_DEFAULT_AGENT;
  const manifestPath = env.SKALD_OPENCODE_AGENT_MANIFEST ?? "packages/cli/deploy/opencode-narrative-agent.md";
  const manifest = loadAgentManifestSnapshot(manifestPath);
  if (!manifest) throw new Error("agent manifest unavailable");
  const messages = category === "interpret" ? INTERPRET_PROBE_MESSAGES : NARRATE_PROBE_MESSAGES;
  const result = await runOpencodeChat({
    binary,
    agent,
    model: `opencode/${model}`,
    messages,
    category,
    timeoutMs,
    killGraceMs: OPENCODE_RUN_KILL_GRACE_MS,
    isolateHome: true,
    agentManifest: manifest.content,
    maxMessageBytes: OPENCODE_RUN_MAX_MESSAGE_BYTES,
    maxOutputBytes: OPENCODE_RUN_MAX_OUTPUT_BYTES,
    cleanupSession: true,
    cleanupTimeoutMs: OPENCODE_RUN_CLEANUP_TIMEOUT_MS,
    env: sanitizeEnv(env),
  });
  return { text: result.text, latencyMs: result.latencyMs };
}

/**
 * Fetch or accept a catalogue snapshot and run no-world marker probes under a
 * strict per-run budget. It never approves a model for player traffic.
 */
export async function screenOpenCodeFreeModels(options: OpenCodeDiscoveryOptions = {}): Promise<OpenCodeDiscoveryReport> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const env = options.env ?? process.env;
  const rawRegion = env[AI_DISCOVERY_REGION_ENV] ?? AI_DISCOVERY_DEFAULT_REGION;
  const region = /^[A-Za-z]{2}$/u.test(rawRegion.trim()) ? rawRegion.trim().toUpperCase() : AI_DISCOVERY_DEFAULT_REGION;
  const requestedTimeout = Math.floor(options.timeoutMs ?? AI_DISCOVERY_PROBE_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(requestedTimeout) ? Math.max(1_000, Math.min(60_000, requestedTimeout)) : AI_DISCOVERY_PROBE_TIMEOUT_MS;
  const requestedCandidates = Math.floor(options.maxCandidates ?? AI_DISCOVERY_MAX_CANDIDATES);
  const maxCandidates = Number.isFinite(requestedCandidates) ? Math.max(1, Math.min(AI_DISCOVERY_MAX_CANDIDATES, requestedCandidates)) : AI_DISCOVERY_MAX_CANDIDATES;
  const maxCalls = maxCandidates * 2 * (1 + AI_DISCOVERY_MAX_RETRIES_PER_PROBE);
  const requestedDuration = Math.floor(options.maxDurationMs ?? AI_DISCOVERY_MAX_DURATION_MS);
  const maxDurationMs = Number.isFinite(requestedDuration) ? Math.max(1_000, Math.min(20 * 60_000, requestedDuration)) : AI_DISCOVERY_MAX_DURATION_MS;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const deadline = monotonicNow() + maxDurationMs;
  const catalog = options.catalog ?? await fetchOpenCodeCatalog({ ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  const metadata = catalog.status === "ok"
    ? metadataCandidates(catalog, options.preferredModels ?? OPENCODE_PREFERRED_MODELS)
      .filter((model) => isOpenCodeModelAvailableInRegion(model.id, region))
    : [];
  const selected = metadata.slice(0, maxCandidates);
  const truncated = metadata.slice(maxCandidates);
  const candidates: ScreenedOpenCodeModel[] = [];
  let circuitBreaker: OpenCodeDiscoveryReport["circuitBreaker"];
  let providerCallCount = 0;

  if (catalog.status !== "ok") {
    return {
      schema: AI_DISCOVERY_SCHEMA,
      status: "failed",
      startedAt,
      finishedAt: now().toISOString(),
      source: { ...(catalog.sourceUrl ? { url: catalog.sourceUrl } : {}), ...(catalog.fetchedAt ? { catalogFetchedAt: catalog.fetchedAt } : {}), ...(catalog.catalogDigest ? { catalogDigest: catalog.catalogDigest } : {}), region, catalogModelCount: catalog.modelIds.length, freeChatCount: catalog.eligibleFreeChatIds?.length ?? 0 },
      policy: { maxConcurrency: AI_DISCOVERY_MAX_CONCURRENCY, maxCandidates, maxCalls, timeoutMs, maxDurationMs, transport: "opencode_cli" },
      providerCallCount: 0,
      candidates: [],
      exclusions: [],
      catalogSnapshot: makeCatalogSnapshot(catalog, region),
      failureReason: "catalog_failed",
    };
  }

  if (!isOpenCodeRunEnabled(env)) circuitBreaker = "native_transport_disabled";
  else if (!(env.OPENCODE_API_KEY || env.SKALD_OPENCODE_ZEN_API_KEY)) circuitBreaker = "credential_missing";

  const probe = options.probe ?? ((model: string, category: "interpret" | "narrate", ms: number) => nativeProbe(model, category, ms, env));
  const sleep = options.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const cleanupHeadroomMs = OPENCODE_RUN_KILL_GRACE_MS + OPENCODE_RUN_CLEANUP_TIMEOUT_MS;
  let next = 0;
  let runtimeBudgetExhausted = false;
  const work = async (): Promise<void> => {
    while (next < selected.length) {
      const index = next++;
      const info = selected[index]!;
      const base = {
        id: info.id,
        model: `opencode/${info.id}`,
        ...(info.name ? { name: info.name } : {}),
        preferred: (options.preferredModels ?? OPENCODE_PREFERRED_MODELS).includes(info.id),
        textInputPrice: info.textInputPrice!,
        textOutputPrice: info.textOutputPrice!,
        transport: "opencode_cli" as const,
      };
      if (circuitBreaker) {
        candidates[index] = { ...base, interpret: { status: "not_run", reason: "circuit_breaker" }, narrate: { status: "not_run", reason: "circuit_breaker" }, screening: "not_run", taskEvaluation: "not_run", activation: "not_approved" };
        continue;
      }
      if (monotonicNow() >= deadline) {
        runtimeBudgetExhausted = true;
        candidates[index] = { ...base, interpret: { status: "not_run", reason: "run_time_budget" }, narrate: { status: "not_run", reason: "run_time_budget" }, screening: "not_run", taskEvaluation: "not_run", activation: "not_approved" };
        continue;
      }
      const run = async (category: "interpret" | "narrate"): Promise<NativeProbeResult> => {
        let retryCount = 0;
        while (true) {
          if (circuitBreaker) return { status: "not_run", reason: "circuit_breaker" };
          if (providerCallCount >= maxCalls) return { status: "not_run", reason: "candidate_budget" };
          const remainingMs = deadline - monotonicNow();
          const callBudgetMs = remainingMs - cleanupHeadroomMs;
          if (callBudgetMs < 1_000) {
            runtimeBudgetExhausted = true;
            return { status: "not_run", reason: "run_time_budget" };
          }
          providerCallCount += 1;
          try {
            const result = await probe(info.id, category, Math.min(timeoutMs, Math.floor(callBudgetMs)));
            const valid = category === "interpret" ? validInterpret(result.text) : validNarrate(result.text);
            const reason = category === "interpret" ? "schema_mismatch" as const : "grounding_mismatch" as const;
            return { status: valid ? "ok" : "marker_mismatch", latencyMs: Math.max(0, Math.round(result.latencyMs)), ...(!valid ? { reason } : {}) };
          } catch (error) {
            const failure = safeProbeFailure(error);
            const status = failure.httpStatus;
            if (status === 429 && retryCount < AI_DISCOVERY_MAX_RETRIES_PER_PROBE) {
              retryCount += 1;
              await sleep(retryDelayMs(failure));
              continue;
            }
            if (status === 401 || status === 403) circuitBreaker = "provider_auth_failure";
            else if (status === 402) circuitBreaker = "provider_quota_exhausted";
            else if (status === 429) circuitBreaker = "provider_rate_limited";
            else if (status === undefined || status >= 500) circuitBreaker = "provider_transport_error";
            const reason = status === 401 || status === 403 ? "provider_auth" as const
              : status === 402 ? "provider_quota" as const
                : status === 429 ? "rate_limited" as const
                  : status === 400 || status === 404 ? "model_unavailable" as const
                    : "timeout_or_process_failure" as const;
            return {
              status: "provider_error",
              reason,
              ...(failure.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
              ...(failure.providerCode ? { providerCode: failure.providerCode } : {}),
              ...(failure.retryAfterMs !== undefined ? { retryAfterMs: failure.retryAfterMs } : {}),
            };
          }
        }
      };
      const interpret = await run("interpret");
      const narrate = circuitBreaker || interpret.reason === "model_unavailable" || interpret.reason === "run_time_budget"
        ? { status: "not_run" as const, reason: circuitBreaker ? "circuit_breaker" as const : interpret.reason as "model_unavailable" | "run_time_budget" }
        : await run("narrate");
      const results = [interpret, narrate];
      const candidateFailure = results.some((result) => result.status === "marker_mismatch" || result.reason === "model_unavailable");
      const providerIncomplete = results.some((result) => result.status === "provider_error" || result.status === "not_run");
      const screening = candidateFailure ? "fail" : providerIncomplete ? "not_run" : "pass";
      candidates[index] = { ...base, interpret, narrate, screening, taskEvaluation: "not_run", activation: "not_approved" };
    }
  };
  await Promise.all(Array.from({ length: Math.min(AI_DISCOVERY_MAX_CONCURRENCY, selected.length) }, () => work()));
  for (const info of truncated) {
    candidates.push({
      id: info.id,
      model: `opencode/${info.id}`,
      ...(info.name ? { name: info.name } : {}),
      preferred: (options.preferredModels ?? OPENCODE_PREFERRED_MODELS).includes(info.id),
      textInputPrice: info.textInputPrice!,
      textOutputPrice: info.textOutputPrice!,
      transport: "opencode_cli",
      interpret: { status: "not_run", reason: "candidate_budget" },
      narrate: { status: "not_run", reason: "candidate_budget" },
      screening: "not_run",
      taskEvaluation: "not_run",
      activation: "not_approved",
    });
  }
  const status = circuitBreaker === "native_transport_disabled" || circuitBreaker === "credential_missing"
    ? "blocked"
    : circuitBreaker || truncated.length > 0 || runtimeBudgetExhausted ? "partial" : "complete";
  return {
    schema: AI_DISCOVERY_SCHEMA,
    status,
    startedAt,
    finishedAt: now().toISOString(),
    source: { ...(catalog.sourceUrl ? { url: catalog.sourceUrl } : {}), ...(catalog.fetchedAt ? { catalogFetchedAt: catalog.fetchedAt } : {}), ...(catalog.catalogDigest ? { catalogDigest: catalog.catalogDigest } : {}), region, catalogModelCount: catalog.modelIds.length, freeChatCount: catalog.eligibleFreeChatIds?.length ?? 0 },
    policy: { maxConcurrency: AI_DISCOVERY_MAX_CONCURRENCY, maxCandidates, maxCalls, timeoutMs, maxDurationMs, transport: "opencode_cli" },
    providerCallCount,
    ...(circuitBreaker ? { circuitBreaker } : {}),
    candidates: Object.freeze(candidates),
    catalogSnapshot: makeCatalogSnapshot(catalog, region),
    exclusions: Object.freeze([
      ...(catalog.models ?? []).flatMap((model) => {
        const reason = exclusionFor(model, region);
        return reason ? [{ id: model.id, reason }] : [];
      }),
      ...truncated.map((model) => ({ id: model.id, reason: "candidate_budget" as const })),
    ]),
  };
}

/** Stable digest for sanitized discovery evidence; volatile timestamps are excluded. */
export function discoveryEvidenceDigest(report: OpenCodeDiscoveryReport): string {
  const { startedAt: _startedAt, finishedAt: _finishedAt, ...stable } = report;
  return createHash("sha256").update(JSON.stringify(stable), "utf8").digest("hex");
}

/** Apply a systemd EnvironmentFile using the same parser as deployment gates. */
export function loadDiscoveryServiceEnvironment(env: NodeJS.ProcessEnv = process.env): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const path = env[AI_DISCOVERY_ENV_FILE_ENV];
  if (!path) return { ok: true };
  let content: string;
  try { content = requireServiceEnvText(path); } catch { return { ok: false, reason: "env_file_unreadable" }; }
  const parsed = parseEnvFile(content);
  if (parsed.malformed) return { ok: false, reason: "env_file_malformed" };
  if (parsed.duplicates.length > 0) return { ok: false, reason: "env_file_duplicate_keys" };
  // This function receives a private per-run environment copy. The current
  // EnvironmentFile is authoritative for that run, so remove its keys first
  // and then reuse the strict parser. This lets a loopback manual refresh see
  // an atomically rotated or removed key without restarting the game server.
  // The EnvironmentFile is authoritative even when a credential, opt-in or
  // CLI override was removed. systemd's already-running process otherwise
  // keeps the old value when the new file no longer contains that variable.
  for (const key of DISCOVERY_ENV_KEYS) delete env[key];
  for (const key of parsed.vars.keys()) delete env[key];
  return applyServiceEnv(env, content);
}

function requireServiceEnvText(path: string): string {
  // Kept behind a function for the environment loader test seam.
  return readFileSync(path, "utf8");
}

/** Sanitized identity of the source checkout for operational evidence. */
export function readDiscoveryCommit(cwd = process.cwd()): string | null {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null; } catch { return null; }
}
