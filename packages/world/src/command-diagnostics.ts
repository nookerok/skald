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
export type MovementOutcome = "moved" | "approached" | "withdrawn" | "blocked" | "journey_started" | "rejected" | "clarification" | "replayed" | "none";

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
export function movementOutcome(events: readonly DomainEvent[]): MovementOutcome {
  let outcome: MovementOutcome = "none";
  for (const event of events) {
    if (event.type === "PlayerLocationChanged" || event.type === "MovementSucceeded") return "moved";
    if (event.type === "MovementBlocked") outcome = "blocked";
    else if (event.type === "JourneyBlocked") outcome = "blocked";
    else if (event.type === "ActionRejected") outcome = "rejected";
    else if (event.type === "JourneyStarted") outcome = "journey_started";
    else if (event.type === "ActionResolved" && (event.payload as { result?: unknown }).result === "approach") outcome = "approached";
    else if (event.type === "ActionResolved" && (event.payload as { result?: unknown }).result === "withdraw") outcome = "withdrawn";
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
  /** Force the movement outcome (preflight rejection / clarification / read-only). */
  readonly outcomeOverride?: MovementOutcome;
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
      outcome: input.outcomeOverride ?? movementOutcome(input.events),
    }),
  });
}

/**
 * Sanitized diagnostics for a turn that never executes a command: a preflight
 * rejection, a clarification, an inquiry/meta read-only answer, or an
 * idempotent replay. Cost 0, no pulses, no movement. The outcome names the turn
 * class so the temporal contract covers every user turn, not only executed
 * commands. A replay is its own outcome (`replayed`, policy `replay`) — it does
 * not re-assert the original command's movement/time result.
 */
export function readOnlyCommandDiagnostics(input: {
  readonly worldTime: number;
  readonly outcome: "rejected" | "clarification" | "replayed" | "none";
  readonly targetKind?: MovementTargetKind;
}): CommandDiagnostics {
  const policy = input.outcome === "rejected" ? "preflight_rejection"
    : input.outcome === "replayed" ? "replay"
    : "read_only";
  return Object.freeze({
    temporal: Object.freeze({
      worldTimeBefore: input.worldTime,
      worldTimeAfter: input.worldTime,
      cost: 0 as const,
      tickPassedCount: 0,
      policy,
    }),
    movement: Object.freeze({
      targetKind: input.targetKind ?? "none",
      outcome: input.outcome,
    }),
  });
}
