import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../projection.js";
import { getCharacterBackground } from "./character-presets.js";
import type { RegionEntrypoint } from "./types.js";
import type { TurnPresentation } from "../presentation/types.js";
import { spatialKnowledgeRank } from "../region/observer-knowledge.js";

export type NarrativeFactEpistemicClass =
  | "established_fact"
  | "observed_fact"
  | "testimony"
  | "inference"
  | "interpretation";

export type NarrativeFactSource =
  | "background"
  | "entrypoint"
  | "bootstrap_event"
  | "observation"
  | "knowledge"
  | "testimony"
  | "inventory"
  | "relation"
  | "situation";

/** A bounded, provenance-bearing fact available to a non-authoritative adapter. */
export interface NarrativeFact {
  readonly id: string;
  readonly text: string;
  readonly epistemicClass: NarrativeFactEpistemicClass;
  readonly source: NarrativeFactSource;
  readonly usableNow: boolean;
  /** Internal read-side provenance; never included in player-facing DTOs or LLM prompt facts. */
  readonly sourceEventIds?: readonly string[];
}

/**
 * Observer-safe context for narration. Fact ids are adapter-local prompt keys;
 * they are never intended for player-facing DTOs.
 */
export interface NarrativeAdapterContext {
  readonly character: {
    readonly name: string;
    readonly backgroundTitle: string;
    readonly formerRole: string;
    readonly rupture: string;
    readonly obligation: string;
  };
  readonly arrival: {
    readonly reason: string;
    readonly personalHook: string;
    readonly startingLocation: string;
  };
  readonly visibleSituation: {
    readonly facts: readonly NarrativeFact[];
    readonly sensoryContext: readonly NarrativeFact[];
  };
  readonly knowledge: {
    readonly observed: readonly NarrativeFact[];
    readonly testimony: readonly NarrativeFact[];
    readonly hypotheses: readonly NarrativeFact[];
  };
  readonly contacts: readonly NarrativeFact[];
  readonly accessibleItems: readonly NarrativeFact[];
  readonly unresolvedSituation: readonly NarrativeFact[];
  readonly openingWindow: boolean;
}

export interface NarrativeAdapterContextOptions {
  readonly profile: { readonly background_id?: string | null } | null;
  readonly characterName?: string | null;
  readonly entrypoint?: RegionEntrypoint | null;
  readonly presentation?: TurnPresentation | null;
  readonly openingWindow?: boolean;
}

export interface BackgroundNarrativeContext {
  readonly backgroundId: string;
  readonly title: string;
  readonly obligation: string;
  readonly establishedFacts: readonly string[];
  readonly playerKnowledge: readonly string[];
  readonly testimony: readonly string[];
  readonly relations: readonly string[];
  readonly accessibleItems: readonly string[];
  readonly familiarSpatialRefs: readonly string[];
}

function fact(id: string, text: string, epistemicClass: NarrativeFactEpistemicClass, source: NarrativeFactSource, usableNow = true, sourceEventIds?: readonly string[]): NarrativeFact {
  return Object.freeze({
    id, text, epistemicClass, source, usableNow,
    ...(sourceEventIds && sourceEventIds.length > 0 ? { sourceEventIds: Object.freeze([...sourceEventIds]) } : {}),
  });
}

function uniqueFacts(items: readonly NarrativeFact[]): readonly NarrativeFact[] {
  const seen = new Set<string>();
  return Object.freeze(items.filter((item) => {
    const key = item.id + "\u0000" + item.text;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }));
}

function currentLocation(world: ReadonlyWorld): { name: string; description: string } {
  const location = world.locations.get(world.currentLocationId);
  return { name: location?.name ?? "переправа", description: location?.description ?? "Ты находишься у переправы." };
}

function humanRiverBand(value: string): string {
  return ({ low: "низкая", normal: "обычная", high: "высокая", flood: "разлив" } as Record<string, string>)[value] ?? value;
}

function humanCrossingCondition(value: string): string {
  return ({ open: "открыта", difficult: "затруднена", closed: "закрыта" } as Record<string, string>)[value] ?? value;
}

function carriedItemIds(events: readonly DomainEvent[], world: ReadonlyWorld): Set<string> {
  const ids = new Set<string>();
  const capabilities = world.actionCapabilities;
  if (capabilities) {
    for (const [itemId, placement] of capabilities.placements) {
      if (placement.kind === "carried" && placement.holderId === "player" && capabilities.owners.get(itemId) === "player") ids.add(itemId);
    }
    return ids;
  }
  for (const event of events) {
    if (event.type !== "ItemMoved") continue;
    const payload = event.payload as { itemId?: unknown; to?: { kind?: unknown; holderId?: unknown } };
    if (typeof payload.itemId !== "string") continue;
    if (payload.to?.kind === "carried" && payload.to.holderId === "player") ids.add(payload.itemId);
    else ids.delete(payload.itemId);
  }
  return ids;
}

