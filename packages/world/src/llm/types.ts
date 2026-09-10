export type ProviderId = "opencode_zen" | "ollama_cloud" | "openrouter";
export type Category = "narrate" | "analyze" | "interpret";
export type HealthStatus = "ok" | "degraded" | "rate_limited" | "forbidden" | "network_error" | "server_error" | "unknown";

/**
 * Wire protocol a provider speaks for chat completions. The HTTP transport
 * branches on this value instead of guessing from the model id.
 *
 * `openai_chat` is `/chat/completions` with `messages`/`max_tokens` and a
 * `choices` response. `openai_responses` is `/responses` with
 * `input`/`max_output_tokens` and an `output_text`/`output` response.
 */
export type ProviderProtocol = "openai_chat" | "openai_responses" | "ollama_chat";

/**
 * Role of a candidate inside a route matrix.
 *
 * `paid_primary`/`paid_backup` describe the historical static matrix.
 * `catalog_candidate` is a preference before live selection; `live_primary`,
 * `live_backup` and `live_fallback` are assigned only after catalogue and
 * authenticated no-world probes. `free_emergency` is the deterministic
 * emergency tier and never counts as production readiness.
 */
export type RouteTier =
  | "paid_primary"
  | "paid_backup"
  | "free_emergency"
  | "catalog_candidate"
  | "live_primary"
  | "live_backup"
  | "live_fallback";

/**
 * One explicit `provider + model + protocol` hop of a route. Routes are
 * ordered candidate lists, not model-name lists, so provider selection is
 * data and never a model-name heuristic.
 */
export interface RouteCandidate {
  readonly provider: ProviderId;
  readonly model: string;
  readonly protocol: ProviderProtocol;
  readonly tier: RouteTier;
}

/**
 * Stage of a provider round-trip at which a failure happened. Used for
 * diagnostics and for separating retry from failover decisions.
 */
export type ProviderPhase =
  | "configuration"
  | "model_selection"
  | "request"
  | "transport"
  | "response_status"
  | "response_decode"
  | "response_shape"
  | "schema_validation";

/**
 * Sanitized description of a failed provider interaction. Contains only
 * operational metadata: never a prompt, response body, header or API key.
 */
export interface ProviderRequestFailure {
  readonly provider: ProviderId;
  readonly model: string;
  readonly category: Category;
  readonly phase: ProviderPhase;
  readonly httpStatus?: number | undefined;
  /** Provider error code after sanitization; `undefined` when unusable. */
  readonly providerCode?: string | undefined;
  /** Whether repeating the identical request may succeed. */
  readonly retryable: boolean;
}

export interface Route {
  readonly category: Category;
  /** Ordered provider-aware candidates. Selection follows this order. */
  readonly candidates: readonly RouteCandidate[];
  /** Compatibility projection: `candidates` model names in the same order. */
  readonly models: readonly string[];
  readonly maxTokens: number;
  readonly allowFreeRouter: boolean;
  readonly dataClasses: readonly string[];
  readonly thinking: boolean | null;
  readonly timeoutMs?: number;
}

export interface RouterDecision {
  readonly category: Category;
  readonly selectedModel: string;
  readonly candidateModels: readonly string[];
  readonly candidates: readonly RouteCandidate[];
  readonly selectedCandidate: RouteCandidate;
  readonly dataClass: string;
  readonly reason: string;
  readonly healthStatus: HealthStatus | "unknown";
  readonly usedHealthCache: boolean;
  readonly provider: ProviderId;
}

export interface ChatResult {
  readonly model: string;
  readonly configuredModel: string;
  /** Provider selected by the router before any model/provider failover. */
  readonly configuredProvider?: ProviderId | undefined;
  readonly responseModel: string;
  readonly usedFallback: boolean;
  readonly text: string;
  readonly latencyMs: number;
  readonly usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  readonly provider: ProviderId;
  /** Tier of the candidate that produced this result. */
  readonly tier?: RouteTier | undefined;
}

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface RouterDiagnostic {
  readonly level: "OK" | "WARN" | "ERROR";
  readonly message: string;
}
