/**
 * Command outcome diagnostics (ADR-0039, T6).
 *
 * A pure, sanitized description of what one command did to time and movement:
 * the temporal policy (cost, pulses, world-time delta) and the movement owner
 * outcome. It carries NO player text, prompt, credentials or hidden snapshot —
 * only closed-vocabulary tokens and counts — so it is safe for trusted
 * diagnostics and for a test-visible command result. It is never part of the
 * player DTO.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "./projection.js";
import type { CommandTimePlan } from "./command-time-policy.js";
import { resolveMovementTarget, type MovementIntentView, type MovementTarget } from "./interactions/target-resolver.js";

/** The movement owner outcome of one command, from the committed events. */
export type MovementOutcome = "moved" | "approached" | "blocked" | "journey_started" | "none";

/** Movement target kind as classified before execution, or "none". */
export type MovementTargetKind = MovementTarget["kind"] | "none";

export interface CommandTemporalDiagnostics {
  readonly worldTimeBefore: number;
  readonly worldTimeAfter: number;
  readonly cost: 0 | 1;
  readonly tickPassedCount: number;
  /** The `planCommandTime` reason (closed vocabulary). */
  readonly policy: string;
}

export interface CommandMovementDiagnostics {
  readonly targetKind: MovementTargetKind;
  readonly outcome: MovementOutcome;
}

export interface CommandDiagnostics {
  readonly temporal: CommandTemporalDiagnostics;
  readonly movement: CommandMovementDiagnostics;
}

/** Derive the movement outcome from the command's committed events. */
export function movementOutcome(events: readonly DomainEvent[]): MovementOutcome {  let outcome: MovementOutcome = "none";
  for (const event of events) {
    if (event.type === "PlayerLocationChanged" || event.type === "MovementSucceeded") return "moved";
    if (event.type === "MovementBlocked") outcome = "blocked";
    else if (event.type === "JourneyStarted") outcome = "journey_started";
    else if (event.type === "ActionResolved" && (event.payload as { result?: unknown }).result === "approach") outcome = "approached";
  }
  return outcome;
}

/**
 * Classify the movement target kind of an intent before execution, or "none"
 * when the intent is not a movement command. Reuses the observer-safe
 * `resolveMovementTarget` so the diagnostic matches what preflight saw.
 */
export function movementTargetKind(intent: MovementIntentView, world: ReadonlyWorld): MovementTargetKind {
  const isMovement = intent.type === "JourneyIntent"
    || (intent.type === "ActionIntentCommand" && (intent.operation === "approach" || intent.operation === "enter"));
  if (!isMovement) return "none";
  return resolveMovementTarget(intent, world).kind;
}

export interface CommandDiagnosticsInput {
  readonly plan: CommandTimePlan;
  readonly worldTimeBefore: number;
  readonly worldTimeAfter: number;
  readonly tickPassedCount: number;
  readonly targetKind: MovementTargetKind;
  readonly events: readonly DomainEvent[];
}

/** Build the frozen, sanitized diagnostics for one command. */
export function buildCommandDiagnostics(input: CommandDiagnosticsInput): CommandDiagnostics {
  return Object.freeze({
    temporal: Object.freeze({
      worldTimeBefore: input.worldTimeBefore,
      worldTimeAfter: input.worldTimeAfter,
      cost: input.plan.cost,
      tickPassedCount: input.tickPassedCount,
      policy: input.plan.reason,
    }),
    movement: Object.freeze({
      targetKind: input.targetKind,
      outcome: movementOutcome(input.events),
    }),
  });
}
