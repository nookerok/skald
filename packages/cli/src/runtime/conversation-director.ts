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
  /** Raw model reply validated BEFORE normalization (no aliases applied). */
  readonly rawSchemaValid: boolean;
  /** Valid AFTER the closed alias normalization. */
  readonly schemaValid: boolean;
  /** A decision was accepted and returned to the caller. */
  readonly decisionAccepted: boolean;
  readonly validationErrors: readonly string[];
  readonly providerLatencyMs: number;
  readonly totalLatencyMs: number;
  /** Provider/model that actually answered this call (attribution evidence). */
  readonly provider?: string | undefined;
  readonly model?: string | undefined;
  /** True when the router served a fallback candidate rather than the primary. */
  readonly usedFallback?: boolean | undefined;
  readonly tier?: string | undefined;
  readonly fallbackReason?: string | undefined;
  /** Closed summary of the invalid reply's top-level keys (never free text). */
  readonly replyShape?: string | undefined;
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

/**
 * Closed normalization of a common model alias (S0): some models return
 * `addressee: "gm"` / `"meta"` instead of the object form the contract
 * requires. Mapping the alias here keeps the validator strict while raising the
 * real schema-hit rate; a bare handle string is NOT an alias and stays invalid.
 */
export function normalizeDecisionShape(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const decision = raw as Record<string, unknown>;
  const addressee = decision["addressee"];
  if (typeof addressee !== "string") return raw;
  const token = addressee.trim().toLowerCase();
  if (token === "gm" || token === "мастер" || token === "master") {
    return { ...decision, addressee: { kind: "gm" } };
  }
  if (token === "meta" || token === "система" || token === "system") {
    return { ...decision, addressee: { kind: "meta" } };
  }
  return raw;
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
    rawSchemaValid: boolean;
    schemaValid: boolean;
    decisionAccepted: boolean;
    validationErrors: string[];
    providerLatencyMs: number;
    totalLatencyMs: number;
    provider?: string;
    model?: string;
    usedFallback?: boolean;
    tier?: string;
    fallbackReason?: string;
    replyShape?: string;
  } = {
    turnKey: input.turnKey,
    contractVersion: GM_CONTRACT_VERSION,
    rawSchemaValid: false,
    schemaValid: false,
    decisionAccepted: false,
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
    // Attribution: which provider/model actually answered (ChatResult fields
    // are sanitized ids, never keys or prompts).
    trace.provider = response.provider;
    trace.model = response.model;
    trace.usedFallback = response.usedFallback;
    if (response.tier !== undefined) trace.tier = response.tier;
    replyText = typeof response.text === "string" ? response.text : "";
  } catch {
    return fallback("provider_error");
  }

  const parsed = extractJsonObject(replyText);
  if (!parsed) return fallback("shape:not_json");

  // Raw compliance (no server-side alias applied) vs compliance after the
  // closed normalization; only the normalized form may become a decision.
  const rawValidation = validateGmTurnDecision(parsed, { allowedHandles: input.handleKeys });
  trace.rawSchemaValid = rawValidation.ok;

  const normalized = normalizeDecisionShape(parsed);
  const validated = validateGmTurnDecision(normalized, { allowedHandles: input.handleKeys });
  trace.schemaValid = validated.ok;
  if (!validated.ok) {
    trace.validationErrors = [...validated.errors];
    trace.replyShape = Object.keys(parsed as Record<string, unknown>).slice(0, 8).join(",");
    return fallback("schema:invalid");
  }
  trace.decisionAccepted = true;
  return decided(validated.decision);
}

/** Shadow-mode flag (S0): the director runs but the legacy path alone executes. */
export function gmDirectorShadowEnabled(): boolean {
  const value = process.env["GM_DIRECTOR_SHADOW"];
  return value === "1" || value === "true" || value === "on";
}
