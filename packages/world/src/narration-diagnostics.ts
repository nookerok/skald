/**
 * Structured narration diagnostic contract (Stage 4).
 *
 * Provides a typed error taxonomy for LLM narration outcomes, a diagnostic
 * sink callback for operational telemetry, and classification helpers.
 * Diagnostics are read-side operational signals — they never modify world
 * state, Event Log or Projection.
 */

import { ProviderUnavailableError, PROVIDER_UNAVAILABLE_CODE, toProviderFailure } from "./llm/errors.js";
import type { NarrativeAdapterContext } from "./setup/background-context.js";

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------

/** Concrete error/outcome category for narration attempts. */
export type NarrationErrorCategory =
  | "success"
  | "no_api_key"
  | "timeout"
  | "network"
  | "provider_429"
  | "provider_5xx"
  | "provider_unavailable"
  | "empty_response"
  | "schema_rejection"
  | "persistence_error"
  | "queue_eviction"
  | "runner_failure"
  | "context_error"
  | "unknown_provider_error";

/** Whether a transient failure was retried and the outcome. */
export type RetryOutcome = "none" | "succeeded_on_retry" | "exhausted";

/**
 * High-level outcome distinguishing provider-level failover (the LLM responded
 * but on a non-configured model after a provider failure) from deterministic
 * fallback (template/no-key/epistemic-violation — no LLM prose was produced).
 */
export type NarrationOutcome =
  | "success"
  | "provider_failover"
  | "retrying"
  | "deterministic_fallback"
  | "retry_exhausted"
  | "persistence_error"
  | "queue_eviction"
  | "runner_failure"
  | "context_error";

// ---------------------------------------------------------------------------
// Diagnostic events
// ---------------------------------------------------------------------------

/** Diagnostic event emitted per LLM narration attempt. */
export interface NarrationLLMDiagnosticEvent {
  readonly kind: "llm";
  readonly category: NarrationErrorCategory;
  /** High-level outcome: success, provider_failover, deterministic_fallback, etc. */
  readonly outcome: NarrationOutcome;
  /** Model name or router providerId — never raw URL/key. */
  readonly provider: string;
  /** Wall-clock duration of this attempt in ms. */
  readonly durationMs: number;
  /** Alias for worldTime used by operational consumers that call it turn. */
  readonly turn: number;
  readonly worldTime: number;
  readonly attempt: number;
  readonly priority: "interactive" | "batch";
  /** Configured request timeout in ms for this route. */
  readonly timeout: number;
  /** Configured request timeout under the shared operational name. */
  readonly timeoutMs?: number | undefined;
  /** Provider transport phase, when this event represents a provider attempt. */
  readonly phase?: string | undefined;
  /** Safe provider HTTP status/code, when available. */
  readonly httpStatus?: number | undefined;
  readonly providerCode?: string | undefined;
  readonly retryOutcome: RetryOutcome;
  /** World this narration belongs to. */
  readonly worldId?: string | undefined;
  /** ISO-8601 wall-clock timestamp when the diagnostic was recorded. */
  readonly recordedAt?: string | undefined;
  /** Correlation identifier linking to the originating command/turn. */
  readonly correlationId?: string | undefined;
  /** Actual model used for the LLM call. */
  readonly model?: string | undefined;
  /** Configured (preferred) model before any failover. */
  readonly configuredModel?: string | undefined;
}

/** Diagnostic event emitted by the scheduler on persistence/queue failures. */
export interface NarrationSchedulerDiagnosticEvent {
  readonly kind: "scheduler";
  readonly category: "persistence_error" | "queue_eviction" | "runner_failure";
  /** High-level outcome for scheduler events. */
  readonly outcome: NarrationOutcome;
  readonly provider: "scheduler";
  readonly durationMs: 0;
  readonly attempt: 0;
  readonly timeout: 0;
  readonly retryOutcome: "none";
  readonly turn: number;
  readonly worldTime: number;
  readonly priority: "interactive" | "batch";
  /** Sanitized message — no raw error text, no stack, no provider URLs. */
  readonly detail?: string | undefined;
  /** World this narration belongs to. */
  readonly worldId?: string | undefined;
  /** ISO-8601 wall-clock timestamp when the diagnostic was recorded. */
  readonly recordedAt?: string | undefined;
  /** Correlation identifier linking to the originating command/turn. */
  readonly correlationId?: string | undefined;
}

/** Read-side adapter diagnostic emitted when observer context cannot be built. */
export interface NarrationContextDiagnosticEvent {
  readonly kind: "context";
  readonly category: "context_error";
  readonly outcome: "context_error";
  readonly provider: "adapter";
  readonly durationMs: number;
  readonly attempt: 0;
  readonly timeout: 0;
  readonly retryOutcome: "none";
  readonly turn: number;
  readonly worldTime: number;
  readonly priority: "interactive" | "batch";
  readonly detail?: string | undefined;
  readonly worldId?: string | undefined;
  readonly recordedAt?: string | undefined;
  readonly correlationId?: string | undefined;
}

