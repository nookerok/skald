import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../../projection.js";
import { canContain, assessCapability, isItemAccessible } from "../../action-capability/capability.js";
import { ruleEventId } from "../../ids.js";
import type { Affordance } from "../../action-capability/types.js";
import type { WorldObject } from "../../objects/types.js";
import { epistemicEvidenceFromObservation, phenomenonObservation, testimonyFromRumor } from "./epistemic.js";
export { epistemicEvidenceFromObservation, phenomenonObservation, testimonyFromRumor } from "./epistemic.js";

const PLAYER_ID = "player";

function base(event: DomainEvent) {
  return {
    schemaVersion: 1,
    timestamp: event.timestamp,
    correlationId: event.correlationId,
    causationId: event.eventId,
  } as const;
}

function actorId(_event: DomainEvent, payload?: Record<string, unknown>): string {
  const candidate = payload?.subjectId ?? payload?.actorId ?? payload?.observerId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : PLAYER_ID;
}

function rejected(event: DomainEvent, reason: string): DomainEvent {
  return {
    ...base(event),
    eventId: ruleEventId(event.eventId, "ActionRejected", 0),
    type: "ActionRejected",
    payload: { reason },
  };
}

function objectById(world: ReadonlyWorld, id: string | undefined): WorldObject | undefined {
  return id ? world.objects.get(id) : undefined;
}

function namedObject(world: ReadonlyWorld, raw: unknown, subjectId = PLAYER_ID): WorldObject | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const query = String((raw as { raw?: string }).raw ?? "").trim().toLowerCase();
  if (!query) return undefined;
  return [...world.objects.values()].find((item) => {
    const visible = item.locationId === world.currentLocationId || isItemAccessible(world, subjectId, item.id);
    return visible
      && (item.name.toLowerCase().includes(query)
        || item.id.toLowerCase().includes(query)
        || item.aliases.some((alias) => alias.toLowerCase() === query));
  });
}

function placementFor(world: ReadonlyWorld, itemId: string) {
  return world.actionCapabilities?.placements.get(itemId);
}

function recipientId(world: ReadonlyWorld, raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) return undefined;
  const query = raw.trim().toLowerCase();
  const entity = [...world.entities.values()].find((candidate) =>
    candidate.id !== PLAYER_ID
    && (candidate.name.toLowerCase().includes(query)
      || candidate.id.toLowerCase().includes(query)
      || candidate.aliases.some((alias) => alias.toLowerCase() === query)),
  );
  if (entity) return entity.id;
  const object = [...world.objects.values()].find((candidate) =>
    candidate.id !== PLAYER_ID
    && isItemAccessible(world, PLAYER_ID, candidate.id)
    && (candidate.name.toLowerCase().includes(query)
      || candidate.id.toLowerCase().includes(query)
      || candidate.aliases.some((alias) => alias.toLowerCase() === query)),
  );
  return object?.id;
}

function originalPayload(event: DomainEvent): Record<string, unknown> | undefined {
  const payload = event.payload as { originalPayload?: unknown };
  return payload.originalPayload !== null && typeof payload.originalPayload === "object"
    ? payload.originalPayload as Record<string, unknown>
    : undefined;
}

/** Resolves canonical take into physical placement and possession facts. */
export const itemPossession: Rule<ReadonlyWorld> = {
  id: "action_capability.item_possession",
  phase: "physics",
  listens: ["InteractionValidated"],
  produces: ["ItemMoved", "ItemPossessionChanged", "ActionRejected"],
  handle: (event, world) => {
    const payload = event.payload as {
      verb?: string;
      entityId?: string;
      subjectId?: string;
      secondaryTarget?: string | null;
    };
    if (payload.verb !== "take" && payload.verb !== "give") return [];
    const subjectId = actorId(event, payload);
    const object = objectById(world, payload.entityId);
    const definition = object ? world.actionCapabilities?.itemDefinitions.get(object.id) : undefined;
    const placement = object ? placementFor(world, object.id) : undefined;
    if (!object || !definition || !placement) return [rejected(event, "item_not_defined")];
    if (!definition.portable) return [rejected(event, "item_not_portable")];
    const owner = world.actionCapabilities?.owners.get(object.id);
    if (payload.verb === "take") {
      if (placement.kind === "carried" && placement.holderId === subjectId) return [];
      if (!isItemAccessible(world, subjectId, object.id)) return [rejected(event, "item_inaccessible")];
      if (owner && owner !== subjectId) return [rejected(event, "item_owned_by_other")];
    } else {
      const recipient = recipientId(world, payload.secondaryTarget);
      if (!recipient) return [rejected(event, "recipient_not_found")];
      if (placement.kind !== "carried" || placement.holderId !== subjectId) return [rejected(event, "item_not_carried")];
      if (recipient === subjectId) return [rejected(event, "recipient_is_sender")];
    }
    const destination = {
      kind: "carried",
      holderId: payload.verb === "give" ? recipientId(world, payload.secondaryTarget)! : subjectId,
    } as const;
    const common = base(event);
    return [
      {
        ...common,
        eventId: ruleEventId(event.eventId, "ItemMoved", 0),
        type: "ItemMoved",
        payload: {
          itemId: object.id,
          from: placement,
          to: destination,
          subjectId,
          reason: payload.verb === "give" ? "given" : "taken",
        },
      },
      {
        ...common,
        eventId: ruleEventId(event.eventId, "ItemPossessionChanged", 1),
        type: "ItemPossessionChanged",
        payload: {
          itemId: object.id,
          previousOwnerId: owner ?? null,
          ownerId: destination.holderId,
          subjectId,
          reason: payload.verb === "give" ? "given" : "taken",
        },
      },
    ];
  },
};

