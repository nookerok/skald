/**
 * Master Turn diagnostic taxonomy (ADR-0028, plan_6 Stage 14).
 *
 * Continues the P0 AI diagnostic contract: events conform to
 * AIDiagnosticEvent (kind "intent") and carry only sanitized operational
 * dimensions — turn kind, clause/referent counts, context revision, phase,
 * provider/model, duration and sanitized failure categories. Player text,
 * transcripts, prompts, provider responses and reference tables can never
 * enter an event: the builder picks an explicit allowlist of fields, so
 * even a cast-smuggled key is dropped at runtime.
 *
 * Producer map (reserved entries await gateway-V2 wiring or parser sinks):
 * - deterministic_fast_path: gateway fast-path accept;
 * - context_required: gateway diverts to the LLM proposal path;
 * - context_built: scene assembly in the V2 gateway path;
 * - conversation_context: context build outcome (built|degraded|failed) with
 *   secret-free counts; failed falls back to an empty conversation;
 * - turn_proposal_requested/received: reserved (V2 proposal fetch);
 * - proposal_repair_requested: one correction round after a statically
 *   invalid reply, carrying only the sanitized rejection reason;
 * - proposal_schema_rejected: reserved (static parser validation has no sink);
 * - referent_rejected: contextual validation stale-clarification;
 * - stale_context: queue revalidation refusal;
 * - world_revalidation_failed: reserved (revalidation is pure sync today);
 * - primary_executed: executor ran the primary through the command cycle;
 * - post_action_inquiry_answered: executor answered the plan question;
 * - clarification_returned: contextual validation ambiguity clarification;
 * - deterministic_fallback: existing P0 gateway fallback (unchanged).
 * - generic_clarification_fallback: last-resort generic wording (plan_9
 *   §2) — always an interpretation defect, never a normal outcome.
 * - speak_addressee_bound: degraded-path speak/call addressee bound
 *   deterministically to one scene person (plan_9 §14 beat 4).
 * - clarification_resolved: a pending-clarification answer matched one
 *   offered option and re-ran the framed original (review P0).
 */

import type { AIDiagnosticSink, CommandDiagnostics } from "@skald/world";

/** Closed Master Turn diagnostic taxonomy, verbatim from the plan. */
export const MASTER_TURN_DIAGNOSTIC_CATEGORIES: readonly string[] = Object.freeze([
  "deterministic_fast_path",
  "context_required",
  "context_built",
  "conversation_context",
  "turn_proposal_requested",
  "turn_proposal_received",
  "proposal_repair_requested",
  "proposal_schema_rejected",
  "referent_rejected",
  "stale_context",
  "world_revalidation_failed",
  "primary_executed",
  "post_action_inquiry_answered",
  "clarification_returned",
  "deterministic_fallback",
  "generic_clarification_fallback",
  "speak_addressee_bound",
  "clarification_resolved",
  // Command outcome (ADR-0039, T6): sanitized temporal + movement dimensions.
  "command_outcome",
  // Conversation Director shadow mode (S0): interpretation only, never executes.
  "gm_director",
]);

/** Sanitized operational dimensions only. No text, prompts or tables. */
export interface MasterTurnDiagnosticDimensions {
  readonly category: string;
  readonly outcome: string;
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  readonly phase?: string | undefined;
  readonly durationMs?: number | undefined;
  readonly correlationId?: string | undefined;
  readonly worldTime?: number | undefined;
  readonly turnKind?: string | undefined;
  readonly clauseCount?: number | undefined;
  readonly referentCount?: number | undefined;
  readonly contextWorldTime?: number | undefined;
  readonly contextEventNumber?: number | undefined;
  readonly queryId?: string | undefined;
  readonly failureCategory?: string | undefined;
  readonly referentInTable?: boolean | undefined;
  readonly referentSurfaceMatch?: boolean | undefined;
  readonly messageCount?: number | undefined;
  readonly mentionCount?: number | undefined;
  /**
   * Sanitized rejected-plan structure (T6 R1/R2): counts and closed-vocabulary
   * tokens from summarizeRejectedPlan — never surfaces, ids or free text.
   */
  readonly planSubjectKinds?: string | undefined;
  readonly planAspects?: string | undefined;
  readonly planSources?: string | undefined;
  readonly planSubjectCount?: number | undefined;
  readonly planPartCount?: number | undefined;
  readonly planReadingCount?: number | undefined;
  readonly planGroupWithoutMembers?: number | undefined;
  readonly planOrdinalWithoutList?: number | undefined;
  readonly planReadingsDangling?: number | undefined;
  readonly planOverLimits?: string | undefined;
  /**
   * Sanitized rejected-ambiguity structure (T6 R1/R2): counts and booleans
   * from summarizeRejectedAmbiguity — never the question or candidates.
   */
  readonly ambKeyCount?: number | undefined;
  readonly ambKindValid?: boolean | undefined;
  readonly ambQuestionIsString?: boolean | undefined;
  readonly ambCandidateCount?: number | undefined;
  readonly ambCandidatesAllStrings?: boolean | undefined;
  readonly hasPendingClarification?: boolean | undefined;
  readonly hasGoal?: boolean | undefined;
  readonly hasDramaticThread?: boolean | undefined;
  readonly truncated?: boolean | undefined;
  /** Command outcome (ADR-0039, T6): sanitized temporal/movement dimensions. */
  readonly temporalCost?: number | undefined;
  readonly tickPassedCount?: number | undefined;
  readonly timePolicy?: string | undefined;
  readonly movementTargetKind?: string | undefined;
  readonly movementOutcome?: string | undefined;
  readonly replayed?: boolean | undefined;
  /** Conversation Director shadow trace (S0). */
  readonly decisionKind?: string | undefined;
  readonly addresseeKind?: string | undefined;
  readonly providerLatencyMs?: number | undefined;
  readonly totalLatencyMs?: number | undefined;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function asCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asText(value: unknown, max = 80): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : undefined;
}

