import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../projection.js";
import { buildDiscoveryJournal } from "../discovery/builder.js";
import type {
  BeliefModel, CausalChain, CausalStep, Contradiction,
  Evidence, EvidenceType, EmergencePayload, ExistenceExplanation,
  Factor, Hypothesis, LensId, ObservationAPI,
  ObservationRecord, ObservablePattern, PatternBelief, RelationObservation,
  RelationType, ObservationSource,
} from "./types.js";
import { deepFreeze } from "../discovery/builder.js";

interface InternalEvidence extends Evidence {
  readonly sourceEventIds: readonly string[];
  readonly direction?: "positive" | "negative";
}

interface Group {
  targetId: string;
  lens: LensId;
  source: ObservationSource;
  evidence: InternalEvidence[];
}

const FRESHNESS_WINDOW = 12;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function freezeMap<V>(source: Map<string, V>): ReadonlyMap<string, V> {
  const clone = new Map(source);
  return new Proxy(clone, {
    get(target, property: string | symbol) {
      if (property === "set" || property === "delete" || property === "clear") {
        return () => { throw new TypeError("immutable"); };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ReadonlyMap<string, V>;
}

function monotonicCheck(events: readonly DomainEvent[]): void {
  let last = 0;
  for (const event of events) {
    if (event.timestamp < last) throw new Error(`Non-monotonic timestamp in Event Log: ${event.timestamp} < ${last}`);
    last = event.timestamp;
  }
}

function payload(event: DomainEvent): Record<string, unknown> {
  return (event.payload && typeof event.payload === "object")
    ? event.payload as Record<string, unknown>
    : {};
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function addGroup(groups: Map<string, Group>, event: DomainEvent, targetId: string, lens: LensId,
  type: EvidenceType, source: ObservationSource, description: string, strength: number, direction?: InternalEvidence["direction"]): void {
  const key = targetId + "|" + lens;
  const item = groups.get(key) ?? { targetId, lens, source, evidence: [] };
  const evidenceId = `evidence:${event.eventId}`;
  if (item.evidence.some((entry) => entry.id === evidenceId)) return;
  item.evidence.push({
    id: evidenceId,
    type,
    description,
    strength: clamp(strength),
    observedAt: event.timestamp,
    linkedObservationIds: [],
    sourceEventIds: [event.eventId],
    ...(direction ? { direction } : {}),
  });
  groups.set(key, item);
}

function collectGroups(events: readonly DomainEvent[], worldTime: number): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const event of events) {
    const p = payload(event);
    switch (event.type) {
      case "ObjectObserved":
      case "EntityExamined": {
        const id = text(p.entityId ?? p.objectId, `object:${text(p.name, event.eventId)}`);
        addGroup(groups, event, id, "emergence", "sensory", "direct",
          text(p.description, "Ты заметил изменение, но пока не понимаешь его природы."), 0.82);
        break;
      }
      case "ObservationUpdated": {
        const key = text(p.key, "unknown");
        const delta = number(p.delta, number(p.newValue, 0));
        const direction = delta < 0 ? "negative" : "positive";
        addGroup(groups, event, `observation:${key}`, "emergence", "pattern-match", "inferred",
          `Наблюдение «${key}» изменилось.`, 0.48, direction);
        break;
      }
      case "MovementSucceeded":
      case "PlayerLocationChanged": {
        const locationId = text(p.locationId, `location:${worldTime}`);
        addGroup(groups, event, locationId.startsWith("location:") ? locationId : "location:" + locationId, "terrain", "sensory", "direct",
          text(p.locationName, "Ты оказался в новом месте."), 0.78);
        break;
      }
      case "MovementBlocked":
      case "ActionBlocked": {
        addGroup(groups, event, `barrier:${text(p.reason, "unknown")}`, "terrain", "anomaly", "direct",
          "Путь оказался преграждён.", 0.68, "negative");
        break;
      }
      case "ObjectTemperatureChanged":
      case "HeatRadiated": {
        const id = text(p.objectId ?? p.source, "heat:nearby");
        addGroup(groups, event, `heat:${id}`, "ecology", "anomaly", "direct",
          "Воздух или предмет рядом заметно нагрелся.", 0.7);
        break;
      }
      case "SoundProduced": {
        const source = text(p.source, "unknown source");
        addGroup(groups, event, `sound:${source}`, "ecology", "sensory", "direct",
          `Ты услышал звук из области «${source}».`, 0.64);
        break;
      }
      case "RelationChanged": {
        const target = text(p.to ?? p.target, "unknown");
        addGroup(groups, event, `relation:${target}`, "relations", "testimony", "reported",
          `Связь с «${target}» изменилась.`, 0.62, number(p.value ?? p.delta, 0) < 0 ? "negative" : "positive");
        break;
      }
      case "ConsequenceCreated":
      case "ConsequenceFired": {
        const kind = text(p.type ?? p.consequenceType, "unknown consequence");
        addGroup(groups, event, `consequence:${kind}`, "emergence", "anomaly", "inferred",
          "Последствие проявилось, но его закон ещё не ясен.", 0.55);
        break;
      }
      default:
        break;
    }
  }
  return groups;
}

function interpretation(evidence: readonly InternalEvidence[]): string {
  return evidence[evidence.length - 1]?.description ?? "Свидетельств пока недостаточно.";
}

function primaryLens(targetId: string): LensId {
  if (targetId.startsWith("relation:")) return "relations";
  if (targetId.startsWith("location:") || targetId.startsWith("barrier:")) return "terrain";
  if (targetId.startsWith("heat:") || targetId.startsWith("sound:")) return "ecology";
  return "emergence";
}

function payloadFor(targetId: string, lens: LensId, evidence: readonly InternalEvidence[], stage: PatternBelief["openHypotheses"][number]["status"]): ObservationRecord["payload"] {
  if (lens === "terrain") {
    return { kind: "terrain", climate: interpretation(evidence) };
  }
  if (lens === "ecology") {
    return { kind: "ecology", pressure: clamp(evidence.length / 5), recovery: stage === "weakening" ? 0.25 : 0.5 };
  }
  if (lens === "relations") {
    const relation = {
      sourceId: "player",
      targetId: targetId.replace(/^relation:/, ""),
      type: "supports" as RelationType,
      observedStrength: clamp(evidence.length / 5),
      confidence: clamp(evidence.reduce((sum, item) => sum + item.strength, 0) / Math.max(1, evidence.length)),
      trend: "stable" as const,
      discoveredAt: evidence[0]?.observedAt ?? 0,
      evidenceIds: evidence.map((item) => item.id),
    };
    return { kind: "relations", relations: [relation] };
  }
  if (lens === "history") {
    return { kind: "history", pastStates: evidence.map((item) => ({ time: item.observedAt, description: item.description, confidence: item.strength })), scars: [] };
  }
  if (lens === "prediction") {
    return { kind: "prediction", trajectories: [] };
  }
  const confidence = clamp(evidence.reduce((sum, item) => sum + item.strength, 0) / Math.max(1, evidence.length));
  return {
    kind: "emergence",
    stage: evidence.length >= 3 ? "stable" : evidence.length === 2 ? "emerging" : "nascent",
    stability: confidence,
    persistence: clamp(evidence.length / 5),
    recovery: 0.5,
    entropy: 1 - confidence,
    identityConfidence: confidence,
    spiritPotential: 0,
  } satisfies EmergencePayload;
}

function makeHypothesis(id: string, targetId: string, statement: string, evidence: readonly InternalEvidence[], now: number, status: Hypothesis["status"]): Hypothesis {
  return deepFreeze({
    id,
    targetId,
    statement,
    confidence: clamp(evidence.reduce((sum, item) => sum + item.strength, 0) / Math.max(1, evidence.length)),
    supportingEvidenceIds: evidence.map((item) => item.id),
    contradictingEvidenceIds: [],
    status,
    createdAt: evidence[0]?.observedAt ?? now,
    lastUpdated: evidence[evidence.length - 1]?.observedAt ?? now,
  });
}

function explanation(patternId: string, belief: PatternBelief, now: number): ExistenceExplanation {
  const support = belief.supportingEvidence.map((entry): Factor => ({
    description: entry.description,
    strength: entry.strength,
    confidence: entry.strength,
    evidenceIds: [entry.id],
  }));
  const freshness = clamp(1 - (now - belief.lastObserved) / FRESHNESS_WINDOW);
  return deepFreeze({
    patternId,
    confidence: belief.confidence,
    supportingFactors: support,
    weakeningFactors: belief.openHypotheses.flatMap((hypothesis) => hypothesis.contradictingEvidenceIds.map((id) => ({
      description: "Есть свидетельство, которое не укладывается в текущую трактовку.",
      strength: 0.5,
      confidence: hypothesis.confidence,
      evidenceIds: [id],
    }))),
    criticalDependencies: support.slice(0, 2),
    collapseConditions: [{
      description: "Новые свидетельства перестали подтверждать эту нить.",
      thresholdExpression: "freshness <= 0",
      currentProximity: 1 - freshness,
      confidence: belief.confidence,
    }],
  });
}

function freezeEvidence(item: InternalEvidence, observationId: string): Evidence {
  return deepFreeze({
    id: item.id,
    type: item.type,
    description: item.description,
    strength: item.strength,
    observedAt: item.observedAt,
    linkedObservationIds: [observationId],
  });
}

export function buildBeliefModel(events: readonly DomainEvent[], world: ReadonlyWorld, observerId = "player"): BeliefModel {
  monotonicCheck(events);
  const now = events.length > 0 ? events[events.length - 1]!.timestamp : world.time;
  const groups = collectGroups(events, now);
  const discovery = buildDiscoveryJournal(events);
  for (const card of discovery.cards) {
    const evidence = card.evidence.map((entry, index): InternalEvidence => ({
      id: `evidence:${card.discoveryId}:${index}`,
      type: "inference",
      description: entry.text,
      strength: card.stage === "discovered" ? 0.86 : card.stage === "hypothesis" ? 0.62 : 0.42,
      observedAt: entry.worldTime,
      linkedObservationIds: [],
      sourceEventIds: entry.sourceEventIds,
    }));
    const key = `discovery:${card.discoveryId}|emergence`;
    groups.set(key, { targetId: `discovery:${card.discoveryId}`, lens: "emergence", source: "inferred", evidence });
  }

  const records: ObservationRecord[] = [];
  const beliefs = new Map<string, PatternBelief>();
  for (const group of groups.values()) {
    const observationId = `observation:${group.targetId}:${group.lens}`;
    const age = Math.max(0, now - (group.evidence[group.evidence.length - 1]?.observedAt ?? now));
    const freshness = clamp(1 - age / FRESHNESS_WINDOW);
    const confidence = clamp(group.evidence.reduce((sum, item) => sum + item.strength, 0) / Math.max(1, group.evidence.length));
    const hypothesis = group.evidence.length >= 2
      ? makeHypothesis(`hypothesis:${group.targetId}`, group.targetId, interpretation(group.evidence), group.evidence, now, "strengthening")
      : null;
    const hypotheses = hypothesis ? [hypothesis] : [];
    const record: ObservationRecord = deepFreeze({
      id: observationId,
      observerId,
      targetId: group.targetId,
      lens: group.lens,
      observedAt: group.evidence[group.evidence.length - 1]?.observedAt ?? now,
      confidence,
      freshness,
      source: group.source,
      evidence: group.evidence.map((item) => freezeEvidence(item, observationId)),
      hypothesisIds: hypotheses.map((item) => item.id),
      payload: payloadFor(group.targetId, group.lens, group.evidence, hypothesis?.status ?? "open"),
    });
    records.push(record);
    const previous = beliefs.get(group.targetId);
    const allEvidence = [...(previous?.supportingEvidence ?? []), ...record.evidence];
    const openHypotheses = [...(previous?.openHypotheses ?? []), ...hypotheses];
    const belief: PatternBelief = {
      patternId: group.targetId,
      currentInterpretation: interpretation(group.evidence),
      confidence,
      supportingEvidence: allEvidence,
      openHypotheses,
      lastObserved: record.observedAt,
    };
    beliefs.set(group.targetId, deepFreeze({ ...belief, existenceExplanation: explanation(group.targetId, belief, now) }));
  }

  const activeHypotheses = [...beliefs.values()].flatMap((belief) => belief.openHypotheses);
  const knownRelations: RelationObservation[] = records
    .filter((record) => record.lens === "relations")
    .flatMap((record) => (record.payload.kind === "relations" ? record.payload.relations : []));
  const contradictions: Contradiction[] = [];
  const directionsByTarget = new Map<string, InternalEvidence[]>();
  for (const group of groups.values()) {
    const directed = group.evidence.filter((entry) => entry.direction);
    if (directed.length > 0) directionsByTarget.set(group.targetId, [...(directionsByTarget.get(group.targetId) ?? []), ...directed]);
  }
  for (const [patternId, directions] of directionsByTarget) {
    const hasPositive = directions.some((entry) => entry.direction === "positive");
    const hasNegative = directions.some((entry) => entry.direction === "negative");
    if (hasPositive && hasNegative) {
      const belief = beliefs.get(patternId);
      contradictions.push(deepFreeze({
        id: `contradiction:${patternId}`,
        description: `Свидетельства о «${patternId}» противоречат друг другу.`,
        involvedHypothesisIds: belief?.openHypotheses.map((item) => item.id) ?? [],
        involvedEvidenceIds: directions.map((item) => item.id),
        detectedAt: now,
      }));
    }
  }

  return deepFreeze({
    schemaVersion: 1 as const,
    observerId,
    beliefs: freezeMap(beliefs),
    activeHypotheses: deepFreeze(activeHypotheses),
    knownRelations: deepFreeze(knownRelations),
    contradictions: deepFreeze(contradictions),
    lastUpdated: now,
  });
}

function findSourceEvent(model: BeliefModel, events: readonly DomainEvent[], rootId: string): string | null {
  if (rootId.startsWith("observation:")) {
    const target = rootId.split(":").slice(1).join(":");
    const belief = model.beliefs.get(target);
    const evidence = belief?.supportingEvidence[belief.supportingEvidence.length - 1];
    return evidence?.id.replace(/^evidence:/, "") ?? null;
  }
  return events.some((event) => event.eventId === rootId) ? rootId : null;
}

function buildTrace(model: BeliefModel, events: readonly DomainEvent[], rootId: string, maxDepth: number): CausalChain {
  const source = findSourceEvent(model, events, rootId);
  if (!source) return deepFreeze({ rootId, steps: [], confidence: 0, incomplete: true });
  const byCausation = new Map<string, DomainEvent[]>();
  for (const event of events) byCausation.set(event.causationId ?? "", [...(byCausation.get(event.causationId ?? "") ?? []), event]);
  const steps: CausalStep[] = [];
  let current = source;
  for (let depth = 0; depth < maxDepth; depth++) {
    const next = byCausation.get(current)?.[0];
    if (!next) break;
    const evidenceIds = [...model.beliefs.values()].flatMap((belief) => belief.supportingEvidence.filter((entry) => entry.id.endsWith(next.eventId)).map((entry) => entry.id));
    steps.push({ fromId: current, toId: next.eventId, relationType: "causes", observedStrength: 0.65, evidenceIds, confidence: 0.65 });
    current = next.eventId;
  }
  return deepFreeze({ rootId, steps, confidence: steps.length ? 0.65 : 0.35, incomplete: steps.length >= maxDepth });
}

function emptyExplanation(patternId: string): ExistenceExplanation {
  return deepFreeze({ patternId, confidence: 0, supportingFactors: [], weakeningFactors: [], criticalDependencies: [], collapseConditions: [] });
}

export function serializeBeliefModel(model: BeliefModel | import("./types.js").BeliefModelDTO): import("./types.js").BeliefModelDTO {
  return deepFreeze({
    schemaVersion: model.schemaVersion,
    observerId: model.observerId,
    beliefs: Array.isArray(model.beliefs) ? model.beliefs : [...model.beliefs.values()],
    activeHypotheses: model.activeHypotheses,
    knownRelations: model.knownRelations,
    contradictions: model.contradictions,
    lastUpdated: model.lastUpdated,
  });
}

export function createObservationAPI(events: readonly DomainEvent[], world: ReadonlyWorld, observerId = "player"): ObservationAPI {
  const model = buildBeliefModel(events, world, observerId);

  const recordFor = (targetId: string, lens: LensId): ObservationRecord | null => {
    const belief = model.beliefs.get(targetId);
    if (!belief || (lens !== "history" && lens !== primaryLens(targetId))) return null;
    const evidence = belief.supportingEvidence;
    const freshness = clamp(1 - (model.lastUpdated - belief.lastObserved) / FRESHNESS_WINDOW);
    const recordPayload: ObservationRecord["payload"] =
      lens === "terrain"
        ? { kind: "terrain", climate: belief.currentInterpretation }
        : lens === "ecology"
          ? { kind: "ecology", pressure: clamp(evidence.length / 5), recovery: 0.5 }
          : lens === "relations"
            ? { kind: "relations", relations: model.knownRelations.filter((item) => item.targetId === targetId || item.sourceId === targetId) }
            : lens === "history"
              ? { kind: "history", pastStates: evidence.map((item) => ({ time: item.observedAt, description: item.description, confidence: item.strength })), scars: [] }
              : lens === "prediction"
                ? { kind: "prediction", trajectories: [] }
                : { kind: "emergence", stage: "nascent", stability: belief.confidence, persistence: 0.5, recovery: 0.5, entropy: 1 - belief.confidence, identityConfidence: belief.confidence, spiritPotential: 0 };
    return deepFreeze({
      id: `observation:${targetId}:${lens}`,
      observerId,
      targetId,
      lens,
      observedAt: belief.lastObserved,
      confidence: belief.confidence,
      freshness,
      source: "inferred" as const,
      evidence,
      hypothesisIds: belief.openHypotheses.map((item) => item.id),
      payload: recordPayload,
    });
  };

  return {
    observe: (targetId, requestedObserver, lens) => requestedObserver === observerId ? recordFor(targetId, lens) : null,
    queryRelations: (patternId, requestedObserver, filters) => requestedObserver !== observerId
      ? []
      : model.knownRelations
        .filter((relation) => relation.sourceId === patternId || relation.targetId === patternId)
        .filter((relation) => !filters?.type || relation.type === filters.type)
        .filter((relation) => filters?.minStrength === undefined || relation.observedStrength >= filters.minStrength),
    queryHistory: (patternId, requestedObserver, timeRange) => requestedObserver !== observerId
      ? []
      : model.beliefs.get(patternId)?.supportingEvidence
        .filter((entry) => !timeRange || (entry.observedAt >= timeRange.from && entry.observedAt <= timeRange.to))
        .map((entry) => deepFreeze({
          id: `observation:${patternId}:history:${entry.id}`,
          observerId,
          targetId: patternId,
          lens: "history" as const,
          observedAt: entry.observedAt,
          confidence: entry.strength,
          freshness: clamp(1 - (model.lastUpdated - entry.observedAt) / FRESHNESS_WINDOW),
          source: "inferred" as const,
          evidence: [entry],
          hypothesisIds: [],
          payload: { kind: "history" as const, pastStates: [{ time: entry.observedAt, description: entry.description, confidence: entry.strength }], scars: [] },
        })) ?? [],
    listObservable: (requestedObserver, lens) => requestedObserver !== observerId
      ? []
      : [...model.beliefs.values()]
        .filter((belief) => !lens || recordFor(belief.patternId, lens) !== null)
        .map((belief): ObservablePattern => ({ patternId: belief.patternId, confidence: belief.confidence, lastSeen: belief.lastObserved })),
    explainExistence: (patternId, requestedObserver) => requestedObserver !== observerId
      ? emptyExplanation(patternId)
      : model.beliefs.get(patternId)?.existenceExplanation ?? emptyExplanation(patternId),
    trace: (rootId, requestedObserver, maxDepth = 8) => requestedObserver !== observerId
      ? deepFreeze({ rootId, steps: [], confidence: 0, incomplete: true })
      : buildTrace(model, events, rootId, maxDepth),
  };
}
