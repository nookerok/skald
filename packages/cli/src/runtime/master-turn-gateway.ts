/**
 * Master Turn Gateway V2 (ADR-0028 P0 production wiring).
 *
 * Single production interpretation entry: deterministic fast path for simple
 * confident commands, otherwise a closed TurnProposalV2 proposal validated
 * statically and contextually. The old IntentProposalV1 LLM path is not used
 * here; it remains in intent-gateway.ts only for test compatibility.
 *
 * Contract:
 * - Called OUTSIDE the world queue with a short consistent snapshot.
 * - Never holds the queue during the network call.
 * - Returns a transient plan; execution + revalidation happen inside the queue.
 */

import type { DomainEvent } from "@skald/event-bus";
import {
  classifyPlayerInput,
  parseIntent,
  validateActionProposal,
  validateTurnProposal,
  type ExecutableIntent,
  type InquiryRequest,
} from "@skald/intent-parser";
import type { AIDiagnosticSink, MasterTurnSceneSnapshot, ModelRouter, ReadonlyWorld } from "@skald/world";
import { describeConversationContext, type MasterConversationContext } from "../conversation/context-builder.js";
import { bindTurnPronouns } from "../conversation/focus-stack.js";
import { MASTER_TURN_SYSTEM_PROMPT, buildMasterTurnPrompt } from "./master-turn-prompt.js";
import { validateMasterTurnPlan, type ValidatedMasterTurnPlan } from "./master-turn-validator.js";
import { emitMasterTurnDiagnostic } from "./master-turn-diagnostics.js";
import {
  clarificationFromDeterministic,
  fallbackForDeterministic,
  isSafeDeterministic,
  isSimpleSafeDeterministic,
  type IntentGatewayMode,
} from "./intent-gateway.js";

const DEFAULT_TIMEOUT_MS = 5_000;

/** Consistent snapshot captured inside a short queue entry. */
export interface MasterTurnSnapshot {
  readonly events: readonly DomainEvent[];
  readonly world: ReadonlyWorld;
  readonly scene: MasterTurnSceneSnapshot;
  readonly conversation: MasterConversationContext;
}

export interface MasterTurnGatewayOptions {
  readonly mode?: IntentGatewayMode;
  readonly timeoutMs?: number;
  readonly diagnostics?: AIDiagnosticSink;
  readonly correlationId?: string;
  readonly worldTime?: number;
}

export type MasterTurnGatewayOutcome =
  | { readonly status: "deterministic"; readonly intent: ExecutableIntent }
  | { readonly status: "inquiry"; readonly inquiry: InquiryRequest }
  | { readonly status: "plan"; readonly plan: ValidatedMasterTurnPlan; readonly scene: MasterTurnSceneSnapshot }
  | {
    readonly status: "clarification";
    readonly question: string;
    readonly options: readonly { readonly optionId: string; readonly label: string }[];
  }
  | { readonly status: "unsupported"; readonly message: string }
  | { readonly status: "unavailable"; readonly message: string };

function readMode(): IntentGatewayMode {
  return process.env["SKALD_INTENT_LLM_MODE"] === "off" ? "off" : "fallback";
}

function clarificationFallback(): MasterTurnGatewayOutcome {
  return {
    status: "clarification",
    question: "Я не уверен, что правильно понял. Скажи, чего ты хочешь добиться первым.",
    options: [{ optionId: "rephrase", label: "Уточнить намерение" }],
  };
}

/**
 * Interprets one replica outside the world queue.
 * Pure orchestration: fast path, V2 proposal, static + contextual validation.
 */
