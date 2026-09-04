import { createHash } from "node:crypto";
import { OPENCODE_PREFERRED_MODELS } from "./config.js";
import { chatOnce, readProviderErrorCode } from "./http.js";
import { isProviderScopedFailure, toProviderFailure } from "./errors.js";
import type { ChatMessage, ProviderPhase, RouteCandidate } from "./types.js";

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
  readonly provider: "opencode_zen";
  readonly status: "ready" | "degraded" | "unavailable" | "misconfigured";
  readonly checkedAt: string;
  readonly durationMs: number;
  readonly catalog: OpenCodeCatalogReport;
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
  try {
    const result = await chatOnce(options.baseUrl, options.apiKey, model, category === "interpret" ? INTERPRET_MESSAGES : NARRATE_MESSAGES, {
      provider: "opencode_zen",
      protocol: "openai_chat",
      category,
      maxTokens: category === "interpret" ? 64 : 16,
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
    protocol: "openai_chat" as const,
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

/** Secret-free fingerprint of the startup model selection and exclusion reasons. */
export function liveModelSelectionFingerprint(selection: LiveModelSelectionReport): string {
  const material = {
    provider: selection.provider,
    status: selection.status,
    catalog: selection.catalog.status,
    modelIds: selection.catalog.modelIds,
    activeModel: selection.activeModel ?? "",
    backupModel: selection.backupModel ?? "",
    excluded: selection.excluded,
  };
  return createHash("sha256").update(JSON.stringify(material), "utf8").digest("hex");
}
