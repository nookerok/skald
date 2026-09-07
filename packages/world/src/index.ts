export * from "./map.js";
export * from "./projection.js";
export * from "./command-handler.js";
export * from "./bootstrap.js";
export * from "./event-types.js";
export * from "./ids.js";
export { physicsMovement } from "./rules/physics-movement.js";
export {
  riskTaker,
  wallCaution,
  edgeAwareness,
  impatience,
  worldReactionFear,
  observationRules,
} from "./rules/observations.js";
export { repercussion, expire, fire } from "./rules/consequences.js";
export { start, forestFireSpread, end } from "./rules/situations.js";
export {
  buildBiographyGraph,
  findCausalChain,
  findDescendants,
  findCrossReference,
} from "./biography.js";
export { giveRule } from "./rules/relations.js";
export { heatSpread } from "./rules/heat.js";
export { durationCheck } from "./rules/duration-check.js";
export { playerStrategy } from "./rules/player-strategy.js";
export { PREDICATES, ACTIONS } from "./strategy-registry.js";
export type { PredicateFn, ActionFn, ActionIntent } from "./strategy-registry.js";
export type {
  Consequence,
  FiredConsequence,
  ActiveSituation,
  RelationEdge,
  HeatSource,
  StrategyEntry,
} from "./projection.js";
export type {
  BiographyNode,
  BiographyGraph,
  CausalChainStep,
} from "./biography.js";
export {
  formatEvent,
  formatWorldState,
  buildNarrative,
} from "./narrative.js";
export type {
  NarrativeEntry,
  NarrativeSnapshot,
} from "./narrative.js";
export { selectTurnPresentation } from "./presentation/selector.js";
export { actionFallbackText, isGenericActionFallback } from "./presentation/action-fallback.js";
export { parseBeliefModelDTO, parseObservationRecord } from "@skald/observation";
export type * from "./presentation/types.js";
export { buildTurnJournal, attachTurnNarrations } from "./journal/builder.js";
export { narrationKey } from "./journal/identity.js";
export type * from "./journal/types.js";
export { buildDiscoveryJournal, DEFINITIONS, toPlayerDiscoveryJournal } from "./discovery/index.js";
export type * from "./discovery/types.js";
export type { PlayerDiscoveryCard, PlayerDiscoveryEvidence, PlayerDiscoveryJournal, PlayerDiscoveryRumor } from "./discovery/index.js";
export { buildBeliefModel, buildDiscoveryJournalFromBeliefModel, createObservationAPI, serializeBeliefModel } from "./observation/index.js";
export type {
  SimTime, Confidence, PatternId, ObserverId, EvidenceId, HypothesisId, ObservationId,
  LensId, EvidenceType, ObservationSource, HypothesisStatus, RelationType, Trend, EmergenceStage,
  Evidence, Hypothesis, ObservationContext, TerrainPayload, EcologyPayload, RelationObservation,
  RelationsPayload, EmergencePayload, HistoryPayload, TrajectoryHypothesis, PredictionPayload,
  LensPayload, ObservationRecord, Factor, CollapseCondition, ExistenceExplanation,
  CausalChain, PatternBelief, Contradiction, BeliefModel, BeliefModelDTO, ObservablePattern, ObservationAPI,
  CausalStep as ObservationCausalStep,
} from "./observation/types.js";
export { buildPlayerGuidance, buildObserverGuidanceContext, GUIDANCE_ACTIONS } from "./guidance/index.js";
export type * from "./guidance/types.js";
export {
  MASTER_TURN_AVAILABLE_ACTIONS,
  MASTER_TURN_MAX_TOPICS,
  buildMasterTurnSceneContext,
} from "./master-turn/observer-context.js";
export type {
  MasterAvailableAction,
  MasterKnowledgeTopic,
  MasterSceneItem,
  MasterSceneReferent,
  MasterSceneReferentKind,
  MasterSceneReference,
  MasterSceneSituation,
  MasterTurnSceneContext,
  MasterTurnSceneSnapshot,
} from "./master-turn/observer-context.js";
export { CHARACTER_BACKGROUNDS, CHARACTER_PRESETS, WORLD_TEMPLATES, getCharacterBackground, getCharacterPreset, getWorldTemplate, listCharacterBackgrounds, listCharacterPresets, listWorldTemplates, listPlayerWorldTemplates, buildBootstrapEvents, listRegionEntrypoints, getRegionEntrypoint, getDefaultRegionEntrypoint, buildPrologue, buildPrologueFromFirstEntry } from "./setup/index.js";
export type { CharacterBackground, CharacterPreset, WorldTemplate, WorldTemplateAudience, RegionEntrypoint, PrologueDTO } from "./setup/types.js";
export type { BootstrapSelection } from "./setup/bootstrap-builder.js";
export { buildGameShellSnapshot, buildShellDelta } from "./game-shell/index.js";
export type * from "./game-shell/types.js";
export { buildPlayerKnowledgePresentation } from "./game-shell/knowledge-view.js";
export { buildInquiryAnswer, INQUIRY_QUERY_HANDLERS } from "./inquiry/index.js";
export type { InquiryAnswerDTO, InquiryReadContext, InquiryQueryHandler } from "./inquiry/index.js";
export { observationLabel, consequenceLabel, situationLabel, relationTargetLabel, relationKindLabel, blockedReasonLabel, operationLabel, relationTargetLabelOrRaw, sanitizePlayerFacingText } from "./game-shell/player-facing.js";
export { localizedPlayerText } from "./game-shell/player-facing.js";
export { narrateLLM, narrateTurnLLM, verifyEpistemicNarration } from "./narrative-llm.js";
export type {
  TurnNarration,
  NarrativeLLMResult,
  GuardFact,
  NarrationClaim,
  StructuredNarration,
  NarrationGuardResult,
  NarrationGuardOptions,
} from "./narrative-llm.js";
export {
  classifyNarrationError,
  isTransientNarrationError,
} from "./narration-diagnostics.js";
export type {
  NarrationErrorCategory,
  RetryOutcome,
  NarrationOutcome,
  NarrationLLMDiagnosticEvent,
  NarrationSchedulerDiagnosticEvent,
  NarrationContextDiagnosticEvent,
  NarrationDiagnosticEvent,
  NarrationDiagnosticSink,
  AIDiagnosticEvent,
  AIDiagnosticSink,
  NarrationOptions,
} from "./narration-diagnostics.js";
export { ModelRouter } from "./llm/router.js";
export type { ChatCandidateOptions, ChatOptions, ModelRouterOptions } from "./llm/router.js";
export {
  chatOnce,
  readProviderErrorCode,
  shouldFallback,
  shouldRetrySameCandidate,
  shouldTryNextCandidate,
} from "./llm/http.js";
export type { ChatOnceOptions, HttpResult } from "./llm/http.js";
export {
  discoverOpenCodeRoutes,
  fetchOpenCodeCatalog,
  liveModelSelectionFingerprint,
} from "./llm/catalog.js";
export type {
  CandidateProbeResult,
  CandidateProbeStatus,
  CatalogPhase,
  LiveModelSelectionOptions,
  LiveModelSelectionReport,
  ModelCandidateReport,
  ModelExclusionReason,
  OpenCodeCatalogOptions,
  OpenCodeCatalogReport,
  OpenCodeCatalogStatus,
} from "./llm/catalog.js";
export { classifyPayload, scanForSecrets, enforceDataPolicy } from "./llm/data-policy.js";
export { loadHealth, saveHealth, checkModel, classifyModelError } from "./llm/health.js";
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
} from "./llm/config.js";
export type { LLMConfig, PolicyConf, ProviderConf } from "./llm/config.js";
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
} from "./llm/errors.js";
export type { ProviderFailureContext, ProviderRequestErrorOptions } from "./llm/errors.js";
export { probeAIReadiness } from "./llm/provider-probe.js";
export type { AIReadinessReport, AIProbeRoute, RouteProbeResult, RouteProbeStatus } from "./llm/provider-probe.js";
export type * from "./llm/types.js";

