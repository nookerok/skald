import type { ReadonlyWorld } from "./projection.js";

export type PredicateFn = (world: ReadonlyWorld) => boolean;

export interface ActionIntent {
  readonly type: string;
  readonly direction?: string;
  readonly relation?: string;
  readonly target?: string;
}

export type ActionFn = () => ActionIntent;

export const PREDICATES: ReadonlyMap<string, PredicateFn> = new Map([
  ["danger_nearby", (w) => {
    for (const c of w.consequences.values()) {
      if (c.type === "audacity") return true;
    }
    return false;
  }],
  ["always", () => true],
  ["never", () => false],
  ["heat_at_player", (w) => {
    const key = `${w.player.x},${w.player.y}`;
    return (w.heatMap.get(key) ?? 0) >= 5;
  }],
]);

const actionEntries: Array<[string, ActionFn]> = [
  ["move_south", () => ({ type: "move" as const, direction: "south" as const })],
  ["move_north", () => ({ type: "move" as const, direction: "north" as const })],
  ["give_help_to_guild", () => ({ type: "give" as const, relation: "help" as const, target: "guild" })],
  ["idle", () => ({ type: "idle" as const })],
];

export const ACTIONS: ReadonlyMap<string, ActionFn> = new Map(actionEntries);
