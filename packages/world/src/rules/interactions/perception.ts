/**
 * Interaction Model v1 — perception law (ADR-0013 §5, Slice 1).
 *
 * Sole owner of the factual outcomes of observe/inspect:
 * - observe without a target describes the current surroundings only;
 * - a concrete target yields EntityExamined (generic entity) or
 *   ObjectObserved (physical WorldObject) — the same factual events for
 *   both verbs; hidden properties are never revealed here.
 *
 * This rule is pure and deterministic; it emits Domain Events only.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import { ruleEventId } from "../../ids.js";
import type { ReadonlyWorld } from "../../projection.js";
import { computeVisibility } from "../../visibility/visibility-engine.js";
import type { SpatialWorldProjection } from "../../region/types.js";

function baseFrom(event: DomainEvent) {
  return {
    schemaVersion: 1,
    timestamp: event.timestamp,
    correlationId: event.correlationId,
    causationId: event.eventId,
  } as const;
}

/** Physics-law outcome of the perception law (observe + inspect). */
export const perceptionObserve: Rule<ReadonlyWorld> = {
  id: "perception.observe",
  phase: "physics",
  listens: ["InteractionValidated"],
  produces: ["EntityExamined", "ObjectObserved", "ActionResolved", "SpatialObservationRecorded"],
  handle: (event, world) => {
    const payload = event.payload as { law?: string; verb?: string; entityId?: string; locationId?: string };
    if (payload.law !== "perception") return [];

    // observe without a target describes surroundings only (ADR-0013 §5).
    if (payload.verb === "observe" && payload.locationId && !payload.entityId) {
      const location = world.locations.get(payload.locationId);
      if (!location) return [];
      const events: DomainEvent[] = [{
        ...baseFrom(event),
        eventId: ruleEventId(event.eventId, "ActionResolved", 0),
        type: "ActionResolved",
        payload: {
          actionEventId: event.eventId,
          result: "observation",
          description: location.description,
        },
      }];
      const spatial = world.spatial;
      const spatialLocations = spatial?.locations;
      const spatialLandmarks = spatial?.landmarks;
      const spatialRelations = spatial?.relations;
      const observerLocation = spatialLocations?.get(payload.locationId);
      if (!spatial?.region || !spatialLocations || !spatialLandmarks || !spatialRelations || !observerLocation) {
        return events;
      }
      const visibility = computeVisibility(
        {
          locationRef: payload.locationId,
          xMetres: observerLocation.anchor.xMetres,
          yMetres: observerLocation.anchor.yMetres,
          elevationMetres: 0,
        },
        spatial as SpatialWorldProjection,
      );
      let index = 1;
      for (const relation of spatial.travelRelations.values()) {
        if (relation.fromId !== payload.locationId && relation.toId !== payload.locationId) continue;
        const otherLocationId = relation.fromId === payload.locationId ? relation.toId : relation.fromId;
        events.push({
          ...baseFrom(event),
          eventId: ruleEventId(event.eventId, "SpatialObservationRecorded", index),
          type: "SpatialObservationRecorded",
          payload: {
            subjectKind: "relation",
            subjectId: relation.id,
            knowledge: "observed",
            observedAt: event.timestamp,
            confidence: 0.8,
            observerId: "player",
            fromLocationId: relation.fromId,
            toLocationId: relation.toId,
          },
        });
        index += 1;
        if (!spatialLocations.has(otherLocationId)) continue;
        events.push({
          ...baseFrom(event),
          eventId: ruleEventId(event.eventId, "SpatialObservationRecorded", index),
          type: "SpatialObservationRecorded",
          payload: {
            subjectKind: "location",
            subjectId: otherLocationId,
            knowledge: "glimpsed",
            observedAt: event.timestamp,
            confidence: 0.55,
            observerId: "player",
          },
        });
        index += 1;
      }
      for (const [subjectId, result] of visibility) {
        if (!result.visible) continue;
        const subjectKind = spatialLocations.has(subjectId)
          ? "location"
          : spatialLandmarks.has(subjectId)
            ? "landmark"
            : spatialRelations.has(subjectId)
              ? "relation"
              : null;
        if (!subjectKind) continue;
        events.push({
          ...baseFrom(event),
          eventId: ruleEventId(event.eventId, "SpatialObservationRecorded", index),
          type: "SpatialObservationRecorded",
          payload: {
            subjectKind,
            subjectId,
            knowledge: result.knowledge,
            observedAt: event.timestamp,
            confidence: result.confidence,
            bearing: result.bearing,
            observerId: "player",
          },
        });
        index += 1;
      }
      return events;
    }

    if (!payload.entityId) return [];

    const entity = world.entities.get(payload.entityId);
    if (entity) {
      return [{
        ...baseFrom(event),
        eventId: ruleEventId(event.eventId, "EntityExamined", 0),
        type: "EntityExamined",
        payload: { entityId: entity.id, name: entity.name, description: entity.description },
      }];
    }

    const object = world.objects.get(payload.entityId);
    if (object) {
      return [{
        ...baseFrom(event),
        eventId: ruleEventId(event.eventId, "ObjectObserved", 0),
        type: "ObjectObserved",
        payload: {
          objectId: object.id,
          name: object.name,
          description: object.description,
          material: object.material,
          temperature: object.temperature,
          integrity: object.integrity,
          state: object.state,
        },
      }];
    }

    return [];
  },
};

/** Consequence-side observation, deliberately separate from perception.observe. */
export const examinedCuriosity: Rule<ReadonlyWorld> = {
  id: "observation.curiosity_from_examination",
  phase: "consequence",
  listens: ["EntityExamined"],
  produces: ["ObservationUpdated"],
  handle: (event) => [{
    ...baseFrom(event),
    eventId: ruleEventId(event.eventId, "ObservationUpdated", 0),
    type: "ObservationUpdated",
    payload: { key: "curiosity", delta: 1 },
  }],
};

export const perceptionRules: readonly Rule<ReadonlyWorld>[] = [
  perceptionObserve,
  examinedCuriosity,
];
