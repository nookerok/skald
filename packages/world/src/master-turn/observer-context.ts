/**
 * Observer-safe Master Turn scene context (ADR-0028, plan_6 Stage 3).
 *
 * A read-side adapter from committed Domain Events plus the current
 * ReadonlyWorld to the bounded scene an LLM interpreter may see. It never
 * passes the whole GameShellSnapshot (which carries worldId, coordinates,
 * internal ids and numeric relation values) and never reads Canon, the raw
 * Event Log or another observer's evidence.
 *
 * Composition, not new truth:
 * - visible objects, known people, known routes, accessible items and the
 *   observed situation come from buildObserverGuidanceContext;
 * - knowledge topics come from buildPlayerKnowledgePresentation over a
 *   freshly built player BeliefModel;
 * - available action names come from closed static registries only.
 *
 * Internal ids are replaced with transient `observerRef` handles
 * (`person_1`, `object_2`, `route_1`, `topic_3`). The returned reference
 * table resolves them back to canonical ids; it is server-only, lives only
 * for the current request and must never be serialized into a prompt.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../projection.js";
import type { NarrativeAdapterContext } from "../setup/background-context.js";
import { buildObserverGuidanceContext } from "../guidance/observer-context.js";
import { buildBeliefModel } from "../observation/builder.js";
import { buildPlayerKnowledgePresentation } from "../game-shell/knowledge-view.js";
import type {
  PlayerKnowledgeCategory,
  PlayerKnowledgeStatus,
} from "../game-shell/types.js";
import { interactionRegistry } from "../interaction-registry.js";

/** Observer-handle namespaces used inside a MasterTurnSceneContext. */
export type MasterSceneReferentKind = "person" | "object" | "route" | "topic";

/** One observer-safe candidate: person, observed object or known route. */
export interface MasterSceneReferent {
  readonly observerRef: string;
  readonly kind: MasterSceneReferentKind;
  readonly label: string;
  readonly knownAs: readonly string[];
  /** Route passability; present only when kind is "route". */
  readonly status?: "open" | "difficult" | "closed";
}

/** One accessible item. Shares the `object_N` namespace with visibleObjects. */
export interface MasterSceneItem {
  readonly observerRef: string;
  readonly label: string;
  readonly knownAs: readonly string[];
  /** Currently unblocked affordances only; blocked ones stay server-side. */
  readonly affordances: readonly string[];
}

/** One statically available action name from a closed registry. */
export interface MasterAvailableAction {
  readonly kind: "interaction" | "journey" | "legacy";
  readonly verb: string;
}

/** One observer-safe knowledge topic. */
export interface MasterKnowledgeTopic {
  readonly observerRef: string;
  readonly category: PlayerKnowledgeCategory;
  readonly text: string;
  readonly status: PlayerKnowledgeStatus;
}

/** The observed situation, stripped to player-facing prose. */
export interface MasterSceneSituation {
  readonly title: string;
  readonly description: string;
}

/**
 * Bounded observer-safe scene for the Master Turn interpreter.
 * JSON-safe: plain data only, no Maps, no internal ids, no coordinates,
 * no numeric relation values, no confidence, no sourceEventIds.
 */
export interface MasterTurnSceneContext {
  readonly schemaVersion: 1;
  readonly revision: {
    readonly worldTime: number;
    readonly eventNumber: number;
  };
  readonly currentLocation: {
    readonly name: string;
    readonly description: string;
  };
  readonly visibleObjects: readonly MasterSceneReferent[];
  readonly knownPeople: readonly MasterSceneReferent[];
  readonly knownRoutes: readonly MasterSceneReferent[];
  readonly accessibleItems: readonly MasterSceneItem[];
  readonly availableActions: readonly MasterAvailableAction[];
  readonly currentSituation: MasterSceneSituation | null;
  readonly knownTopics: readonly MasterKnowledgeTopic[];
}

/**
 * Server-only resolution of one observerRef back to identity: the canonical
 * entity/relation/object id, or the `category:text` knowledge-entry key for
 * topics (which have no canonical id).
 */
export interface MasterSceneReference {
  readonly kind: MasterSceneReferentKind;
  readonly internalId: string;
  readonly label: string;
}

/**
 * One adapter call result: the prompt-safe context plus its transient
 * server-only reference table. The table must not be retained past the
 * current request and must never enter an LLM prompt.
 */
export interface MasterTurnSceneSnapshot {
  readonly context: MasterTurnSceneContext;
  readonly references: ReadonlyMap<string, MasterSceneReference>;
}

/** Maximum knowledge topics carried into a scene context. */
export const MASTER_TURN_MAX_TOPICS = 24;

/**
 * Closed static action names: the world's interaction registry plus journey
 * plus the legacy command-pipeline operations. Names only — per-scene
 * applicability stays with Rules and the later contextual validator.
 */
