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

export interface MoveCommand {
  type: "MoveCommand";
  direction: Direction;
}

export type PlayerCommand = MoveCommand;

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

/**
 * Parse user input into a PlayerCommand or a ParseError.
 * Recognises only `move north|south|east|west` (case-insensitive).
 */
export function parseCommand(input: string): ParseResult {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) {
    return { type: "ParseError", reason: "empty input", input };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2 || parts[0] !== "move") {
    return {
      type: "ParseError",
      reason: `unknown command: ${JSON.stringify(input)}`,
      input,
    };
  }

  const direction = parts[1]!;
  if (!DIRECTIONS.has(direction as Direction)) {
    return {
      type: "ParseError",
      reason: `unknown direction: ${JSON.stringify(parts[1])}`,
      input,
    };
  }

  return {
    type: "MoveCommand",
    direction: direction as Direction,
  };
}