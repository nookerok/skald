/**
 * Observation & Belief read model.
 *
 * This module deliberately contains no domain events or rules. It translates
 * recorded evidence into the observer's incomplete, time-decaying model.
 */
export type SimTime = number;
export type Confidence = number;
export type PatternId = string;
export type ObserverId = string;
export type EvidenceId = string;
export type HypothesisId = string;
export type ObservationId = string;

export type LensId =
  | "terrain"
  | "ecology"
  | "relations"
  | "emergence"
  | "history"
  | "prediction";

export type EvidenceType =
  | "sensory"
  | "pattern-match"
  | "testimony"
  | "anomaly"
  | "ritual"
  | "inference";

export type ObservationSource = "direct" | "inferred" | "reported" | "myth" | "ritual";
export type HypothesisStatus = "open" | "strengthening" | "weakening" | "confirmed" | "refuted";
export type RelationType = "supports" | "feeds" | "threatens" | "depends" | "enables" | "constrains";
export type Trend = "rising" | "stable" | "falling" | "unknown";
export type EmergenceStage = "nascent" | "emerging" | "stable" | "collapsing" | "dissolved";

export interface Evidence {
  readonly id: EvidenceId;
  readonly type: EvidenceType;
  readonly description: string;
  readonly strength: number;
  readonly observedAt: SimTime;
  readonly linkedObservationIds: readonly ObservationId[];
}

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

export interface ObservationContext {
  readonly position?: { readonly x: number; readonly y: number; readonly z?: number };
  readonly time: SimTime;
  readonly weather?: string;
  readonly [key: string]: unknown;
}

export interface TerrainPayload {
  readonly kind: "terrain";
  readonly height?: number;
  readonly slope?: number;
  readonly soil?: string;
  readonly hydrology?: string;
  readonly climate?: string;
}

export interface EcologyPayload {
  readonly kind: "ecology";
  readonly productivity?: number;
  readonly diversity?: number;
  readonly pressure?: number;
  readonly recovery?: number;
}

export interface RelationObservation {
  readonly sourceId: PatternId;
  readonly targetId: PatternId;
  readonly type: RelationType;
  readonly observedStrength: number;
  readonly confidence: Confidence;
  readonly trend: Trend;
  readonly discoveredAt: SimTime;
  readonly evidenceIds: readonly EvidenceId[];
}

export interface RelationsPayload {
  readonly kind: "relations";
  readonly relations: readonly RelationObservation[];
}

export interface EmergencePayload {
  readonly kind: "emergence";
  readonly stage: EmergenceStage;
  readonly stability: number;
  readonly persistence: number;
  readonly recovery: number;
  readonly entropy: number;
  readonly identityConfidence: number;
  readonly spiritPotential: number;
}

export interface HistoryPayload {
  readonly kind: "history";
  readonly pastStates: readonly { readonly time: SimTime; readonly description: string; readonly confidence: Confidence }[];
  readonly scars: readonly string[];
}

export interface TrajectoryHypothesis {
  readonly patternId: PatternId;
  readonly horizon: SimTime;
  readonly probability: number;
  readonly possibleStates: readonly {
    readonly state: string;
    readonly probability: number;
    readonly conditions: readonly string[];
  }[];
  readonly confidence: Confidence;
}

export interface PredictionPayload {
  readonly kind: "prediction";
  readonly trajectories: readonly TrajectoryHypothesis[];
}

export type LensPayload =
  | TerrainPayload
  | EcologyPayload
  | RelationsPayload
  | EmergencePayload
  | HistoryPayload
  | PredictionPayload;

export interface ObservationRecord {
  readonly id: ObservationId;
  readonly observerId: ObserverId;
  readonly targetId: PatternId;
  readonly lens: LensId;
  readonly observedAt: SimTime;
  readonly confidence: Confidence;
  readonly freshness: Confidence;
  readonly source: ObservationSource;
  readonly evidence: readonly Evidence[];
  readonly hypothesisIds: readonly HypothesisId[];
  readonly payload: LensPayload;
}

export interface Factor {
  readonly relatedPatternId?: PatternId;
  readonly description: string;
  readonly strength: number;
  readonly confidence: Confidence;
  readonly evidenceIds: readonly EvidenceId[];
}

export interface CollapseCondition {
  readonly description: string;
  readonly thresholdExpression: string;
  readonly currentProximity: number;
  readonly confidence: Confidence;
}

export interface ExistenceExplanation {
  readonly patternId: PatternId;
  readonly confidence: Confidence;
  readonly supportingFactors: readonly Factor[];
  readonly weakeningFactors: readonly Factor[];
  readonly criticalDependencies: readonly Factor[];
  readonly collapseConditions: readonly CollapseCondition[];
}

export interface CausalStep {
  readonly fromId: string;
  readonly toId: string;
  readonly relationType: string;
  readonly observedStrength: number;
  readonly evidenceIds: readonly EvidenceId[];
  readonly confidence: Confidence;
}

export interface CausalChain {
  readonly rootId: string;
  readonly steps: readonly CausalStep[];
  readonly confidence: Confidence;
  readonly incomplete: boolean;
}

export interface PatternBelief {
  readonly patternId: PatternId;
  readonly currentInterpretation: string;
  readonly confidence: Confidence;
  readonly supportingEvidence: readonly Evidence[];
  readonly openHypotheses: readonly Hypothesis[];
  readonly existenceExplanation?: ExistenceExplanation;
  readonly lastObserved: SimTime;
}

export interface Contradiction {
  readonly id: string;
  readonly description: string;
  readonly involvedHypothesisIds: readonly HypothesisId[];
  readonly involvedEvidenceIds: readonly EvidenceId[];
  readonly detectedAt: SimTime;
}

export interface BeliefModel {
  readonly schemaVersion: 1;
  readonly observerId: ObserverId;
  readonly beliefs: ReadonlyMap<PatternId, PatternBelief>;
  readonly activeHypotheses: readonly Hypothesis[];
  readonly knownRelations: readonly RelationObservation[];
  readonly contradictions: readonly Contradiction[];
  readonly lastUpdated: SimTime;
}

/** JSON-safe representation used at the HTTP/browser boundary. */
export interface BeliefModelDTO {
  readonly schemaVersion: 1;
  readonly observerId: ObserverId;
  readonly beliefs: readonly PatternBelief[];
  readonly activeHypotheses: readonly Hypothesis[];
  readonly knownRelations: readonly RelationObservation[];
  readonly contradictions: readonly Contradiction[];
  readonly lastUpdated: SimTime;
}

export interface ObservablePattern {
  readonly patternId: PatternId;
  readonly confidence: Confidence;
  readonly lastSeen: SimTime;
}

export interface ObservationAPI {
  observe(
    targetId: PatternId,
    observerId: ObserverId,
    lens: LensId,
    context?: ObservationContext,
  ): ObservationRecord | null;
  queryRelations(
    patternId: PatternId,
    observerId: ObserverId,
    filters?: Partial<{ type: RelationType; minStrength: number }>,
  ): readonly RelationObservation[];
  queryHistory(
    patternId: PatternId,
    observerId: ObserverId,
    timeRange?: { from: SimTime; to: SimTime },
  ): readonly ObservationRecord[];
  listObservable(observerId: ObserverId, lens?: LensId): readonly ObservablePattern[];
  explainExistence(patternId: PatternId, observerId: ObserverId): ExistenceExplanation;
  trace(rootId: string, observerId: ObserverId, maxDepth?: number): CausalChain;
}