/**
 * Return only hydrology facts that are both in the player's observer map and
 * attached to a relation adjacent to the current location.  The simulation
 * projection intentionally contains the whole region; that is not equivalent
 * to what the player can currently see.
 */
function locallyObservedHydrology(world: ReadonlyWorld): {
  readonly crossingIds: ReadonlySet<string>;
  readonly watercourseIds: ReadonlySet<string>;
} {
  const spatial = world.spatial;
  const knowledge = world.spatialKnowledge;
  if (!spatial || !knowledge || knowledge.observerId !== "player") {
    return { crossingIds: new Set(), watercourseIds: new Set() };
  }

  const adjacentRelationIds = new Set<string>();
  for (const relation of spatial.travelRelations.values()) {
    if (relation.fromId === world.currentLocationId || relation.toId === world.currentLocationId) {
      adjacentRelationIds.add(relation.id);
    }
  }
  for (const relation of spatial.relations?.values() ?? []) {
    if (relation.fromId === world.currentLocationId || relation.toId === world.currentLocationId) {
      adjacentRelationIds.add(relation.id);
    }
  }

  const crossingIds = new Set<string>();
  for (const [relationId, observation] of knowledge.relations) {
    if (observation.observerId !== "player" || !adjacentRelationIds.has(relationId)) continue;
    if (spatialKnowledgeRank(observation.knowledge) < spatialKnowledgeRank("glimpsed")) continue;
    if (spatial.crossingDefinitions.has(relationId)) crossingIds.add(relationId);
  }

  const watercourseIds = new Set<string>();
  for (const crossingId of crossingIds) {
    const definition = spatial.crossingDefinitions.get(crossingId);
    if (definition) watercourseIds.add(definition.watercourseId);
  }
  for (const [watercourseId, observation] of knowledge.water) {
    if (observation.observerId !== "player") continue;
    if (spatialKnowledgeRank(observation.knowledge) < spatialKnowledgeRank("glimpsed")) continue;
    if (watercourseIds.has(watercourseId)) watercourseIds.add(watercourseId);
  }
  return { crossingIds, watercourseIds };
}

/**
 * Builds the Stage 5 narrative adapter context from already replayed state.
 * This function is deliberately free of LLM, Canon, EventBus writes and
 * projection mutation. It only returns a frozen read-side value.
 */