export const MASTER_TURN_AVAILABLE_ACTIONS: readonly MasterAvailableAction[] = Object.freeze([
  ...[...interactionRegistry.values()].map((definition) => Object.freeze({
    kind: "interaction" as const,
    verb: definition.verb,
  })),
  Object.freeze({ kind: "journey" as const, verb: "journey" }),
  ...["approach", "enter", "heat", "cool", "create_mark", "speak", "call", "wait"].map((verb) => Object.freeze({
    kind: "legacy" as const,
    verb,
  })),
]);

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return freeze(result);
}

/**
 * Builds the observer-safe scene for one Master Turn request.
 * Pure and read-only: emits no Domain Events, writes no Projection,
 * performs no network calls.
 */
export function buildMasterTurnSceneContext(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  narrativeContext?: NarrativeAdapterContext | null,
): MasterTurnSceneSnapshot {
  const guidance = buildObserverGuidanceContext(events, world, narrativeContext ?? null);
  const beliefModel = buildBeliefModel(events, world);
  const knowledge = buildPlayerKnowledgePresentation(events, world, beliefModel);

  const references = new Map<string, MasterSceneReference>();
  const claimRef = (observerRef: string, reference: MasterSceneReference): void => {
    references.set(observerRef, freeze(reference));
  };

  const location = world.locations.get(world.currentLocationId);
  const objectAliases = (id: string): readonly string[] => {
    const object = world.objects.get(id);
    if (!object) return freeze([]);
    return uniqueStrings([object.name, ...object.aliases]);
  };

  const visibleObjects: MasterSceneReferent[] = guidance.observedObjects.map((object, index) => {
    const observerRef = `object_${index + 1}`;
    claimRef(observerRef, { kind: "object", internalId: object.id, label: object.label });
    return freeze({
      observerRef,
      kind: "object" as const,
      label: object.label,
      knownAs: objectAliases(object.id),
    });
  });
  const objectRefById = new Map<string, string>();
  for (const referent of visibleObjects) {
    const reference = references.get(referent.observerRef);
    if (reference) objectRefById.set(reference.internalId, referent.observerRef);
  }

  const knownPeople: MasterSceneReferent[] = guidance.knownContacts.map((contact, index) => {
    const observerRef = `person_${index + 1}`;
    claimRef(observerRef, { kind: "person", internalId: contact.id, label: contact.label });
    return freeze({
      observerRef,
      kind: "person" as const,
      label: contact.label,
      knownAs: uniqueStrings([contact.label]),
    });
  });

  const knownRoutes: MasterSceneReferent[] = guidance.knownRoutes.map((route, index) => {
    const observerRef = `route_${index + 1}`;
    claimRef(observerRef, { kind: "route", internalId: route.id, label: route.label });
    return freeze({
      observerRef,
      kind: "route" as const,
      label: route.label,
      knownAs: uniqueStrings([route.label]),
      status: route.status,
    });
  });

  const accessibleItems: MasterSceneItem[] = guidance.accessibleItems.map((item) => {
    let observerRef = objectRefById.get(item.id);
    if (!observerRef) {
      observerRef = `object_${visibleObjects.length + 1}`;
      claimRef(observerRef, { kind: "object", internalId: item.id, label: item.label });
      visibleObjects.push(freeze({
        observerRef,
        kind: "object" as const,
        label: item.label,
        knownAs: objectAliases(item.id),
      }));
      objectRefById.set(item.id, observerRef);
    }
    return freeze({
      observerRef,
      label: item.label,
      knownAs: objectAliases(item.id),
      affordances: freeze([...item.affordances]),
    });
  });

  const knownTopics: MasterKnowledgeTopic[] = knowledge.entries
    .slice(0, MASTER_TURN_MAX_TOPICS)
    .map((entry, index) => {
      const observerRef = `topic_${index + 1}`;
      claimRef(observerRef, { kind: "topic", internalId: `${entry.category}:${entry.text}`, label: entry.text });
      return freeze({
        observerRef,
        category: entry.category,
        text: entry.text,
        status: entry.status,
      });
    });

  const context: MasterTurnSceneContext = freeze({
    schemaVersion: 1 as const,
    revision: freeze({ worldTime: world.time, eventNumber: world.eventNumber }),
    currentLocation: freeze({
      name: location?.name ?? "",
      description: location?.description ?? "",
    }),
    visibleObjects: freeze(visibleObjects),
    knownPeople: freeze(knownPeople),
    knownRoutes: freeze(knownRoutes),
    accessibleItems: freeze(accessibleItems),
    availableActions: MASTER_TURN_AVAILABLE_ACTIONS,
    currentSituation: guidance.activeSituation
      ? freeze({ title: guidance.activeSituation.title, description: guidance.activeSituation.description })
      : null,
    knownTopics: freeze(knownTopics),
  });

  return freeze({ context, references: references as ReadonlyMap<string, MasterSceneReference> });
}
