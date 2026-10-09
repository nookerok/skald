/**
 * Unified proximity resolver (ADR-0039 §3).
 *
 * One pure question for every proximity-dependent rule: how close is the player
 * to a given target in the current scene? `near` after an approach, `engaged`
 * after a deepening interaction (e.g. handing an item over), `far` otherwise.
 * Rules compose this instead of re-reading `sceneEngagement` by hand.
 */

import type { ReadonlyWorld } from "../projection.js";

export type ProximityLevel = "far" | "near" | "engaged";

/** The player's proximity to one target in the current scene. */
export function resolveProximity(world: ReadonlyWorld, targetRef: string): ProximityLevel {
  const engagement = world.sceneEngagement;
  if (engagement && engagement.targetRef === targetRef && engagement.locationId === world.currentLocationId) {
    return engagement.state;
  }
  return "far";
}

/** True when the player is at least `near` the target. */
export function isNear(world: ReadonlyWorld, targetRef: string): boolean {
  return resolveProximity(world, targetRef) !== "far";
}