export function buildNarrativeAdapterContext(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  options: NarrativeAdapterContextOptions,
): NarrativeAdapterContext | null {
  const backgroundId = options.profile?.background_id ?? null;
  if (!backgroundId) return null;
  const background = getCharacterBackground(backgroundId);
  if (!background) return null;
  const location = currentLocation(world);
  const entrypoint = options.entrypoint ?? null;
  const name = options.characterName?.trim() || "путник";

  const reason = background.reasonInRegion;
  const personalHook = entrypoint?.backgroundBridges[background.id] ?? background.openingHook;

  const observed: NarrativeFact[] = [];
  const testimony: NarrativeFact[] = [];
  const hypotheses: NarrativeFact[] = [];
  const knownContactIds = new Set<string>();
  for (const [index, event] of events.entries()) {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === "RelationChanged" && payload.from === "player" && typeof payload.to === "string") {
      knownContactIds.add(payload.to);
    }
    if (event.type === "KnowledgeAcquired" && payload.subjectId === "player" && typeof payload.proposition === "string") {
      // KnowledgeAcquired records what the player has learned, not a new
      // world-level truth. Keep it observer-scoped and below established_fact
      // so the narration guard cannot promote a learned proposition into an
      // authoritative statement about the world.
      observed.push(fact(`knowledge:${index}`, payload.proposition, "observed_fact", "knowledge"));
    }
    if (event.type === "TestimonyReceived" && payload.observerId === "player" && typeof payload.proposition === "string") {
      testimony.push(fact(`testimony:${index}`, payload.proposition, "testimony", "testimony"));
    }
    if (event.type === "EpistemicEvidenceRecorded" && payload.observerId === "player" && typeof payload.proposition === "string") {
      hypotheses.push(fact(`hypothesis:${index}`, payload.proposition, "inference", "knowledge"));
    }
  }

  const presentationFacts = options.presentation ? [
    ...(options.presentation.primary ? [options.presentation.primary] : []),
    ...options.presentation.notable,
  ].map((entry, index) => fact(`turn:${index}`, entry.text, entry.epistemicClass, "observation", true, entry.sourceEventIds)) : [];
  const visibleFacts: NarrativeFact[] = [
    fact("situation:location", `${location.name}: ${location.description}`, "observed_fact", "situation"),
    ...presentationFacts,
  ];
  const sensoryFacts: NarrativeFact[] = [];
  // Weather is a region-wide process without an observer/location binding in
  // the current read model.  Do not turn it into a local fact here; a future
  // observation event can add it through presentationFacts.
  const localHydrology = locallyObservedHydrology(world);
  if (world.spatial?.crossingStates) {
    for (const state of world.spatial.crossingStates.values()) {
      if (!localHydrology.crossingIds.has(state.crossingId)) continue;
      sensoryFacts.push(fact(`situation:crossing:${state.crossingId}`, `Переправа ${humanCrossingCondition(state.condition)}.`, "observed_fact", "situation"));
    }
  }
  if (world.spatial?.riverStates) {
    for (const state of world.spatial.riverStates.values()) {
      if (!localHydrology.watercourseIds.has(state.watercourseId)) continue;
      sensoryFacts.push(fact(`situation:river:${state.watercourseId}`, `Вода поднялась до уровня: ${humanRiverBand(state.band)}.`, "observed_fact", "situation"));
    }
  }

  const contacts: NarrativeFact[] = [];
  for (const relation of world.relations.values()) {
    if (relation.from !== "player") continue;
    if (!knownContactIds.has(relation.to)) continue;
    const entity = world.entities.get(relation.to);
    if (!entity?.name) continue;
    contacts.push(fact(`contact:${relation.to}`, `Ты знаком с ${entity.name}.`, "established_fact", "relation"));
  }
  const itemIds = carriedItemIds(events, world);
  const accessibleItems: NarrativeFact[] = [];
  for (const itemId of itemIds) {
    const item = world.objects.get(itemId);
    if (item?.name) accessibleItems.push(fact(`item:${itemId}`, `Среди твоих вещей: ${item.name}.`, "observed_fact", "inventory"));
  }

  const unresolved = [
    fact("situation:obligation", background.obligation, "established_fact", "background"),
    ...(entrypoint?.openingProblem ? [fact("situation:opening-problem", entrypoint.openingProblem, "observed_fact", "entrypoint")] : []),
  ];
  return Object.freeze({
    character: Object.freeze({ name, backgroundTitle: background.title, formerRole: background.formerRole, rupture: background.rupture, obligation: background.obligation }),
    arrival: Object.freeze({ reason, personalHook, startingLocation: entrypoint?.title ?? location.name }),
    visibleSituation: Object.freeze({ facts: uniqueFacts(visibleFacts), sensoryContext: uniqueFacts(sensoryFacts) }),
    knowledge: Object.freeze({ observed: uniqueFacts(observed), testimony: uniqueFacts(testimony), hypotheses: uniqueFacts(hypotheses) }),
    contacts: uniqueFacts(contacts),
    accessibleItems: uniqueFacts(accessibleItems),
    unresolvedSituation: uniqueFacts(unresolved),
    openingWindow: options.openingWindow === true,
  });
}

/** Read-side context for narration; it never creates or mutates simulation state. */
export function buildBackgroundNarrativeContext(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  profile: { readonly background_id?: string | null } | null,
): BackgroundNarrativeContext | null {
  const backgroundId = profile?.background_id ?? null;
  if (!backgroundId) return null;
  const background = getCharacterBackground(backgroundId);
  if (!background) return null;

  const knowledge: string[] = [];
  const testimony: string[] = [];
  const familiarSpatialRefs: string[] = [];
  const itemOwners = new Map<string, string>();
  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    if (event.type === "KnowledgeAcquired" && payload.subjectId === "player" && typeof payload.proposition === "string") {
      knowledge.push(payload.proposition);
    }
    if (event.type === "TestimonyReceived" && payload.observerId === "player" && typeof payload.proposition === "string") {
      testimony.push(payload.proposition);
    }
    if (event.type === "SpatialObservationRecorded" && (payload.observerId ?? "player") === "player" &&
        typeof payload.subjectKind === "string" && typeof payload.subjectId === "string") {
      familiarSpatialRefs.push(payload.subjectKind + ":" + payload.subjectId);
    }
    if (event.type === "ItemPossessionChanged" && typeof payload.itemId === "string") {
      if (payload.ownerId === "player") itemOwners.set(payload.itemId, "player");
      else itemOwners.delete(payload.itemId);
    }
  }

  const relations = [...world.relations.values()]
    .filter((relation) => relation.from === "player")
    .map((relation) => relation.kind + " → " + relation.to);
  const accessibleItems = [...itemOwners.keys()]
    .map((id) => world.objects.get(id)?.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0);

  return Object.freeze({
    backgroundId,
    title: background.title,
    obligation: background.obligation,
    establishedFacts: Object.freeze([...world.locations.values()].filter((location) => location.id === world.currentLocationId).map((location) => location.description)),
    playerKnowledge: Object.freeze([...new Set(knowledge)]),
    testimony: Object.freeze([...new Set(testimony)]),
    relations: Object.freeze(relations),
    accessibleItems: Object.freeze(accessibleItems),
    familiarSpatialRefs: Object.freeze([...new Set(familiarSpatialRefs)]),
  });
}
