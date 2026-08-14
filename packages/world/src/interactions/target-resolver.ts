/**
 * Interaction Model v1 — unified Target Resolver (ADR-0013 §3).
 *
 * Runtime, offline classification and HTTP tests share this resolver. It
 * exposes only observer-visible candidates and never guesses an ambiguous
 * target. Items inside an accessible open container are visible to `take`.
 */

import type { Entity } from "../entities/types.js";
import type { ReadonlyWorld } from "../projection.js";
import { isItemAccessible } from "../action-capability/capability.js";
import { targetFromEntity, targetFromObject } from "./target-view.js";
import type { InteractionTarget, PlayerFacingCandidate, TargetResolution } from "./types.js";

function normalized(value: string): string {
  return value.trim().toLowerCase();
}

function isNearby(entity: Entity, world: ReadonlyWorld): boolean {
  return Math.abs(entity.x - world.player.x) + Math.abs(entity.y - world.player.y) <= 1;
}

type MatchLevel = "exact" | "partial" | null;

function matchLevel(names: readonly string[], query: string): MatchLevel {
  if (!query) return null;
  for (const candidate of names) if (normalized(candidate) === query) return "exact";
  for (const candidate of names) {
    const name = normalized(candidate);
    if (name.includes(query) || query.includes(name)) return "partial";
  }
  return null;
}

function collectCandidates(world: ReadonlyWorld, query: string, verb: string): InteractionTarget[] {
  const byId = new Map<string, InteractionTarget>();
  const locationId = world.currentLocationId;
  const location = locationId ? world.locations.get(locationId) : undefined;

  for (const id of location?.objectIds ?? []) {
    const object = world.objects.get(id);
    if (object && matchLevel([object.name, ...object.aliases], query) !== null) byId.set(id, targetFromObject(object));
  }

  // A contained item is a valid `take` target only when its full placement is
  // accessible; hidden or closed-container contents never leak to the UI.
  if (verb === "take" || verb === "give") {
    for (const [id, placement] of world.actionCapabilities?.placements ?? []) {
      if (verb === "take" && placement.kind !== "container") continue;
      if (!isItemAccessible(world, "player", id)) continue;
      const object = world.objects.get(id);
      if (object && matchLevel([object.name, ...object.aliases], query) !== null) byId.set(id, targetFromObject(object));
    }
  }

  for (const entity of world.entities.values()) {
    if (world.objects.has(entity.id) || !isNearby(entity, world)) continue;
    if (matchLevel([entity.name, ...entity.aliases], query) !== null) byId.set(entity.id, targetFromEntity(entity));
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function toCandidates(targets: readonly InteractionTarget[]): readonly PlayerFacingCandidate[] {
  const seen = new Set<string>();
  const candidates: PlayerFacingCandidate[] = [];
  for (const target of targets) {
    if (seen.has(target.name)) continue;
    seen.add(target.name);
    candidates.push({ name: target.name, description: target.description });
  }
  return candidates;
}

/** Resolves one target from the observer-scoped world snapshot. */
export function resolveInteractionTarget(world: ReadonlyWorld, verb: string, query: string): TargetResolution {
  const object = normalized(query);
  if (object.length === 0) {
    if (verb === "observe" || verb === "listen") {
      const locationId = world.currentLocationId;
      if (locationId) return { kind: "environment", locationId };
      if (world.entities.has("old-cart")) return { kind: "environment", locationId: "legacy_overworld" };
    }
    return { kind: "missing" };
  }

  const candidates = collectCandidates(world, object, verb);
  const exact = candidates.filter((target) => matchLevel([target.name, ...target.aliases], object) === "exact");
  const pool = exact.length > 0 ? exact : candidates;
  if (pool.length === 0) return { kind: "missing" };
  if (pool.length === 1) return { kind: "resolved", target: pool[0]! };
  return { kind: "ambiguous", candidates: toCandidates(pool) };
}
