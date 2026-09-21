/**
 * Live intent/narration contract probe (plan: real acceptance).
 *
 * A read-only, opt-in check that the configured provider can actually carry a
 * master turn: the plan's three live phrases must resolve without a generic
 * fallback, and the narration route must answer. It never creates a world,
 * executes a command or writes the Event Log — `interpretMasterTurn` only
 * produces a transient plan/clarification, and the narration call is a plain
 * provider round-trip.
 *
 * Pure report shaping: no world access beyond the supplied snapshot, no
 * persistence, no HTTP. Callers decide whether a failure blocks deployment.
 */

import { isGenericFallbackText } from "@skald/intent-parser";
import type { ChatMessage, ModelRouter } from "@skald/world";
import { interpretMasterTurn, type MasterTurnSnapshot, type MasterTurnGatewayOutcome } from "../runtime/master-turn-gateway.js";

/** The plan's live phrases, in order. */
export const LIVE_INTENT_PHRASES = [
  "я осматриваюсь",
  "подхожу к ограде",
  "подхожу к ограде и осматриваю двор, что я вижу?",
] as const;

/** Outcome for one live phrase. */
export interface LiveIntentPhraseResult {
  readonly input: string;
  readonly status: string;
  /** A clarification that is only the diagnosed last-resort wording. */
  readonly genericFallback: boolean;
  readonly ok: boolean;
  readonly detail?: string | undefined;
}

/** One live provider round-trip on the narration route. */
export interface LiveNarrationResult {
  readonly ok: boolean;
  readonly detail?: string | undefined;
}

/** Aggregate live contract verdict. */
export interface LiveIntentContractReport {
  readonly status: "ready" | "unavailable";
  readonly pass: boolean;
  readonly phrases: readonly LiveIntentPhraseResult[];
  readonly narration: LiveNarrationResult;
}

export interface LiveIntentContractOptions {
  readonly timeoutMs?: number;
}

function phraseResult(input: string, outcome: MasterTurnGatewayOutcome): LiveIntentPhraseResult {
  const genericFallback = outcome.status === "clarification" && isGenericFallbackText(outcome.question);
  const dead = outcome.status === "unavailable" || outcome.status === "unsupported";
  const accepted = outcome.status === "deterministic" || outcome.status === "plan" || outcome.status === "inquiry";
  return Object.freeze({
    input,
    status: outcome.status,
    genericFallback,
    ok: !genericFallback && !dead && (accepted || outcome.status === "clarification"),
    ...(outcome.status === "clarification" ? { detail: genericFallback ? "generic fallback" : "named clarification" } : {}),
  });
}

/**
 * Runs the three live phrases through the real gateway and one narration
 * round-trip on the configured provider. Read-only and total: provider errors
 * become an `unavailable` report, never a thrown error.
 */
export async function probeLiveIntentContract(
  snapshot: MasterTurnSnapshot,
  router: ModelRouter | null,
  options?: LiveIntentContractOptions,
): Promise<LiveIntentContractReport> {
  const timeoutMs = options?.timeoutMs ?? 10_000;
  const phrases: LiveIntentPhraseResult[] = [];
  for (const input of LIVE_INTENT_PHRASES) {
    try {
      const outcome = await interpretMasterTurn(input, snapshot, router, { timeoutMs, mode: "fallback" });
      phrases.push(phraseResult(input, outcome));
    } catch {
      phrases.push(Object.freeze({ input, status: "error", genericFallback: false, ok: false, detail: "probe error" }));
    }
  }

  let narration: LiveNarrationResult;
  if (!router) {
    narration = Object.freeze({ ok: false, detail: "no router" });
  } else {
    const messages: ChatMessage[] = [
      { role: "system", content: "Ответь одним коротким предложением по-русски." },
      { role: "user", content: "Опиши тихую переправу у реки." },
    ];
    try {
      const result = await router.chat("narrate", messages, { timeoutMs });
      narration = Object.freeze({ ok: typeof result.text === "string" && result.text.trim().length > 0, ...(typeof result.text === "string" && result.text.trim().length > 0 ? {} : { detail: "empty narration" }) });
    } catch {
      narration = Object.freeze({ ok: false, detail: "narration provider error" });
    }
  }

  const pass = phrases.every((entry) => entry.ok) && narration.ok;
  return Object.freeze({ status: pass ? "ready" : "unavailable", pass, phrases: Object.freeze(phrases), narration });
}
