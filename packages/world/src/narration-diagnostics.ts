/**
 * Structured narration diagnostic contract (Stage 4).
 *
 * Provides a typed error taxonomy for LLM narration outcomes, a diagnostic
 * sink callback for operational telemetry, and classification helpers.
 * Diagnostics are read-side operational signals — they never modify world
 * state, Event Log or Projection.
 */

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
  | "empty_response"
  | "schema_rejection"
  | "persistence_error"
  | "queue_eviction"
  | "runner_failure"
  | "unknown_provider_error";

/** Whether a transient failure was retried and the outcome. */
export type RetryOutcome = "none" | "succeeded_on_retry" | "exhausted";

// ---------------------------------------------------------------------------
// Diagnostic events
// ---------------------------------------------------------------------------

/** Diagnostic event emitted per LLM narration attempt. */
export interface NarrationLLMDiagnosticEvent {
  readonly kind: "llm";
  readonly category: NarrationErrorCategory;
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
  readonly retryOutcome: RetryOutcome;
}

/** Diagnostic event emitted by the scheduler on persistence/queue failures. */
export interface NarrationSchedulerDiagnosticEvent {
  readonly kind: "scheduler";
  readonly category: "persistence_error" | "queue_eviction" | "runner_failure";
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
}

/** Union of all narration diagnostic events. */
export type NarrationDiagnosticEvent =
  | NarrationLLMDiagnosticEvent
  | NarrationSchedulerDiagnosticEvent;

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
