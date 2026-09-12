import { createHash } from "node:crypto";
import { LLM_CONFIG, OLLAMA_CLOUD_BACKUP_MODEL, OPENCODE_PREFERRED_MODELS, OPENROUTER_PREFERRED_MODELS, openCodeProtocolForModel } from "./config.js";
import { chatOnce, readProviderErrorCode } from "./http.js";
import { isProviderScopedFailure, toProviderFailure } from "./errors.js";
import type { ChatMessage, ProviderId, ProviderPhase, ProviderProtocol, RouteCandidate } from "./types.js";

const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1";
const CATALOG_TIMEOUT_MS = 10_000;
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,159}$/;

const INTERPRET_MESSAGES: readonly ChatMessage[] = Object.freeze([
  { role: "system", content: "Skald readiness probe. Return only JSON with schemaVersion 1 and probe true." },
  { role: "user", content: "Return exactly {\"schemaVersion\":1,\"probe\":true}." },
]);

const NARRATE_MESSAGES: readonly ChatMessage[] = Object.freeze([
  { role: "system", content: "Skald readiness probe. Return only the marker and no other text." },
  { role: "user", content: "Return exactly SKALD_PROBE_OK." },
]);

export type OpenCodeCatalogStatus = "ok" | "auth_failure" | "unavailable" | "failed";
export type CatalogPhase = "configuration" | "request" | "response_status" | "response_decode" | "response_shape";

export interface OpenCodeCatalogReport {
  readonly provider: "opencode_zen";
  readonly status: OpenCodeCatalogStatus;
  readonly phase: CatalogPhase;
  readonly modelIds: readonly string[];
  readonly httpStatus?: number;
  readonly providerCode?: string;
}

export type CandidateProbeStatus = "ok" | "auth_failure" | "model_unavailable" | "failed" | "not_run";

export interface CandidateProbeResult {
  readonly status: CandidateProbeStatus;
  readonly phase: ProviderPhase | CatalogPhase;
  readonly httpStatus?: number;
  readonly providerCode?: string;
  readonly responseModel?: string;
}

export type ModelExclusionReason =
  | "not_in_catalog"
  | "catalog_auth_failure"
  | "catalog_unavailable"
  | "missing_credential"
  | "auth_failure"
  | "model_unavailable"
  | "quota_exceeded"
  | "interpret_probe_failed"
  | "narrate_probe_failed";

export interface ModelCandidateReport {
  readonly model: string;
  readonly inCatalog: boolean;
  readonly interpret: CandidateProbeResult;
  readonly narrate: CandidateProbeResult;
  readonly active: boolean;
  readonly exclusionReason?: ModelExclusionReason;
}

export interface LiveModelSelectionReport {
  readonly provider: ProviderId;
  readonly status: "ready" | "degraded" | "unavailable" | "misconfigured";
  readonly checkedAt: string;
  readonly durationMs: number;
  /**
   * Zen catalogue snapshot. Present when Zen discovery ran (it always runs
   * first); Ollama-only paths reuse the Zen snapshot for context and gate
   * the operator-pinned model on dual probes instead of catalogue tags,
   * whose cloud names do not match the local tag list reliably.
   */
  readonly catalog?: OpenCodeCatalogReport;
  readonly activeModel?: string;
  readonly backupModel?: string;
  readonly candidates: readonly ModelCandidateReport[];
  readonly excluded: readonly { model: string; reason: ModelExclusionReason }[];
  readonly routes: {
    readonly interpret: readonly RouteCandidate[];
    readonly narrate: readonly RouteCandidate[];
  };
}

