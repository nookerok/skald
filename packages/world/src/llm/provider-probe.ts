import { createHash } from "node:crypto";
import { LLM_CONFIG, criticalRouteConfigIssues } from "./config.js";
import type { Category, ChatMessage, ProviderId, RouteCandidate } from "./types.js";
import type { ModelRouter } from "./router.js";
import type { LiveModelSelectionReport } from "./catalog.js";

export type AIProbeRoute = "interpret" | "narrate";
export type RouteProbeStatus = "ok" | "failed" | "misconfigured" | "unavailable";

export interface RouteProbeResult {
  readonly route: AIProbeRoute;
  readonly provider: ProviderId;
  readonly model: string;
  readonly status: RouteProbeStatus;
  readonly phase: string;
  readonly latencyMs: number;
  readonly httpStatus?: number;
  readonly providerCode?: string;
}

export interface AIReadinessReport {
  readonly status: "ready" | "degraded" | "unavailable" | "misconfigured";
  readonly checkedAt: string;
  readonly durationMs: number;
  readonly configFingerprint: string;
  readonly activeModel?: string;
  readonly backupModel?: string;
  readonly excludedModels?: readonly { model: string; reason: string }[];
  /** Full secret-free startup catalogue/probe report, when live discovery ran. */
  readonly modelSelection?: LiveModelSelectionReport;
  /**
   * Per-route aggregate: `ok` when at least one probed candidate passed,
   * `failed` otherwise (failed, misconfigured and missing slots all count
   * as not-ok). A route with no working candidate cannot serve gameplay,
   * even when the sibling route is healthy.
   */
  readonly routeStatus: {
    readonly interpret: "ok" | "failed";
    readonly narrate: "ok" | "failed";
  };
  /**
   * Deployment gate: true only when both routes have a working candidate.
   * `degraded` (one live model, no backup) is still accepted for deploy,
   * but a dead interpret route is not — without it free-form player input
   * is unintelligible and the master degrades to a command interface.
   */
  readonly playable: boolean;
  readonly routes: {
    readonly interpret: readonly RouteProbeResult[];
    readonly narrate: readonly RouteProbeResult[];
  };
}

const PROBE_TIMEOUT_MS = 10_000;
const PROVIDER_CODE_RE = /^[a-zA-Z0-9_.:-]{1,80}$/;

const INTERPRET_MESSAGES: readonly ChatMessage[] = Object.freeze([
  { role: "system", content: "Skald readiness probe. Return only JSON with schemaVersion 1 and probe true." },
  { role: "user", content: "Return exactly {\"schemaVersion\":1,\"probe\":true}." },
]);

const NARRATE_MESSAGES: readonly ChatMessage[] = Object.freeze([
  { role: "system", content: "Skald readiness probe. Return only the marker and no other text." },
  { role: "user", content: "Return exactly SKALD_PROBE_OK." },
]);

function safeProviderCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return PROVIDER_CODE_RE.test(value) ? value : undefined;
}

function errorFailure(error: unknown): { phase?: string; httpStatus?: number; providerCode?: string } {
  if (!error || typeof error !== "object") return {};
  const value = error as { failure?: unknown; details?: unknown; phase?: unknown; httpStatus?: unknown; providerCode?: unknown };
  const nested = value.failure && typeof value.failure === "object" ? value.failure as Record<string, unknown> :
    value.details && typeof value.details === "object" ? value.details as Record<string, unknown> : value as Record<string, unknown>;
  const httpStatus = typeof nested.httpStatus === "number" && Number.isInteger(nested.httpStatus) ? nested.httpStatus : undefined;
  const phase = typeof nested.phase === "string" && /^[a-z_]{1,48}$/.test(nested.phase) ? nested.phase : undefined;
  const providerCode = safeProviderCode(nested.providerCode);
  return { ...(phase ? { phase } : {}), ...(httpStatus !== undefined ? { httpStatus } : {}), ...(providerCode ? { providerCode } : {}) };
}

function routeCandidates(router: ModelRouter, category: AIProbeRoute): readonly RouteCandidate[] {
  // The probe must inspect the complete configured matrix, including
  // candidates whose provider key is missing. A runtime router may filter
  // unavailable providers for gameplay selection, but that would hide a
  // production misconfiguration from readiness.
  const candidateApi = router as unknown as { routeCandidates?: (category: Category) => readonly RouteCandidate[] };
  if (typeof candidateApi.routeCandidates === "function") return candidateApi.routeCandidates(category);
  const configured = LLM_CONFIG.routes[category]?.candidates;
  if (configured && configured.length > 0) return configured;
  const route = LLM_CONFIG.routes[category] as unknown as { candidates?: readonly RouteCandidate[] };
  return route.candidates ?? [];
}

