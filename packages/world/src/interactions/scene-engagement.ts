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
  const entity = world.entities.get(engagement.targetRef);
  const object = world.objects.get(engagement.targetRef);
  const name = entity?.name ?? object?.name ?? null;
  if (!name) return null;
  // Identity boundary: a CONTACT's canonical name is player-facing only after
  // acquaintance; an unknown present person is cited observer-safely. Objects
  // carry no identity boundary.
  const contact = entity?.components.contact;
  if (contact) {
    const known = [...world.relations.values()].some((relation) => relation.from === "player" && relation.to === engagement.targetRef);
    return { state: engagement.state, label: known ? name : "Незнакомый человек" };
  }
  return { state: engagement.state, label: name };
}