export interface OpenCodeCatalogOptions {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface LiveModelSelectionOptions extends OpenCodeCatalogOptions {
  readonly preferredModels?: readonly string[];
  readonly probe?: (category: "interpret" | "narrate", model: string, options: {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly timeoutMs: number;
  }) => Promise<CandidateProbeResult>;
  readonly checkedAt?: () => string;
}

function boundedTimeout(timeoutMs: number | undefined): number {
  return Math.max(1, Math.floor(timeoutMs ?? CATALOG_TIMEOUT_MS));
}

function safeModelId(value: unknown): string | undefined {
  return typeof value === "string" && MODEL_ID_RE.test(value) ? value : undefined;
}

function catalogIds(payload: unknown): readonly string[] {
  const entries = Array.isArray(payload)
    ? payload
    : payload !== null && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  const ids: string[] = [];
  for (const entry of entries) {
    const id = safeModelId(typeof entry === "string" ? entry : entry !== null && typeof entry === "object" ? (entry as { id?: unknown }).id : undefined);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return Object.freeze(ids);
}

/**
 * Fetch the authenticated OpenCode Zen model catalogue. Only model IDs and
 * sanitized status metadata leave this function; response bodies are dropped.
 */
export async function fetchOpenCodeCatalog(options: OpenCodeCatalogOptions = {}): Promise<OpenCodeCatalogReport> {
  const apiKey = options.apiKey ?? "";
  const baseUrl = (options.baseUrl ?? OPENCODE_ZEN_BASE_URL).replace(/\/+$/, "");
  if (!apiKey) return { provider: "opencode_zen", status: "auth_failure", phase: "configuration", modelIds: [] };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedTimeout(options.timeoutMs));
  try {
    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(`${baseUrl}/models`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        signal: controller.signal,
      });
    } catch {
      return { provider: "opencode_zen", status: "unavailable", phase: "request", modelIds: [] };
    }
    if (!response.ok) {
      const providerCode = await readProviderErrorCode(response);
      const status = response.status === 401 || response.status === 403
        ? "auth_failure"
        : response.status === 400 || response.status === 404
          ? "unavailable"
          : "failed";
      return {
        provider: "opencode_zen",
        status,
        phase: "response_status",
        modelIds: [],
        httpStatus: response.status,
        ...(providerCode ? { providerCode } : {}),
      };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { provider: "opencode_zen", status: "failed", phase: "response_decode", modelIds: [] };
    }
    const modelIds = catalogIds(payload);
    if (modelIds.length === 0) return { provider: "opencode_zen", status: "failed", phase: "response_shape", modelIds };
    return { provider: "opencode_zen", status: "ok", phase: "response_shape", modelIds };
  } finally {
    clearTimeout(timeout);
  }
}

function probeText(category: "interpret" | "narrate", text: string): CandidateProbeResult | null {
  if (!text) return { status: "failed", phase: "response_shape" };
  if (category === "narrate") {
    return text === "SKALD_PROBE_OK"
      ? { status: "ok", phase: "response_shape" }
      : { status: "failed", phase: "response_shape" };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    const valid = parsed !== null && typeof parsed === "object"
      && (parsed as Record<string, unknown>).schemaVersion === 1
      && (parsed as Record<string, unknown>).probe === true;
    return valid ? { status: "ok", phase: "schema_validation" } : { status: "failed", phase: "schema_validation" };
  } catch {
    return { status: "failed", phase: "response_decode" };
  }
}

