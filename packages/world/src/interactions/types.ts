/**
 * Interaction Model v1 — shared target types (ADR-0013 §3, §4).
 *
 * The resolver and the target adapter are the single source of target
 * semantics for the runtime gate, the offline classifier and the HTTP layer.
 */

import type { EntityComponents } from "../entities/types.js";
import type { WorldObject } from "../objects/types.js";

/** Player-facing ambiguity candidate; never carries internal identifiers. */
export interface PlayerFacingCandidate {
  readonly name: string;
  readonly description: string;
}

/**
 * Result of the unified target resolver. `resolved` targets are concrete and
 * unambiguous; `environment` means observe/listen with no target describes
 * the current surroundings; `missing` and `ambiguous` are honest rejections
 * (no guessing, no long-lived clarification state).
 */
export type TargetResolution =
  | { readonly kind: "resolved"; readonly target: InteractionTarget }
  | { readonly kind: "environment"; readonly locationId: string }
  | { readonly kind: "missing" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly PlayerFacingCandidate[] };

/**
 * Pure read adapter over ReadonlyWorld (ADR-0013 §4): one target view for
 * both the generic Entity read model and the physical WorldObject model.
 * No third canonical object model. `worldObject` is null for grid-scoped
 * entities without a physical object.
 */
export interface InteractionTarget {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly components: EntityComponents;
  readonly worldObject: WorldObject | null;
}
