import {
  LLM_CONFIG,
  candidateForModel,
  llmConfigFingerprint,
  protocolForModel,
  providerForModel,
  routeCandidates as configuredRouteCandidates,
} from "./config.js";
import { loadHealth } from "./health.js";
import { classifyPayload, enforceDataPolicy } from "./data-policy.js";
import { chatOnce, shouldRetrySameCandidate, shouldTryNextCandidate } from "./http.js";
import {
  ProviderRequestError,
  ProviderUnavailableError,
  isModelScopedFailure,
  isProviderScopedFailure,
  toProviderFailure,
} from "./errors.js";
import type { ProviderFailureContext } from "./errors.js";
import type { LiveModelSelectionReport } from "./catalog.js";
import type {
  Category,
  ChatMessage,
  ChatResult,
  HealthStatus,
  ProviderId,
  ProviderPhase,
  ProviderProtocol,
  RouteCandidate,
  RouterDecision,
  RouterDiagnostic,
} from "./types.js";

/** A provider hop without tier metadata: direct `chatOnce` calls. */
interface SendTarget {
  readonly provider: ProviderId;
  readonly model: string;
  readonly protocol: ProviderProtocol;
}

/**
 * Whether a non-transient error is an explicit provider-level refusal
 * (deliberate failure, 401/403 auth rejection, 404 stale endpoint, already
 * typed) rather than an empty response or unknown provider error. Only these
 * are normalized to ProviderUnavailableError; others stay raw for
 * classifyNarrationError.
 */
function isExplicitProviderUnavailable(err: Error): boolean {
  if (err instanceof ProviderUnavailableError) return true;
  if (err instanceof ProviderRequestError && (isProviderScopedFailure(err.httpStatus, err.providerCode) || isModelScopedFailure(err.httpStatus, err.providerCode))) return true;
  const msg = err.message.toLowerCase();
  if (msg.includes("deliberate") || msg.includes("provider_unavailable")) return true;
  if (msg.includes("http 401") || msg.includes("http 403")) return true;
  return false;
}

export interface ModelRouterOptions {
  readonly apiKey?: string | undefined;
  /** Provider-scoped credentials captured by the runtime factory. */
  readonly providerKeys?: Partial<Record<ProviderId, string>> | undefined;
  /** Let narration defer retry ownership to this router's bounded policy. */
  readonly boundedRetries?: boolean | undefined;
  readonly baseUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly healthCachePath?: string | undefined;
  readonly providerId?: ProviderId | undefined;
  readonly availableProviders?: readonly ProviderId[] | undefined;
  /** Secret-free fingerprint captured by the environment factory. */
  readonly configFingerprint?: string | undefined;
  /** Runtime/deploy-time routes activated by live catalogue and probes. */
  readonly routeCandidates?: Partial<Record<Category, readonly RouteCandidate[]>> | undefined;
  /** Sanitized startup discovery report used by readiness diagnostics. */
  readonly liveSelection?: LiveModelSelectionReport | undefined;
}

export interface ChatCandidateOptions {
  readonly maxTokens?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly dataClass?: string | undefined;
}

export interface ChatOptions {
  readonly dataClass?: string | undefined;
  /** Total budget for all candidate attempts and the one retry. */
  readonly timeoutMs?: number | undefined;
  /** Read-side sink for one structured event per provider attempt. */
  readonly diagnostics?: ((event: {
    readonly kind: "provider";
    readonly category: Category;
    readonly outcome: "success" | "failed" | "retrying" | "provider_failover";
    readonly provider: ProviderId;
    readonly model: string;
    readonly configuredModel: string;
    readonly phase: ProviderPhase;
    readonly httpStatus?: number;
    readonly providerCode?: string;
    readonly attempt: number;
    readonly durationMs: number;
    readonly timeoutMs: number;
    readonly priority: "interactive" | "batch";
    readonly correlationId?: string;
    readonly worldTime?: number;
  }) => void) | undefined;
  readonly priority?: "interactive" | "batch" | undefined;
  readonly correlationId?: string | undefined;
  readonly worldTime?: number | undefined;
}

