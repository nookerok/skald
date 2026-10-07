/**
 * Local approach to a present contact (npc-close-approach phase 1,
 * ADR-0013 amendment).
 *
 * Single owner of the contact case of `mode: relocate, operation:
 * approach`: the movement rule excludes it through the SAME
 * `resolveApproachTarget` predicate, so one action yields exactly one
 * outcome — either this rule's `ActionResolved` (the approach happened; no
 * location or coordinate changed) or its `ActionBlocked
 * (contact_unavailable)` when the target is unresolvable in the current
 * location at execution time. Ambiguity and unknown targets are asked
 * BEFORE execution (command preflight / contextual validation); this rule
 * never picks a candidate and never starts a conversation, changes a
 * relation or adds knowledge — the outcome only confirms the approach.
 *
 * Pure and deterministic: Event + ReadonlyWorld → events, no LLM, no
 * second tick (time follows the ordinary command policy).
 */

import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import { ruleEventId } from "../../ids.js";
import type { ReadonlyWorld } from "../../projection.js";
import { resolveApproachTarget } from "../../interactions/target-resolver.js";

function referenceText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const reference = value as { normalized?: unknown; raw?: unknown };
  return typeof reference.normalized === "string"
    ? reference.normalized.trim()
    : typeof reference.raw === "string" ? reference.raw.trim() : "";
}

export const contactApproach: Rule<ReadonlyWorld> = {
  id: "interactions.contact_approach",
  phase: "physics",
  listens: ["ActionValidated"],
  produces: ["ActionResolved", "ActionBlocked"],
  handle: (event: DomainEvent, world: ReadonlyWorld): DomainEvent[] => {
    const payload = (event.payload as { originalPayload: Record<string, unknown> }).originalPayload;
    const mode = payload["mode"] as string | undefined;
    const operation = payload["operation"] as string | undefined;
    if (mode !== "relocate" || operation !== "approach") return [];

    const targetRaw = referenceText(payload["target"]);
    const target = resolveApproachTarget(world, targetRaw);
    if (target.kind === "other") return [];

    const base = {
      schemaVersion: 1,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      causationId: event.eventId,
    };

    if (target.kind === "contact") {
      // Repeated approach to the same present target: keep exactly one
      // engagement state and answer meaningfully (ADR-0039 §3).
      const alreadyNear = world.sceneEngagement?.targetRef === target.ref
        && world.sceneEngagement.locationId === world.currentLocationId;
      // Identity boundary (contact-identity T3/T5): the canonical name is
      // player-facing only AFTER acquaintance. An unknown present contact is
      // cited by an observer-safe label, never by its canonical name.
      const known = [...world.relations.values()].some((relation) => relation.from === "player" && relation.to === target.ref);
      const label = known ? target.name : "Незнакомый человек";
      return [{
        ...base,
        eventId: ruleEventId(event.eventId, "ActionResolved", 0),
        type: "ActionResolved",
        payload: {
          actionEventId: event.eventId,
          result: "approach",
          // Additive fields (ADR-0039 §3): the projection derives scene
          // engagement from them; an older runtime ignores them.
          targetRef: target.ref,
          locationId: world.currentLocationId,
          engagement: "near",
          description: alreadyNear
            ? `Ты уже стоишь рядом с ${label}.`
            : `Ты подходишь ближе. Перед тобой — ${label}.`,
        },
      }];
    }

    return [{
      ...base,
      eventId: ruleEventId(event.eventId, "ActionBlocked", 0),
      type: "ActionBlocked",
      payload: { reason: "contact_unavailable", objectName: targetRaw },
    }];
  },
};
