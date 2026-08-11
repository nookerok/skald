/**
 * Open Intent types for Iteration 15.
 *
 * ActionIntentCommand is a transport entity, NOT a Domain Event.
 * It carries the interpreter's best understanding of player intent
 * to the Command Handler, which converts it into a Domain Event.
 */

export type IntentMode =
  | "perceive"
  | "relocate"
  | "interact"
  | "communicate"
  | "combine"
  | "wait"
  | "travel";

export type IntentOperation =
  | "observe"
  | "listen"
  | "touch"
  | "approach"
  | "enter"
  | "apply_force"
  | "heat"
  | "cool"
  | "take"
  | "place"
  | "use"
  | "create_mark"
  | "speak"
  | "call"
  | "wait"
  | "open"
  | "give"
  | "travel"
  | "interrupt"
  | "unknown";

export interface IntentReference {
  readonly raw: string;
  readonly normalized?: string;
}

export interface InterpretationMeta {
  readonly source: "deterministic" | "llm";
  readonly confidence: number;
  readonly ambiguities: readonly string[];
}

export interface ActionIntentCommand {
  readonly type: "ActionIntentCommand";
  readonly mode: IntentMode;
  readonly operation: IntentOperation;
  readonly target?: IntentReference | undefined;
  readonly secondaryTarget?: IntentReference | undefined;
  readonly instrument?: IntentReference | undefined;
  readonly manner?: string | undefined;
  readonly goal?: string | undefined;
  readonly utterance?: string | undefined;
  readonly rawText: string;
  readonly interpretation: InterpretationMeta;
}

/**
 * Canonical Interaction Model v1 verb set (ADR-0013 §2). The parser
 * normalizes synonyms and Russian word forms to exactly one of these values;
 * `examine` is an alias of `inspect`.
 */
export type InteractionVerb =
  | "observe"
  | "inspect"
  | "listen"
  | "touch"
  | "take"
  | "open"
  | "apply_force"
  | "give";

/**
 * Canonical transient Interaction Model v1 command (ADR-0013 §1).
 *
 * Produced by the parser for the v1 verb set and consumed by the Command
 * Handler, which converts it into the first Domain Event
 * (`InteractionRequested`). It is NOT a Domain Event and is never persisted.
 * The parser never resolves world-dependent ambiguity — target resolution
 * is a Validation Rule over ReadonlyWorld.
 */
export interface InteractionCommand {
  readonly type: "InteractionCommand";
  readonly verb: InteractionVerb;
  /** The target as the player named it (raw text, not an entity id). */
  readonly target?: IntentReference | undefined;
  /** give: the recipient as the player named it. */
  readonly secondaryTarget?: IntentReference | undefined;
  readonly instrument?: IntentReference | undefined;
  readonly utterance?: string | undefined;
  readonly rawText: string;
  readonly interpretation: InterpretationMeta;
}

/**
 * Canonical transient Spatial Movement command (ADR-0015).
 *
 * Produced by the parser for travel verbs and consumed by the Command
 * Handler, which converts it into the first Domain Event
 * (`JourneyRequested`). It is NOT a Domain Event and is never persisted.
 * The parser never resolves world-dependent route ambiguity — route
 * resolution is a Validation Rule over ReadonlyWorld.
 */
export interface JourneyIntent {
  readonly type: "JourneyIntent";
  /** The destination as the player named it (raw text, not a location id). */
  readonly destination: IntentReference;
  /** Optional route hint: "по лесной дороге", "через переправу". */
  readonly routeHint?: IntentReference | undefined;
  readonly rawText: string;
  readonly interpretation: InterpretationMeta;
}

export interface ClarificationRequest {
  readonly type: "ClarificationRequired";
  readonly clarificationId: string;
  readonly question: string;
  readonly interpretations: readonly string[];
}

export interface UnsupportedIntent {
  readonly type: "UnsupportedButUnderstood";
  readonly intent: ActionIntentCommand | InteractionCommand | JourneyIntent;
  readonly message: string;
}

export type IntentResult =
  | ActionIntentCommand
  | InteractionCommand
  | JourneyIntent
  | ClarificationRequest
  | UnsupportedIntent;

export type { ActionIntentCommand as PlayerCommand };
