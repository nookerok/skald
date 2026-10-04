/**
 * Command time policy (ADR-0039).
 *
 * A single pure decision for how much world time a command costs, whether the
 * generic root `TickPassed` is emitted, and which timestamp its events carry.
 * It replaces the two duplicated `suppressTick` computations in
 * `master-turn-executor.ts` and `world-handlers.ts`.
 *
 * It is deliberately blind to Rule outcomes: whether a physical attempt ends
 * `ActionResolved` or `ActionBlocked` is decided later by Rules, and both cost
 * one turn. The policy only classifies the intent shape against the current
 * journey state.
 *
 * Pure and deterministic: no clock, no randomness, no I/O. `cost === 0`
 * commands stamp the CURRENT world time so a journaled refusal does not advance
 * `world.time`; `cost === 1` commands stamp `world.time + 1`.
 */

/** The intent shape the policy reads (structurally satisfied by `ExecutableIntent`). */
export interface CommandTimeIntent {
  /** `JourneyIntent`, `InteractionCommand` or `ActionIntentCommand`. */
  readonly type: string;
  /** `ActionIntentCommand` operation (`interrupt`, `wait`, `speak`, …), if any. */
  readonly operation?: string | null | undefined;
}

/** The world facts the policy reads. */
export interface CommandTimeWorld {
  /** Current projection time. */
  readonly time: number;
  /** Deterministic, monotonic event counter (used to keep cost-0 ids unique). */
  readonly eventNumber: number;
  /** Active journey id, or null/undefined when not traveling. */
  readonly activeJourneyId?: string | null | undefined;
}

/** Classification of a command for time purposes. */
export type CommandTimeKind =
  | "read_only"
  | "instant"
  | "turn"
  | "journey_start"
  | "journey_wait"
  | "journey_interrupt"
  | "rejected_while_traveling";

/** Human-readable reason, stable enough to log and test. */
export type CommandTimeReason =
  | "read_only"
  | "ordinary_attempt"
  | "journey_start"
  | "journey_wait"
  | "journey_interrupt"
  | "traveling_rejection";

/** The single time decision for one command. */
export interface CommandTimePlan {
  readonly kind: CommandTimeKind;
  /** 0 or 1 world-time units. */
  readonly cost: 0 | 1;
  /** Timestamp the command's root events must carry. */
  readonly eventTimestamp: number;
  /** Whether the executor appends the generic root `TickPassed`. */
  readonly emitTickPassed: boolean;
  readonly reason: CommandTimeReason;
}

function plan(
  kind: CommandTimeKind,
  cost: 0 | 1,
  eventTimestamp: number,
  emitTickPassed: boolean,
  reason: CommandTimeReason,
): CommandTimePlan {
  return Object.freeze({ kind, cost, eventTimestamp, emitTickPassed, reason });
}

/**
 * Decide the time cost of one executable command.
 *
 * While a journey is active, only an explicit `wait` advances the journey
 * (cost 1, generic pulse); an `interrupt` and any other command cost nothing
 * and do not move the clock. Outside a journey, a `JourneyIntent` starts a
 * journey (cost 1, no generic pulse — the journey rule owns its first step),
 * an `interrupt` is instant (cost 0), and every other command is an ordinary
 * turn (cost 1, generic pulse).
 */
export function planCommandTime(intent: CommandTimeIntent, world: CommandTimeWorld): CommandTimePlan {
  const activeJourney = world.activeJourneyId != null;
  const isJourney = intent.type === "JourneyIntent";
  const operation = intent.operation ?? null;
  const interrupt = operation === "interrupt";
  const wait = operation === "wait";

  if (activeJourney) {
    if (wait) return plan("journey_wait", 1, world.time + 1, true, "journey_wait");
    if (interrupt) return plan("journey_interrupt", 0, world.time, false, "journey_interrupt");
    return plan("rejected_while_traveling", 0, world.time, false, "traveling_rejection");
  }

  if (isJourney) return plan("journey_start", 1, world.time + 1, false, "journey_start");
  if (interrupt) return plan("instant", 0, world.time, false, "journey_interrupt");
  return plan("turn", 1, world.time + 1, true, "ordinary_attempt");
}

/**
 * Correlation id for a command's events. Cost-1 commands are unique by their
 * advancing timestamp; cost-0 commands share a timestamp, so they include the
 * deterministic event counter to keep event ids unique across consecutive
 * refusals (`cmd-<time>-<eventNumber>`).
 */
export function commandCorrelationId(plan: CommandTimePlan, world: CommandTimeWorld): string {
  return plan.cost === 0 ? `cmd-${plan.eventTimestamp}-${world.eventNumber}` : `cmd-${plan.eventTimestamp}`;
}
