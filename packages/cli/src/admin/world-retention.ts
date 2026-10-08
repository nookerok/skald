/**
 * Scratch-world retention planner (operational-hygiene follow-up).
 *
 * Pure and conservative: only ACTIVE worlds whose `saveLabel` matches an
 * explicit scratch pattern, are older than a TTL, and are NOT the primary
 * world, a succession target, or one of the N most-recently-played worlds are
 * eligible for archiving. The canonical player world is never touched.
 *
 * Archiving (soft) is the retention action: `setWorldStatus(id, "archived")`
 * removes the world from the active catalog without deleting its Event Log.
 */

import type { WorldRecord } from "../persistence/types.js";

export interface WorldRetentionOptions {
  readonly now: number;
  readonly ttlMs: number;
  /** A `saveLabel` must match this pattern to be eligible for archiving. */
  readonly scratchPattern: RegExp;
  /** Always keep this many most-recently-played active worlds. */
  readonly protectRecent: number;
}

export interface WorldRetentionPlan {
  readonly archive: readonly WorldRecord[];
  readonly keep: readonly WorldRecord[];
}

function recency(world: WorldRecord): number {
  return world.lastPlayedAt ?? world.createdAt;
}

export function planWorldRetention(
  worlds: readonly WorldRecord[],
  options: WorldRetentionOptions,
): WorldRetentionPlan {
  const active = worlds.filter((world) => world.status === "active");
  const protectedRecent = new Set(
    [...active]
      .sort((a, b) => recency(b) - recency(a))
      .slice(0, Math.max(0, options.protectRecent))
      .map((world) => world.worldId),
  );
  const archive: WorldRecord[] = [];
  const keep: WorldRecord[] = [];
  for (const world of worlds) {
    const age = options.now - recency(world);
    const eligible = world.status === "active"
      && !world.isPrimary
      && world.successorWorldId === null
      && !protectedRecent.has(world.worldId)
      && options.scratchPattern.test(world.saveLabel)
      && age >= options.ttlMs;
    (eligible ? archive : keep).push(world);
  }
  return Object.freeze({ archive: Object.freeze(archive), keep: Object.freeze(keep) });
}
