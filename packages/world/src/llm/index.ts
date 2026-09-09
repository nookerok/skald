export { ModelRouter } from "./router.js";
export type { ChatCandidateOptions, ChatOptions, ModelRouterOptions } from "./router.js";
export {
  chatOnce,
  readProviderErrorCode,
  shouldFallback,
  shouldRetrySameCandidate,
  shouldTryNextCandidate,
} from "./http.js";
export type { ChatOnceOptions, HttpResult } from "./http.js";
export {
  discoverLiveRoutes,
  discoverOllamaRoutes,
  discoverOpenCodeRoutes,
  fetchOpenCodeCatalog,
  liveModelSelectionFingerprint,
} from "./catalog.js";
export type {
  CandidateProbeResult,
  CandidateProbeStatus,
  CatalogPhase,
  LiveModelSelectionOptions,
  LiveModelSelectionReport,
  LiveRouteDiscoveryOptions,
  ModelCandidateReport,
  ModelExclusionReason,
  OllamaDiscoveryOptions,
  OpenCodeCatalogOptions,
  OpenCodeCatalogReport,
  OpenCodeCatalogStatus,
} from "./catalog.js";
export { classifyPayload, scanForSecrets, enforceDataPolicy } from "./data-policy.js";
export { loadHealth, saveHealth, checkModel, classifyModelError } from "./health.js";
export {
  LLM_CONFIG,
  OPENCODE_PREFERRED_MODELS,
  OLLAMA_CLOUD_BACKUP_MODEL,
  candidateForModel,
  configuredProviders,
  criticalRouteConfigIssues,
  llmConfigFingerprint,
  protocolForModel,
  providerForModel,
  providersWithKeys,
  routeCandidates,
} from "./config.js";
export type { LLMConfig, PolicyConf, ProviderConf } from "./config.js";
export {
  PROVIDER_REQUEST_FAILED_CODE,
  PROVIDER_SCOPED_HTTP_STATUSES,
  PROVIDER_UNAVAILABLE_CODE,
  ProviderRequestError,
  ProviderUnavailableError,
  TRANSIENT_HTTP_STATUSES,
  formatProviderErrorMessage,
  isProviderScopedFailure,
  isModelScopedFailure,
  isRetryableProviderFailure,
  sanitizeProviderCode,
  MODEL_SCOPED_PROVIDER_CODES,
  toProviderFailure,
} from "./errors.js";
export type { ProviderFailureContext, ProviderRequestErrorOptions } from "./errors.js";
export { probeAIReadiness } from "./provider-probe.js";
export type { AIReadinessReport, AIProbeRoute, RouteProbeResult, RouteProbeStatus } from "./provider-probe.js";
export type * from "./types.js";