/**
 * Emits one taxonomy event to the sink. Best-effort: never throws, never
 * carries unlisted keys. Unknown categories pass through untouched so
 * future producers are not blocked by this allowlist.
 */
export function emitMasterTurnDiagnostic(
  sink: AIDiagnosticSink | undefined,
  dimensions: MasterTurnDiagnosticDimensions,
): void {
  if (!sink) return;
  try {
    sink(freeze({
      kind: "intent" as const,
      category: String(dimensions.category),
      outcome: String(dimensions.outcome),
      provider: asText(dimensions.provider) ?? "master_turn",
      ...(asText(dimensions.model, 128) ? { model: asText(dimensions.model, 128)! } : {}),
      ...(asText(dimensions.phase) ? { phase: asText(dimensions.phase)! } : {}),
      attempt: 1,
      durationMs: asCount(dimensions.durationMs) ?? 0,
      timeoutMs: 0,
      priority: "interactive" as const,
      ...(asText(dimensions.correlationId, 128) ? { correlationId: asText(dimensions.correlationId, 128)! } : {}),
      ...(asCount(dimensions.worldTime) !== undefined ? { worldTime: asCount(dimensions.worldTime)!, turn: asCount(dimensions.worldTime)! } : {}),
      ...(asText(dimensions.turnKind, 32) ? { turnKind: asText(dimensions.turnKind, 32)! } : {}),
      ...(asCount(dimensions.clauseCount) !== undefined ? { clauseCount: asCount(dimensions.clauseCount)! } : {}),
      ...(asCount(dimensions.referentCount) !== undefined ? { referentCount: asCount(dimensions.referentCount)! } : {}),
      ...(asCount(dimensions.contextWorldTime) !== undefined ? { contextWorldTime: asCount(dimensions.contextWorldTime)! } : {}),
      ...(asCount(dimensions.contextEventNumber) !== undefined ? { contextEventNumber: asCount(dimensions.contextEventNumber)! } : {}),
      ...(asText(dimensions.queryId, 80) ? { queryId: asText(dimensions.queryId, 80)! } : {}),
      ...(asText(dimensions.failureCategory, 80) ? { failureCategory: asText(dimensions.failureCategory, 80)! } : {}),
      ...(typeof dimensions.referentInTable === "boolean" ? { referentInTable: dimensions.referentInTable } : {}),
      ...(typeof dimensions.referentSurfaceMatch === "boolean" ? { referentSurfaceMatch: dimensions.referentSurfaceMatch } : {}),
      ...(asCount(dimensions.messageCount) !== undefined ? { messageCount: asCount(dimensions.messageCount)! } : {}),
      ...(asCount(dimensions.mentionCount) !== undefined ? { mentionCount: asCount(dimensions.mentionCount)! } : {}),
      ...(asText(dimensions.planSubjectKinds, 120) ? { planSubjectKinds: asText(dimensions.planSubjectKinds, 120)! } : {}),
      ...(asText(dimensions.planAspects, 120) ? { planAspects: asText(dimensions.planAspects, 120)! } : {}),
      ...(asText(dimensions.planSources, 120) ? { planSources: asText(dimensions.planSources, 120)! } : {}),
      ...(asCount(dimensions.planSubjectCount) !== undefined ? { planSubjectCount: asCount(dimensions.planSubjectCount)! } : {}),
      ...(asCount(dimensions.planPartCount) !== undefined ? { planPartCount: asCount(dimensions.planPartCount)! } : {}),
      ...(asCount(dimensions.planReadingCount) !== undefined ? { planReadingCount: asCount(dimensions.planReadingCount)! } : {}),
      ...(asCount(dimensions.planGroupWithoutMembers) !== undefined ? { planGroupWithoutMembers: asCount(dimensions.planGroupWithoutMembers)! } : {}),
      ...(asCount(dimensions.planOrdinalWithoutList) !== undefined ? { planOrdinalWithoutList: asCount(dimensions.planOrdinalWithoutList)! } : {}),
      ...(asCount(dimensions.planReadingsDangling) !== undefined ? { planReadingsDangling: asCount(dimensions.planReadingsDangling)! } : {}),
      ...(asText(dimensions.planOverLimits, 32) ? { planOverLimits: asText(dimensions.planOverLimits, 32)! } : {}),
      ...(asCount(dimensions.ambKeyCount) !== undefined ? { ambKeyCount: asCount(dimensions.ambKeyCount)! } : {}),
      ...(typeof dimensions.ambKindValid === "boolean" ? { ambKindValid: dimensions.ambKindValid } : {}),
      ...(typeof dimensions.ambQuestionIsString === "boolean" ? { ambQuestionIsString: dimensions.ambQuestionIsString } : {}),
      ...(asCount(dimensions.ambCandidateCount) !== undefined ? { ambCandidateCount: asCount(dimensions.ambCandidateCount)! } : {}),
      ...(typeof dimensions.ambCandidatesAllStrings === "boolean" ? { ambCandidatesAllStrings: dimensions.ambCandidatesAllStrings } : {}),
      ...(typeof dimensions.hasPendingClarification === "boolean" ? { hasPendingClarification: dimensions.hasPendingClarification } : {}),
      ...(typeof dimensions.hasGoal === "boolean" ? { hasGoal: dimensions.hasGoal } : {}),
      ...(typeof dimensions.hasDramaticThread === "boolean" ? { hasDramaticThread: dimensions.hasDramaticThread } : {}),
      ...(typeof dimensions.truncated === "boolean" ? { truncated: dimensions.truncated } : {}),
      ...(asCount(dimensions.temporalCost) !== undefined ? { temporalCost: asCount(dimensions.temporalCost)! } : {}),
      ...(asCount(dimensions.tickPassedCount) !== undefined ? { tickPassedCount: asCount(dimensions.tickPassedCount)! } : {}),
      ...(asText(dimensions.timePolicy, 40) ? { timePolicy: asText(dimensions.timePolicy, 40)! } : {}),
      ...(asText(dimensions.movementTargetKind, 40) ? { movementTargetKind: asText(dimensions.movementTargetKind, 40)! } : {}),
      ...(asText(dimensions.movementOutcome, 40) ? { movementOutcome: asText(dimensions.movementOutcome, 40)! } : {}),
      ...(typeof dimensions.replayed === "boolean" ? { replayed: dimensions.replayed } : {}),
      ...(asText(dimensions.decisionKind, 32) ? { decisionKind: asText(dimensions.decisionKind, 32)! } : {}),
      ...(asText(dimensions.addresseeKind, 32) ? { addresseeKind: asText(dimensions.addresseeKind, 32)! } : {}),
      ...(asCount(dimensions.providerLatencyMs) !== undefined ? { providerLatencyMs: asCount(dimensions.providerLatencyMs)! } : {}),
      ...(asCount(dimensions.totalLatencyMs) !== undefined ? { totalLatencyMs: asCount(dimensions.totalLatencyMs)! } : {}),
      recordedAt: new Date().toISOString(),
    }));
  } catch {
    // Operational telemetry must not affect interpretation or execution.
  }
}

