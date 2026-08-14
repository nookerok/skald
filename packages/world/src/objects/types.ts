/**
 * World Object types for Iteration 15.
 *
 * Objects are physical entities in the world with material, integrity,
 * temperature, and location. They are placed via bootstrap events and
 * modified by Domain Events.
 */

export type Material = "wood" | "iron" | "stone" | "glass" | "ash" | "fabric" | "water";

export interface WorldObject {
  readonly id: string;
  readonly name: string;
  /** Player-facing alternative names («пепел» for «Кучка пепла»), ADR-0013 §3. */
  readonly aliases: readonly string[];
  readonly description: string;
  readonly material: Material;
  readonly locationId: string;
  readonly integrity: number;
  readonly temperature: number;
  /** Event-derived physical mass used by container capacity checks. */
  readonly mass?: number;
  /** Whether the object may be moved by an actor. */
  readonly portable?: boolean;
  /** Physical operations exposed by this object. */
  readonly affordances?: readonly string[];
  /** Maximum contained mass; null/undefined means not a container. */
  readonly containerCapacity?: number | null;
  readonly state: Readonly<Record<string, unknown>>;
}

export interface Location {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly objectIds: readonly string[];
  readonly connections: Readonly<Record<string, string>>;
}

export interface WorldObjectState {
  readonly objects: ReadonlyMap<string, WorldObject>;
  readonly locations: ReadonlyMap<string, Location>;
  readonly currentLocationId: string;
}

export const INTEGRITY_MIN = 0;
export const INTEGRITY_MAX = 100;
export const TEMPERATURE_AMBIENT = 20;
export const TEMPERATURE_HOT = 60;
export const TEMPERATURE_DANGEROUS = 80;
