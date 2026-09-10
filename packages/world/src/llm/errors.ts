/**
 * Typed provider error contract.
 *
 * `ProviderUnavailableError` marks a deliberate provider refusal.
 * `ProviderRequestError` carries a sanitized, structured description of any
 * failed provider round-trip: phase, HTTP status and a sanitized provider
 * error code. Raw provider bodies, messages, headers and API keys never
 * enter these objects.
 */

import { LLM_CONFIG } from "./config.js";
import type { ProviderId, Category, ProviderPhase, ProviderRequestFailure } from "./types.js";

export const PROVIDER_UNAVAILABLE_CODE = "PROVIDER_UNAVAILABLE" as const;
export const PROVIDER_REQUEST_FAILED_CODE = "PROVIDER_REQUEST_FAILED" as const;

/** HTTP statuses that are transient and may be retried on the same candidate. */
export const TRANSIENT_HTTP_STATUSES: readonly number[] = Object.freeze([429, 500, 502, 503, 504]);

/**
 * HTTP statuses that may be scoped to the credential or endpoint. A 404 with
 * a known model-unavailable code is narrowed to one candidate below.
 */
export const PROVIDER_SCOPED_HTTP_STATUSES: readonly number[] = Object.freeze([401, 403, 404]);

/** Sanitized provider codes that identify one unavailable model, not Zen itself. */
export const MODEL_SCOPED_PROVIDER_CODES: readonly string[] = Object.freeze([
  "model_not_found",
  "model_unavailable",
  "model_not_supported",
  "invalid_model",
]);

/** Maximum accepted length of a sanitized provider error code. */
export const MAX_PROVIDER_CODE_LENGTH = 80;

const SAFE_PROVIDER_CODE = /^[a-zA-Z0-9_.:-]+$/;
const LEGACY_HTTP_STATUS = /HTTP\s+(\d{3})/i;
const PROVIDER_PHASES: readonly ProviderPhase[] = Object.freeze([
  "configuration",
  "model_selection",
  "request",
  "transport",
  "response_status",
  "response_decode",
  "response_shape",
  "schema_validation",
]);

function isProviderPhase(value: unknown): value is ProviderPhase {
  return typeof value === "string" && PROVIDER_PHASES.includes(value as ProviderPhase);
}

/**
 * Reduce an untrusted provider error code to a short operational token.
 * Returns `undefined` for anything that is not a bounded, character-safe
 * code, so free-form provider text can never reach diagnostics.
 */
export function sanitizeProviderCode(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PROVIDER_CODE_LENGTH) return undefined;
  if (!SAFE_PROVIDER_CODE.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Whether repeating the identical request on the same candidate may succeed.
 * Only timeouts, network failures and transient HTTP statuses qualify.
 */
export function isRetryableProviderFailure(phase: ProviderPhase, httpStatus?: number): boolean {
  if (phase === "transport") return true;
  if (phase === "response_status" && httpStatus !== undefined && TRANSIENT_HTTP_STATUSES.includes(httpStatus)) return true;
  return false;
}

/** Whether a status/code invalidates the whole provider rather than one model. */
export function isProviderScopedFailure(httpStatus?: number, providerCode?: string): boolean {
  if (httpStatus === 404 && providerCode && MODEL_SCOPED_PROVIDER_CODES.includes(providerCode.toLowerCase())) return false;
  return httpStatus !== undefined && PROVIDER_SCOPED_HTTP_STATUSES.includes(httpStatus);
}

/** Whether a failure is isolated to the selected model and may try a backup. */
export function isModelScopedFailure(httpStatus?: number, providerCode?: string): boolean {
  if (httpStatus === 400) return true;
  return httpStatus === 404 && Boolean(providerCode && MODEL_SCOPED_PROVIDER_CODES.includes(providerCode.toLowerCase()));
}

/**
 * Build the human-readable message of a provider failure from sanitized parts
 * only. The status phrase keeps the historical `HTTP <status>` shape so
 * existing diagnostic classifiers keep working.
 */
export function formatProviderErrorMessage(failure: {
  readonly phase: ProviderPhase;
  readonly httpStatus?: number | undefined;
  readonly providerCode?: string | undefined;
  readonly reason?: string | undefined;
}): string {
  if (failure.httpStatus !== undefined) {
    const suffix = failure.providerCode ? ` [${failure.providerCode}]` : "";
    return `HTTP ${failure.httpStatus}${suffix} (phase=${failure.phase})`;
  }
  return `${failure.reason ?? "provider request failed"} (phase=${failure.phase})`;
}

export interface ProviderRequestErrorOptions {
  readonly provider: ProviderId;
  readonly model: string;
  readonly phase: ProviderPhase;
  readonly category?: Category | undefined;
  readonly httpStatus?: number | undefined;
  /** Raw provider code; sanitized before it is stored. */
  readonly providerCode?: string | undefined;
  readonly retryable?: boolean | undefined;
  /** Short safe reason used when there is no HTTP status. */
  readonly reason?: string | undefined;
  readonly cause?: unknown;
}

/** A failed provider round-trip with sanitized, structured metadata. */
export class ProviderRequestError extends Error {
  readonly code = PROVIDER_REQUEST_FAILED_CODE;
  readonly provider: ProviderId;
  readonly model: string;
  readonly category: Category;
  readonly phase: ProviderPhase;
  readonly httpStatus: number | undefined;
  readonly providerCode: string | undefined;
  readonly retryable: boolean;

  constructor(opts: ProviderRequestErrorOptions) {
    const providerCode = sanitizeProviderCode(opts.providerCode);
    const httpStatus = opts.httpStatus;
    super(formatProviderErrorMessage({ phase: opts.phase, httpStatus, providerCode, ...(opts.reason !== undefined ? { reason: opts.reason } : {}) }), { cause: opts.cause });
    this.name = "ProviderRequestError";
    this.provider = opts.provider;
    this.model = opts.model;
    this.category = opts.category ?? "narrate";
    this.phase = opts.phase;
    this.httpStatus = httpStatus;
    this.providerCode = providerCode;
    this.retryable = opts.retryable ?? isRetryableProviderFailure(opts.phase, httpStatus);
  }

  /** Sanitized projection safe for logs, probes and diagnostics. */
  toFailure(): ProviderRequestFailure {
    return {
      provider: this.provider,
      model: this.model,
      category: this.category,
      phase: this.phase,
      httpStatus: this.httpStatus,
      providerCode: this.providerCode,
      retryable: this.retryable,
    };
  }
}

/**
 * Deliberate provider refusal or unavailability: raised at the router
 * boundary so callers can distinguish it from an empty or malformed response.
 */
export class ProviderUnavailableError extends Error {
  readonly code = PROVIDER_UNAVAILABLE_CODE;
  readonly provider: ProviderId;
  readonly model: string;
  readonly configuredModel: string;

  constructor(
    message: string,
    opts: {
      provider: ProviderId;
      model: string;
      configuredModel: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: opts.cause });
    this.name = "ProviderUnavailableError";
    this.provider = opts.provider;
    this.model = opts.model;
    this.configuredModel = opts.configuredModel;
  }
}

