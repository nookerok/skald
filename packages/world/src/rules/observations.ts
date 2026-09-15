import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../projection.js";
import { ruleEventId } from "../ids.js";

function obsEvent(
  causationEvent: DomainEvent,
  key: string,
  delta: number,
): DomainEvent {
  return {
    eventId: ruleEventId(causationEvent.eventId, "ObservationUpdated", 0),
    type: "ObservationUpdated",
    schemaVersion: 1,
    payload: { key, delta },
    timestamp: causationEvent.timestamp,
    correlationId: causationEvent.correlationId,
    causationId: causationEvent.eventId,
  };
}

export const riskTaker: Rule<ReadonlyWorld> = {
  id: "observations.risk_taker",
  phase: "consequence",
  listens: ["MovementSucceeded"],
  produces: ["ObservationUpdated"],
  handle: (event: DomainEvent, _world: ReadonlyWorld): DomainEvent[] => {
    return [obsEvent(event, "risk_taken", 1)];
  },
};

export const wallCaution: Rule<ReadonlyWorld> = {
  id: "observations.wall_caution",
  phase: "consequence",
  listens: ["MovementBlocked"],
  produces: ["ObservationUpdated"],
  handle: (event: DomainEvent, _world: ReadonlyWorld): DomainEvent[] => {
    const { reason } = event.payload as { reason: string };
    if (reason !== "wall") return [];
    return [obsEvent(event, "wall_caution", 1)];
  },
};

export const edgeAwareness: Rule<ReadonlyWorld> = {
  id: "observations.edge_awareness",
  phase: "consequence",
  listens: ["MovementBlocked"],
  produces: ["ObservationUpdated"],
  handle: (event: DomainEvent, _world: ReadonlyWorld): DomainEvent[] => {
    const { reason } = event.payload as { reason: string };
    if (reason !== "boundary") return [];
    return [obsEvent(event, "edge_awareness", 1)];
  },
};

export const impatience: Rule<ReadonlyWorld> = {
  id: "observations.impatience",
  phase: "consequence",
  listens: ["CommandRejected"],
  produces: ["ObservationUpdated"],
  handle: (event: DomainEvent, _world: ReadonlyWorld): DomainEvent[] => {
    return [obsEvent(event, "impatience", 1)];
  },
};

export const worldReactionFear: Rule<ReadonlyWorld> = {
  id: "observations.world_reaction_fear",
  phase: "consequence",
  listens: ["AudacityTriggered"],
  produces: ["ObservationUpdated"],
  handle: (event: DomainEvent, _world: ReadonlyWorld): DomainEvent[] => {
    const { severity } = event.payload as { severity: number };
    return [obsEvent(event, "world_reaction_fear", severity)];
  },
};

/**
 * Completing a multi-stage journey is the spatial-movement analogue of a
 * successful legacy step: the player crossed open ground and the world
 * noticed. One risk_taken point per arrival feeds the same
 * consequences.repercussion threshold as MovementSucceeded, so the
 * audacity lifecycle (created → expired → fired) stays reachable in
 * living-region worlds where grid movement never occurs. Pure and
 * deterministic like every observation rule.
 */
export const journeyRisk: Rule<ReadonlyWorld> = {
  id: "observations.journey_risk",
  phase: "consequence",
  listens: ["JourneyCompleted"],
  produces: ["ObservationUpdated"],
  handle: (event: DomainEvent, _world: ReadonlyWorld): DomainEvent[] => {
    return [obsEvent(event, "risk_taken", 1)];
  },
};

export const observationRules: Rule<ReadonlyWorld>[] = [
  riskTaker,
  wallCaution,
  edgeAwareness,
  impatience,
  worldReactionFear,
  journeyRisk,
];