export async function interpretMasterTurn(
  input: string,
  snapshot: MasterTurnSnapshot,
  router: ModelRouter | null,
  options?: MasterTurnGatewayOptions,
): Promise<MasterTurnGatewayOutcome> {
  const classification = classifyPlayerInput(input, parseIntent);
  if (classification.kind === "inquiry") {
    return { status: "inquiry", inquiry: classification.inquiry };
  }
  const deterministic = classification.kind === "inquiry_candidate" ? parseIntent(input) : classification.intent;

  if (classification.kind !== "inquiry_candidate" && isSimpleSafeDeterministic(input, deterministic)) {
    if (deterministic.type === "ActionIntentCommand" || deterministic.type === "InteractionCommand" || deterministic.type === "JourneyIntent") {
      const structural = validateActionProposal(deterministic);
      if (!structural.ok) {
        return {
          status: "clarification",
          question: structural.clarification,
          options: [{ optionId: "rephrase", label: "Переформулировать действие" }],
        };
      }
      emitMasterTurnDiagnostic(options?.diagnostics, {
        category: "deterministic_fast_path",
        outcome: "accepted",
        phase: "fast_path",
        correlationId: options?.correlationId,
        worldTime: options?.worldTime,
      });
      return { status: "deterministic", intent: deterministic };
    }
  }

  if (deterministic.type === "UnsupportedButUnderstood" && (options?.mode ?? readMode()) === "off") {
    return { status: "unsupported", message: deterministic.message };
  }
  if ((options?.mode ?? readMode()) === "off" || router === null) {
    if ((deterministic.type === "ActionIntentCommand" || deterministic.type === "InteractionCommand" || deterministic.type === "JourneyIntent")
      && isSafeDeterministic(deterministic)) {
      const structural = validateActionProposal(deterministic);
      if (structural.ok) return { status: "deterministic", intent: deterministic };
    }
    const mapped = mapLegacyFallback(fallbackForDeterministic(deterministic));
    if (mapped) return mapped;
    return clarificationFallback();
  }

  const startedAt = performance.now();
  emitMasterTurnDiagnostic(options?.diagnostics, {
    category: "context_required",
    outcome: "accepted",
    phase: "routing",
    correlationId: options?.correlationId,
    worldTime: options?.worldTime,
  });
  emitMasterTurnDiagnostic(options?.diagnostics, {
    category: "context_built",
    outcome: "built",
    phase: "snapshot",
    correlationId: options?.correlationId,
    worldTime: options?.worldTime,
    contextWorldTime: snapshot.world.time,
    contextEventNumber: snapshot.world.eventNumber,
  });
  const contextSummary = describeConversationContext(snapshot.conversation);
  emitMasterTurnDiagnostic(options?.diagnostics, {
    category: "conversation_context",
    outcome: contextSummary.truncated ? "degraded" : "built",
    phase: "snapshot",
    correlationId: options?.correlationId,
    worldTime: options?.worldTime,
    contextWorldTime: snapshot.world.time,
    contextEventNumber: snapshot.world.eventNumber,
    messageCount: contextSummary.messageCount,
    mentionCount: contextSummary.mentionCount,
    hasPendingClarification: contextSummary.hasPendingClarification,
    hasGoal: contextSummary.hasGoal,
    hasDramaticThread: contextSummary.hasDramaticThread,
    truncated: contextSummary.truncated,
  });

  let raw: unknown;
  emitMasterTurnDiagnostic(options?.diagnostics, {
    category: "turn_proposal_requested",
    outcome: "requested",
    phase: "request",
    correlationId: options?.correlationId,
    worldTime: options?.worldTime,
  });
  try {
    raw = await withTimeout(proposeTurn(router, input, snapshot, options), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } catch {
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "deterministic_fallback",
      outcome: "fallback",
      phase: "fallback",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
    });
    const safeFallback = isSafeDeterministic(deterministic) && (deterministic.type === "ActionIntentCommand" || deterministic.type === "InteractionCommand" || deterministic.type === "JourneyIntent")
      ? deterministic
      : null;
    if (safeFallback) return { status: "deterministic", intent: safeFallback };
    const deterministicClarification = clarificationFromDeterministic(deterministic);
    if (deterministicClarification) return mapLegacyFallback(deterministicClarification) ?? clarificationFallback();
    return clarificationFallback();
  }

  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") throw new Error("proposal response was not JSON");
  } catch {
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "proposal_schema_rejected",
      outcome: "invalid",
      phase: "response_decode",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
    });
    const safeFallback = isSafeDeterministic(deterministic) && (deterministic.type === "ActionIntentCommand" || deterministic.type === "InteractionCommand" || deterministic.type === "JourneyIntent")
      ? deterministic
      : null;
    if (safeFallback) return { status: "deterministic", intent: safeFallback };
    const deterministicClarification = clarificationFromDeterministic(deterministic);
    if (deterministicClarification) return mapLegacyFallback(deterministicClarification) ?? clarificationFallback();
    return clarificationFallback();
  }

  emitMasterTurnDiagnostic(options?.diagnostics, {
    category: "turn_proposal_received",
    outcome: "received",
    phase: "response",
    correlationId: options?.correlationId,
    worldTime: options?.worldTime,
    durationMs: Math.round(performance.now() - startedAt),
  });

  const staticCheck = validateTurnProposal(parsed);
  if (staticCheck.status === "clarification") return staticCheck;
  if (staticCheck.status === "invalid") {
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "proposal_schema_rejected",
      outcome: "invalid",
      phase: "schema_validation",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
    });
    const deterministicClarification = clarificationFromDeterministic(deterministic);
    if (deterministicClarification) return mapLegacyFallback(deterministicClarification) ?? clarificationFallback();
    return clarificationFallback();
  }

  const contextual = validateMasterTurnPlan({
    proposal: staticCheck.proposal,
    scene: snapshot.scene,
    world: snapshot.world,
    rawText: input,
    diagnostics: options?.diagnostics,
  });
  if (contextual.status === "accepted") {
    return { status: "plan", plan: contextual.plan, scene: snapshot.scene };
  }
  if (contextual.status === "clarification") {
    return { status: "clarification", question: contextual.question, options: contextual.options };
  }
  const deterministicClarification = clarificationFromDeterministic(deterministic);
  if (deterministicClarification) return mapLegacyFallback(deterministicClarification) ?? clarificationFallback();
  return clarificationFallback();
}