/** Places a carried item into an open container without introducing slots. */
export const itemContainment: Rule<ReadonlyWorld> = {
  id: "action_capability.item_containment",
  phase: "physics",
  listens: ["ActionValidated"],
  produces: ["ItemMoved", "ActionRejected"],
  handle: (event, world) => {
    const original = originalPayload(event);
    if (!original || original.operation !== "place") return [];
    const subjectId = actorId(event, original);
    const item = namedObject(world, original.target, subjectId);
    const container = namedObject(world, original.secondaryTarget ?? original.instrument, subjectId);
    const itemPlacement = item ? placementFor(world, item.id) : undefined;
    if (!item || !container || !itemPlacement) return [rejected(event, "placement_target_missing")];
    if (item.id === container.id) return [rejected(event, "containment_cycle")];
    if (itemPlacement.kind !== "carried" || itemPlacement.holderId !== subjectId) return [rejected(event, "item_not_carried")];
    if (!canContain(world, container.id, item.id, subjectId)) return [rejected(event, "container_unavailable")];
    return [{
      ...base(event),
      eventId: ruleEventId(event.eventId, "ItemMoved", 0),
      type: "ItemMoved",
      payload: {
        itemId: item.id,
        from: itemPlacement,
        to: { kind: "container", containerId: container.id },
        subjectId,
        containerId: container.id,
        reason: "placed",
      },
    }];
  },
};

function openable(object: WorldObject, capacity: number | null | undefined): boolean {
  return capacity !== null && capacity !== undefined
    || object.state.open !== undefined
    || object.state.locked !== undefined
    || object.id.includes("door");
}

/** Resolves canonical open/close without silently forcing a locked object. */
export const containerAccess: Rule<ReadonlyWorld> = {
  id: "action_capability.container_access",
  phase: "physics",
  listens: ["InteractionValidated"],
  produces: ["ContainerOpened", "ContainerClosed", "ActionRejected"],
  handle: (event, world) => {
    const payload = event.payload as { verb?: string; entityId?: string; subjectId?: string };
    if (payload.verb !== "open" && payload.verb !== "close") return [];
    const subjectId = actorId(event, payload);
    const object = objectById(world, payload.entityId);
    const definition = object ? world.actionCapabilities?.itemDefinitions.get(object.id) : undefined;
    if (!object || !definition || !isItemAccessible(world, subjectId, object.id)) return [rejected(event, "container_inaccessible")];
    if (!openable(object, definition.containerCapacityMass)) return [rejected(event, "not_openable")];
    if (object.state.locked === true) return [rejected(event, "locked")];
    const common = base(event);
    if (payload.verb === "open") {
      if (object.state.open === true) return [];
      return [{
        ...common,
        eventId: ruleEventId(event.eventId, "ContainerOpened", 0),
        type: "ContainerOpened",
        payload: { containerId: object.id, subjectId, previousOpen: false, open: true },
      }];
    }
    if (object.state.open !== true) return [];
    return [{
      ...common,
      eventId: ruleEventId(event.eventId, "ContainerClosed", 0),
      type: "ContainerClosed",
      payload: { containerId: object.id, subjectId, previousOpen: true, open: false },
    }];
  },
};

/** Supports close as an ActionIntent operation while the canonical verb migrates. */
export const containerCloseAction: Rule<ReadonlyWorld> = {
  id: "action_capability.container_close_action",
  phase: "physics",
  listens: ["ActionValidated"],
  produces: ["ContainerClosed", "ActionRejected"],
  handle: (event, world) => {
    const original = originalPayload(event);
    if (!original || original.operation !== "close") return [];
    const subjectId = actorId(event, original);
    const object = namedObject(world, original.target, subjectId);
    if (!object || !isItemAccessible(world, subjectId, object.id)) return [rejected(event, "container_inaccessible")];
    if (object.state.locked === true || object.state.open !== true) return [];
    return [{
      ...base(event),
      eventId: ruleEventId(event.eventId, "ContainerClosed", 0),
      type: "ContainerClosed",
      payload: { containerId: object.id, subjectId, previousOpen: true, open: false },
    }];
  },
};

