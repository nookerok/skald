import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../../projection.js";
import { ruleEventId } from "../../ids.js";

const PLAYER_ID = "player";

function base(event: DomainEvent) {
  return {
    schemaVersion: 1,
    timestamp: event.timestamp,
    correlationId: event.correlationId,
    causationId: event.eventId,
  } as const;
}

function objectById(world: ReadonlyWorld, id: string | undefined) {
  return id ? world.objects.get(id) : undefined;
}

/** Converts an authored social report into an observer-scoped testimony claim. */
export const testimonyFromRumor: Rule<ReadonlyWorld> = {
  id: "action_capability.testimony_from_rumor",
  phase: "consequence",
  listens: ["RumorHeard"],
  produces: ["TestimonyReceived"],
  handle: (event) => {
    const payload = event.payload as {
      rumorRef?: string;
      observerId?: string;
      sourceLabel?: string;
      text?: string;
      subjectRef?: string;
    };
    const claimId = payload.rumorRef ?? event.eventId;
    return [{
      ...base(event),
      eventId: ruleEventId(event.eventId, "TestimonyReceived", 0),
      type: "TestimonyReceived",
      payload: {
        claimId,
        observerId: payload.observerId ?? PLAYER_ID,
        sourceId: payload.sourceLabel ?? null,
        proposition: payload.text ?? "",
        subjectId: payload.subjectRef ?? null,
        receivedAt: event.timestamp,
        sourceEventId: event.eventId,
      },
    }];
  },
};

/** Converts an explicit observation relation into epistemic evidence. */
export const epistemicEvidenceFromObservation: Rule<ReadonlyWorld> = {
  id: "action_capability.epistemic_evidence_from_observation",
  phase: "consequence",
  listens: ["EntityExamined", "ObjectObserved", "SpatialObservationRecorded", "PhenomenonObserved"],
  produces: ["EpistemicEvidenceRecorded"],
  handle: (event) => {
    const payload = event.payload as {
      claimId?: string;
      epistemicClaimId?: string;
      relation?: string;
      observerId?: string;
      evidenceId?: string;
    };
    const claimId = payload.claimId ?? payload.epistemicClaimId;
    const relation = payload.relation === "supports" || payload.relation === "contradicts"
      ? payload.relation
      : undefined;
    if (!claimId || !relation) return [];
    return [{
      ...base(event),
      eventId: ruleEventId(event.eventId, "EpistemicEvidenceRecorded", 0),
      type: "EpistemicEvidenceRecorded",
      payload: {
        claimId,
        evidenceId: payload.evidenceId ?? ruleEventId(event.eventId, "EpistemicEvidenceRecorded", 0),
        relation,
        observerId: payload.observerId ?? PLAYER_ID,
        sourceObservationEventId: event.eventId,
      },
    }];
  },
};

/** Turns an observed phenomenon into an explicit domain fact. */
export const phenomenonObservation: Rule<ReadonlyWorld> = {
  id: "action_capability.phenomenon_observation",
  phase: "consequence",
  listens: ["EntityExamined", "ObjectObserved"],
  produces: ["PhenomenonObserved"],
  handle: (event, world) => {
    const payload = event.payload as { entityId?: string; objectId?: string; state?: Record<string, unknown> };
    const id = payload.entityId ?? payload.objectId;
    const object = objectById(world, id);
    if (!object || object.state.phenomenon !== true) return [];
    return [{
      ...base(event),
      eventId: ruleEventId(event.eventId, "PhenomenonObserved", 0),
      type: "PhenomenonObserved",
      payload: {
        phenomenonId: object.id,
        observerId: PLAYER_ID,
        observedProperties: payload.state ?? object.state,
        sourceObservationEventId: event.eventId,
      },
    }];
  },
};
