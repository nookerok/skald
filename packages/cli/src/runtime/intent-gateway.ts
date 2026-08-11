import {
  INTENT_CAPABILITIES,
  parseIntent,
  validateIntentProposal,
  type ExecutableIntent,
  type IntentResult,
  type IntentProposalValidation,
} from "@skald/intent-parser";
import type { ModelRouter } from "@skald/world";

export type IntentGatewayMode = "off" | "fallback";

export type IntentGatewayResult =
  | { readonly status: "accepted"; readonly intent: ExecutableIntent; readonly source: "deterministic" | "llm" }
  | { readonly status: "clarification"; readonly question: string; readonly options: readonly { readonly optionId: string; readonly label: string }[] }
  | { readonly status: "unsupported"; readonly message: string }
  | { readonly status: "unavailable"; readonly message: string };

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Resolves player text before the world queue. LLM output remains a proposal
 * until the pure intent-proposal validator maps it to an existing command.
 */
export async function interpretPlayerInput(
  input: string,
  router: ModelRouter | null,
  options?: { readonly mode?: IntentGatewayMode; readonly timeoutMs?: number },
): Promise<IntentGatewayResult> {
  const deterministic = parseIntent(input);
  if (isSafeDeterministic(deterministic) && !needsLLMForNaturalPhrase(input, deterministic)) return { status: "accepted", intent: deterministic, source: "deterministic" };
  if (deterministic.type === "ClarificationRequired") {
    return { status: "clarification", question: deterministic.question, options: deterministic.interpretations.map((label, index) => ({ optionId: `deterministic-${index + 1}`, label })) };
  }
  if (deterministic.type === "UnsupportedButUnderstood" && (options?.mode ?? readMode()) === "off") {
    return { status: "unsupported", message: deterministic.message };
  }
  if ((options?.mode ?? readMode()) === "off" || router === null) {
    return fallbackForDeterministic(deterministic);
  }

  try {
    const raw = await withTimeout(proposeIntent(router, input), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const validated = validateIntentProposal(raw, input);
    return mapValidation(validated);
  } catch {
    return { status: "clarification", question: "Не удалось безопасно разобрать это действие. Попробуй назвать одну цель и одно действие.", options: [{ optionId: "rephrase", label: "Переформулировать действие" }] };
  }
}

function readMode(): IntentGatewayMode {
  return process.env["SKALD_INTENT_LLM_MODE"] === "off" ? "off" : "fallback";
}

function isSafeDeterministic(result: IntentResult): result is ExecutableIntent {
  if (result.type === "InteractionCommand") {
    return result.interpretation.source === "deterministic"
      && (result.interpretation.ambiguities.length === 0 || ((result.verb === "observe" || result.verb === "listen") && result.interpretation.ambiguities.every((item) => item === "no clear target identified")))
      && result.interpretation.confidence >= 0.7;
  }
  if (result.type === "JourneyIntent") {
    return result.interpretation.source === "deterministic"
      && result.interpretation.ambiguities.length === 0
      && result.interpretation.confidence >= 0.7;
  }
  if (result.type !== "ActionIntentCommand") return false;
  return result.interpretation.source === "deterministic"
    && result.operation !== "unknown"
    && result.interpretation.ambiguities.length === 0
    && result.interpretation.confidence >= 0.7;
}

function needsLLMForNaturalPhrase(input: string, result: ExecutableIntent): boolean {
  if (/(?:\sи\s|\sзатем\s|\sпосле\s|\sпока\s|\sодновременно\s)/iu.test(input)) return true;
  if (result.type !== "ActionIntentCommand" || result.operation !== "approach") return false;
  if (!result.target?.normalized) return false;
  return !/^(?:я\s*)?(?:(?:иду|идти|пойти|направиться|двигаться|двигайся|обойти|обходить)|move)?\s*(?:на\s+)?(?:север|юг|восток|запад|north|south|east|west)\s*[.!?]*$/iu.test(input.trim());
}

function fallbackForDeterministic(result: IntentResult, message = "Я не уверен, что правильно понял действие. Скажи, что ты хочешь сделать в первую очередь."): IntentGatewayResult {
  if (result.type === "UnsupportedButUnderstood") return { status: "unsupported", message: result.message };
  if (result.type === "ClarificationRequired") {
    return { status: "clarification", question: result.question, options: result.interpretations.map((label, index) => ({ optionId: `deterministic-${index + 1}`, label })) };
  }
  return { status: "unavailable", message };
}

function mapValidation(result: IntentProposalValidation): IntentGatewayResult {
  if (result.status === "accepted") return { status: "accepted", intent: result.intent, source: "llm" };
  if (result.status === "clarification") return result;
  if (result.status === "unsupported") return result;
  return { status: "unavailable", message: "Я не смог безопасно разобрать это действие. Попробуй назвать одну цель и одно действие." };
}

async function proposeIntent(router: ModelRouter, input: string): Promise<unknown> {
  const response = await router.chat("interpret", [
    {
      role: "system",
      content: [
        "You are SKALD's non-authoritative intent interpretation layer.",
        "Return exactly one JSON object matching IntentProposalV1.",
        "Convert the player's text into one registered intent only.",
        "Do not decide success, consequences, target identity, route availability or world facts.",
        "Return raw player-facing references, never internal ids, coordinates, events or rules.",
        "If the text contains more than one executable action, keep one primary and preserve the rest in additionalClauses.",
        "Never silently discard unsupported text.",
        `Capabilities: ${JSON.stringify(INTENT_CAPABILITIES)}`,
      ].join("\n"),
    },
    { role: "user", content: JSON.stringify({ kind: "player_input", text: input.slice(0, 2_000) }) },
  ], { dataClass: "player_input" });
  return JSON.parse(response.text);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("intent interpretation timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
