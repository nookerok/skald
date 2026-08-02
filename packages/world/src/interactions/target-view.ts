/**
 * Interaction Model v1 — InteractionTarget adapter (ADR-0013 §4).
 *
 * Entity stays the compatible generic read view; WorldObject stays the
 * mutable physical model. Both derive from the same Domain Events (the
 * generic components of a placed object come from the same WorldObjectPlaced
 * data, never from a manually synchronized copy). This module is the pure
 * mapping between the two models; there is no third object model.
 */

import type { Entity, EntityComponents } from "../entities/types.js";
import type { WorldObject } from "../objects/types.js";
import type { InteractionTarget } from "./types.js";

/** Pure adapter over a generic Entity read view. */
export function targetFromEntity(entity: Entity): InteractionTarget {
  return {
    id: entity.id,
    name: entity.name,
    aliases: entity.aliases,
    description: entity.description,
    components: entity.components,
    worldObject: null,
  };
}

/**
 * Pure adapter over the physical WorldObject model. The generic components
 * are derived from the same WorldObjectPlaced data the projector stores.
 */
export function targetFromObject(object: WorldObject): InteractionTarget {
  const components: EntityComponents = {
    material: { kind: object.material },
    thermal: { temperature: object.temperature },
    // TODO(slice-4): weight source is not defined for WorldObjectPlaced yet;
    // take/inventory gates will introduce it with its own ADR event mapping.
    physical: { intact: object.integrity > 0, weight: 0 },
  };
  return {
    id: object.id,
    name: object.name,
    aliases: object.aliases,
    description: object.description,
    components,
    worldObject: object,
  };
}
