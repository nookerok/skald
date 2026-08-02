/**
 * @skald/intent-parser
 *
 * Pure syntactic/semantic interpretation of player input into a PlayerCommand.
 *
 * Per AGENTS.md: the parser NEVER takes gameplay decisions and never
 * resolves ambiguity that requires world knowledge. It has NO dependency
 * on event-bus: a PlayerCommand is a plain in-memory object and is NEVER
 * appended to the Event Log.
 *
 * Iteration 15: Supports both legacy commands (MoveCommand, GiveCommand),
 * the Open Intent model (ActionIntentCommand) and the canonical Interaction
 * Model v1 command (InteractionCommand, ADR-0013).
 */

// ── Legacy types (backward compatible) ──────────────────────────────

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

export type LegacyCommand = MoveCommand | GiveCommand;

export interface ParseError {
  type: "ParseError";
  reason: string;
  input: string;
}

export type LegacyParseResult = LegacyCommand | ParseError;

// ── Open Intent types (Iteration 15) ────────────────────────────────

export type {
  IntentMode,
  IntentOperation,
  IntentReference,
  InterpretationMeta,
  ActionIntentCommand,
  InteractionVerb,
  InteractionCommand,
  ClarificationRequest,
  UnsupportedIntent,
  IntentResult,
} from "./types.js";

export { interpretIntent } from "./deterministic-interpreter.js";
export type { InterpreterOptions } from "./deterministic-interpreter.js";

// ── Legacy parser (kept for backward compatibility) ──────────────────

const DIRECTIONS: ReadonlySet<Direction> = new Set([
  "north",
  "south",
  "east",
  "west",
]);

const RELATIONS: ReadonlySet<RelationKind> = new Set(["help", "respect", "fear"]);

export function parseCommand(input: string): LegacyParseResult {
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

// ── Unified parse (Iteration 15 entry point) ────────────────────────

import { interpretIntent } from "./deterministic-interpreter.js";
import type { InteractionCommand, IntentResult } from "./types.js";

/**
 * Parse player input into an ActionIntentCommand or, for the canonical v1
 * verb set, an InteractionCommand (ADR-0013). Tries the exact interaction
 * syntax first (English "examine"/"inspect"), then legacy commands
 * ("move north" / "give help to guild"), then falls through to the
 * deterministic Russian interpreter.
 */
export function parseIntent(input: string): IntentResult {
  const interaction = parseExactInteraction(input);
  if (interaction) return interaction;

  const legacy = parseCommand(input);

  if (legacy.type === "MoveCommand") {
    return {
      type: "ActionIntentCommand",
      mode: "relocate",
      operation: "approach",
      target: { raw: legacy.direction, normalized: legacy.direction },
      rawText: input,
      interpretation: { source: "deterministic", confidence: 1.0, ambiguities: [] },
    };
  }

  if (legacy.type === "GiveCommand") {
    return {
      type: "ActionIntentCommand",
      mode: "communicate",
      operation: "speak",
      target: { raw: legacy.target },
      utterance: `${legacy.relation} to ${legacy.target}`,
      rawText: input,
      interpretation: { source: "deterministic", confidence: 1.0, ambiguities: [] },
    };
  }

  // Fall through to Russian interpreter
  return interpretIntent(input);
}

/**
 * Exact English syntax for the canonical Interaction Model v1 verb set.
 * `examine` and `inspect` both normalize to the canonical `inspect` verb
 * (ADR-0013 §2); natural-language/LLM vocabulary is deliberately not widened
 * in this path.
 */
function parseExactInteraction(input: string): InteractionCommand | null {
  const match = /^(?:examine|inspect)(?:\s+(.*))?$/i.exec(input.trim());
  if (!match) return null;
  const object = (match[1] ?? "").trim();
  return {
    type: "InteractionCommand",
    verb: "inspect",
    target: object.length > 0 ? { raw: object } : undefined,
    rawText: input,
    interpretation: {
      source: "deterministic",
      confidence: 1,
      ambiguities: object.length > 0 ? [] : ["no clear target identified"],
    },
  };
}

// ── Backward-compatible re-export ────────────────────────────────────

/** @deprecated Use LegacyParseResult instead */
export type ParseResult = LegacyParseResult;
/** @deprecated Use LegacyCommand instead */
export type PlayerCommand = LegacyCommand;
