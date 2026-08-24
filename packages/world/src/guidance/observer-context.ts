import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../projection.js";
import type { NarrativeAdapterContext } from "../setup/background-context.js";
import { buildSituationView } from "../game-shell/situation-view.js";
import type { SituationView } from "../game-shell/types.js";
import { getPlacement, isItemAccessible } from "../action-capability/capability.js";
import { spatialKnowledgeRank } from "../region/observer-knowledge.js";

export interface ObservedObject {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface KnownContact {
  readonly id: string;
  readonly label: string;
}

export interface KnownRoute {
  readonly id: string;
  readonly label: string;
  readonly status: "open" | "difficult" | "closed";
  readonly kind: "road" | "crossing" | "river" | "visibility";
}

export interface AccessibleItem {
  readonly id: string;
  readonly label: string;
  readonly affordances: readonly string[];
  readonly blockedAffordances: readonly string[];
}

export interface ObserverGuidanceContext {
  readonly observedObjects: readonly ObservedObject[];
  readonly knownContacts: readonly KnownContact[];
  readonly knownRoutes: readonly KnownRoute[];
  readonly activeSituation: SituationView | null;
  readonly accessibleItems: readonly AccessibleItem[];
  readonly personalHook: string | null;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function isPlayerScopedEvidence(payload: Record<string, unknown>): boolean {
  // The legacy perception events predate an explicit observerId and are
  // emitted only for the player's interaction. Keep that compatibility
  // default, while rejecting evidence explicitly attributed to another
  // observer.
  return payload.observerId === undefined || payload.observerId === "player";
}

function isConfirmedAccessibleObject(world: ReadonlyWorld, objectId: string): boolean {
  const placement = getPlacement(world.actionCapabilities, objectId);
  if (!placement) return false;
  if (placement.kind === "carried") return placement.holderId === "player";
  // A container-held item is accessible only when the container itself is
  // open and accessible to the player. A bare location placement is not a
  // visibility proof: the location may contain hidden or occluded objects.
  if (placement.kind !== "container") return false;
  return world.objects.get(placement.containerId)?.state.open === true
    && isItemAccessible(world, "player", objectId);
}

function localRelationIds(world: ReadonlyWorld): Set<string> {
  const ids = new Set<string>();
  for (const relation of world.spatial?.travelRelations.values() ?? []) {
    if (relation.fromId === world.currentLocationId || relation.toId === world.currentLocationId) ids.add(relation.id);
  }
  for (const relation of world.spatial?.relations?.values() ?? []) {
    if (relation.fromId === world.currentLocationId || relation.toId === world.currentLocationId) ids.add(relation.id);
  }
  return ids;
}

function buildObservedObjects(events: readonly DomainEvent[], world: ReadonlyWorld): readonly ObservedObject[] {
  const observedIds = new Set<string>();
  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    if (!isPlayerScopedEvidence(payload)) continue;
    if (event.type === "ObjectObserved" && typeof payload.objectId === "string") observedIds.add(payload.objectId);
    if (event.type === "EntityExamined" && typeof payload.entityId === "string") observedIds.add(payload.entityId);
  }
  const items: ObservedObject[] = [];
  for (const object of world.objects.values()) {
    const accessible = isConfirmedAccessibleObject(world, object.id);
    // Being in the same projected location is not observation. The living
    // region projection contains authored and hidden objects that are not
    // necessarily visible to the player. Only explicit player evidence or a
    // capability-proven accessible item may cross into guidance.
    if (!accessible && !observedIds.has(object.id)) continue;
    if (!object.name.trim()) continue;
    items.push(freeze({ id: object.id, label: object.name, description: object.description }));
  }
  return freeze(items.sort((a, b) => a.label.localeCompare(b.label, "ru")));
}

function buildKnownContacts(world: ReadonlyWorld, narrativeContext?: NarrativeAdapterContext | null): readonly KnownContact[] {
  const contacts: KnownContact[] = [];
  const seen = new Set<string>();
  for (const relation of world.relations.values()) {
    if (relation.from !== "player" || seen.has(relation.to)) continue;
    const entity = world.entities.get(relation.to);
    if (!entity?.name || !entity.components.contact) continue;
    seen.add(relation.to);
    contacts.push(freeze({ id: relation.to, label: entity.name }));
  }
  // The adapter may contain a known contact that is represented by a legacy
  // relation rather than an Entity. Only its player-scoped, already known
  // label crosses this boundary; no region-wide entity scan is performed.
  for (const fact of narrativeContext?.contacts ?? []) {
    const id = fact.id.startsWith("contact:") ? fact.id.slice("contact:".length) : fact.id;
    const match = /^Ты знаком с (.+)\.$/u.exec(fact.text);
    if (!match || seen.has(id)) continue;
    seen.add(id);
    contacts.push(freeze({ id, label: match[1]! }));
  }
  return freeze(contacts.sort((a, b) => a.label.localeCompare(b.label, "ru")));
}

function buildKnownRoutes(world: ReadonlyWorld): readonly KnownRoute[] {
  const routes: KnownRoute[] = [];
  const knowledge = world.spatialKnowledge;
  const localIds = localRelationIds(world);
  if (world.spatial && knowledge?.observerId === "player") {
    for (const relation of world.spatial.travelRelations.values()) {
      if (!localIds.has(relation.id)) continue;
      const observation = knowledge.relations.get(relation.id);
      if (!observation || spatialKnowledgeRank(observation.knowledge) < spatialKnowledgeRank("observed")) continue;
      const targetId = relation.fromId === world.currentLocationId ? relation.toId : relation.fromId;
      const target = world.locations.get(targetId);
      if (!target) continue;
      const crossing = relation.kind === "crossing"
        ? world.spatial.crossingStates.get(relation.id) ?? [...world.spatial.crossingStates.values()].find((state) => state.crossingId === relation.id)
        : undefined;
      routes.push(freeze({
        id: relation.id,
        label: target.name,
        status: crossing?.condition ?? (relation.passability === "blocked" ? "closed" : "open"),
        kind: relation.kind,
      }));
    }
  } else {
    // Legacy worlds have no observer spatial read view. Their location
    // connections are already the player-facing local read model.
    const location = world.locations.get(world.currentLocationId);
    for (const targetId of Object.values(location?.connections ?? {})) {
      const target = world.locations.get(targetId);
      if (target) routes.push(freeze({ id: target.id, label: target.name, status: "open", kind: "road" }));
    }
  }
  const seen = new Set<string>();
  return freeze(routes.filter((route) => {
    if (seen.has(route.id)) return false;
    seen.add(route.id);
    return true;
  }).sort((a, b) => a.label.localeCompare(b.label, "ru")));
}

function buildAccessibleItems(world: ReadonlyWorld): readonly AccessibleItem[] {
  const model = world.actionCapabilities;
  if (!model) return freeze([]);
  const conditions = [...model.conditions.values()].filter((condition) => condition.subjectId === "player");
  const blocked = new Set(conditions.flatMap((condition) => condition.blockedAffordances));
  const items: AccessibleItem[] = [];
  for (const [itemId, definition] of model.itemDefinitions) {
    if (!isItemAccessible(world, "player", itemId)) continue;
    const object = world.objects.get(itemId);
    if (!object?.name) continue;
    const affordances = [...definition.affordances].filter((affordance) => !blocked.has(affordance));
    if (affordances.length === 0) continue;
    items.push(freeze({ id: itemId, label: object.name, affordances, blockedAffordances: [...blocked] }));
  }
  return freeze(items.sort((a, b) => a.label.localeCompare(b.label, "ru")));
}

function hasObservedSituationEvidence(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  narrativeContext?: NarrativeAdapterContext | null,
): boolean {
  const active = [...world.activeSituations.values()];
  if (active.length === 0) return false;

  // A selected turn presentation is already an observer-safe, read-side
  // statement. It is the normal production path after a command or reload.
  const byId = new Map(events.map((event) => [event.eventId, event]));
  const activeStarts = new Map(active.map((situation) => [situation.situationId, events.filter((event) => {
    if (event.type !== "SituationStarted") return false;
    const payload = event.payload as Record<string, unknown>;
    return payload.situationId === situation.situationId;
  })]));
  const observerEventTypes = new Set(["ObjectObserved", "EntityExamined", "SoundObserved", "PhenomenonObserved", "SpatialObservationRecorded"]);
  const referencesSituation = (event: DomainEvent, situation: Readonly<{ situationId: string; type: string }>): boolean => {
    const payload = event.payload as Record<string, unknown>;
    const nested = payload.state && typeof payload.state === "object" ? payload.state as Record<string, unknown> : {};
    const refs = [payload.situationId, payload.situationType, payload.subjectRef, payload.phenomenonId, nested.situationId, nested.situationType]
      .filter((value): value is string => typeof value === "string");
    return refs.includes(situation.situationId) || refs.includes(situation.type);
  };
  const isCausalAncestor = (sourceId: string, situation: Readonly<{ situationId: string }>): boolean => {
    const pending = [...(activeStarts.get(situation.situationId) ?? [])];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const event = pending.pop();
      if (!event || seen.has(event.eventId)) continue;
      seen.add(event.eventId);
      if (event.causationId === sourceId) return true;
      if (event.causationId) {
        const parent = byId.get(event.causationId);
        if (parent) pending.push(parent);
      }
    }
    return false;
  };
  const presentedObservation = [
    ...(narrativeContext?.visibleSituation.facts ?? []),
    ...(narrativeContext?.visibleSituation.sensoryContext ?? []),
  ].some((fact) => {
    if (fact.source !== "observation" || !fact.usableNow || fact.epistemicClass !== "observed_fact") return false;
    const sourceIds = fact.sourceEventIds ?? [];
    return active.some((situation) => sourceIds.some((sourceId) => {
      const source = byId.get(sourceId);
      return source !== undefined && observerEventTypes.has(source.type) && isPlayerScopedEvidence(source.payload as Record<string, unknown>)
        && (referencesSituation(source, situation) || isCausalAncestor(sourceId, situation));
    }));
  });
  if (presentedObservation) return true;

