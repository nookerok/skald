/**
 * Interaction Model v1 — unified Target Resolver (ADR-0013 §3).
 *
 * The single resolver used by the runtime gate, the offline classifier and
 * the HTTP/integration tests, so runtime and offline can never disagree
 * (continues the ADR-0011 shared-predicate principle).
 *
 * Semantics:
 * - observer/player scope only: grid entities must be nearby (Manhattan ≤ 1);
 *   WorldObjects must be in the player's current location;
 * - an exact name/alias match always beats a partial match;
 * - a partial match resolves only when it selects a single candidate;
 * - two equal matches are `ambiguous` (honest rejection with player-facing
 *   candidate names, never a guess);
 * - `observe`/`listen` with no target resolve to `environment`;
 * - the parser never calls this: it is a Rule-side function over
 *   ReadonlyWorld.
 *
 * TODO(ADR-0013): "invisible/unavailable excluded" needs a visibility model;
 * the v1 slice set has none, so scope is distance/location only.
 */

import type { Entity } from "../entities/types.js";
import type { ReadonlyWorld } from "../projection.js";
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
  for (const candidate of names) {
    if (normalized(candidate) === query) return "exact";
  }
  for (const candidate of names) {
    const name = normalized(candidate);
    if (name.includes(query) || query.includes(name)) return "partial";
  }
  return null;
}

function collectCandidates(world: ReadonlyWorld, query: string): InteractionTarget[] {
  const byId = new Map<string, InteractionTarget>();

  // Location scope: physical objects in the player's current location.
  const locationId = world.currentLocationId;
  const location = locationId ? world.locations.get(locationId) : undefined;
  for (const id of location?.objectIds ?? []) {
    const object = world.objects.get(id);
    if (object && matchLevel([object.name, ...object.aliases], query) !== null) {
      byId.set(id, targetFromObject(object));
    }
  }

  // Grid scope: generic entities nearby the player. Entities backed by a
  // physical object are location-scoped (their grid coordinates carry no
  // location semantics), so they are excluded here.
  for (const entity of world.entities.values()) {
    if (world.objects.has(entity.id)) continue;
    if (!isNearby(entity, world)) continue;
    if (matchLevel([entity.name, ...entity.aliases], query) !== null) {
      byId.set(entity.id, targetFromEntity(entity));
    }
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

/**
 * Unified target resolution. `verb` selects the environment fallback
 * (`observe`/`listen`); `query` is the raw text the player used.
 */
export function resolveInteractionTarget(
  world: ReadonlyWorld,
  verb: string,
  query: string,
): TargetResolution {
  const object = normalized(query);

  if (object.length === 0) {
    if (verb === "observe" || verb === "listen") {
      const locationId = world.currentLocationId;
      if (locationId && locationId.length > 0) return { kind: "environment", locationId };
      // Existing pre-location legacy logs remain valid saves. They have the
      // old-cart entity but no LocationDefined event; allow environment
      // observation and let the law return only facts present in that log.
      if (world.entities.has("old-cart") && !world.currentLocationId) {
        return { kind: "environment", locationId: "legacy_overworld" };
      }
    }
    return { kind: "missing" };
  }

  const candidates = collectCandidates(world, object);

  const exact = candidates.filter((target) => {
    const names = [target.name, ...target.aliases];
    return matchLevel(names, object) === "exact";
  });
  const pool = exact.length > 0 ? exact : candidates;

  if (pool.length === 0) return { kind: "missing" };
  if (pool.length === 1) return { kind: "resolved", target: pool[0]! };
  return { kind: "ambiguous", candidates: toCandidates(pool) };
}