// Iteration 15 — Objects & Locations
export * from "./objects/index.js";
export * from "./entities/index.js";
export * from "./resource/index.js";
export {
  interactionResolveTarget,
  interactionResolveLaw,
  resolveInteractionLaw,
  worldInteractionRules,
} from "./rules/world-interaction.js";
export { perceptionObserve, examinedCuriosity, perceptionRules } from "./rules/interactions/perception.js";
export { listeningListen, authoredWaystationRumor, listeningRules } from "./rules/interactions/listening.js";
export { interactionRegistry, getInteractionDefinition, isKnownInteractionVerb } from "./interaction-registry.js";
export { interactionRules } from "./rules/interaction.js";
export { criticalCheckRules, criticalCheckOutcomeRules } from "./checks/index.js";
export { createRules } from "./rules/registry.js";
export type { CriticalCheckState, CheckKind, CheckOutcome, DieType, CriticalModifier } from "./checks/types.js";

// Interaction Model v1 — unified target resolver and adapter (ADR-0013)
export { resolveInteractionTarget, targetFromEntity, targetFromObject } from "./interactions/index.js";
export type {
  InteractionTarget,
  PlayerFacingCandidate,
  TargetResolution,
} from "./interactions/index.js";

// UX-6 — Observer presence reconstruction (read-only)
export {
  buildObserverSession,
  buildFirstEntry,
  buildObserverSessionAndSummary,
  buildWorldPresenceSummary,
  buildPresenceDiagnostics,
  computePresenceDrift,
  resolveCheckpointState,
  reconstructCheckpointModel,
  reconstructCurrentModel,
  findDormantThreads,
  computeBeliefDrift,
  computeBeliefRevision,
  buildDriftReasons,
  STALE_FRESHNESS_THRESHOLD,
} from "./presence/index.js";
export type * from "./presence/types.js";