/** Union of all narration diagnostic events. */
export type NarrationDiagnosticEvent =
  | NarrationLLMDiagnosticEvent
  | NarrationSchedulerDiagnosticEvent
  | NarrationContextDiagnosticEvent
  | AIDiagnosticEvent;

/**
 * Shared operational AI diagnostic contract.  The older narration-specific
 * event shapes remain part of NarrationDiagnosticEvent for compatibility;
 * newly instrumented providers, Intent Gateway and readiness probes use this
 * shape.  It deliberately contains only sanitized operational metadata.
 */
export interface AIDiagnosticEvent {
  readonly kind: "provider" | "intent" | "narration" | "probe" | "scheduler";
  readonly category: string;
  readonly outcome: string;
  readonly provider: string;
  readonly model?: string;
  readonly configuredModel?: string;
  readonly phase?: string;
  readonly httpStatus?: number;
  readonly providerCode?: string;
  readonly attempt: number;
  readonly durationMs: number;
  /** New name used by the operational contract. */
  readonly timeoutMs: number;
  /** Legacy spelling retained for old diagnostic consumers. */
  readonly timeout?: number;
  readonly priority: "interactive" | "batch";
  readonly correlationId?: string;
  readonly worldTime?: number;
  /** Legacy world/turn fields may be present on narration events. */
  readonly worldId?: string;
  readonly turn?: number;
  readonly recordedAt?: string;
}

export type AIDiagnosticSink = (event: AIDiagnosticEvent) => void;

/** Callback type for receiving narration diagnostic events. */
export type NarrationDiagnosticSink = (event: NarrationDiagnosticEvent) => void;

// ---------------------------------------------------------------------------
// Options passed to narrateLLM / narrateTurnLLM
// ---------------------------------------------------------------------------

export interface NarrationOptions {
  readonly diagnostics?: NarrationDiagnosticSink;
  readonly maxRetries?: number;
  readonly retryBaseMs?: number;
  /** Request timeout in ms for diagnostic reporting. */
  readonly timeoutMs?: number;
  /** Queue priority associated with this narration attempt. */
  readonly priority?: "interactive" | "batch";
  /** World this narration belongs to — threaded into diagnostic events. */
  readonly worldId?: string;
  /** Correlation identifier linking to the originating command/turn. */
  readonly correlationId?: string;
  /** Bounded observer-safe facts for the non-authoritative narration adapter. */
  readonly narrativeContext?: NarrativeAdapterContext;
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Classify an error or fallback reason into a concrete narration error
 * category. Pure and deterministic.
 */
export function classifyNarrationError(
  err: unknown,
  fallbackReason: string | null,
): NarrationErrorCategory {
  // Fast-path: already classified fallback reasons from existing code
  if (fallbackReason === "no_api_key") return "no_api_key";
  if (fallbackReason?.startsWith("epistemic_violation:")) return "schema_rejection";

  // Typed error: ProviderUnavailableError from ModelRouter.chat boundary
  if (err instanceof ProviderUnavailableError) return "provider_unavailable";
  if (
    err && typeof err === "object"
    && (err as { code?: unknown }).code === PROVIDER_UNAVAILABLE_CODE
  ) return "provider_unavailable";

  const providerFailure = toProviderFailure(err);
  if (providerFailure) {
    if (providerFailure.httpStatus === 429) return "provider_429";
    if ([500, 502, 503, 504].includes(providerFailure.httpStatus ?? -1)) return "provider_5xx";
    if (providerFailure.phase === "transport") {
      return err instanceof Error && (err.message.includes("AbortError") || err.message.includes("timeout") || err.message.includes("timed out"))
        ? "timeout"
        : "network";
    }
    if (providerFailure.phase === "response_shape") return "empty_response";
    if (providerFailure.phase === "schema_validation") return "schema_rejection";
    if (providerFailure.phase === "response_decode") return "unknown_provider_error";
    if (providerFailure.httpStatus !== undefined) return "provider_unavailable";
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();

    // Provider status codes are checked before generic network wording so a
    // structured HTTP failure keeps its more useful provider category.
    if (msg.includes("http ")) {
      for (const code of RETRYABLE_HTTP_STATUSES) {
        if (msg.includes(String(code))) {
          return code === 429 ? "provider_429" : "provider_5xx";
        }
      }
      if (msg.includes("http 408")) return "timeout";
    }

    // Timeout / abort
    if (msg.includes("aborterror") || msg.includes("timeout") || msg.includes("timed out")) return "timeout";

    // Network / fetch
    if (msg.includes("fetch") || msg.includes("network")) return "network";

    // Empty response
    if (msg.includes("empty response")) return "empty_response";

    // Explicit provider-level failure (deliberate refusal, unavailable, etc.)
    if (msg.includes("deliberate") || msg.includes("provider_unavailable")) return "provider_unavailable";
  }

  return "unknown_provider_error";
}

/**
 * Whether the given error category is transient and worth retrying.
 * Pure and deterministic.
 */
export function isTransientNarrationError(category: NarrationErrorCategory): boolean {
  return category === "timeout"
    || category === "network"
    || category === "provider_429"
    || category === "provider_5xx";
}
