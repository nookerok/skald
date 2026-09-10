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
 */

import type { AIDiagnosticSink } from "@skald/world";

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
  readonly messageCount?: number | undefined;
  readonly mentionCount?: number | undefined;
  readonly hasPendingClarification?: boolean | undefined;
  readonly hasGoal?: boolean | undefined;
  readonly hasDramaticThread?: boolean | undefined;
  readonly truncated?: boolean | undefined;
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
      ...(asCount(dimensions.messageCount) !== undefined ? { messageCount: asCount(dimensions.messageCount)! } : {}),
      ...(asCount(dimensions.mentionCount) !== undefined ? { mentionCount: asCount(dimensions.mentionCount)! } : {}),
      ...(typeof dimensions.hasPendingClarification === "boolean" ? { hasPendingClarification: dimensions.hasPendingClarification } : {}),
      ...(typeof dimensions.hasGoal === "boolean" ? { hasGoal: dimensions.hasGoal } : {}),
      ...(typeof dimensions.hasDramaticThread === "boolean" ? { hasDramaticThread: dimensions.hasDramaticThread } : {}),
      ...(typeof dimensions.truncated === "boolean" ? { truncated: dimensions.truncated } : {}),
      recordedAt: new Date().toISOString(),
    }));
  } catch {
    // Operational telemetry must not affect interpretation or execution.
  }
}
