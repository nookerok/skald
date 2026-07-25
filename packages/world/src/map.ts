import type { Direction } from "@skald/intent-parser";

/**
 * The fixed MVP-0 map.
 *
 * Grid is 5x5 with coordinates x ∈ [0,4], y ∈ [0,4]. Origin (0,0) is the
 * bottom-left corner; north = +y, south = −y, east = +x, west = −x.
 * Boundaries are NOT enforced by any rule in MVP-0 (only walls block) —
 * documenting that explicitly so it is not mistaken for a feature.
 *
 * Walls (interior): {(2,0), (3,3)}.
 * Player start:        (0,0).
 *
 * Walls and start are NOT hardcoded as the projector's secret state: they
 * are bootstrap Domain Events ("PlayerSpawned", "WallPlaced") committed once
 * at startup so the whole projection is reproducible from the Event Log
 * alone (AGENTS invariant #2 — Projection Purity).
 */
export const WORLD_WIDTH = 5;
export const WORLD_HEIGHT = 5;

export const START_POSITION: { x: number; y: number } = { x: 0, y: 0 };

export const WALLS: readonly { x: number; y: number }[] = [
  { x: 2, y: 0 },
  { x: 3, y: 3 },
];

export const DIRECTION_DELTAS: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: 1 },
  south: { dx: 0, dy: -1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

export function wallKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function computeDestination(
  x: number,
  y: number,
  direction: Direction,
): { x: number; y: number } {
  const { dx, dy } = DIRECTION_DELTAS[direction];
  return { x: x + dx, y: y + dy };
}