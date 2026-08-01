import type { BeliefEngine, BeliefRevision, BeliefRevisionRelation, BeliefState } from "./types.js";
import type { Contradiction, Evidence, Hypothesis, ObservationRecord, PatternBelief } from "@skald/observation";
import { deepFreeze, freezeMap } from "./immutable.js";

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

function evidenceConfidence(belief: PatternBelief): number {
  const evidence = belief.supportingEvidence;
  if (evidence.length === 0) return clamp(belief.confidence);
  return clamp(evidence.reduce((sum, item) => sum + item.strength, 0) / evidence.length);
}

function freezeState(state: BeliefState): BeliefState {
  return Object.freeze({
    ...state,
    beliefs: freezeMap(new Map(state.beliefs)),
    activeHypotheses: deepFreeze([...state.activeHypotheses]),
    contradictions: deepFreeze([...state.contradictions]),
    ...(state.baseConfidence ? { baseConfidence: freezeMap(new Map(state.baseConfidence)) } : {}),
  });
}

function revisionId(revision: BeliefRevision): string {
  return `revision:${revision.patternId}:${revision.at}`;
}

function contradictionFor(revision: BeliefRevision, hypothesis: Hypothesis | undefined): Contradiction | null {
  if (revision.relation !== "contradicts") return null;
  return deepFreeze({
    id: `contradiction:${revisionId(revision)}`,
    description: "\u0421\u0432\u0438\u0434\u0435\u0442\u0435\u043b\u044c\u0441\u0442\u0432\u0430 \u043f\u0440\u043e\u0442\u0438\u0432\u043e\u0440\u0435\u0447\u0430\u0442 \u0442\u0435\u043a\u0443\u0449\u0435\u043c\u0443 \u0442\u043e\u043b\u043a\u043e\u0432\u0430\u043d\u0438\u044e.",
    involvedHypothesisIds: hypothesis ? [hypothesis.id] : [],
    involvedEvidenceIds: revision.evidence.map((item) => item.id),
    detectedAt: revision.at,
  });
}

/** Creates the pure Belief Engine implementation. */
export function createBeliefEngine(): BeliefEngine {
  return Object.freeze({
    fromObservation(record: ObservationRecord): BeliefRevision {
      const statement = "\u041d\u0430\u0431\u043b\u044e\u0434\u0430\u0435\u043c\u043e\u0435 \u044f\u0432\u043b\u0435\u043d\u0438\u0435 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u0432\u043d\u0438\u043c\u0430\u043d\u0438\u044f.";
      const hypothesis: Hypothesis | undefined = record.hypothesisIds.length > 0
        ? {
            id: record.hypothesisIds[0]!, targetId: record.targetId, statement, confidence: record.confidence,
            supportingEvidenceIds: record.evidence.map((item) => item.id), contradictingEvidenceIds: [], status: "open",
            createdAt: record.observedAt, lastUpdated: record.observedAt,
          }
        : undefined;
      return deepFreeze({ patternId: record.targetId, interpretation: statement, evidence: [...record.evidence], ...(hypothesis ? { hypothesis } : {}), relation: "supports" as const, at: record.observedAt });
    },
    applyRevision(state: BeliefState, revision: BeliefRevision): BeliefState {
      const previous = state.beliefs.get(revision.patternId);
      const evidence = [...(previous?.supportingEvidence ?? []), ...revision.evidence];
      const confidence = clamp(evidence.reduce((sum, item) => sum + item.strength, 0) / Math.max(1, evidence.length));
      const belief: PatternBelief = deepFreeze({
        patternId: revision.patternId,
        displayName: "Наблюдаемое явление",
        currentInterpretation: revision.interpretation,
        confidence,
        supportingEvidence: deepFreeze(evidence),
        openHypotheses: revision.hypothesis ? [...(previous?.openHypotheses ?? []), revision.hypothesis] : previous?.openHypotheses ?? [],
        lastObserved: revision.at,
        freshness: 1,
      });
      const beliefs = new Map(state.beliefs);
      beliefs.set(revision.patternId, belief);
      const baseConfidence = new Map(state.baseConfidence);
      baseConfidence.set(revision.patternId, confidence);
      const contradiction = contradictionFor(revision, revision.hypothesis);
      return freezeState({
        schemaVersion: 2,
        observerId: state.observerId,
        beliefs,
        activeHypotheses: revision.hypothesis ? [...state.activeHypotheses, revision.hypothesis] : state.activeHypotheses,
        contradictions: contradiction ? [...state.contradictions, contradiction] : state.contradictions,
        lastUpdated: Math.max(state.lastUpdated, revision.at),
        baseConfidence,
      });
    },
    decay(state: BeliefState, now: number, freshnessWindow: number): BeliefState {
      if (!Number.isFinite(freshnessWindow) || freshnessWindow <= 0) throw new Error("freshnessWindow must be positive");
      const beliefs = new Map<string, PatternBelief>();
      const baseConfidence = new Map(state.baseConfidence);
      for (const [id, belief] of state.beliefs) {
        const freshness = clamp(1 - Math.max(0, now - belief.lastObserved) / freshnessWindow);
        const baseline = state.baseConfidence?.get(id) ?? evidenceConfidence(belief);
        baseConfidence.set(id, baseline);
        beliefs.set(id, deepFreeze({ ...belief, confidence: clamp(baseline * freshness), freshness }));
      }
      return freezeState({ ...state, beliefs, baseConfidence, lastUpdated: Math.max(state.lastUpdated, now) });
    },
  });
}

/** Builds a revision with an explicit contradiction relation for callers that have evidence direction. */
export function createBeliefRevision(patternId: string, interpretation: string, evidence: readonly Evidence[], at: number, relation: BeliefRevisionRelation = "supports", hypothesis?: Hypothesis): BeliefRevision {
  return deepFreeze({ patternId, interpretation, evidence: [...evidence], ...(hypothesis ? { hypothesis } : {}), relation, at });
}