const AFFORDANCES = new Set<Affordance>([
  "anchor", "secure", "tie", "descend", "assist_climbing",
  "strike", "drive_nail", "break", "shape", "repair",
  "illuminate", "ignite", "signal", "contain", "experiment",
]);

/** Applies an accessible item affordance through the existing ActionValidated path. */
export const affordanceUse: Rule<ReadonlyWorld> = {
  id: "action_capability.affordance_use",
  phase: "physics",
  listens: ["ActionValidated"],
  produces: ["ItemUsed", "ProficiencyEvidenceRecorded", "EpistemicEvidenceRecorded", "PhenomenonInteracted", "ObjectTemperatureChanged", "ActionRejected"],
  handle: (event, world) => {
    const original = originalPayload(event);
    if (!original || original.operation !== "use") return [];
    const subjectId = actorId(event, original);
    const target = namedObject(world, original.target, subjectId);
    const instrument = namedObject(world, original.instrument, subjectId);
    const affordance = typeof original.goal === "string" ? original.goal.toLowerCase() as Affordance : undefined;
    if (!target || !instrument || !affordance || !AFFORDANCES.has(affordance)) return [rejected(event, "affordance_not_specified")];
    const assessment = assessCapability(world, { subjectId, affordance, instrumentId: instrument.id });
    if (!assessment.canAttempt) return [rejected(event, assessment.reasons.join(",") || "cannot_attempt")];

    const targetAccepts = (target.affordances?.includes(affordance) === true)
      || (Array.isArray(target.state.affordances) && target.state.affordances.includes(affordance))
      || (affordance === "ignite" && target.state.flammable === true)
      || (affordance === "experiment" && target.state.phenomenon === true);
    const outcome = targetAccepts ? "achieved" : "not_achieved";
    const techniqueId = typeof original.manner === "string" ? original.manner : null;
    const contextTags = Array.isArray(original.contextTags)
      ? original.contextTags.filter((tag): tag is string => typeof tag === "string")
      : [];
    const common = base(event);
    const result: DomainEvent[] = [
      {
        ...common,
        eventId: ruleEventId(event.eventId, "ItemUsed", 0),
        type: "ItemUsed",
        payload: { subjectId, instrumentId: instrument.id, targetId: target.id, affordance, outcome, techniqueId, contextTags },
      },
      {
        ...common,
        eventId: ruleEventId(event.eventId, "ProficiencyEvidenceRecorded", 1),
        type: "ProficiencyEvidenceRecorded",
        payload: {
          evidenceId: ruleEventId(event.eventId, "ProficiencyEvidenceRecorded", 1),
          subjectId,
          affordance,
          techniqueId,
          contextTags,
          outcome,
          sourceEventId: event.eventId,
        },
      },
    ];
    const claimId = typeof original.claimId === "string"
      ? original.claimId
      : typeof original.epistemicClaimId === "string" ? original.epistemicClaimId : undefined;
    if (claimId) {
      result.push({
        ...common,
        eventId: ruleEventId(event.eventId, "EpistemicEvidenceRecorded", result.length),
        type: "EpistemicEvidenceRecorded",
        payload: {
          claimId,
          evidenceId: ruleEventId(event.eventId, "EpistemicEvidenceRecorded", result.length),
          relation: outcome === "achieved" ? "supports" : "contradicts",
          observerId: subjectId,
          proposition: typeof original.proposition === "string" ? original.proposition : "experiment outcome",
          sourceInteractionEventId: event.eventId,
        },
      });
    }
    if (targetAccepts && affordance === "ignite") {
      result.push({
        ...common,
        eventId: ruleEventId(event.eventId, "ObjectTemperatureChanged", 2),
        type: "ObjectTemperatureChanged",
        payload: {
          objectId: target.id,
          previousTemperature: target.temperature,
          temperature: Math.min(100, target.temperature + 30),
          cause: "ItemUsed",
          instrumentId: instrument.id,
        },
      });
    }
    if (target.state.phenomenon === true) {
      result.push({
        ...common,
        eventId: ruleEventId(event.eventId, "PhenomenonInteracted", result.length),
        type: "PhenomenonInteracted",
        payload: { phenomenonId: target.id, subjectId, affordance, outcome },
      });
    }
    return result;
  },
};

export const actionCapabilityRules: readonly Rule<ReadonlyWorld>[] = [
  itemPossession,
  itemContainment,
  containerAccess,
  containerCloseAction,
  affordanceUse,
  testimonyFromRumor,
  epistemicEvidenceFromObservation,
  phenomenonObservation,
];
