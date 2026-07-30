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
  | "wait";

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
 * Narrow World Interaction Model command. It is intentionally separate from
 * ActionIntentCommand so the first vertical slice can prove its own gate
 * pipeline without widening the existing open-intent operation catalog.
 */
export interface IntentCommand {
  readonly type: "IntentCommand";
  readonly verb: string;
  readonly object: string;
  readonly instrument?: string | undefined;
  readonly location?: string | undefined;
  readonly modifiers?: readonly string[] | undefined;
}

export interface ClarificationRequest {
  readonly type: "ClarificationRequired";
  readonly clarificationId: string;
  readonly question: string;
  readonly interpretations: readonly string[];
}

export interface UnsupportedIntent {
  readonly type: "UnsupportedButUnderstood";
  readonly intent: ActionIntentCommand;
  readonly message: string;
}

export type IntentResult =
  | ActionIntentCommand
  | IntentCommand
  | ClarificationRequest
  | UnsupportedIntent;

export type { ActionIntentCommand as PlayerCommand };