// UX-6.2 — Observer active threads (pure read model)
export {
  buildObserverThreadJournal,
  buildObserverThreadDelta,
  OBSERVER_THREAD_DEFINITIONS,
  definitionForThreadKey,
  classifyThread,
  computeThreadRef,
  threadKeyToPatternId,
  signalRank,
  MAX_THREADS,
  MAX_EVIDENCE,
  MAX_RECENTLY_RESOLVED,
  REMEMBERED_MAX_AGE,
} from "./observer-threads/index.js";
export type * from "./observer-threads/types.js";

// UX-6.3 — Offline intent queue (pure classification)
export { resolveOfflineIntent } from "./offline-intent/index.js";
export type {
  OfflineClassificationContext,
  OfflineIntentResolution,
  OfflineRejectReason,
  OfflineIntentEnvelope,
  OfflineIntentResolutionDTO,
} from "./offline-intent/index.js";

// Spatial Movement (ADR-0015)
export * from "./journey/index.js";
export { journeyStart } from "./rules/journey-start.js";
export { journeyProgress } from "./rules/journey-progress.js";
export { journeyInterrupt } from "./rules/journey-interrupt.js";
export { createJourneyValidationRule } from "./rules/journey-validation.js";

// Visibility Engine (ADR-0016)
export * from "./visibility/index.js";

// River Hydrology (ADR-0017)
export { riverLevelProcess } from "./rules/river-level.js";
export { crossingCondition } from "./rules/crossing-condition.js";

// Weather (ADR-0020, influences graph)
export { weatherProcess } from "./rules/weather.js";
export { computeWeatherState } from "./weather/process.js";
export { WeatherProjector } from "./weather/projector.js";
export type { WeatherProcessDefinition, WeatherState, WeatherReadView } from "./weather/types.js";

// Heat Transfer (PR-7.1, second independent system)
export { heatTransferProcess } from "./rules/heat-transfer.js";
export { computeHeatTransfer, classifyThermalZone } from "./heat/process.js";
export { HeatProjector } from "./heat/projector.js";
export type { HeatProcessDefinition, ThermalState, HeatReadView } from "./heat/types.js";

// Settlement Pattern (PR-7.4, first long-lived object)
export { settlementPattern } from "./rules/settlement-pattern.js";
export { computeSettlementTick } from "./rules/settlement-pattern.js";
export { SettlementProjector } from "./settlement/projector.js";
export type { SettlementDefinition, SettlementState, SettlementReadView } from "./settlement/types.js";

// First living region — deterministic spatial bootstrap and observer map
export * from './action-capability/index.js';
export { actionCapabilityRules, itemPossession, containerAccess, affordanceUse, phenomenonObservation } from './rules/interactions/action-capability.js';
export * from "./region/index.js";
export { buildBackgroundNarrativeContext, buildNarrativeAdapterContext } from "./setup/background-context.js";
export type {
  BackgroundNarrativeContext,
  NarrativeFact,
  NarrativeFactEpistemicClass,
  NarrativeFactSource,
  NarrativeAdapterContext,
  NarrativeAdapterContextOptions,
} from "./setup/background-context.js";
