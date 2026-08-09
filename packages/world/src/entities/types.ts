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

export interface EntityComponents {
  readonly material?: MaterialComponent | undefined;
  readonly thermal?: ThermalComponent | undefined;
  readonly physical?: PhysicalComponent | undefined;
  readonly relation?: RelationComponent | undefined;
  readonly inventory?: InventoryComponent | undefined;
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
