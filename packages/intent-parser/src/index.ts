/**
 * @skald/intent-parser
 *
 * Pure syntactic/semantic interpretation of player input into a PlayerCommand.
 *
 * Per AGENTS.md: the parser NEVER takes gameplay decisions and never
 * resolves ambiguity that requires world knowledge. For MVP-0 it recognises
 * exactly `move <direction>` (case-insensitive, whitespace-trimmed) and
 * nothing else. It has NO dependency on event-bus: a PlayerCommand is a
 * plain in-memory object and is NEVER appended to the Event Log.
 */

export type Direction = "north" | "south" | "east" | "west";
export type RelationKind = "help" | "respect" | "fear";

export interface MoveCommand {
  type: "MoveCommand";
  direction: Direction;
}

export interface GiveCommand {
  type: "GiveCommand";
  relation: RelationKind;
  target: string;
}

export type PlayerCommand = MoveCommand | GiveCommand;

export interface ParseError {
  type: "ParseError";
  reason: string;
  input: string;
}

export type ParseResult = PlayerCommand | ParseError;

const DIRECTIONS: ReadonlySet<Direction> = new Set([
  "north",
  "south",
  "east",
  "west",
]);

const RELATIONS: ReadonlySet<RelationKind> = new Set(["help", "respect", "fear"]);

export function parseCommand(input: string): ParseResult {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) {
    return { type: "ParseError", reason: "empty input", input };
  }

  const parts = trimmed.split(/\s+/);

  if (parts[0] === "move") {
    if (parts.length !== 2) {
      return { type: "ParseError", reason: `unknown command: ${JSON.stringify(input)}`, input };
    }
    if (!DIRECTIONS.has(parts[1] as Direction)) {
      return { type: "ParseError", reason: `unknown direction: ${JSON.stringify(parts[1])}`, input };
    }
    return { type: "MoveCommand", direction: parts[1] as Direction };
  }

  if (parts[0] === "give") {
    if (parts.length !== 4 || parts[2] !== "to") {
      return { type: "ParseError", reason: `unknown command: ${JSON.stringify(input)}`, input };
    }
    const relation = parts[1]!;
    if (!RELATIONS.has(relation as RelationKind)) {
      return { type: "ParseError", reason: `unknown relation: ${JSON.stringify(relation)}`, input };
    }
    const target = parts[3]!.trim();
    if (target.length === 0) {
      return { type: "ParseError", reason: "empty target", input };
    }
    return { type: "GiveCommand", relation: relation as RelationKind, target };
  }

  return {
    type: "ParseError",
    reason: `unknown command: ${JSON.stringify(input)}`,
    input,
  };
}