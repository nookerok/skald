import { z } from "zod";

const confidence = z.number().finite().min(0).max(1);
const simTime = z.number().finite();
const evidenceType = z.enum(["sensory", "pattern-match", "testimony", "anomaly", "ritual", "inference"]);
const lens = z.enum(["terrain", "ecology", "relations", "emergence", "history", "prediction"]);
const source = z.enum(["direct", "inferred", "reported", "myth", "ritual"]);
const relationType = z.enum(["supports", "feeds", "threatens", "depends", "enables", "constrains"]);
const trend = z.enum(["rising", "stable", "falling", "unknown"]);

const evidenceSchema = z.object({
  id: z.string(),
  type: evidenceType,
  description: z.string(),
  strength: confidence,
  observedAt: simTime,
  linkedObservationIds: z.array(z.string()),
}).strict();

const hypothesisSchema = z.object({
  id: z.string(),
  targetId: z.string(),
  statement: z.string(),
  confidence,
  supportingEvidenceIds: z.array(z.string()),
  contradictingEvidenceIds: z.array(z.string()),
  status: z.enum(["open", "strengthening", "weakening", "confirmed", "refuted"]),
  createdAt: simTime,
  lastUpdated: simTime,
}).strict();

const relationSchema = z.object({
  sourceId: z.string(),
  targetId: z.string(),
  type: relationType,
  observedStrength: confidence,
  confidence,
  trend,
  discoveredAt: simTime,
  evidenceIds: z.array(z.string()),
}).strict();

const terrainPayload = z.object({
  kind: z.literal("terrain"),
  height: z.number().finite().optional(),
  slope: z.number().finite().optional(),
  soil: z.string().optional(),
  hydrology: z.string().optional(),
  climate: z.string().optional(),
}).strict();

const ecologyPayload = z.object({
  kind: z.literal("ecology"),
  productivity: confidence.optional(),
  diversity: confidence.optional(),
  pressure: confidence.optional(),
  recovery: confidence.optional(),
}).strict();

const relationsPayload = z.object({ kind: z.literal("relations"), relations: z.array(relationSchema) }).strict();
const emergencePayload = z.object({
  kind: z.literal("emergence"),
  stage: z.enum(["nascent", "emerging", "stable", "collapsing", "dissolved"]),
  stability: confidence,
  persistence: confidence,
  recovery: confidence,
  entropy: confidence,
  identityConfidence: confidence,
  spiritPotential: confidence,
}).strict();
const historyPayload = z.object({
  kind: z.literal("history"),
  pastStates: z.array(z.object({ time: simTime, description: z.string(), confidence }).strict()),
  scars: z.array(z.string()),
}).strict();
const predictionPayload = z.object({
  kind: z.literal("prediction"),
  trajectories: z.array(z.object({
    patternId: z.string(),
    horizon: simTime,
    probability: confidence,
    possibleStates: z.array(z.object({ state: z.string(), probability: confidence, conditions: z.array(z.string()) }).strict()),
    confidence,
  }).strict()),
}).strict();

const lensPayload = z.discriminatedUnion("kind", [
  terrainPayload, ecologyPayload, relationsPayload, emergencePayload, historyPayload, predictionPayload,
]);

const factorSchema = z.object({
  relatedPatternId: z.string().optional(),
  description: z.string(),
  strength: confidence,
  confidence,
  evidenceIds: z.array(z.string()),
}).strict();

const explanationSchema = z.object({
  patternId: z.string(),
  confidence,
  supportingFactors: z.array(factorSchema),
  weakeningFactors: z.array(factorSchema),
  criticalDependencies: z.array(factorSchema),
  collapseConditions: z.array(z.object({
    description: z.string(),
    thresholdExpression: z.string(),
    currentProximity: confidence,
    confidence,
  }).strict()),
}).strict();

const patternBeliefSchema = z.object({
  patternId: z.string(),
  displayName: z.string(),
  currentInterpretation: z.string(),
  confidence,
  supportingEvidence: z.array(evidenceSchema),
  openHypotheses: z.array(hypothesisSchema),
  existenceExplanation: explanationSchema.optional(),
  lastObserved: simTime,
  freshness: confidence,
}).strict();

const contradictionSchema = z.object({
  id: z.string(),
  description: z.string(),
  involvedHypothesisIds: z.array(z.string()),
  involvedEvidenceIds: z.array(z.string()),
  detectedAt: simTime,
}).strict();

/** Runtime-safe schema for the public BeliefModelDTO boundary. */
export const beliefModelDTOSchema = z.object({
  schemaVersion: z.literal(2),
  observerId: z.string(),
  beliefs: z.array(patternBeliefSchema),
  activeHypotheses: z.array(hypothesisSchema),
  knownRelations: z.array(relationSchema),
  contradictions: z.array(contradictionSchema),
  lastUpdated: simTime,
}).strict();

/** Runtime-safe schema for one ObservationRecord boundary. */
export const observationRecordSchema = z.object({
  id: z.string(),
  observerId: z.string(),
  targetId: z.string(),
  lens,
  observedAt: simTime,
  confidence,
  freshness: confidence,
  source,
  evidence: z.array(evidenceSchema),
  hypothesisIds: z.array(z.string()),
  payload: lensPayload,
}).strict();

/** Validates and returns a BeliefModelDTO without coercion. */
export function parseBeliefModelDTO(value: unknown) {
  return beliefModelDTOSchema.parse(value);
}

/** Validates and returns an ObservationRecord without coercion. */
export function parseObservationRecord(value: unknown) {
  return observationRecordSchema.parse(value);
}
