import type { DomainEvent } from "@skald/event-bus";
import type { Rule } from "@skald/rule-engine";
import type { ReadonlyWorld } from "../../projection.js";
import { canContain, assessCapability, isItemAccessible } from "../../action-capability/capability.js";
import { resolveInteractionTarget } from "../../interactions/index.js";
import { ruleEventId } from "../../ids.js";
import type { Affordance } from "../../action-capability/types.js";
import type { WorldObject } from "../../objects/types.js";
import type { PlayerFacingCandidate } from "../../interactions/types.js";
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

function rejectedAmbiguous(event: DomainEvent, candidates: readonly PlayerFacingCandidate[]): DomainEvent {
  return {
    ...base(event),
    eventId: ruleEventId(event.eventId, "ActionRejected", 0),
    type: "ActionRejected",
    payload: {
      reason: "ambiguous_target",
      candidateNames: candidates.map((candidate) => candidate.name),
      candidates,
    },
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
    const visible = objectVisible(world, item, subjectId);
    return visible
      && (item.name.toLowerCase().includes(query)
        || item.id.toLowerCase().includes(query)
        || item.aliases.some((alias) => alias.toLowerCase() === query));
  });
}

/**
 * Whether the subject can see/reach an object. The action-capability placements
 * model is the authoritative source once an item moves (carried / container /
 * location), because the object projection's `locationId` is only rewritten for
 * `to.kind === 'location'` and otherwise keeps the stale pre-move location — a
 * closed container would not shield an item from a `use` otherwise. Objects
 * without a placement record fall back to the projection location for
 * bootstrap/legacy objects that were never moved.
 */
function objectVisible(world: ReadonlyWorld, item: WorldObject, subjectId: string): boolean {
  const placement = world.actionCapabilities?.placements.get(item.id);
  if (placement) return isItemAccessible(world, subjectId, item.id);
  return item.locationId === world.currentLocationId;
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
  listens: ["InteractionValidated"],
  produces: ["ItemMoved", "ActionRejected"],
  handle: (event, world) => {
    const payload = event.payload as {
      verb?: string;
      entityId?: string;
      secondaryTarget?: string | null;
      subjectId?: string;
    };
    if (payload.verb !== "place") return [];
    const subjectId = actorId(event, payload);
    const item = objectById(world, payload.entityId);
    const itemPlacement = item ? placementFor(world, item.id) : undefined;
    if (!item || !itemPlacement) return [rejected(event, "placement_target_missing")];

    const containerQuery = payload.secondaryTarget?.trim() ?? "";
    const containerResolution = resolveInteractionTarget(world, "place", containerQuery);
    if (containerResolution.kind !== "resolved") {
      if (containerResolution.kind === "ambiguous") {
        return [rejectedAmbiguous(event, containerResolution.candidates)];
      }
      return [rejected(event, "placement_target_missing")];
    }
    const containerId = containerResolution.target.id;
    if (item.id === containerId) return [rejected(event, "containment_cycle")];
    if (itemPlacement.kind !== "carried" || itemPlacement.holderId !== subjectId) return [rejected(event, "item_not_carried")];
    if (!canContain(world, containerId, item.id, subjectId)) return [rejected(event, "container_unavailable")];
    return [{
      ...base(event),
      eventId: ruleEventId(event.eventId, "ItemMoved", 0),
      type: "ItemMoved",
      payload: {
        itemId: item.id,
        from: itemPlacement,
        to: { kind: "container", containerId },
        subjectId,
        containerId,
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

/** Applies an accessible item affordance through the canonical interaction chain. */
export const affordanceUse: Rule<ReadonlyWorld> = {
  id: "action_capability.affordance_use",
  phase: "physics",
  listens: ["InteractionValidated"],
  produces: ["ItemUsed", "ProficiencyEvidenceRecorded", "EpistemicEvidenceRecorded", "PhenomenonInteracted", "ObjectTemperatureChanged", "ActionRejected"],
  handle: (event, world) => {
    const payload = event.payload as {
      verb?: string;
      entityId?: string;
      instrument?: string | null;
      goal?: string | null;
      manner?: string | null;
      contextTags?: unknown;
      subjectId?: string;
      claimId?: string;
      epistemicClaimId?: string;
      proposition?: string;
    };
    if (payload.verb !== "use") return [];
    const subjectId = actorId(event, payload);
    const target = objectById(world, payload.entityId);
    const affordance = typeof payload.goal === "string" ? payload.goal.toLowerCase() as Affordance : undefined;
    if (!target || !affordance || !AFFORDANCES.has(affordance)) return [rejected(event, "affordance_not_specified")];

    const instrumentQuery = payload.instrument?.trim() ?? "";
    const instrumentResolution = resolveInteractionTarget(world, "use", instrumentQuery);
    if (instrumentResolution.kind !== "resolved") {
      if (instrumentResolution.kind === "ambiguous") {
        return [rejectedAmbiguous(event, instrumentResolution.candidates)];
      }
      return [rejected(event, "affordance_not_specified")];
    }
    const instrument = objectById(world, instrumentResolution.target.id);
    if (!instrument) return [rejected(event, "affordance_not_specified")];

    // A closed container shields the target too: `use` must reach both the
    // instrument and the thing it is applied to. The instrument is already
    // guarded by assessCapability below; the target needs its own check.
    if (!isItemAccessible(world, subjectId, target.id)) return [rejected(event, "target_inaccessible")];
    const assessment = assessCapability(world, { subjectId, affordance, instrumentId: instrument.id });
    if (!assessment.canAttempt) return [rejected(event, assessment.reasons.join(",") || "cannot_attempt")];

    const targetAccepts = (target.affordances?.includes(affordance) === true)
      || (Array.isArray(target.state.affordances) && target.state.affordances.includes(affordance))
      || (affordance === "ignite" && target.state.flammable === true)
      || (affordance === "experiment" && target.state.phenomenon === true);
    const outcome = targetAccepts ? "achieved" : "not_achieved";
    const techniqueId = typeof payload.manner === "string" ? payload.manner : null;
    const contextTags = Array.isArray(payload.contextTags)
      ? payload.contextTags.filter((tag): tag is string => typeof tag === "string")
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
    const claimId = typeof payload.claimId === "string"
      ? payload.claimId
      : typeof payload.epistemicClaimId === "string" ? payload.epistemicClaimId : undefined;
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
          proposition: typeof payload.proposition === "string" ? payload.proposition : "experiment outcome",
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
