import type { BeliefEngine, BeliefRevision, BeliefRevisionRelation, BeliefState } from "./types.js";
import type { Contradiction, Evidence, Hypothesis, ObservationRecord, PatternBelief } from "@skald/observation";

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

function freezeState(state: BeliefState): BeliefState {
  return Object.freeze({ ...state, beliefs: new Map(state.beliefs), activeHypotheses: Object.freeze([...state.activeHypotheses]), contradictions: Object.freeze([...state.contradictions]) });
}

function revisionId(revision: BeliefRevision): string {
  return `revision:${revision.patternId}:${revision.at}`;
}

function contradictionFor(revision: BeliefRevision, hypothesis: Hypothesis | undefined): Contradiction | null {
  if (revision.relation !== "contradicts") return null;
  return Object.freeze({
    id: `contradiction:${revisionId(revision)}`,
    description: `Evidence conflicts with the current interpretation of ${revision.patternId}.`,
    involvedHypothesisIds: hypothesis ? [hypothesis.id] : [],
    involvedEvidenceIds: revision.evidence.map((item) => item.id),
    detectedAt: revision.at,
  });
}

/** Creates the pure Belief Engine implementation. */
export function createBeliefEngine(): BeliefEngine {
  return Object.freeze({
    fromObservation(record: ObservationRecord): BeliefRevision {
      const hypothesis: Hypothesis | undefined = record.hypothesisIds.length > 0
        ? {
            id: record.hypothesisIds[0]!, targetId: record.targetId, statement: `Evidence concerns ${record.targetId}.`, confidence: record.confidence,
            supportingEvidenceIds: record.evidence.map((item) => item.id), contradictingEvidenceIds: [], status: "open",
            createdAt: record.observedAt, lastUpdated: record.observedAt,
          }
        : undefined;
      return Object.freeze({ patternId: record.targetId, interpretation: `Evidence concerns ${record.targetId}.`, evidence: [...record.evidence], ...(hypothesis ? { hypothesis } : {}), relation: "supports" as const, at: record.observedAt });
    },
    applyRevision(state: BeliefState, revision: BeliefRevision): BeliefState {
      const previous = state.beliefs.get(revision.patternId);
      const evidence = [...(previous?.supportingEvidence ?? []), ...revision.evidence];
      const confidence = clamp(evidence.reduce((sum, item) => sum + item.strength, 0) / Math.max(1, evidence.length));
      const belief: PatternBelief = Object.freeze({
        patternId: revision.patternId,
        currentInterpretation: revision.interpretation,
        confidence,
        supportingEvidence: evidence,
        openHypotheses: revision.hypothesis ? [...(previous?.openHypotheses ?? []), revision.hypothesis] : previous?.openHypotheses ?? [],
        lastObserved: revision.at,
      });
      const beliefs = new Map(state.beliefs);
      beliefs.set(revision.patternId, belief);
      const contradiction = contradictionFor(revision, revision.hypothesis);
      return freezeState({
        schemaVersion: 1,
        observerId: state.observerId,
        beliefs,
        activeHypotheses: revision.hypothesis ? [...state.activeHypotheses, revision.hypothesis] : state.activeHypotheses,
        contradictions: contradiction ? [...state.contradictions, contradiction] : state.contradictions,
        lastUpdated: Math.max(state.lastUpdated, revision.at),
      });
    },
    decay(state: BeliefState, now: number, freshnessWindow: number): BeliefState {
      if (!Number.isFinite(freshnessWindow) || freshnessWindow <= 0) throw new Error("freshnessWindow must be positive");
      const beliefs = new Map<string, PatternBelief>();
      for (const [id, belief] of state.beliefs) {
        const freshness = clamp(1 - Math.max(0, now - belief.lastObserved) / freshnessWindow);
        beliefs.set(id, Object.freeze({ ...belief, confidence: clamp(belief.confidence * freshness) }));
      }
      return freezeState({ ...state, beliefs, lastUpdated: Math.max(state.lastUpdated, now) });
    },
  });
}

/** Builds a revision with an explicit contradiction relation for callers that have evidence direction. */
export function createBeliefRevision(patternId: string, interpretation: string, evidence: readonly Evidence[], at: number, relation: BeliefRevisionRelation = "supports", hypothesis?: Hypothesis): BeliefRevision {
  return Object.freeze({ patternId, interpretation, evidence: [...evidence], ...(hypothesis ? { hypothesis } : {}), relation, at });
}
