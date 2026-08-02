/**
 * Interaction Model v1 — listening law (ADR-0013 §5, Slice 2).
 *
 * Sole owner of the factual outcomes of listen:
 * - the event carries a readable source, loudness and distance in domain
 *   units, and the observer's scope (locationId); hidden causes are never
 *   revealed;
 * - an audible source is a deterministic world fact: a hot object
 *   (temperature above TEMPERATURE_HOT) crackles quietly; everything else
 *   reports honest silence (ActionHadNoObservableEffect), never a guess.
 *
 * Pure and deterministic; emits Domain Events only.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import { ruleEventId } from "../../ids.js";
import { TEMPERATURE_HOT } from "../../objects/types.js";
import type { ReadonlyWorld } from "../../projection.js";

function baseFrom(event: DomainEvent) {
  return {
    schemaVersion: 1,
    timestamp: event.timestamp,
    correlationId: event.correlationId,
    causationId: event.eventId,
  } as const;
}

function soundObserved(
  event: DomainEvent,
  payload: {
    sourceId: string;
    source: string;
    description: string;
    loudness: "quiet" | "loud";
    distance: number | null;
    distanceBand: "same_location" | "near" | "unknown";
    locationId: string;
  },
): DomainEvent {
  return {
    ...baseFrom(event),
    eventId: ruleEventId(event.eventId, "SoundObserved", 0),
    type: "SoundObserved",
    payload,
  };
}

function silent(event: DomainEvent, reason: "silence" | "silent_target"): DomainEvent {
  return {
    ...baseFrom(event),
    eventId: ruleEventId(event.eventId, "ActionHadNoObservableEffect", 0),
    type: "ActionHadNoObservableEffect",
    payload: { reason },
  };
}

function describeTargetSound(sourceName: string, temperature: number): string {
  return temperature > TEMPERATURE_HOT + 40
    ? `${sourceName} раскалённо потрескивает.`
    : `${sourceName} тихо потрескивает.`;
}

function qualitativeDistance(world: ReadonlyWorld, sourceId: string, locationId: string): { distance: number | null; distanceBand: "same_location" | "near" | "unknown" } {
  const entity = world.entities.get(sourceId);
  if (entity) {
    const distance = Math.abs(entity.x - world.player.x) + Math.abs(entity.y - world.player.y);
    return { distance, distanceBand: distance <= 1 ? "near" : "unknown" };
  }
  const object = world.objects.get(sourceId);
  if (object && object.locationId === locationId) {
    return { distance: null, distanceBand: "same_location" };
  }
  return { distance: null, distanceBand: "unknown" };
}

/** Physics-law outcome of the listening law (verb listen). */
export const listeningListen: Rule<ReadonlyWorld> = {
  id: "listening.listen",
  phase: "physics",
  listens: ["InteractionValidated"],
  produces: ["SoundObserved", "ActionHadNoObservableEffect"],
  handle: (event, world) => {
    const payload = event.payload as { law?: string; verb?: string; entityId?: string; locationId?: string };
    if (payload.law !== "listening" || payload.verb !== "listen") return [];

    const locationId = payload.locationId ?? world.currentLocationId;

    // Environment: what is audible in the current surroundings?
    if (!payload.entityId) {
      if (!locationId) return [silent(event, "silence")];
      const location = world.locations.get(locationId);
      if (!location) return [silent(event, "silence")];
      const audible = location.objectIds
        .map((id) => world.objects.get(id))
        .filter((object): object is NonNullable<typeof object> => object !== undefined)
        .filter((object) => object.temperature > TEMPERATURE_HOT);
      if (audible.length === 0) return [silent(event, "silence")];
      const first = audible[0]!;
      const dist = qualitativeDistance(world, first.id, locationId);
      return [soundObserved(event, {
        // The player heard an ambient sound, not its hidden physical cause.
        sourceId: "ambient",
        source: "окружение",
        description: "Где-то рядом слышен тихий треск.",
        loudness: "quiet",
        distance: dist.distance,
        distanceBand: dist.distanceBand,
        locationId,
      })];
    }

    // Concrete target: the target's own audible state, in observer scope.
    const entity = world.entities.get(payload.entityId);
    if (entity) {
      const temperature = entity.components.thermal?.temperature;
      const distance = Math.abs(entity.x - world.player.x) + Math.abs(entity.y - world.player.y);
      if (temperature !== undefined && temperature > TEMPERATURE_HOT) {
        return [soundObserved(event, {
          sourceId: entity.id,
          source: entity.name,
          description: describeTargetSound(entity.name, temperature),
          loudness: "quiet",
          distance,
          distanceBand: distance <= 1 ? "near" : "unknown",
          locationId: locationId ?? "",
        })];
      }
      return [silent(event, "silent_target")];
    }

    const object = world.objects.get(payload.entityId);
    if (object) {
      if (object.temperature > TEMPERATURE_HOT) {
        const dist = qualitativeDistance(world, object.id, locationId);
        return [soundObserved(event, {
          sourceId: object.id,
          source: object.name,
          description: describeTargetSound(object.name, object.temperature),
          loudness: "quiet",
          distanceBand: dist.distanceBand,
          distance: dist.distance,
          locationId,
        })];
      }
      return [silent(event, "silent_target")];
    }

    return [silent(event, "silent_target")];
  },
};

export const listeningRules: readonly Rule<ReadonlyWorld>[] = [
  listeningListen,
];