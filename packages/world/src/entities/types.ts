/**
 * Additive generic entities for the World Interaction Model.
 *
 * They intentionally do not replace the Iteration 15 objects/location model.
 * An entity is reconstructed only from ObjectPlaced events.
 */

export type EntityId = string;

export interface MaterialComponent {
  readonly kind: "iron" | "wood" | "stone" | "glass" | "ash" | "fabric" | "water";
}

export interface ThermalComponent {
  readonly temperature: number;
  readonly meltingPoint?: number | undefined;
}

export interface PhysicalComponent {
  readonly intact: boolean;
  readonly weight: number;
}

export interface RelationComponent {
  readonly relationIds: readonly string[];
}

export interface InventoryComponent {
  readonly itemIds: readonly string[];
}

/**
 * Stable, observer-safe author card of a contact (contact-identity T2).
 * Only durable, publicly observable data: how the person looks, a
 * distinguishing feature, their usual role, the designations and address forms
 * the player may use. Conditional reactions and hidden facts never live here.
 * `identityRef` is the canonical id and is internal (never shown to the player).
 */
export interface ContactProfile {
  readonly identityRef: string;
  readonly visibleAppearance: readonly string[];
  readonly distinguishingFeatures: readonly string[];
  readonly publicRole: string | null;
  /**
   * Author-declared PUBLIC designations only. The canonical proper name is not
   * stored here; the observer layer surfaces the name only for someone the
   * player actually knows, so an empty list never leaks an unknown name.
   */
  readonly knownAs: readonly string[];
  readonly addressForms: readonly string[];
}

/**
 * Minimal contact metadata; this is not an NPC simulation model.
 * A person's identity never depends on a background: the acquaintance and its
 * origin live in `RelationChanged` and testimony facts, not here.
 */
export interface ContactComponent {
  readonly locationId: string;
  /** Placement origin only (where the entity was placed), never identity. */
  readonly entrypointId?: string | undefined;
  /** Legacy origin field on old events; carried but never read as identity. */
  readonly backgroundId?: string | undefined;
  readonly profile?: ContactProfile | undefined;
}

export interface EntityComponents {
  readonly material?: MaterialComponent | undefined;
  readonly thermal?: ThermalComponent | undefined;
  readonly physical?: PhysicalComponent | undefined;
  readonly relation?: RelationComponent | undefined;
  readonly inventory?: InventoryComponent | undefined;
  readonly contact?: ContactComponent | undefined;
}

export type EntityComponentName = keyof EntityComponents;

export interface Entity {
  readonly id: EntityId;
  readonly x: number;
  readonly y: number;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly components: EntityComponents;
}