function mapLegacyFallback(result: { readonly status: string; readonly question?: string; readonly options?: readonly { readonly optionId: string; readonly label: string }[]; readonly message?: string; readonly intent?: ExecutableIntent }): MasterTurnGatewayOutcome | null {
  if (result.status === "clarification" && result.question) {
    return { status: "clarification", question: result.question, options: result.options ?? [{ optionId: "rephrase", label: "Уточнить намерение" }] };
  }
  if (result.status === "unsupported" && result.message) return { status: "unsupported", message: result.message };
  if (result.status === "unavailable" && result.message) return { status: "unavailable", message: result.message };
  return null;
}

async function proposeTurn(
  router: ModelRouter,
  input: string,
  snapshot: MasterTurnSnapshot,
  options?: MasterTurnGatewayOptions,
): Promise<unknown> {
  // Pronoun bindings resolve against the same snapshot the model sees;
  // the validator and the queue revalidate every referent afterwards.
  const pronounBindings = bindTurnPronouns(input, snapshot.conversation, snapshot.scene.context);
  const prompt = buildMasterTurnPrompt({
    playerText: input,
    scene: snapshot.scene.context,
    conversation: snapshot.conversation,
    pronounBindings,
  });
  const response = await router.chat("interpret", [
    { role: "system", content: MASTER_TURN_SYSTEM_PROMPT },
    { role: "user", content: prompt.user },
  ], {
    dataClass: "player_input",
    ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options?.diagnostics ? { diagnostics: options.diagnostics } : {}),
    ...(options?.correlationId ? { correlationId: options.correlationId } : {}),
    ...(Number.isFinite(options?.worldTime) ? { worldTime: options!.worldTime } : {}),
    priority: "interactive",
  });
  return response.text;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error("master turn interpretation timeout");
          error.name = "IntentTimeoutError";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
