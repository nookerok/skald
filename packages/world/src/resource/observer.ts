import type { ReadonlyWorld } from "../projection.js";
import { spatialKnowledgeRank } from "../region/observer-knowledge.js";
import type { ResourceQualityBand } from "./types.js";

export type ResourceAvailability = "depleted" | "scarce" | "limited" | "available" | "abundant" | "unknown";
export type ResourceConfidence = "uncertain" | "probable" | "confirmed";
export type ResourceFreshness = "fresh" | "aging" | "stale";

/** Player-safe estimate of a resource. Exact stock and node ids stay server-side. */
export interface ObservedResourceDTO {
  readonly name: string;
  readonly availability: ResourceAvailability;
  readonly quality?: ResourceQualityBand;
  readonly confidence: ResourceConfidence;
  readonly freshness: ResourceFreshness;
  readonly observedAtWorldTime: number;
}

function resourceName(kind: string): string {
  const names: Record<string, string> = { timber: "Древесина", herbs: "Травы", stone: "Камень", grain: "Зерно", fish: "Рыба", fresh_water: "Пресная вода" };
  return names[kind] ?? kind.replace(/[_-]+/g, " ");
}

function availability(stock: number, capacity: number): ResourceAvailability {
  if (stock <= 0) return "depleted";
  const ratio = capacity > 0 ? stock / capacity : 0;
  if (ratio <= 0.15) return "scarce";
  if (ratio <= 0.4) return "limited";
  if (ratio >= 0.8) return "abundant";
  return "available";
}

function freshness(worldTime: number, observedAt: number): ResourceFreshness {
  const age = Math.max(0, worldTime - observedAt);
  if (age <= 3) return "fresh";
  if (age <= 12) return "aging";
  return "stale";
}

/** Builds only estimates for resource nodes in the observer's known local scope. */
export function buildObservedResources(world: ReadonlyWorld, observerId = "player"): readonly ObservedResourceDTO[] {
  const resources = world.resources;
  if (!resources) return [];
  const result: ObservedResourceDTO[] = [];
  for (const definition of resources.definitions.values()) {
    if (definition.locationId !== world.currentLocationId) continue;
    const observation = world.spatialKnowledge?.locations.get(definition.locationId);
    if (definition.requiresObservation && (!observation || observation.observerId !== observerId || spatialKnowledgeRank(observation.knowledge) < spatialKnowledgeRank("observed"))) continue;
    const state = resources.states.get(definition.id);
    if (!state) continue;
    const observedAtWorldTime = observation?.observedAt ?? world.time;
    const confidence: ResourceConfidence = observation && spatialKnowledgeRank(observation.knowledge) >= spatialKnowledgeRank("traversed") ? "confirmed" : observation ? "probable" : "uncertain";
    result.push({ name: resourceName(definition.resourceKind), availability: availability(state.stockUnits, definition.capacityUnits), quality: definition.quality, confidence, freshness: freshness(world.time, observedAtWorldTime), observedAtWorldTime });
  }
  return Object.freeze(result.sort((a, b) => a.name.localeCompare(b.name)));
}
