/**
 * Mixed-turn execution (ADR-0028, plan_6 Stage 9).
 *
 * Runs one ValidatedMasterTurnPlan: at most one primary action through the
 * existing command cycle, then the read-only question against the
 * post-action observer snapshot. No CompositeCommand, no action chains —
 * deferred clauses are preserved verbatim and never auto-executed.
 *
 * Policy implemented here (the rest is validation-time):
 * - valid primary + valid question → execute, answer on post-state;
 * - rejected primary + valid question → no silent loss: the question is
 *   still answered from the actual post-action state, and the rejection is
 *   reported for the response composer (Stage 10);
 * - stale plan → nothing executes, natural clarification (Stage 8 check
 *   runs first, inside the same call);
 * - inquiry-only plans → no world change, question answered on current state.
 *
 * One primary execution means at most one game tick; the inquiry never
 * advances time. Conversation persistence belongs to the persistence stage;
 * HTTP response composition belongs to the response stage.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { RuleEngine } from "@skald/rule-engine";
import {
  buildBackgroundNarrativeContext,
  buildGameShellSnapshot,
  buildInquiryAnswer,
  commandEventId,
  handleCommand as worldHandleCommand,
  type InquiryAnswerDTO,
  type MasterTurnSceneSnapshot,
  type ReadonlyWorld,
  type WorldProjector,
} from "@skald/world";
import { rollCriticalCheck } from "../dice-roller.js";
import { revalidateMasterTurnPlan } from "./master-turn-revalidation.js";
import type {
  DeferredClause,
  TurnKind,
  ValidatedMasterTurnPlan,
} from "./master-turn-validator.js";

/** Engine-level context for one execution. */
export interface MasterTurnExecutionContext {
  readonly engine: RuleEngine<ReadonlyWorld>;
  readonly projection: WorldProjector;
  /** Committed log before execution; post events derive from it. */
  readonly events: readonly DomainEvent[];
  /** Shell DTO owner, used for read models only. */
  readonly worldId: string;
}

/** World-changing outcome of one executed primary action. */
export interface ExecutedMasterTurn {
  readonly planKind: TurnKind;
  readonly executed: boolean;
  readonly actionRejected: boolean;
  readonly commandEvents: readonly DomainEvent[];
  readonly tickEvents: readonly DomainEvent[];
  readonly postEvents: readonly DomainEvent[];
  readonly inquiryAnswer: InquiryAnswerDTO | null;
  readonly deferred: readonly DeferredClause[];
  readonly revisionBefore: { readonly worldTime: number; readonly eventNumber: number };
  readonly revisionAfter: { readonly worldTime: number; readonly eventNumber: number };
}

/** Execution outcome. Stale plans execute nothing. */
export type MasterTurnExecutionResult =
  | {
      readonly status: "stale";
      readonly question: string;
      readonly options: readonly { readonly optionId: string; readonly label: string }[];
    }
  | ({ readonly status: "executed" } & ExecutedMasterTurn);

/** Committed rejections marking a runtime-invalid primary. */
const REJECTION_EVENTS: ReadonlySet<string> = new Set([
  "ActionRejected",
  "JourneyBlocked",
  "MovementBlocked",
]);

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

/**
 * Executes one validated plan: revalidate, run at most one primary through
 * the existing command cycle, answer the question on the post-action
 * snapshot. The engine and projection are the only writers; the inquiry is
 * a pure read and deferred clauses never execute.
 */
export function executeMasterTurnPlan(
  plan: ValidatedMasterTurnPlan,
  scene: MasterTurnSceneSnapshot,
  context: MasterTurnExecutionContext,
): MasterTurnExecutionResult {
  const before = context.projection.getSnapshot();
  const revisionBefore = freeze({ worldTime: before.time, eventNumber: before.eventNumber });

  const revalidation = revalidateMasterTurnPlan({ plan, scene, world: before });
  if (revalidation.status === "stale") return revalidation;

  if (!plan.execution) {
    const postEvents = [...context.events];
    return freeze({
      status: "executed" as const,
      planKind: plan.kind,
      executed: false,
      actionRejected: false,
      commandEvents: freeze([]),
      tickEvents: freeze([]),
      postEvents: freeze(postEvents),
      inquiryAnswer: answerPostActionInquiry(plan, postEvents, before, context.worldId),
      deferred: plan.deferredClauses,
      revisionBefore,
      revisionAfter: revisionBefore,
    });
  }

  const intent = plan.execution.intent;
  const ts = before.time + 1;
  const correlationId = `cmd-${ts}`;
  const firstEvent = worldHandleCommand(intent, correlationId, ts);
  const tickEvent: DomainEvent = {
    eventId: commandEventId(`tick-${ts}`, "TickPassed"),
    type: "TickPassed",
    schemaVersion: 1,
    payload: { delta: 1 },
    timestamp: ts,
    correlationId: `tick-${ts}`,
    causationId: null,
  };
  const interrupt = intent.type === "ActionIntentCommand" && intent.operation === "interrupt";
  const wait = intent.type === "ActionIntentCommand" && intent.operation === "wait";
  const suppressTick = intent.type === "JourneyIntent" || interrupt || (!!before.activeJourneyId && !wait);
  const { committed } = context.engine.processSequence(suppressTick ? [firstEvent] : [firstEvent, tickEvent], {
    deriveEvents: (staged) => staged
      .filter((event) => event.type === "CriticalCheckRequested" && event.correlationId === correlationId)
      .map((event) => rollCriticalCheck(event)),
  });

  const after = context.projection.getSnapshot();
  const commandEvents = freeze(committed.filter((event) => event.correlationId === correlationId));
  const tickEvents = freeze(committed.filter((event) => event.correlationId === `tick-${ts}`));
  const postEvents = freeze([...context.events, ...committed]);
  return freeze({
    status: "executed" as const,
    planKind: plan.kind,
    executed: true,
    actionRejected: commandEvents.some((event) => REJECTION_EVENTS.has(event.type)),
    commandEvents,
    tickEvents,
    postEvents,
    inquiryAnswer: answerPostActionInquiry(plan, postEvents, after, context.worldId),
    deferred: plan.deferredClauses,
    revisionBefore,
    revisionAfter: freeze({ worldTime: after.time, eventNumber: after.eventNumber }),
  });
}

/** Answers the plan question on the given snapshot, if the plan has one. */
function answerPostActionInquiry(
  plan: ValidatedMasterTurnPlan,
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  worldId: string,
): InquiryAnswerDTO | null {
  if (!plan.postActionInquiry) return null;
  const shell = buildGameShellSnapshot(events, world, null, worldId, undefined);
  const background = buildBackgroundNarrativeContext(events, world, null);
  return buildInquiryAnswer(plan.postActionInquiry, { shell, background });
}