export class ModelRouter {
  /** Provider-level retry/failover is bounded by this router. */
  readonly managesRetries: boolean;
  readonly providerId: ProviderId;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly healthCachePath: string;
  readonly timeoutSeconds: number;
  readonly availableProviders: readonly ProviderId[];
  private readonly providerKeys: Readonly<Partial<Record<ProviderId, string>>>;
  private fingerprint: string | undefined;
  private routeOverrides: Partial<Record<Category, readonly RouteCandidate[]>>;
  private startupSelection: LiveModelSelectionReport | undefined;

  constructor(opts?: ModelRouterOptions) {
    this.managesRetries = opts?.boundedRetries === true;
    this.providerId = opts?.providerId ?? (LLM_CONFIG.policy.skaldProvider as ProviderId);
    const provConf = LLM_CONFIG.providers[this.providerId];
    this.baseUrl = (opts?.baseUrl || provConf?.baseUrl || "").replace(/\/+$/, "");
    const suppliedKeys = opts?.providerKeys;
    const capturedKeys: Partial<Record<ProviderId, string>> = {};
    for (const provider of Object.keys(LLM_CONFIG.providers) as ProviderId[]) {
      const envName = LLM_CONFIG.providers[provider]?.apiKeyEnv ?? "";
      capturedKeys[provider] = Object.prototype.hasOwnProperty.call(suppliedKeys ?? {}, provider)
        ? suppliedKeys?.[provider] ?? ""
        : process.env[envName] ?? "";
    }
    const apiKey = opts?.apiKey !== undefined ? opts.apiKey : capturedKeys[this.providerId] ?? "";
    this.apiKey = apiKey;
    Object.defineProperty(this, "apiKey", { value: apiKey, enumerable: false, writable: false, configurable: false });
    capturedKeys[this.providerId] = this.apiKey;
    this.providerKeys = Object.freeze({ ...capturedKeys });
    Object.defineProperty(this, "providerKeys", { value: this.providerKeys, enumerable: false, writable: false, configurable: false });
    this.healthCachePath = opts?.healthCachePath ?? "packages/cli/llm-health.json";
    this.timeoutSeconds = (opts?.timeoutMs ?? 30000) / 1000;
    this.availableProviders = Object.freeze([...new Set(opts?.availableProviders ?? [this.providerId])]);
    this.fingerprint = opts?.configFingerprint;
    this.routeOverrides = Object.freeze({ ...(opts?.routeCandidates ?? {}) });
    this.startupSelection = opts?.liveSelection;
  }

  diagnostics(): RouterDiagnostic[] {
    const diag: RouterDiagnostic[] = [];
    if (!this.apiKey) {
      diag.push({ level: "WARN", message: "API key is empty — LLM disabled, template fallback will be used" });
    } else {
      diag.push({ level: "OK", message: "API key present" });
    }
    diag.push({ level: "OK", message: `base URL: ${this.baseUrl}` });
    for (const cat of ["narrate", "analyze", "interpret"] as const) {
      const candidates = this.routeCandidates(cat).map((c) => `${c.provider}/${c.model}[${c.tier}]`).join(", ");
      diag.push({ level: "OK", message: `${cat}: candidates=${candidates}` });
    }
    return diag;
  }

  /** Stable, secret-free fingerprint of endpoints and route candidates. */
  configFingerprint(): string {
    return this.fingerprint ?? llmConfigFingerprint();
  }

  /** Sanitized startup model selection, when live discovery was enabled. */
  liveModelSelection(): LiveModelSelectionReport | undefined {
    return this.startupSelection;
  }

  /**
   * Replace the live Zen routes with a fresh discovery selection.
   * Operational mutation only: it never touches the Event Log, Projection or
   * game state. Callers own the policy of when a selection is worth applying
   * (e.g. only when it keeps at least one active model).
   */
  applyLiveSelection(selection: LiveModelSelectionReport, configFingerprint: string): void {
    this.routeOverrides = Object.freeze({
      ...this.routeOverrides,
      interpret: Object.freeze([...selection.routes.interpret]),
      narrate: Object.freeze([...selection.routes.narrate]),
    });
    this.startupSelection = selection;
    this.fingerprint = configFingerprint;
  }