/**
 * Emit one sanitized `command_outcome` for any user turn (ADR-0039, T6.1):
 * executed command, preflight rejection, clarification, read-only inquiry/meta
 * or an idempotent replay. Single emission point so the deterministic and
 * model paths cannot diverge in shape.
 */
export function emitCommandOutcome(
  sink: AIDiagnosticSink | undefined,
  diagnostics: CommandDiagnostics,
  extra: {
    readonly correlationId?: string | undefined;
    readonly phase?: string | undefined;
    readonly turnKind?: string | undefined;
    readonly replayed?: boolean | undefined;
  } = {},
): void {
  emitMasterTurnDiagnostic(sink, {
    category: "command_outcome",
    outcome: diagnostics.movement.outcome,
    phase: extra.phase ?? "execution",
    ...(extra.correlationId ? { correlationId: extra.correlationId } : {}),
    ...(extra.turnKind ? { turnKind: extra.turnKind } : {}),
    worldTime: diagnostics.temporal.worldTimeAfter,
    temporalCost: diagnostics.temporal.cost,
    tickPassedCount: diagnostics.temporal.tickPassedCount,
    timePolicy: diagnostics.temporal.policy,
    movementTargetKind: diagnostics.movement.targetKind,
    movementOutcome: diagnostics.movement.outcome,
    ...(typeof extra.replayed === "boolean" ? { replayed: extra.replayed } : {}),
  });
}
