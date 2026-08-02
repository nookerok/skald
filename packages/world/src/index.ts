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
export { parseBeliefModelDTO, parseObservationRecord } from "@skald/observation";
export type * from "./presentation/types.js";
export { buildTurnJournal } from "./journal/builder.js";
export type * from "./journal/types.js";
export { buildDiscoveryJournal, DEFINITIONS } from "./discovery/index.js";
export type * from "./discovery/types.js";
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
export { buildPlayerGuidance, GUIDANCE_ACTIONS } from "./guidance/index.js";
export type * from "./guidance/types.js";
export { CHARACTER_PRESETS, WORLD_TEMPLATES, getCharacterPreset, getWorldTemplate, listCharacterPresets, listWorldTemplates, buildBootstrapEvents } from "./setup/index.js";
export type { CharacterPreset, WorldTemplate } from "./setup/types.js";
export { buildGameShellSnapshot, buildShellDelta } from "./game-shell/index.js";
export type * from "./game-shell/types.js";
export { observationLabel, consequenceLabel, relationTargetLabel, relationKindLabel, blockedReasonLabel, operationLabel } from "./game-shell/player-facing.js";
export { narrateLLM } from "./narrative-llm.js";
export type { NarrativeLLMResult } from "./narrative-llm.js";
export { ModelRouter } from "./llm/router.js";
export { chatOnce, shouldFallback } from "./llm/http.js";
export { classifyPayload, scanForSecrets, enforceDataPolicy } from "./llm/data-policy.js";
export { loadHealth, saveHealth, checkModel, classifyModelError } from "./llm/health.js";
export { LLM_CONFIG } from "./llm/config.js";
export type * from "./llm/types.js";

// Iteration 15 — Objects & Locations
export * from "./objects/index.js";
export * from "./entities/index.js";
export {
  interactionResolveTarget,
  interactionResolveLaw,
  resolveInteractionLaw,
  perceptionExamine,
  examinedCuriosity,
  findExamineTarget,
  worldInteractionRules,
} from "./rules/world-interaction.js";
export { interactionRegistry, getInteractionDefinition, isKnownInteractionVerb } from "./interaction-registry.js";
export { interactionRules } from "./rules/interaction.js";
export { criticalCheckRules, criticalCheckOutcomeRules } from "./checks/index.js";
export { createRules } from "./rules/registry.js";
export type { CriticalCheckState, CheckKind, CheckOutcome, DieType, CriticalModifier } from "./checks/types.js";

// UX-6 — Observer presence reconstruction (read-only)
export {
  buildObserverSession,
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