function routerFingerprint(router: ModelRouter | null, override?: string): string {
  if (override) return override;
  const withFingerprint = router as unknown as { configFingerprint?: () => string };
  if (router && typeof withFingerprint.configFingerprint === "function") return withFingerprint.configFingerprint();
  const material = router ? ["router", ...(["interpret", "narrate"] as const).flatMap((category) => routeCandidates(router, category).map((candidate) => `${category}:${candidate.provider}:${candidate.model}:${candidate.protocol}:${candidate.tier}`))] : ["no-router"];
  return createHash("sha256").update(material.join("|"), "utf8").digest("hex");
}

function hasProviderKey(router: ModelRouter, provider: ProviderId): boolean {
  const keyApi = router as unknown as { hasProviderKey?: (provider: ProviderId) => boolean };
  if (typeof keyApi.hasProviderKey === "function") return keyApi.hasProviderKey(provider);
  const envName = LLM_CONFIG.providers[provider]?.apiKeyEnv;
  return Boolean(envName && process.env[envName]);
}

async function checkCandidate(router: ModelRouter, route: AIProbeRoute, candidate: RouteCandidate, timeoutMs: number): Promise<RouteProbeResult> {
  const startedAt = performance.now();
  if (!hasProviderKey(router, candidate.provider)) {
    return { route, provider: candidate.provider, model: candidate.model, status: "misconfigured", phase: "configuration", latencyMs: Math.round(performance.now() - startedAt) };
  }
  try {
    const exact = router as unknown as {
      chatCandidate?: (category: Category, candidate: RouteCandidate, messages: readonly ChatMessage[], opts?: { timeoutMs?: number }) => Promise<{ text: string; responseModel?: string }>;
    };
    const response = typeof exact.chatCandidate === "function"
      ? await exact.chatCandidate(route, candidate, route === "interpret" ? INTERPRET_MESSAGES : NARRATE_MESSAGES, { timeoutMs })
      : await router.chatOnce(candidate.model, route === "interpret" ? INTERPRET_MESSAGES : NARRATE_MESSAGES, { provider: candidate.provider, maxTokens: route === "interpret" ? 64 : 16, timeoutMs });
    const text = typeof response?.text === "string" ? response.text.trim() : "";
    if (!text) return { route, provider: candidate.provider, model: candidate.model, status: "failed", phase: "response_shape", latencyMs: Math.round(performance.now() - startedAt) };
    if (typeof response?.responseModel === "string" && response.responseModel.length > 0 && response.responseModel !== candidate.model) {
      return { route, provider: candidate.provider, model: candidate.model, status: "failed", phase: "model_selection", latencyMs: Math.round(performance.now() - startedAt) };
    }
    if (route === "interpret") {
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch {
        return { route, provider: candidate.provider, model: candidate.model, status: "failed", phase: "response_decode", latencyMs: Math.round(performance.now() - startedAt) };
      }
      const valid = parsed !== null && typeof parsed === "object" && (parsed as Record<string, unknown>).schemaVersion === 1 && (parsed as Record<string, unknown>).probe === true;
      if (!valid) return { route, provider: candidate.provider, model: candidate.model, status: "failed", phase: "schema_validation", latencyMs: Math.round(performance.now() - startedAt) };
    } else if (text !== "SKALD_PROBE_OK") {
      return { route, provider: candidate.provider, model: candidate.model, status: "failed", phase: "response_shape", latencyMs: Math.round(performance.now() - startedAt) };
    }
    return { route, provider: candidate.provider, model: candidate.model, status: "ok", phase: "response_shape", latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    const failure = errorFailure(error);
    return {
      route,
      provider: candidate.provider,
      model: candidate.model,
      status: "failed",
      phase: failure.phase ?? "request",
      latencyMs: Math.round(performance.now() - startedAt),
      ...(failure.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
      ...(failure.providerCode ? { providerCode: failure.providerCode } : {}),
    };
  }
}

function summarizeStatus(
  routes: readonly RouteProbeResult[],
  hasMissingRoute: boolean,
  configIssues: readonly string[],
): AIReadinessReport["status"] {
  if (configIssues.some((issue) => !issue.includes(":missing_"))) return "misconfigured";
  if (configIssues.length > 0) return "unavailable";
  if (routes.some((result) => result.status === "misconfigured")) return "misconfigured";
  if (hasMissingRoute) {
    // A single working model with no backup (e.g. the Ollama Cloud fallback)
    // is degraded, not dead. checkCandidate never emits status "unavailable"
    // itself — only the synthetic missing-slot entries below carry it — so
    // anything else keeps "unavailable".
    const okCount = routes.filter((result) => result.status === "ok").length;
    const restSynthetic = routes
      .filter((result) => result.status !== "ok")
      .every((result) => result.status === "unavailable");
    if (okCount > 0 && restSynthetic) return "degraded";
    return "unavailable";
  }
  const required = routes.filter((result) => result.status !== "misconfigured");
  if (required.length > 0 && required.every((result) => result.status === "ok")) return "ready";
  if (required.some((result) => result.status === "ok")) return "degraded";
  return "unavailable";
}

/**
 * Run a no-world readiness probe against the explicit primary and backup
 * candidates. This function only calls providers and returns sanitized
 * metadata; it has no access to a world, event log or persistence.
 */
export async function probeAIReadiness(router: ModelRouter | null, options?: {
  timeoutMs?: number;
  configFingerprint?: string;
  diagnostics?: (event: {
    kind: "probe";
    category: string;
    outcome: string;
    provider: string;
    model: string;
    phase: string;
    attempt: number;
    durationMs: number;
    timeoutMs: number;
    priority: "interactive";
    httpStatus?: number;
    providerCode?: string;
    correlationId?: string;
  }) => void;
  correlationId?: string;
  selectionReport?: LiveModelSelectionReport;
}): Promise<AIReadinessReport> {
  const startedAt = performance.now();
  const timeoutMs = Math.max(1, Math.floor(options?.timeoutMs ?? PROBE_TIMEOUT_MS));
  const checkedAt = new Date().toISOString();
  const failedRouteStatus = { interpret: "failed", narrate: "failed" } as const;
  if (!router) {
    return {
      status: options?.selectionReport?.status === "unavailable" ? "unavailable" : "misconfigured",
      checkedAt,
      durationMs: Math.round(performance.now() - startedAt),
      configFingerprint: routerFingerprint(null, options?.configFingerprint),
      ...(options?.selectionReport?.activeModel ? { activeModel: options.selectionReport.activeModel } : {}),
      ...(options?.selectionReport?.backupModel ? { backupModel: options.selectionReport.backupModel } : {}),
      ...(options?.selectionReport ? { excludedModels: options.selectionReport.excluded } : {}),
      ...(options?.selectionReport ? { modelSelection: options.selectionReport } : {}),
      routeStatus: { ...failedRouteStatus },
      playable: false,
      routes: { interpret: [], narrate: [] },
    };
  }
  const routeResults: { interpret: RouteProbeResult[]; narrate: RouteProbeResult[] } = { interpret: [], narrate: [] };
  for (const route of ["interpret", "narrate"] as const) {
    const candidates = routeCandidates(router, route).filter((candidate) => candidate.tier !== "free_emergency").slice(0, 2);
    const missing = candidates.length < 2;
    const results = await Promise.all(candidates.map((candidate) => checkCandidate(router, route, candidate, timeoutMs)));
    routeResults[route].push(...results);
    for (const result of results) {
      try {
        options?.diagnostics?.({
          kind: "probe",
          category: route,
          outcome: result.status,
          provider: result.provider,
          model: result.model,
          phase: result.phase,
          attempt: 1,
          durationMs: result.latencyMs,
          timeoutMs,
          priority: "interactive",
          ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
          ...(result.providerCode !== undefined ? { providerCode: result.providerCode } : {}),
          ...(options?.correlationId ? { correlationId: options.correlationId } : {}),
        });
      } catch { /* diagnostics are best effort */ }
    }
    if (missing) {
      routeResults[route].push({ route, provider: candidates[0]?.provider ?? "opencode_zen", model: candidates[0]?.model ?? "", status: "unavailable", phase: "configuration", latencyMs: 0 });
    }
  }
  const all = [...routeResults.interpret, ...routeResults.narrate];
  const routeStatus = summarizeStatus(
    all,
    routeResults.interpret.length < 2 || routeResults.narrate.length < 2,
    criticalRouteConfigIssues(),
  );
  // Live route results own the status. A stale startup selection must never
  // mask a live total failure (e.g. degraded startup + now-dead routes must
  // report unavailable). The selection report only contributes metadata below.
  const status = options?.selectionReport?.status === "misconfigured" && routeStatus !== "misconfigured"
    ? "misconfigured"
    : routeStatus;
  const routeOk = (results: readonly RouteProbeResult[]): boolean =>
    results.some((result) => result.status === "ok");
  const routeStatusBlock = {
    interpret: routeOk(routeResults.interpret) ? "ok" : "failed",
    narrate: routeOk(routeResults.narrate) ? "ok" : "failed",
  } as const;
  const playable = routeStatusBlock.interpret === "ok" && routeStatusBlock.narrate === "ok";
  return {
    status,
    checkedAt,
    durationMs: Math.round(performance.now() - startedAt),
    configFingerprint: routerFingerprint(router, options?.configFingerprint),
    ...(options?.selectionReport?.activeModel ? { activeModel: options.selectionReport.activeModel } : {}),
    ...(options?.selectionReport?.backupModel ? { backupModel: options.selectionReport.backupModel } : {}),
    ...(options?.selectionReport ? { excludedModels: options.selectionReport.excluded } : {}),
    ...(options?.selectionReport ? { modelSelection: options.selectionReport } : {}),
    routeStatus: { ...routeStatusBlock },
    playable,
    routes: { interpret: routeResults.interpret, narrate: routeResults.narrate },
  };
}
