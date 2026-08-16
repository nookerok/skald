import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../projection.js";
import { getCharacterBackground } from "./character-presets.js";

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