async function probeOpenCodeModel(category: "interpret" | "narrate", model: string, options: { apiKey: string; baseUrl: string; timeoutMs: number; fetchImpl?: typeof fetch }): Promise<CandidateProbeResult> {
  const protocol: ProviderProtocol = openCodeProtocolForModel(model);
  try {
    // Probe budgets must cover reasoning traces: live evidence shows Zen
    // thinking models (effort high) spending a dozen-plus tokens before any
    // content, so terse budgets starve the marker (`incomplete`,
    // `max_output_tokens`) and healthy models look dead.
    const maxTokens = category === "interpret" ? 1024 : 512;
    const result = await chatOnce(options.baseUrl, options.apiKey, model, category === "interpret" ? INTERPRET_MESSAGES : NARRATE_MESSAGES, {
      provider: "opencode_zen",
      protocol,
      category,
      maxTokens,
      timeoutMs: options.timeoutMs,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    const checked = probeText(category, result.text.trim());
    if (!checked) return { status: "failed", phase: "response_shape" };
    if (result.responseModel && result.responseModel !== model) return { status: "failed", phase: "model_selection", responseModel: result.responseModel };
    return { ...checked, ...(result.responseModel ? { responseModel: result.responseModel } : {}) };
  } catch (error) {
    const failure = toProviderFailure(error, { provider: "opencode_zen", model, category });
    if (failure && (isProviderScopedFailure(failure.httpStatus, failure.providerCode) || failure.httpStatus === 400 || failure.httpStatus === 404)) {
      if (failure.httpStatus === 401 || failure.httpStatus === 403) return { status: "auth_failure", phase: failure.phase, httpStatus: failure.httpStatus, ...(failure.providerCode ? { providerCode: failure.providerCode } : {}) };
      if (failure.httpStatus === 400 || failure.httpStatus === 404) return { status: "model_unavailable", phase: failure.phase, httpStatus: failure.httpStatus, ...(failure.providerCode ? { providerCode: failure.providerCode } : {}) };
    }
    return {
      status: "failed",
      phase: failure?.phase ?? "request",
      ...(failure?.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
      ...(failure?.providerCode ? { providerCode: failure.providerCode } : {}),
    };
  }
}

function inactiveProbe(phase: CatalogPhase): CandidateProbeResult {
  return { status: "not_run", phase };
}

function routeForModels(models: readonly string[]): readonly RouteCandidate[] {
  return Object.freeze(models.map((model, index) => ({
    provider: "opencode_zen" as const,
    model,
    protocol: openCodeProtocolForModel(model),
    tier: (index === 0 ? "live_primary" : index === 1 ? "live_backup" : "live_fallback") as RouteCandidate["tier"],
  })));
}

function selectionStatus(catalog: OpenCodeCatalogReport, activeCount: number, candidates: readonly ModelCandidateReport[]): LiveModelSelectionReport["status"] {
  if (catalog.status === "auth_failure") return "misconfigured";
  if (catalog.status !== "ok") return "unavailable";
  if (activeCount >= 2) return "ready";
  if (activeCount === 1) return "degraded";
  if (candidates.some((candidate) => candidate.interpret.status === "auth_failure" || candidate.narrate.status === "auth_failure")) return "misconfigured";
  return "unavailable";
}

/**
 * Discover and probe the preferred Zen models once at runtime/deploy startup.
 * No model is routed until it is present in the live catalogue and passes both
 * authenticated no-world probes. Each candidate is attempted at most once per
 * route; unavailable models are excluded instead of retried indefinitely.
 */
export async function discoverOpenCodeRoutes(options: LiveModelSelectionOptions = {}): Promise<LiveModelSelectionReport> {
  const startedAt = performance.now();
  const checkedAt = options.checkedAt ?? (() => new Date().toISOString());
  const preferredModels = Object.freeze([...(options.preferredModels ?? OPENCODE_PREFERRED_MODELS)]);
  const timeoutMs = boundedTimeout(options.timeoutMs);
  const apiKey = options.apiKey ?? "";
  const baseUrl = (options.baseUrl ?? OPENCODE_ZEN_BASE_URL).replace(/\/+$/, "");
  const catalog = await fetchOpenCodeCatalog({ apiKey, baseUrl, timeoutMs, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  const catalogSet = new Set(catalog.modelIds);
  const candidates = await Promise.all(preferredModels.map(async (model): Promise<ModelCandidateReport> => {
    const inCatalog = catalogSet.has(model);
    if (!apiKey) {
      return { model, inCatalog, interpret: inactiveProbe("configuration"), narrate: inactiveProbe("configuration"), active: false, exclusionReason: "missing_credential" };
    }
    if (catalog.status === "auth_failure") {
      return { model, inCatalog, interpret: inactiveProbe("response_status"), narrate: inactiveProbe("response_status"), active: false, exclusionReason: "catalog_auth_failure" };
    }
    if (catalog.status !== "ok") {
      return { model, inCatalog, interpret: inactiveProbe(catalog.phase), narrate: inactiveProbe(catalog.phase), active: false, exclusionReason: "catalog_unavailable" };
    }
    if (!inCatalog) {
      return { model, inCatalog, interpret: inactiveProbe("response_shape"), narrate: inactiveProbe("response_shape"), active: false, exclusionReason: "not_in_catalog" };
    }
    const [interpret, narrate] = await Promise.all([
      options.probe
        ? options.probe("interpret", model, { apiKey, baseUrl, timeoutMs })
        : probeOpenCodeModel("interpret", model, { apiKey, baseUrl, timeoutMs, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }),
      options.probe
        ? options.probe("narrate", model, { apiKey, baseUrl, timeoutMs })
        : probeOpenCodeModel("narrate", model, { apiKey, baseUrl, timeoutMs, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }),
    ]);
    const active = interpret.status === "ok" && narrate.status === "ok";
    const exclusionReason = active
      ? undefined
      : interpret.status === "auth_failure" || narrate.status === "auth_failure"
        ? "auth_failure"
        : interpret.status === "model_unavailable" || narrate.status === "model_unavailable"
          ? "model_unavailable"
          : interpret.status !== "ok" ? "interpret_probe_failed" : "narrate_probe_failed";
    return { model, inCatalog, interpret, narrate, active, ...(exclusionReason ? { exclusionReason } : {}) };
  }));

  const activeModels = candidates.filter((candidate) => candidate.active).map((candidate) => candidate.model);
  const routes = routeForModels(activeModels);
  const excluded = Object.freeze(candidates.filter((candidate) => !candidate.active && candidate.exclusionReason).map((candidate) => ({ model: candidate.model, reason: candidate.exclusionReason! })));
  return {
    provider: "opencode_zen",
    status: selectionStatus(catalog, activeModels.length, candidates),
    checkedAt: checkedAt(),
    durationMs: Math.round(performance.now() - startedAt),
    catalog,
    ...(activeModels[0] ? { activeModel: activeModels[0] } : {}),
    ...(activeModels[1] ? { backupModel: activeModels[1] } : {}),
    candidates: Object.freeze(candidates),
    excluded,
    routes: { interpret: routes, narrate: routes },
  };
}

const OLLAMA_BASE_URL = "https://ollama.com";
const OLLAMA_INTERPRET_MAX_TOKENS = 256;
const OLLAMA_NARRATE_MAX_TOKENS = 64;

export interface OllamaDiscoveryOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly probe?: LiveModelSelectionOptions["probe"];
  readonly checkedAt?: () => string;
}

async function probeOllamaModel(category: "interpret" | "narrate", model: string, options: { apiKey: string; baseUrl: string; timeoutMs: number; fetchImpl?: typeof fetch }): Promise<CandidateProbeResult> {
  try {
    const maxTokens = category === "interpret" ? OLLAMA_INTERPRET_MAX_TOKENS : OLLAMA_NARRATE_MAX_TOKENS;
    const result = await chatOnce(options.baseUrl, options.apiKey, model, category === "interpret" ? INTERPRET_MESSAGES : NARRATE_MESSAGES, {
      provider: "ollama_cloud",
      protocol: "ollama_chat",
      category,
      maxTokens,
      timeoutMs: options.timeoutMs,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    const checked = probeText(category, result.text.trim());
    if (!checked) return { status: "failed", phase: "response_shape" };
    if (result.responseModel && result.responseModel !== model) return { status: "failed", phase: "model_selection", responseModel: result.responseModel };
    return { ...checked, ...(result.responseModel ? { responseModel: result.responseModel } : {}) };
  } catch (error) {
    const failure = toProviderFailure(error, { provider: "ollama_cloud", model, category });
    if (failure && (isProviderScopedFailure(failure.httpStatus, failure.providerCode) || failure.httpStatus === 400 || failure.httpStatus === 404)) {
      if (failure.httpStatus === 401 || failure.httpStatus === 403) return { status: "auth_failure", phase: failure.phase, httpStatus: failure.httpStatus, ...(failure.providerCode ? { providerCode: failure.providerCode } : {}) };
      if (failure.httpStatus === 400 || failure.httpStatus === 404) return { status: "model_unavailable", phase: failure.phase, httpStatus: failure.httpStatus, ...(failure.providerCode ? { providerCode: failure.providerCode } : {}) };
    }
    return {
      status: "failed",
      phase: failure?.phase ?? "request",
      ...(failure?.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
      ...(failure?.providerCode ? { providerCode: failure.providerCode } : {}),
    };
  }
}

function ollamaRoute(model: string): readonly RouteCandidate[] {
  return Object.freeze([{
    provider: "ollama_cloud" as const,
    model,
    protocol: "ollama_chat" as const,
    tier: "live_primary" as const,
  }]);
}

/**
 * Probe the operator-pinned Ollama Cloud backup model for both routes.
 * Unlike Zen there is no catalogue gate: cloud tags use local names and the
 * tags endpoint is unreliable, so the dual probes are authoritative and
 * `inCatalog` only records whether the id was seen in a tag list.
 * A single model can never satisfy the primary+backup contract, so full
 * success reports `degraded` (works, no redundancy), never `ready`.
 */
export async function discoverOllamaRoutes(options: OllamaDiscoveryOptions = {}): Promise<LiveModelSelectionReport> {
  const startedAt = performance.now();
  const checkedAt = options.checkedAt ?? (() => new Date().toISOString());
  const timeoutMs = boundedTimeout(options.timeoutMs);
  const apiKey = options.apiKey ?? "";
  const model = options.model ?? OLLAMA_CLOUD_BACKUP_MODEL;
  const baseUrl = (options.baseUrl ?? LLM_CONFIG.providers.ollama_cloud?.baseUrl ?? OLLAMA_BASE_URL).replace(/\/+$/, "");
  const fail = (status: LiveModelSelectionReport["status"], interpret: CandidateProbeResult, narrate: CandidateProbeResult, exclusionReason: ModelExclusionReason): LiveModelSelectionReport => ({
    provider: "ollama_cloud",
    status,
    checkedAt: checkedAt(),
    durationMs: Math.round(performance.now() - startedAt),
    candidates: Object.freeze([{ model, inCatalog: false, interpret, narrate, active: false, exclusionReason }]),
    excluded: Object.freeze([{ model, reason: exclusionReason }]),
    routes: { interpret: Object.freeze([]), narrate: Object.freeze([]) },
  });
  if (!apiKey) {
    const inactive = { status: "not_run" as const, phase: "configuration" as const };
    return fail("misconfigured", inactive, inactive, "missing_credential");
  }
  const runner = options.probe
    ? (category: "interpret" | "narrate") => options.probe!(category, model, { apiKey, baseUrl, timeoutMs })
    : (category: "interpret" | "narrate") => probeOllamaModel(category, model, { apiKey, baseUrl, timeoutMs, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  const [interpret, narrate] = await Promise.all([runner("interpret"), runner("narrate")]);
  if (interpret.status === "ok" && narrate.status === "ok") {
    const routes = ollamaRoute(model);
    return {
      provider: "ollama_cloud",
      status: "degraded",
      checkedAt: checkedAt(),
      durationMs: Math.round(performance.now() - startedAt),
      activeModel: model,
      candidates: Object.freeze([{ model, inCatalog: false, interpret, narrate, active: true }]),
      excluded: Object.freeze([]),
      routes: { interpret: routes, narrate: routes },
    };
  }
  const exclusionReason = interpret.status === "auth_failure" || narrate.status === "auth_failure"
    ? "auth_failure"
    : interpret.status === "model_unavailable" || narrate.status === "model_unavailable"
      ? "model_unavailable"
      : interpret.status !== "ok" ? "interpret_probe_failed" : "narrate_probe_failed";
  return fail(
    interpret.status === "auth_failure" || narrate.status === "auth_failure" ? "misconfigured" : "unavailable",
    interpret,
    narrate,
    exclusionReason,
  );
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_INTERPRET_MAX_TOKENS = 256;
const OPENROUTER_NARRATE_MAX_TOKENS = 64;

export interface OpenRouterDiscoveryOptions {
  readonly apiKey?: string;
  readonly models?: readonly string[];
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly probe?: LiveModelSelectionOptions["probe"];
  readonly checkedAt?: () => string;
}

async function probeOpenRouterModel(category: "interpret" | "narrate", model: string, options: { apiKey: string; baseUrl: string; timeoutMs: number; fetchImpl?: typeof fetch }): Promise<CandidateProbeResult> {
  try {
    const maxTokens = category === "interpret" ? OPENROUTER_INTERPRET_MAX_TOKENS : OPENROUTER_NARRATE_MAX_TOKENS;
    const result = await chatOnce(options.baseUrl, options.apiKey, model, category === "interpret" ? INTERPRET_MESSAGES : NARRATE_MESSAGES, {
      provider: "openrouter",
      protocol: "openai_chat",
      category,
      maxTokens,
      timeoutMs: options.timeoutMs,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    const checked = probeText(category, result.text.trim());
    if (!checked) return { status: "failed", phase: "response_shape" };
    if (result.responseModel && result.responseModel !== model) return { status: "failed", phase: "model_selection", responseModel: result.responseModel };
    return { ...checked, ...(result.responseModel ? { responseModel: result.responseModel } : {}) };
  } catch (error) {
    const failure = toProviderFailure(error, { provider: "openrouter", model, category });
    if (failure && (isProviderScopedFailure(failure.httpStatus, failure.providerCode) || failure.httpStatus === 400 || failure.httpStatus === 404)) {
      if (failure.httpStatus === 401 || failure.httpStatus === 403) return { status: "auth_failure", phase: failure.phase, httpStatus: failure.httpStatus, ...(failure.providerCode ? { providerCode: failure.providerCode } : {}) };
      if (failure.httpStatus === 400 || failure.httpStatus === 404) return { status: "model_unavailable", phase: failure.phase, httpStatus: failure.httpStatus, ...(failure.providerCode ? { providerCode: failure.providerCode } : {}) };
    }
    return {
      status: "failed",
      phase: failure?.phase ?? "request",
      ...(failure?.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
      ...(failure?.providerCode ? { providerCode: failure.providerCode } : {}),
    };
  }
}

function openRouterRoute(model: string): readonly RouteCandidate[] {
  return Object.freeze([{
    provider: "openrouter" as const,
    model,
    protocol: "openai_chat" as const,
    tier: "live_primary" as const,
  }]);
}

function openRouterExclusion(interpret: CandidateProbeResult, narrate: CandidateProbeResult): ModelExclusionReason {
  if (interpret.status === "auth_failure" || narrate.status === "auth_failure") return "auth_failure";
  if (interpret.providerCode === "insufficient_credits" || narrate.providerCode === "insufficient_credits"
    || interpret.httpStatus === 402 || narrate.httpStatus === 402) return "quota_exceeded";
  if (interpret.status === "model_unavailable" || narrate.status === "model_unavailable") return "model_unavailable";
  return interpret.status !== "ok" ? "interpret_probe_failed" : "narrate_probe_failed";
}

/**
 * Probe the pinned OpenRouter free models in preference order, first
 * dual-ok model wins. Models are probed SEQUENTIALLY (not in parallel):
 * free quota is 20 req/min and 50 req/day account-wide with failed attempts
 * counting, so a winner must stop further spending. No catalogue gate —
 * the preference list is operator-pinned from live recon and probes are
 * authoritative; dead ids are excluded, never retried indefinitely.
 * A single model can never satisfy the primary+backup contract, so full
 * success reports `degraded` (works, no redundancy), never `ready`.
 */
export async function discoverOpenRouterRoutes(options: OpenRouterDiscoveryOptions = {}): Promise<LiveModelSelectionReport> {
  const startedAt = performance.now();
  const checkedAt = options.checkedAt ?? (() => new Date().toISOString());
  const timeoutMs = boundedTimeout(options.timeoutMs);
  const apiKey = options.apiKey ?? "";
  const models = Object.freeze([...(options.models ?? OPENROUTER_PREFERRED_MODELS)]);
  const baseUrl = (options.baseUrl ?? LLM_CONFIG.providers.openrouter?.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, "");
  const finish = (
    status: LiveModelSelectionReport["status"],
    candidates: readonly ModelCandidateReport[],
    activeModel: string | undefined,
  ): LiveModelSelectionReport => ({
    provider: "openrouter",
    status,
    checkedAt: checkedAt(),
    durationMs: Math.round(performance.now() - startedAt),
    ...(activeModel ? { activeModel } : {}),
    candidates: Object.freeze([...candidates]),
    excluded: Object.freeze(candidates.filter((candidate) => !candidate.active && candidate.exclusionReason).map((candidate) => ({ model: candidate.model, reason: candidate.exclusionReason! }))),
    routes: activeModel ? { interpret: openRouterRoute(activeModel), narrate: openRouterRoute(activeModel) } : { interpret: Object.freeze([]), narrate: Object.freeze([]) },
  });
  if (!apiKey) {
    const inactive = { status: "not_run" as const, phase: "configuration" as const };
    return finish("misconfigured", Object.freeze(models.map((model) => ({
      model, inCatalog: false, interpret: inactive, narrate: inactive, active: false, exclusionReason: "missing_credential" as const,
    }))), undefined);
  }
  const candidates: ModelCandidateReport[] = [];
  for (const model of models) {
    const runner = options.probe
      ? (category: "interpret" | "narrate") => options.probe!(category, model, { apiKey, baseUrl, timeoutMs })
      : (category: "interpret" | "narrate") => probeOpenRouterModel(category, model, { apiKey, baseUrl, timeoutMs, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
    const [interpret, narrate] = await Promise.all([runner("interpret"), runner("narrate")]);
    const active = interpret.status === "ok" && narrate.status === "ok";
    candidates.push({
      model,
      inCatalog: false,
      interpret,
      narrate,
      active,
      ...(active ? {} : { exclusionReason: openRouterExclusion(interpret, narrate) }),
    });
    // Stop at the first dual-ok model: every further probe spends free quota.
    if (active) {
      return finish("degraded", candidates, model);
    }
  }
  const status = candidates.length === 0
    ? "unavailable"
    : candidates.some((candidate) => candidate.interpret.status === "auth_failure" || candidate.narrate.status === "auth_failure")
      ? "misconfigured"
      : "unavailable";
  return finish(status, candidates, undefined);
}

export interface LiveRouteDiscoveryOptions extends LiveModelSelectionOptions {
  /** Ollama Cloud credential for the fallback path; Zen discovery never sees it. */
  readonly ollamaKey?: string;
  /** Override for the pinned Ollama Cloud backup model id. */
  readonly ollamaModel?: string;
  /** OpenRouter credential for the last-resort path; earlier rungs never see it. */
  readonly openrouterKey?: string;
  /** Override for the pinned OpenRouter free-model preference order. */
  readonly openrouterModels?: readonly string[];
}

/**
 * Provider-ordered live discovery: Zen first, Ollama Cloud fallback,
 * OpenRouter last resort. Each rung wins without touching the next —
 * OpenRouter's free quota (20 req/min, 50 req/day account-wide) is only
 * spent when Zen and Ollama both activate nothing. Reports keep the Zen
 * catalogue snapshot for context and merge every exclusion list so
 * readiness keeps explaining each miss.
 */
export async function discoverLiveRoutes(options: LiveRouteDiscoveryOptions = {}): Promise<LiveModelSelectionReport> {
  const startedAt = performance.now();
  const checkedAt = options.checkedAt ?? (() => new Date().toISOString());
  const zen = await discoverOpenCodeRoutes(options);
  const zenActive = zen.candidates.filter((candidate) => candidate.active);
  if (zenActive.length > 0) return zen;
  const ollamaKey = options.ollamaKey ?? "";
  let ollamaExcluded: LiveModelSelectionReport["excluded"] = Object.freeze([]);
  let ollamaCandidates: LiveModelSelectionReport["candidates"] = Object.freeze([]);
  let ollamaAttempted = false;
  if (ollamaKey) {
    const ollama = await discoverOllamaRoutes({
      apiKey: ollamaKey,
      ...(options.ollamaModel ? { model: options.ollamaModel } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.probe ? { probe: options.probe } : {}),
      ...(options.checkedAt ? { checkedAt: options.checkedAt } : {}),
    });
    const ollamaActive = ollama.candidates.filter((candidate) => candidate.active);
    if (ollamaActive.length > 0) {
      return {
        provider: "ollama_cloud",
        status: ollama.status,
        checkedAt: ollama.checkedAt,
        durationMs: Math.round(performance.now() - startedAt),
        ...(zen.catalog ? { catalog: zen.catalog } : {}),
        ...(ollama.activeModel ? { activeModel: ollama.activeModel } : {}),
        ...(ollama.backupModel ? { backupModel: ollama.backupModel } : {}),
        candidates: ollama.candidates,
        excluded: Object.freeze([...zen.excluded, ...ollama.excluded]),
        routes: ollama.routes,
      };
    }
    ollamaAttempted = true;
    ollamaExcluded = ollama.excluded;
    ollamaCandidates = ollama.candidates;
  }
  const openrouterKey = options.openrouterKey ?? "";
  if (!openrouterKey) {
    // No further rung to try: report everything that was actually checked so
    // a total outage still explains each miss instead of hiding the fallback.
    return mergedFallbackReport({
      startedAt,
      checkedAt: checkedAt(),
      zen,
      ...(ollamaAttempted ? { ollamaCandidates, ollamaExcluded } : {}),
    });
  }
  const openrouter = await discoverOpenRouterRoutes({
    apiKey: openrouterKey,
    ...(options.openrouterModels ? { models: options.openrouterModels } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.probe ? { probe: options.probe } : {}),
    ...(options.checkedAt ? { checkedAt: options.checkedAt } : {}),
  });
  const openrouterActive = openrouter.candidates.filter((candidate) => candidate.active);
  if (openrouterActive.length === 0) {
    return mergedFallbackReport({
      startedAt,
      checkedAt: checkedAt(),
      zen,
      ...(ollamaAttempted ? { ollamaCandidates, ollamaExcluded } : {}),
      openrouter,
    });
  }
  return {
    provider: "openrouter",
    status: openrouter.status,
    checkedAt: openrouter.checkedAt,
    durationMs: Math.round(performance.now() - startedAt),
    ...(zen.catalog ? { catalog: zen.catalog } : {}),
    ...(openrouter.activeModel ? { activeModel: openrouter.activeModel } : {}),
    ...(openrouter.backupModel ? { backupModel: openrouter.backupModel } : {}),
    candidates: openrouter.candidates,
    excluded: Object.freeze([...zen.excluded, ...ollamaExcluded, ...openrouter.excluded]),
    routes: openrouter.routes,
  };
}

/**
 * Total-failure report preserving every checked rung: all inactive
 * candidates, all exclusions and the real fallback chain. No routes are
 * served (nothing is active), but diagnosis keeps working exactly when it
 * matters — during a full provider outage.
 */
function mergedFallbackReport(input: {
  readonly startedAt: number;
  readonly checkedAt: string;
  readonly zen: LiveModelSelectionReport;
  readonly ollamaCandidates?: LiveModelSelectionReport["candidates"];
  readonly ollamaExcluded?: LiveModelSelectionReport["excluded"];
  readonly openrouter?: LiveModelSelectionReport;
}): LiveModelSelectionReport {
  const candidates = Object.freeze([
    ...input.zen.candidates,
    ...(input.ollamaCandidates ?? []),
    ...(input.openrouter?.candidates ?? []),
  ]);
  const excluded = Object.freeze([
    ...input.zen.excluded,
    ...(input.ollamaExcluded ?? []),
    ...(input.openrouter?.excluded ?? []),
  ]);
  const authFailure =
    candidates.some((candidate) =>
      candidate.interpret.status === "auth_failure" || candidate.narrate.status === "auth_failure",
    ) ||
    excluded.some((entry) => entry.reason === "auth_failure" || entry.reason === "catalog_auth_failure");
  return {
    provider: input.openrouter !== undefined
      ? "openrouter"
      : input.ollamaCandidates !== undefined
        ? "ollama_cloud"
        : "opencode_zen",
    status: authFailure ? "misconfigured" : "unavailable",
    checkedAt: input.checkedAt,
    durationMs: Math.round(performance.now() - input.startedAt),
    ...(input.zen.catalog ? { catalog: input.zen.catalog } : {}),
    candidates,
    excluded,
    routes: { interpret: Object.freeze([]), narrate: Object.freeze([]) },
  };
}

/** Secret-free fingerprint of the startup model selection and exclusion reasons. */
export function liveModelSelectionFingerprint(selection: LiveModelSelectionReport): string {
  const material = {
    provider: selection.provider,
    status: selection.status,
    catalog: selection.catalog?.status ?? "unavailable",
    modelIds: selection.catalog?.modelIds ?? [],
    activeModel: selection.activeModel ?? "",
    backupModel: selection.backupModel ?? "",
    excluded: selection.excluded,
  };
  return createHash("sha256").update(JSON.stringify(material), "utf8").digest("hex");
}