  /** Ordered candidates of a route restricted to available providers. */
  routeCandidates(category: Category): readonly RouteCandidate[] {
    const configured = Object.prototype.hasOwnProperty.call(this.routeOverrides, category)
      ? this.routeOverrides[category] ?? []
      : configuredRouteCandidates(category);
    return configured.filter((candidate) => this.availableProviders.includes(candidate.provider));
  }

  private _route(category: Category) {
    const route = LLM_CONFIG.routes[category];
    if (!route) return undefined;
    const candidates = this.routeCandidates(category);
    return Object.prototype.hasOwnProperty.call(this.routeOverrides, category)
      ? { ...route, candidates, models: candidates.map((candidate) => candidate.model) }
      : route;
  }

  /**
   * Whether a key value is configured for a provider. Returns a boolean only —
   * the key itself is never exposed.
   */
  hasProviderKey(provider: ProviderId): boolean {
    return (this.providerKeys[provider] ?? "").length > 0;
  }

  /**
   * Send one request to exactly one candidate without health selection or
   * failover. Used by readiness probes so a route/provider pair can be
   * exercised in isolation with synthetic prompts.
   */
  async chatCandidate(
    category: Category,
    candidate: RouteCandidate,
    messages: readonly ChatMessage[],
    opts?: ChatCandidateOptions,
  ): Promise<ChatResult> {
    const route = this._route(category);
    if (!route) throw new Error(`Unknown category: ${category}`);
    this._assertDataPolicy(candidate.provider, messages, opts?.dataClass);

    const timeoutMs = opts?.timeoutMs ?? route.timeoutMs;
    const result = await this._send(candidate, messages, {
      category,
      maxTokens: opts?.maxTokens ?? route.maxTokens,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });

    return {
      model: candidate.model,
      configuredModel: candidate.model,
      configuredProvider: candidate.provider,
      responseModel: result.responseModel,
      usedFallback: false,
      text: result.text,
      latencyMs: result.latencyMs,
      usage: result.usage,
      provider: candidate.provider,
      tier: candidate.tier,
    };
  }

