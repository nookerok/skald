/**
 * Conversation Director (SKALD S0 / P1 — shadow only).
 *
 * Interprets one player replica into a validated `GmTurnDecision` by asking
 * the model with an observer-safe `GmContext`. It NEVER executes: no Events, no
 * ConversationTurn, no Projection change. In shadow mode its result is compared
 * against the legacy path; only the legacy path may change the world.
 */

import type { ChatMessage, ModelRouter } from "@skald/world";
import {
  GM_CONTRACT_VERSION,
  validateGmTurnDecision,
  type GmContext,
  type GmTurnDecision,
  type VisibleActorKey,
} from "@skald/intent-parser";
import { GM_DIRECTOR_SYSTEM_PROMPT, buildGmDecisionPrompt } from "../conversation/gm-prompt.js";

/** Sanitized operational trace of one director call (no prompts, no snapshot). */
export interface GmDirectorTrace {
  readonly turnKey: string;
  readonly contractVersion: number;
  readonly decisionKind?: string | undefined;
  readonly addresseeKind?: string | undefined;
  readonly referencedHandles?: readonly string[] | undefined;
  readonly schemaValid: boolean;
  readonly validationErrors: readonly string[];
  readonly providerLatencyMs: number;
  readonly totalLatencyMs: number;
  readonly fallbackReason?: string | undefined;
}

export interface GmDirectorInput {
  readonly input: string;
  readonly context: GmContext;
  /** Allowed actor handles for this scene (server-assigned). */
  readonly handleKeys: readonly VisibleActorKey[];
  readonly router: ModelRouter;
  readonly turnKey: string;
  readonly timeoutMs?: number | undefined;
}

export type GmDirectorResult =
  | { readonly status: "decision"; readonly decision: GmTurnDecision; readonly trace: GmDirectorTrace }
  | { readonly status: "fallback"; readonly reason: string; readonly trace: GmDirectorTrace };

/** Best-effort JSON object extraction from a model reply (never throws). */
export function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/** Run one director interpretation. Pure side-effect free with respect to the world. */
export async function interpretGmDecision(input: GmDirectorInput): Promise<GmDirectorResult> {
  const started = Date.now();
  // Mutable working copy; frozen into the readonly trace on return.
  const trace: {
    turnKey: string;
    contractVersion: number;
    decisionKind?: string;
    addresseeKind?: string;
    referencedHandles?: string[];
    schemaValid: boolean;
    validationErrors: string[];
    providerLatencyMs: number;
    totalLatencyMs: number;
    fallbackReason?: string;
  } = {
    turnKey: input.turnKey,
    contractVersion: GM_CONTRACT_VERSION,
    schemaValid: false,
    validationErrors: [],
    providerLatencyMs: 0,
    totalLatencyMs: 0,
  };
  const done = (): GmDirectorTrace => Object.freeze({ ...trace, validationErrors: Object.freeze([...trace.validationErrors]) }) as GmDirectorTrace;
  const fallback = (reason: string): GmDirectorResult => {
    trace.fallbackReason = reason;
    trace.totalLatencyMs = Date.now() - started;
    return { status: "fallback", reason, trace: done() };
  };
  const decided = (decision: GmTurnDecision): GmDirectorResult => {
    trace.totalLatencyMs = Date.now() - started;
    trace.decisionKind = decision.kind;
    trace.addresseeKind = decision.addressee.kind;
    trace.referencedHandles = decision.addressee.kind === "npc" ? [decision.addressee.handle] : [];
    return { status: "decision", decision, trace: done() };
  };

  let replyText = "";
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: GM_DIRECTOR_SYSTEM_PROMPT },
      { role: "user", content: buildGmDecisionPrompt(input.input, input.context) },
    ];
    const before = Date.now();
    const response = await input.router.chat("interpret", messages, {
      dataClass: "player_input",
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      priority: "interactive",
    });
    trace.providerLatencyMs = Date.now() - before;
    replyText = typeof response.text === "string" ? response.text : "";
  } catch {
    return fallback("provider_error");
  }

  const parsed = extractJsonObject(replyText);
  if (!parsed) return fallback("shape:not_json");

  const validated = validateGmTurnDecision(parsed, { allowedHandles: input.handleKeys });
  if (!validated.ok) {
    trace.validationErrors = [...validated.errors];
    return fallback("schema:invalid");
  }
  trace.schemaValid = true;
  return decided(validated.decision);
}

/** Shadow-mode flag (S0): the director runs but the legacy path alone executes. */
export function gmDirectorShadowEnabled(): boolean {
  const value = process.env["GM_DIRECTOR_SHADOW"];
  return value === "1" || value === "true" || value === "on";
}
