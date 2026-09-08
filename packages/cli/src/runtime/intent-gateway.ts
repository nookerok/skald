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
import { toProviderFailure } from "@skald/world";
import type { AIDiagnosticSink, ModelRouter, ProviderId } from "@skald/world";
import { emitMasterTurnDiagnostic } from "./master-turn-diagnostics.js";

export type IntentGatewayMode = "off" | "fallback";

export type IntentGatewayResult =
  | { readonly status: "inquiry"; readonly inquiry: InquiryRequest }
  | { readonly status: "accepted"; readonly intent: ExecutableIntent; readonly source: "deterministic" | "llm" }
  | { readonly status: "clarification"; readonly question: string; readonly options: readonly { readonly optionId: string; readonly label: string }[] }
  | { readonly status: "unsupported"; readonly message: string }
  | { readonly status: "unavailable"; readonly message: string };

const DEFAULT_TIMEOUT_MS = 5_000;

export interface IntentGatewayOptions {
  readonly mode?: IntentGatewayMode;
  readonly timeoutMs?: number;
  readonly diagnostics?: AIDiagnosticSink;
  readonly correlationId?: string;
  readonly worldTime?: number;
}

function emitIntentDiagnostic(
  sink: AIDiagnosticSink | undefined,
  options: IntentGatewayOptions | undefined,
  category: string,
  outcome: string,
  phase: string,
  startedAt: number,
  attempt = 1,
  provider = "gateway",
  model?: string,
  error?: unknown,
): void {
  try {
    const failure = diagnosticProviderFailure(error, provider);
    const safeModel = diagnosticModel(failure?.model ?? model);
    const safeConfiguredModel = diagnosticModel(error && typeof error === "object" ? (error as { configuredModel?: unknown }).configuredModel : undefined);
    sink?.({
      kind: "intent",
      category,
      outcome,
      provider: failure?.provider ?? provider,
      ...(safeModel ? { model: safeModel } : {}),
      ...(safeConfiguredModel ? { configuredModel: safeConfiguredModel } : {}),
      phase: failure?.phase ?? phase,
      ...(failure?.httpStatus !== undefined ? { httpStatus: failure.httpStatus } : {}),
      ...(failure?.providerCode !== undefined ? { providerCode: failure.providerCode } : {}),
      attempt,
      durationMs: Math.round(performance.now() - startedAt),
      timeoutMs: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      priority: "interactive",
      ...(options?.correlationId ? { correlationId: options.correlationId } : {}),
      ...(Number.isFinite(options?.worldTime) ? { worldTime: options!.worldTime } : {}),
      ...(Number.isFinite(options?.worldTime) ? { turn: options!.worldTime } : {}),
      recordedAt: new Date().toISOString(),
    });
  } catch {
    // Operational telemetry is best effort and must not affect interpretation.
  }
}

function diagnosticProviderFailure(error: unknown, fallbackProvider: string): ReturnType<typeof toProviderFailure> {
  const context = {
    provider: fallbackProvider === "opencode_zen" || fallbackProvider === "ollama_cloud" ? fallbackProvider as ProviderId : undefined,
    category: "interpret" as const,
  };
  const direct = toProviderFailure(error, context);
  if (direct) return direct;
  if (error && typeof error === "object") {
    const cause = (error as { cause?: unknown }).cause;
    if (cause) return toProviderFailure(cause, context);
  }
  return null;
}

function diagnosticModel(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value) ? value : undefined;
}

function diagnosticProvider(error: unknown): string {
  if (error && typeof error === "object") {
    const source = error as { provider?: unknown; providerId?: unknown };
    const provider = source.provider ?? source.providerId;
    if (typeof provider === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(provider)) return provider;
  }
  return "provider";
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === "IntentTimeoutError" || error.message.includes("intent interpretation timeout"));
}

function parseProposalJson(raw: unknown): unknown {
  if (typeof raw === "string") return JSON.parse(raw);
  if (raw && typeof raw === "object") return raw;
  throw new Error("proposal response was not JSON");
}