  // Some integrations carry the observed subject directly on their event
  // payload. Accept only player-scoped evidence and only when it names the
  // active situation (or its canonical type).
  for (const event of events) {
    if (!["PhenomenonObserved", "SoundObserved", "EntityExamined", "ObjectObserved"].includes(event.type)) continue;
    const payload = event.payload as Record<string, unknown>;
    if (!isPlayerScopedEvidence(payload)) continue;
    const references = [
      payload.situationId,
      payload.situationType,
      payload.subjectId,
      payload.subjectRef,
      payload.phenomenonId,
      payload.type,
    ].filter((value): value is string => typeof value === "string");
    if (active.some((situation) => references.includes(situation.situationId) || references.includes(situation.type))) return true;
  }
  return false;
}

function buildLocalSituation(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  narrativeContext?: NarrativeAdapterContext | null,
): SituationView | null {
  const explicit = buildSituationView(world);
  if (explicit && (world.spatial === null || hasObservedSituationEvidence(events, world, narrativeContext))) return explicit;
  const localIds = localRelationIds(world);
  const spatial = world.spatial;
  const knowledge = world.spatialKnowledge;
  if (!spatial || knowledge?.observerId !== "player") return null;
  for (const state of spatial.crossingStates.values()) {
    if (!localIds.has(state.crossingId)) continue;
    const observation = knowledge.relations.get(state.crossingId);
    if (!observation || spatialKnowledgeRank(observation.knowledge) < spatialKnowledgeRank("observed")) continue;
    return freeze({ situationId: "observed-crossing", title: "Переправа", description: state.condition === "closed" ? "Переправа закрыта из-за высокой воды." : state.condition === "difficult" ? "Переправа трудна." : "Переправа открыта.", effects: [], startedAt: state.updatedAt, remainingTicks: null });
  }
  for (const state of spatial.riverStates.values()) {
    const crossing = [...spatial.crossingDefinitions.values()].find((definition) => definition.watercourseId === state.watercourseId);
    if (!crossing || !localIds.has(crossing.crossingId)) continue;
    const observation = knowledge.water.get(state.watercourseId);
    if (!observation || spatialKnowledgeRank(observation.knowledge) < spatialKnowledgeRank("observed")) continue;
    return freeze({ situationId: "observed-water", title: "Вода у переправы", description: state.band === "high" || state.band === "flood" ? "Вода поднялась у переправы." : "У переправы видна вода.", effects: [], startedAt: state.updatedAt, remainingTicks: null });
  }
  return null;
}

export function buildObserverGuidanceContext(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  narrativeContext?: NarrativeAdapterContext | null,
): ObserverGuidanceContext {
  return freeze({
    observedObjects: buildObservedObjects(events, world),
    knownContacts: buildKnownContacts(world, narrativeContext),
    knownRoutes: buildKnownRoutes(world),
    activeSituation: buildLocalSituation(events, world, narrativeContext),
    accessibleItems: buildAccessibleItems(world),
    personalHook: narrativeContext?.arrival.personalHook?.trim() || null,
  });
}
