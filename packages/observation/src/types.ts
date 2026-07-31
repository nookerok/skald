/** Observation & Belief Model v1.0 public contract. This module contains no engine. */

/** Simulation time, never wall-clock time. */
export type SimTime = number;
/** Normalized confidence in the interval [0, 1]. */
export type Confidence = number;
/** Stable identity of an observed pattern. */
export type PatternId = string;
/** Stable identity of an observer. */
export type ObserverId = string;
/** Stable identity of evidence. */
export type EvidenceId = string;
/** Stable identity of a hypothesis. */
export type HypothesisId = string;
/** Stable identity of an observation record. */
export type ObservationId = string;

/** Allowed observation lenses. */
export type LensId = "terrain" | "ecology" | "relations" | "emergence" | "history" | "prediction";
/** Kinds of evidence that can support a belief. */
export type EvidenceType = "sensory" | "pattern-match" | "testimony" | "anomaly" | "ritual" | "inference";
/** Provenance of an observation. */
export type ObservationSource = "direct" | "inferred" | "reported" | "myth" | "ritual";
/** Lifecycle status of a hypothesis. */
export type HypothesisStatus = "open" | "strengthening" | "weakening" | "confirmed" | "refuted";
/** Relation kinds that can be observed between patterns. */
export type RelationType = "supports" | "feeds" | "threatens" | "depends" | "enables" | "constrains";
/** Direction of an observed trend. */
export type Trend = "rising" | "stable" | "falling" | "unknown";
/** Emergence lifecycle shown by the emergence lens. */
export type EmergenceStage = "nascent" | "emerging" | "stable" | "collapsing" | "dissolved";

/** A typed reason supporting or weakening an interpretation. */
export interface Evidence {
  readonly id: EvidenceId;
  readonly type: EvidenceType;
  readonly description: string;
  readonly strength: number;
  readonly observedAt: SimTime;
  readonly linkedObservationIds: readonly ObservationId[];
}

/** A provisional interpretation with explicit supporting and contradicting evidence. */
export interface Hypothesis {
  readonly id: HypothesisId;
  readonly targetId: PatternId;
  readonly statement: string;
  readonly confidence: Confidence;
  readonly supportingEvidenceIds: readonly EvidenceId[];
  readonly contradictingEvidenceIds: readonly EvidenceId[];
  readonly status: HypothesisStatus;
  readonly createdAt: SimTime;
  readonly lastUpdated: SimTime;
}

/** Context supplied to an observation request. */
export interface ObservationContext {
  readonly position?: { readonly x: number; readonly y: number; readonly z?: number };
  readonly time: SimTime;
  readonly weather?: string;
  readonly [key: string]: unknown;
}

/** Terrain lens payload. */
export interface TerrainPayload { readonly kind: "terrain"; readonly height?: number; readonly slope?: number; readonly soil?: string; readonly hydrology?: string; readonly climate?: string; }
/** Ecology lens payload. */
export interface EcologyPayload { readonly kind: "ecology"; readonly productivity?: number; readonly diversity?: number; readonly pressure?: number; readonly recovery?: number; }
/** An observer-scoped relation. */
export interface RelationObservation { readonly sourceId: PatternId; readonly targetId: PatternId; readonly type: RelationType; readonly observedStrength: number; readonly confidence: Confidence; readonly trend: Trend; readonly discoveredAt: SimTime; readonly evidenceIds: readonly EvidenceId[]; }
/** Relations lens payload. */
export interface RelationsPayload { readonly kind: "relations"; readonly relations: readonly RelationObservation[]; }
/** Emergence lens payload. */
export interface EmergencePayload { readonly kind: "emergence"; readonly stage: EmergenceStage; readonly stability: number; readonly persistence: number; readonly recovery: number; readonly entropy: number; readonly identityConfidence: number; readonly spiritPotential: number; }
/** History lens payload. */
export interface HistoryPayload { readonly kind: "history"; readonly pastStates: readonly { readonly time: SimTime; readonly description: string; readonly confidence: Confidence }[]; readonly scars: readonly string[]; }
/** A possible future trajectory. */
export interface TrajectoryHypothesis { readonly patternId: string; readonly horizon: SimTime; readonly probability: number; readonly possibleStates: readonly { readonly state: string; readonly probability: number; readonly conditions: readonly string[] }[]; readonly confidence: Confidence; }
/** Prediction lens payload. */
export interface PredictionPayload { readonly kind: "prediction"; readonly trajectories: readonly TrajectoryHypothesis[]; }
/** Union of all lens payloads. */
export type LensPayload = TerrainPayload | EcologyPayload | RelationsPayload | EmergencePayload | HistoryPayload | PredictionPayload;