  async chatOnce(
    model: string,
    messages: readonly ChatMessage[],
    opts: { provider?: ProviderId; maxTokens?: number; timeoutMs?: number; category?: Category } = {},
  ): Promise<{ text: string; responseModel: string; latencyMs: number; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    const provider = opts.provider ?? providerForModel(model);
    const configuredProtocol = candidateForModel("interpret", model) ?? candidateForModel("narrate", model) ?? candidateForModel("analyze", model);
    const target: SendTarget = {
      provider,
      model,
      // The wire format is per model (Zen multiplexes Chat Completions and
      // Responses behind one base URL); fall back to the explicit provider
      // default only for unconfigured models.
      protocol: configuredProtocol?.protocol ?? LLM_CONFIG.providers[provider]?.protocol ?? protocolForModel(model),
    };
    return this._send(target, messages, {
      category: opts.category ?? "narrate",
      maxTokens: opts.maxTokens,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
  }

  private _send(
    target: SendTarget,
    messages: readonly ChatMessage[],
    opts: { category: Category; maxTokens: number | undefined; timeoutMs?: number },
  ): Promise<{ text: string; responseModel: string; latencyMs: number; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    const provConf = LLM_CONFIG.providers[target.provider];
    const baseUrl = (target.provider === this.providerId
      ? this.baseUrl || provConf?.baseUrl
      : provConf?.baseUrl ?? this.baseUrl).replace(/\/+$/, "");
    const apiKey = target.provider === this.providerId
      ? this.apiKey
      : (this.providerKeys[target.provider] ?? "");

    if (!baseUrl || !apiKey) {
      throw new ProviderRequestError({
        provider: target.provider,
        model: target.model,
        category: opts.category,
        phase: "configuration",
        reason: "provider is not configured",
      });
    }

    return chatOnce(baseUrl, apiKey, target.model, messages, {
      provider: target.provider,
      protocol: target.protocol,
      category: opts.category,
      maxTokens: opts.maxTokens,
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
  }

  private _modelHealth(model: string): string {
    const health = loadHealth(this.healthCachePath);
    return health[model]?.status ?? "unknown";
  }

  private _assertDataPolicy(provider: ProviderId, messages: readonly ChatMessage[], dataClass?: string): string {
    const msgText = messages.map((m) => m.content).join(" ");
    const cls = classifyPayload(msgText, dataClass);
    const policy = enforceDataPolicy(msgText, cls.class, provider);
    if (!policy.ok) throw new Error(`Data policy blocked: ${policy.reason}`);
    return cls.class;
  }

  decideModel(category: Category, messages: readonly ChatMessage[], dataClass?: string): RouterDecision {
    const route = this._route(category);
    if (!route) throw new Error(`Unknown category: ${category}`);

    // The configured router provider owns the data policy check, as before.
    const resolvedClass = this._assertDataPolicy(this.providerId, messages, dataClass);

    const candidates = this.routeCandidates(category);
    if (candidates.length === 0) throw new Error(`No models configured for category: ${category}`);

    const decide = (candidate: RouteCandidate, reason: string, health: HealthStatus | "unknown"): RouterDecision => ({
      category,
      selectedModel: candidate.model,
      candidateModels: candidates.map((c) => c.model),
      candidates,
      selectedCandidate: candidate,
      dataClass: resolvedClass,
      reason,
      healthStatus: health,
      usedHealthCache: true,
      provider: candidate.provider,
    });

    // Pass 1: first healthy
    for (const candidate of candidates) {
      if (this._modelHealth(candidate.model) === "ok") {
        return decide(candidate, "first healthy model", "ok");
      }
    }

    // Pass 2: first non-fatal
    for (const candidate of candidates) {
      const h = this._modelHealth(candidate.model);
      if (!["forbidden", "network_error", "rate_limited"].includes(h)) {
        return decide(candidate, "first non-fatal candidate", h as HealthStatus | "unknown");
      }
    }

    throw new Error(`No healthy models available for category: ${category}`);
  }

  async chat(category: Category, messages: readonly ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
    const route = this._route(category);
    if (!route) throw new Error(`Unknown category: ${category}`);

    const decision = this.decideModel(category, messages, opts?.dataClass);
    const ordered = this._orderedCandidates(category, decision.selectedCandidate);
    const configuredProvider = decision.selectedCandidate.provider;
    const totalTimeoutMs = Math.max(1, Math.floor(opts?.timeoutMs ?? route.timeoutMs ?? this.timeoutSeconds * 1000));
    const deadline = performance.now() + totalTimeoutMs;

    let lastError: Error | null = null;
    let retryUsed = false;
    const invalidProviders = new Set<ProviderId>();

    for (let index = 0; index < ordered.length; index += 1) {
      const candidate = ordered[index]!;
      if (invalidProviders.has(candidate.provider)) continue;
      const ctx: ProviderFailureContext = { provider: candidate.provider, model: candidate.model, category };

      if (performance.now() >= deadline) break;

      // At most one same-candidate retry for the whole chat call.
      const attempts = retryUsed ? 1 : 2;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const attemptStartedAt = performance.now();
        try {
          const remainingMs = Math.max(1, Math.floor(deadline - performance.now()));
          const result = await this.chatCandidate(category, candidate, messages, {
            maxTokens: route.maxTokens,
            timeoutMs: remainingMs,
          });
          this.emitProviderDiagnostic(category, opts, {
            outcome: candidate.provider !== configuredProvider
              ? "provider_failover"
              : "success",
            candidate,
            configuredModel: decision.selectedModel,
            phase: "request",
            attempt: attempt + 1,
            startedAt: attemptStartedAt,
            timeoutMs: totalTimeoutMs,
          });
          return {
            ...result,
            configuredModel: decision.selectedModel,
            configuredProvider,
            usedFallback: candidate.model !== decision.selectedModel,
          };
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          const failure = toProviderFailure(error, ctx);
          lastError = error;
          if (failure && isProviderScopedFailure(failure.httpStatus, failure.providerCode)) {
            // A rejected credential or endpoint invalidates every remaining
            // candidate owned by this provider for this call.
            invalidProviders.add(candidate.provider);
          }
          // Preserve the candidate that actually failed. The configured router
          // provider may differ when the candidate list crosses providers.
          Object.assign(error, {
            provider: candidate.provider,
            model: candidate.model,
            configuredModel: decision.selectedModel,
            configuredProvider,
            ...(failure
              ? { phase: failure.phase, httpStatus: failure.httpStatus, providerCode: failure.providerCode }
              : {}),
          });
          const retrySameCandidate = attempt === 0 && !retryUsed && shouldRetrySameCandidate(error, ctx);
          this.emitProviderDiagnostic(category, opts, {
            outcome: retrySameCandidate ? "retrying" : "failed",
            candidate,
            configuredModel: decision.selectedModel,
            phase: failure?.phase ?? "request",
            ...(failure?.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
            ...(failure?.providerCode !== undefined ? { providerCode: failure.providerCode } : {}),
            attempt: attempt + 1,
            startedAt: attemptStartedAt,
            timeoutMs: totalTimeoutMs,
          });
          if (retrySameCandidate) {
            retryUsed = true;
            continue;
          }
          break;
        }
      }

      if (performance.now() >= deadline) break;

      const next = index + 1 < ordered.length ? ordered[index + 1]! : null;
      if (lastError && !shouldTryNextCandidate(lastError, next, ctx)) {
        if (isExplicitProviderUnavailable(lastError)) {
          throw new ProviderUnavailableError(lastError.message, {
            provider: candidate.provider,
            model: candidate.model,
            configuredModel: decision.selectedModel,
            cause: lastError,
          });
        }
        throw lastError;
      }
    }

    if (lastError && isExplicitProviderUnavailable(lastError)) {
      const failure = toProviderFailure(lastError);
      throw new ProviderUnavailableError(lastError.message, {
        provider: failure?.provider ?? this.providerId,
        model: failure?.model ?? decision.selectedModel,
        configuredModel: decision.selectedModel,
        cause: lastError,
      });
    }

    throw lastError ?? new Error("All models failed for category: " + category);
  }

  private emitProviderDiagnostic(
    category: Category,
    opts: ChatOptions | undefined,
    event: {
      readonly outcome: "success" | "failed" | "retrying" | "provider_failover";
      readonly candidate: RouteCandidate;
      readonly configuredModel: string;
      readonly phase: ProviderPhase;
      readonly httpStatus?: number;
      readonly providerCode?: string;
      readonly attempt: number;
      readonly startedAt: number;
      readonly timeoutMs: number;
    },
  ): void {
    try {
      const worldTime = opts?.worldTime;
      opts?.diagnostics?.({
        kind: "provider",
        category,
        outcome: event.outcome,
        provider: event.candidate.provider,
        model: event.candidate.model,
        configuredModel: event.configuredModel,
        phase: event.phase,
        ...(event.httpStatus !== undefined ? { httpStatus: event.httpStatus } : {}),
        ...(event.providerCode !== undefined ? { providerCode: event.providerCode } : {}),
        attempt: event.attempt,
        durationMs: Math.round(performance.now() - event.startedAt),
        timeoutMs: event.timeoutMs,
        priority: opts.priority ?? "interactive",
        ...(opts.correlationId ? { correlationId: opts.correlationId } : {}),
        ...(typeof worldTime === "number" && Number.isFinite(worldTime) ? { worldTime } : {}),
      });
    } catch {
      // Diagnostics are best effort and must not alter provider behaviour.
    }
  }

  /** Candidates of a route with the decided candidate moved to the front. */
  private _orderedCandidates(category: Category, selected: RouteCandidate): readonly RouteCandidate[] {
    const candidates = this.routeCandidates(category);
    const rest = candidates.filter((candidate) => candidate.provider !== selected.provider || candidate.model !== selected.model);
    return [selected, ...rest];
  }
}
