import type { GuidanceActionId, GuidanceSuggestionKind } from "./types.js";

export interface GuidanceActionDef {
  readonly kind: GuidanceSuggestionKind;
  readonly input: string | null;
  readonly view: "journal" | "discoveries" | null;
}

const _actions: Record<GuidanceActionId, GuidanceActionDef> = {
  move_north: { kind: "command", input: "move north", view: null },
  move_south: { kind: "command", input: "move south", view: null },
  move_east: { kind: "command", input: "move east", view: null },
  move_west: { kind: "command", input: "move west", view: null },
  wait: { kind: "command", input: "wait", view: null },
  give_help: { kind: "command", input: "give help to guild", view: null },
  give_respect: { kind: "command", input: "give respect to guild", view: null },
  give_fear: { kind: "command", input: "give fear to guild", view: null },
  open_journal: { kind: "navigate", input: null, view: "journal" },
  open_discoveries: { kind: "navigate", input: null, view: "discoveries" },
};

// Deep-freeze the entire registry: the outer object and every inner def.
for (const key of Object.keys(_actions)) {
  Object.freeze(_actions[key as GuidanceActionId]);
}
Object.freeze(_actions);

export const GUIDANCE_ACTIONS: Readonly<Record<GuidanceActionId, Readonly<GuidanceActionDef>>> = _actions;