/** One observer-scoped result produced by the Observation Engine. */
export interface ObservationRecord { readonly id: ObservationId; readonly observerId: ObserverId; readonly targetId: PatternId; readonly lens: LensId; readonly observedAt: SimTime; readonly confidence: Confidence; readonly freshness: Confidence; readonly source: ObservationSource; readonly evidence: readonly Evidence[]; readonly hypothesisIds: readonly HypothesisId[]; readonly payload: LensPayload; }
/** A factor in an existence explanation. */
export interface Factor { readonly relatedPatternId?: PatternId; readonly description: string; readonly strength: number; readonly confidence: Confidence; readonly evidenceIds: readonly EvidenceId[]; }
/** A condition under which a pattern may collapse. */
export interface CollapseCondition { readonly description: string; readonly thresholdExpression: string; readonly currentProximity: number; readonly confidence: Confidence; }
/** Structured explanation of why a pattern persists. */
export interface ExistenceExplanation { readonly patternId: string; readonly confidence: Confidence; readonly supportingFactors: readonly Factor[]; readonly weakeningFactors: readonly Factor[]; readonly criticalDependencies: readonly Factor[]; readonly collapseConditions: readonly CollapseCondition[]; }
/** One observer-visible causal relation. */
export interface CausalStep { readonly fromId: string; readonly toId: string; readonly relationType: string; readonly observedStrength: number; readonly evidenceIds: readonly EvidenceId[]; readonly confidence: Confidence; }
/** An incomplete-safe causal chain. */
export interface CausalChain { readonly rootId: string; readonly steps: readonly CausalStep[]; readonly confidence: Confidence; readonly incomplete: boolean; }
/** Current interpretation of one pattern. */
export interface PatternBelief { readonly patternId: PatternId; readonly currentInterpretation: string; readonly confidence: Confidence; readonly supportingEvidence: readonly Evidence[]; readonly openHypotheses: readonly Hypothesis[]; readonly existenceExplanation?: ExistenceExplanation; readonly lastObserved: SimTime; }
/** Persistent conflict between evidence and interpretation. */
export interface Contradiction { readonly id: string; readonly description: string; readonly involvedHypothesisIds: readonly HypothesisId[]; readonly involvedEvidenceIds: readonly EvidenceId[]; readonly detectedAt: SimTime; }
/** In-memory observer-scoped read model. */
export interface BeliefModel { readonly schemaVersion: 1; readonly observerId: ObserverId; readonly beliefs: ReadonlyMap<PatternId, PatternBelief>; readonly activeHypotheses: readonly Hypothesis[]; readonly knownRelations: readonly RelationObservation[]; readonly contradictions: readonly Contradiction[]; readonly lastUpdated: SimTime; }
/** JSON-safe HTTP representation of BeliefModel. */
export interface BeliefModelDTO { readonly schemaVersion: 1; readonly observerId: ObserverId; readonly beliefs: readonly PatternBelief[]; readonly activeHypotheses: readonly Hypothesis[]; readonly knownRelations: readonly RelationObservation[]; readonly contradictions: readonly Contradiction[]; readonly lastUpdated: SimTime; }
/** An observable target summary. */
export interface ObservablePattern { readonly patternId: PatternId; readonly confidence: Confidence; readonly lastSeen: SimTime; }

/** Public read-only operations of the Observation Contract. */
export interface ObservationAPI {
  observe(targetId: PatternId, observerId: ObserverId, lens: LensId, context?: ObservationContext): ObservationRecord | null;
  queryRelations(patternId: PatternId, observerId: ObserverId, filters?: Partial<{ type: RelationType; minStrength: number }>): readonly RelationObservation[];
  queryHistory(patternId: PatternId, observerId: ObserverId, timeRange?: { from: SimTime; to: SimTime }): readonly ObservationRecord[];
  listObservable(observerId: ObserverId, lens?: LensId): readonly ObservablePattern[];
  explainExistence(patternId: PatternId, observerId: ObserverId): ExistenceExplanation;
  trace(rootId: string, observerId: ObserverId, maxDepth?: number): CausalChain;
}