/**
 * Resolves player text before the world queue. LLM output remains a proposal
 * until the pure intent-proposal validator maps it to an existing command.
 */
export async function interpretPlayerInput(
  input: string,
  router: ModelRouter | null,
  options?: IntentGatewayOptions,
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
    const startedAt = performance.now();
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "context_required",
      outcome: "accepted",
      phase: "routing",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
    });
    let rawInquiry: unknown;
    try {
      rawInquiry = await withTimeout(proposeInquiry(router, input, options), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      emitIntentDiagnostic(options?.diagnostics, options, "inquiry_proposal_request", "success", "request", startedAt, 1, diagnosticProvider(rawInquiry));
    } catch (error) {
      emitIntentDiagnostic(options?.diagnostics, options, isTimeoutError(error) ? "intent_timeout" : "inquiry_proposal_request", "failed", isTimeoutError(error) ? "request" : "transport", startedAt, 1, diagnosticProvider(error), undefined, error);
      // A question must never be reclassified as a world-changing speech action.
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
    let parsedInquiry: unknown;
    try {
      parsedInquiry = parseProposalJson(rawInquiry);
    } catch {
      emitIntentDiagnostic(options?.diagnostics, options, "inquiry_json_parse", "failed", "response_decode", startedAt, 1, diagnosticProvider(router), undefined, undefined);
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
    const validatedInquiry = validateInquiryProposal(parsedInquiry);
    if (validatedInquiry.status === "accepted") {
      emitIntentDiagnostic(options?.diagnostics, options, "inquiry_schema_validation", "accepted", "schema_validation", startedAt, 1, diagnosticProvider(router));
      return {
        status: "inquiry",
        inquiry: { type: "InquiryRequest", queryId: validatedInquiry.queryId, rawText: input, confidence: 1, source: "llm" },
      };
    }
    emitIntentDiagnostic(options?.diagnostics, options, "inquiry_schema_validation", validatedInquiry.status, "schema_validation", startedAt, 1, diagnosticProvider(router));
    if (validatedInquiry.status === "clarification") return validatedInquiry;
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
  // Master Turn order (ADR-0028, plan_6 Stage 1): fast path first.
  // Structural validation runs only for simple safe commands. Unknown,
  // pronoun-bearing, multi-clause or question-like inputs skip pre-LLM
  // validation so that `unknown` reaches the LLM proposal.
  if (isSimpleSafeDeterministic(input, deterministic)) {
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
      return { status: "accepted", intent: deterministic, source: "deterministic" };
    }
  }
  if (deterministic.type === "UnsupportedButUnderstood" && (options?.mode ?? readMode()) === "off") {
    return { status: "unsupported", message: deterministic.message };
  }
  if ((options?.mode ?? readMode()) === "off" || router === null) {
    // Safe deterministic fallback when the model is unavailable: keep simple
    // playable commands working without a network call.
    if ((deterministic.type === "ActionIntentCommand" || deterministic.type === "InteractionCommand" || deterministic.type === "JourneyIntent")
      && isSafeDeterministic(deterministic)) {
      const structural = validateActionProposal(deterministic);
      if (structural.ok) return { status: "accepted", intent: deterministic, source: "deterministic" };
    }
    return fallbackForDeterministic(deterministic);
  }

  const startedAt = performance.now();
  emitMasterTurnDiagnostic(options?.diagnostics, {
    category: "context_required",
    outcome: "accepted",
    phase: "routing",
    correlationId: options?.correlationId,
    worldTime: options?.worldTime,
  });
  let raw: unknown;
  try {
    raw = await withTimeout(proposeIntent(router, input, options), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    emitIntentDiagnostic(options?.diagnostics, options, "intent_proposal_request", "success", "request", startedAt, 1, diagnosticProvider(router));
  } catch (error) {
    emitIntentDiagnostic(options?.diagnostics, options, isTimeoutError(error) ? "intent_timeout" : "intent_proposal_request", "failed", isTimeoutError(error) ? "request" : "transport", startedAt, 1, diagnosticProvider(error), undefined, error);
    // A model timeout or transient provider failure must not strand a
    // deterministic, single-intent reading in clarification. The validator
    // remains authoritative for model output; this fallback only reuses the
    // parser's already-safe command and still lets the world validate it.
    const safeFallback = isSafeDeterministic(deterministic) ? deterministic : null;
    if (safeFallback) {
      emitIntentDiagnostic(options?.diagnostics, options, "deterministic_fallback", "accepted", "fallback", startedAt, 1, "gateway");
      return { status: "accepted", intent: safeFallback, source: "deterministic" };
    }
    const deterministicClarification = clarificationFromDeterministic(deterministic);
    if (deterministicClarification) {
      emitIntentDiagnostic(options?.diagnostics, options, "deterministic_clarification_fallback", "accepted", "fallback", startedAt, 1, "gateway");
      return deterministicClarification;
    }
    emitIntentDiagnostic(options?.diagnostics, options, "clarification_fallback", "accepted", "fallback", startedAt, 1, "gateway");
    return { status: "clarification", question: "Я не уверен, что правильно понял. Скажи, чего ты хочешь добиться первым.", options: [{ optionId: "rephrase", label: "Уточнить намерение" }] };
  }
  let parsed: unknown;
  try {
    parsed = parseProposalJson(raw);
  } catch {
    emitIntentDiagnostic(options?.diagnostics, options, "intent_json_parse", "failed", "response_decode", startedAt, 1, diagnosticProvider(router));
    const safeFallback = isSafeDeterministic(deterministic) ? deterministic : null;
    if (safeFallback) {
      emitIntentDiagnostic(options?.diagnostics, options, "deterministic_fallback", "accepted", "fallback", startedAt, 1, "gateway");
      return { status: "accepted", intent: safeFallback, source: "deterministic" };
    }
    const deterministicClarification = clarificationFromDeterministic(deterministic);
    if (deterministicClarification) {
      emitIntentDiagnostic(options?.diagnostics, options, "deterministic_clarification_fallback", "accepted", "fallback", startedAt, 1, "gateway");
      return deterministicClarification;
    }
    emitIntentDiagnostic(options?.diagnostics, options, "clarification_fallback", "accepted", "fallback", startedAt, 1, "gateway");
    return { status: "clarification", question: "Я не уверен, что правильно понял. Скажи, чего ты хочешь добиться первым.", options: [{ optionId: "rephrase", label: "Уточнить намерение" }] };
  }
  const validated = validateIntentProposal(parsed, input);
  emitIntentDiagnostic(options?.diagnostics, options, "intent_schema_validation", validated.status, "schema_validation", startedAt, 1, diagnosticProvider(router));
  try {
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
    const mapped = mapValidation(validated);
    // Parser-detected compound keeps its specific clarification when the
    // model output cannot be used (invalid/unavailable), instead of a
    // generic fallback message.
    if (mapped.status === "unavailable") {
      const deterministicClarification = clarificationFromDeterministic(deterministic);
      if (deterministicClarification) return deterministicClarification;
    }
    return mapped;
  } catch {
    const deterministicClarification = clarificationFromDeterministic(deterministic);
    if (deterministicClarification) return deterministicClarification;
    emitIntentDiagnostic(options?.diagnostics, options, "clarification_fallback", "accepted", "fallback", startedAt, 1, "gateway");
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

/**
 * Master Turn fast-path gate (ADR-0028, plan_6 Stage 1).
 *
 * True only for a simple, confident, unambiguous command without pronouns,
 * previous-replica references, extra clauses or question form. Everything
 * else (including `unknown`) must reach the LLM proposal. Pending
 * clarification is not checked here yet: the gateway has no conversation
 * context (Stage 4); that check arrives with MasterTurnContext.
 */
function isSimpleSafeDeterministic(input: string, result: IntentResult): boolean {
  if (result.type !== "ActionIntentCommand" && result.type !== "InteractionCommand" && result.type !== "JourneyIntent") return false;
  if (!isSafeDeterministic(result)) return false;
  if (needsLLMForNaturalPhrase(input, result)) return false;
  if (isQuestionLikeForFastPath(input)) return false;
  if (containsPronounOrContextReference(input)) return false;
  if (hasMultipleActionClauses(input)) return false;
  return true;
}

function normalizeWords(input: string): readonly string[] {
  return input
    .toLowerCase()
    .replace(/ё/gu, "е")
    .split(/[^a-zа-я0-9]+/iu)
    .filter((word) => word.length > 0);
}

const PRONOUN_OR_CONTEXT_WORDS: ReadonlySet<string> = new Set([
  "он", "она", "оно", "они",
  "его", "ее", "их",
  "ему", "ей", "им", "ими",
  "нем", "ней",
  "него", "нее", "них", "ним", "ними",
  "меня", "тебя", "себя", "нас", "вас",
  "этом", "этим", "этой", "этого", "того",
  "этот", "эта", "это",
  "такой", "такая", "такое", "такие",
  "туда", "сюда", "там", "здесь", "тут",
  "оттуда", "отсюда",
  "тогда", "прежде", "раньше",
]);

function containsPronounOrContextReference(input: string): boolean {
  const words = normalizeWords(input);
  return words.some((word) => PRONOUN_OR_CONTEXT_WORDS.has(word));
}

const SECOND_VERB_STEMS = "(?:иду|идти|пойти|направиться|двига|отправ|выбр|обойти|обходить|подойти|подхож|приблиз|войти|проник|залез|влез|пролез|попад|лезу|взять|поднять|забрать|достать|собрать|открыть|закрыть|отдать|передать|вручить|положить|поставить|разместить|оставить|класть|использовать|применить|воспользов|толкнуть|толка|удар|навали|выбить|сломать|пнуть|броса|вбить|вырвать|отодвинуть|нагреть|греть|поджечь|расплав|раскалить|остудить|охладить|нарисовать|написать|нацарапать|сказать|спросить|спрош|прошептать|позвать|крик|оклик|осматр|осматрива|рассмотр|огля|посмотр|смотр|взгляд|провер|слуш|прислуш|подслуш|вслуш|трон|трог|прикосн|пощуп|наблюд)";

function hasMultipleActionClauses(input: string): boolean {
  if (/[:;]/u.test(input)) return true;
  if (/(?:^|\s)(?:потом|затем|после|одновременно)\s+/iu.test(input)) return true;
  const secondVerb = new RegExp(`(?:^|\\s)(?:и|а|но|или)\\s+(?:я\\s+)?${SECOND_VERB_STEMS}`, "iu");
  if (secondVerb.test(input)) return true;
  const commaVerb = new RegExp(`,\\s*(?:я\\s+)?${SECOND_VERB_STEMS}`, "iu");
  if (commaVerb.test(input)) return true;
  return false;
}

function isQuestionLikeForFastPath(input: string): boolean {
  const trimmed = input.trim();
  if (/[?]\s*$/u.test(trimmed)) return true;
  const normalized = trimmed.toLowerCase().replace(/ё/gu, "е");
  return /^(?:кто|что|где|куда|почему|зачем|как|какие|какая|какой|сколько)/iu.test(normalized);
}

function clarificationFromDeterministic(result: IntentResult): IntentGatewayResult | null {
  if (result.type !== "ClarificationRequired") return null;
  return {
    status: "clarification",
    question: result.question,
    options: result.interpretations.map((label, index) => ({ optionId: `deterministic-${index + 1}`, label })),
  };
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

async function proposeInquiry(router: ModelRouter, input: string, options?: IntentGatewayOptions): Promise<unknown> {
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

async function proposeIntent(router: ModelRouter, input: string, options?: IntentGatewayOptions): Promise<unknown> {
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
          const error = new Error("intent interpretation timeout");
          error.name = "IntentTimeoutError";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
