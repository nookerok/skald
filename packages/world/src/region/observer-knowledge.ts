import type { DomainEvent } from "@skald/event-bus";
import type { SpatialKnowledge, SpatialObservationPayload } from "./types.js";

/** A durable observer-scoped spatial fact reconstructed from the Event Log. */
export interface KnownSpatialObservation extends SpatialObservationPayload {
  readonly observerId: string;
  readonly sourceEventId: string;
  readonly eventSequence: number;
}

/** Read-side knowledge available to a single observer. */
export interface ObserverSpatialKnowledge {
  readonly observerId: string;
  readonly locations: ReadonlyMap<string, KnownSpatialObservation>;
  readonly landmarks: ReadonlyMap<string, KnownSpatialObservation>;
  readonly relations: ReadonlyMap<string, KnownSpatialObservation>;
  readonly water: ReadonlyMap<string, KnownSpatialObservation>;
}

export interface MutableObserverSpatialKnowledge {
  readonly observerId: string;
  readonly locations: Map<string, KnownSpatialObservation>;
  readonly landmarks: Map<string, KnownSpatialObservation>;
  readonly relations: Map<string, KnownSpatialObservation>;
  readonly water: Map<string, KnownSpatialObservation>;
}

export function spatialKnowledgeRank(knowledge: SpatialKnowledge): number {
  switch (knowledge) {
    case "rumored": return 1;
    case "glimpsed": return 2;
    case "observed": return 3;
    case "traversed": return 4;
  }
}

export function createObserverSpatialKnowledge(observerId = "player"): MutableObserverSpatialKnowledge {
  return { observerId, locations: new Map(), landmarks: new Map(), relations: new Map(), water: new Map() };
}

/** Merge a new observation monotonically; weak later reports never downgrade facts. */
export function mergeSpatialObservation(
  target: MutableObserverSpatialKnowledge,
  payload: SpatialObservationPayload,
  sourceEventId: string,
  eventSequence: number,
): void {
  const observerId = payload.observerId ?? "player";
  if (observerId !== target.observerId) return;
  const record: KnownSpatialObservation = Object.freeze({ ...payload, observerId, sourceEventId, eventSequence });
  const map = payload.subjectKind === "location"
    ? target.locations
    : payload.subjectKind === "landmark"
      ? target.landmarks
      : payload.subjectKind === "water"
        ? target.water
        : target.relations;
  const previous = map.get(payload.subjectId);
  if (!previous || shouldReplace(previous, record)) map.set(payload.subjectId, record);
}

function shouldReplace(previous: KnownSpatialObservation, incoming: KnownSpatialObservation): boolean {
  const previousRank = spatialKnowledgeRank(previous.knowledge);
  const incomingRank = spatialKnowledgeRank(incoming.knowledge);
  if (incomingRank !== previousRank) return incomingRank > previousRank;
  if (incoming.observedAt !== previous.observedAt) return incoming.observedAt > previous.observedAt;
  return incoming.eventSequence > previous.eventSequence;
}

export function buildObserverSpatialKnowledge(events: readonly DomainEvent[], observerId = "player"): ObserverSpatialKnowledge {
  const knowledge = createObserverSpatialKnowledge(observerId);
  events.forEach((event, index) => {
    if (event.type !== "SpatialObservationRecorded") return;
    mergeSpatialObservation(knowledge, event.payload as SpatialObservationPayload, event.eventId, index);
  });
  return freezeObserverSpatialKnowledge(knowledge);
}

export function freezeObserverSpatialKnowledge(knowledge: MutableObserverSpatialKnowledge): ObserverSpatialKnowledge {
  const freezeMap = (map: Map<string, KnownSpatialObservation>) => new Map(
    [...map].map(([id, value]) => [id, Object.freeze({ ...value })]),
  );
  return Object.freeze({
    observerId: knowledge.observerId,
    locations: freezeMap(knowledge.locations),
    landmarks: freezeMap(knowledge.landmarks),
    relations: freezeMap(knowledge.relations),
    water: freezeMap(knowledge.water),
  });
}
