/**
 * Observer-safe view of the per-scene engagement state (ADR-0039 §3).
 *
 * The projection stores an internal `targetRef`; this adapter resolves it to a
 * player-facing label and NEVER exposes the ref, the internal location id or
 * any coordinate. A target that cannot be named observer-safely yields null
 * rather than a leaked identifier.
 */

import type { ReadonlyWorld } from "../projection.js";

export interface SceneEngagementView {
  readonly state: "near" | "engaged";
  /** Player-facing name of the nearby target; never an internal id. */
  readonly label: string;
}

export function sceneEngagementView(world: ReadonlyWorld): SceneEngagementView | null {
  const engagement = world.sceneEngagement;
  if (!engagement) return null;
  const label = world.entities.get(engagement.targetRef)?.name
    ?? world.objects.get(engagement.targetRef)?.name
    ?? null;
  if (!label) return null;
  return { state: engagement.state, label };
}
