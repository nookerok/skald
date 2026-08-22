import {
  INQUIRY_CAPABILITIES,
  INTENT_CAPABILITIES,
  classifyPlayerInput,
  parseIntent,
  validateActionProposal,
  validateInquiryProposal,
  validateIntentProposal,
  type ExecutableIntent,
  type InquiryRequest,
  type IntentResult,
  type IntentProposalValidation,
} from "@skald/intent-parser";
import type { ModelRouter } from "@skald/world";

export type IntentGatewayMode = "off" | "fallback";

export type IntentGatewayResult =
  | { readonly status: "inquiry"; readonly inquiry: InquiryRequest }
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
  const classification = classifyPlayerInput(input, parseIntent);
  if (classification.kind === "inquiry") return { status: "inquiry", inquiry: classification.inquiry };
  const deterministic = classification.kind === "inquiry_candidate" ? parseIntent(input) : classification.intent;
  if (classification.kind === "inquiry_candidate") {
    if ((options?.mode ?? readMode()) === "off" || router === null) {
      return {
        status: "clarification",
        question: "Ты спрашиваешь о месте, своих знаниях или хочешь обратиться к кому-то в мире?",
        options: [
          { optionId: "place", label: "Спросить о месте" },
          { optionId: "speech", label: "Обратиться к персонажу" },
        ],
      };
    }
    try {
      const rawInquiry = await withTimeout(proposeInquiry(router, input), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const validatedInquiry = validateInquiryProposal(rawInquiry);
      if (validatedInquiry.status === "accepted") {
        return {
          status: "inquiry",
          inquiry: { type: "InquiryRequest", queryId: validatedInquiry.queryId, rawText: input, confidence: 1, source: "llm" },
        };
      }
      if (validatedInquiry.status === "clarification") return validatedInquiry;
    } catch {
      // A question must never be reclassified as a world-changing speech action.
    }
    return {
      status: "clarification",
      question: "Я не до конца понял вопрос. Ты хочешь узнать о месте, о себе или о том, что произошло?",
      options: [
        { optionId: "place", label: "О месте" },
        { optionId: "self", label: "О себе" },
        { optionId: "events", label: "О событиях" },
      ],
    };
  }
  if (deterministic.type === "ActionIntentCommand" || deterministic.type === "InteractionCommand" || deterministic.type === "JourneyIntent") {
    const structural = validateActionProposal(deterministic);
    if (!structural.ok) {
      return {
        status: "clarification",
        question: structural.clarification,
        options: [{ optionId: "rephrase", label: "Переформулировать действие" }],
      };
    }
  }
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
    if (
      validated.status === "accepted"
      && validated.intent.type === "JourneyIntent"
      && /(^|:)\s*(?:обхожу|обхожу)/iu.test(input)
      && /(?:^|\s)(?:я\s+)?не(?:\s|$)|прямо\s+к/iu.test(validated.intent.destination.raw)
    ) {
      return {
        status: "clarification",
        question: "Я услышал несколько частей намерения. Назови одну цель и одно действие.",
        options: [{ optionId: "primary-action", label: "Сначала назвать основное действие" }],
      };
    }
    return mapValidation(validated);
  } catch {
    // A model timeout or transient provider failure must not strand a
    // deterministic, single-intent reading in clarification. The validator
    // remains authoritative for model output; this fallback only reuses the
    // parser's already-safe command and still lets the world validate it.
    const safeFallback = isSafeDeterministic(deterministic) ? deterministic : null;
    if (safeFallback) return { status: "accepted", intent: safeFallback, source: "deterministic" };
    return { status: "clarification", question: "Я не уверен, что правильно понял. Скажи, чего ты хочешь добиться первым.", options: [{ optionId: "rephrase", label: "Уточнить намерение" }] };
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
      // A colon, conjunction or trailing manner clause usually means the
      // player supplied a compound intention. Do not execute the first
      // parser fragment when the LLM proposal is unavailable: ask for one
      // primary action instead of silently turning context into a destination.
      && !isCompoundNaturalInput(result.rawText)
      && result.interpretation.confidence >= 0.7;
  }
  if (result.type !== "ActionIntentCommand") return false;
  return result.interpretation.source === "deterministic"
    && result.operation !== "unknown"
    && result.interpretation.ambiguities.length === 0
    && !(result.operation === "approach" && isCompoundNaturalInput(result.rawText))
    && result.interpretation.confidence >= 0.7;
}

function isCompoundNaturalInput(input: string): boolean {
  return /[:;]|\s+и\s+|,\s*(?:стараясь|пытаясь|чтобы|и\s+наблюдать)\b/iu.test(input);
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
  return { status: "unavailable", message: "Я не уверен, что правильно понял это намерение. Скажи, чего ты хочешь добиться первым." };
}

async function proposeInquiry(router: ModelRouter, input: string): Promise<unknown> {
  const response = await router.chat("interpret", [
    {
      role: "system",
      content: [
        "You are SKALD's non-authoritative inquiry classifier.",
        "Return exactly one JSON object matching InquiryProposalV1.",
        "Select one registered read-only query id. Do not answer the question.",
        "Do not return world facts, ids, coordinates, events, actions or consequences.",
        "Queries: " + JSON.stringify(INQUIRY_CAPABILITIES.queryIds),
      ].join("\n"),
    },
    { role: "user", content: JSON.stringify({ kind: "player_inquiry", text: input.slice(0, 2_000) }) },
  ], { dataClass: "player_input" });
  return JSON.parse(response.text);
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