/** Defaults used for legacy errors that carry no provider metadata. */
export interface ProviderFailureContext {
  readonly provider?: ProviderId | undefined;
  readonly model?: string | undefined;
  readonly category?: Category | undefined;
}

function defaultProvider(): ProviderId {
  return LLM_CONFIG.policy.skaldProvider as ProviderId;
}

function isProviderId(value: unknown): value is ProviderId {
  return value === "opencode_zen" || value === "ollama_cloud" || value === "openrouter";
}

/**
 * Normalize any thrown value into a sanitized provider failure.
 *
 * Typed `ProviderRequestError` values keep their metadata; legacy stringly
 * typed errors (`HTTP 503`, `fetch failed`, `empty response`, ...) are
 * classified by message so older call sites keep behaving. Returns `null`
 * when the value carries no recognizable provider failure, which callers
 * treat as "fail fast, do not failover".
 */
export function toProviderFailure(err: unknown, ctx: ProviderFailureContext = {}): ProviderRequestFailure | null {
  if (err instanceof ProviderRequestError) return err.toFailure();

  if (err !== null && typeof err === "object") {
    const typed = err as Partial<ProviderRequestFailure> & { code?: unknown };
    if (typed.code === PROVIDER_REQUEST_FAILED_CODE || isProviderPhase(typed.phase)) {
      const phase = isProviderPhase(typed.phase) ? typed.phase : "transport";
      const httpStatus = typeof typed.httpStatus === "number" ? typed.httpStatus : undefined;
      return {
        provider: isProviderId(typed.provider) ? typed.provider : (ctx.provider ?? defaultProvider()),
        model: typed.model ?? ctx.model ?? "",
        category: typed.category ?? ctx.category ?? "narrate",
        phase,
        httpStatus,
        providerCode: sanitizeProviderCode(typed.providerCode),
        retryable: typeof typed.retryable === "boolean" ? typed.retryable : isRetryableProviderFailure(phase, httpStatus),
      };
    }
  }

  if (err instanceof Error) {
    // Legacy errors carry optional provider/model metadata as plain props.
    const legacy = err as Error & { provider?: unknown; model?: unknown };
    const provider = isProviderId(legacy.provider) ? legacy.provider : (ctx.provider ?? defaultProvider());
    const model = typeof legacy.model === "string" ? legacy.model : (ctx.model ?? "");
    const category = ctx.category ?? "narrate";

    const statusMatch = LEGACY_HTTP_STATUS.exec(err.message);
    if (statusMatch) {
      const httpStatus = Number(statusMatch[1]);
      return {
        provider,
        model,
        category,
        phase: "response_status",
        httpStatus,
        providerCode: undefined,
        retryable: isRetryableProviderFailure("response_status", httpStatus),
      };
    }

    const message = err.message.toLowerCase();
    if (message.includes("aborterror") || message.includes("timeout") || message.includes("timed out")) {
      return { provider, model, category, phase: "transport", httpStatus: undefined, providerCode: undefined, retryable: true };
    }
    if (message.includes("fetch") || message.includes("network") || message.includes("econn") || message.includes("enotfound")) {
      return { provider, model, category, phase: "transport", httpStatus: undefined, providerCode: undefined, retryable: true };
    }
    if (message.includes("empty response") || message.includes("malformed")) {
      return { provider, model, category, phase: "response_shape", httpStatus: undefined, providerCode: undefined, retryable: false };
    }
  }

  return null;
}
