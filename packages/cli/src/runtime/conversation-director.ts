/**
 * Conversation Director (SKALD S0 / P3 bridge).
 *
 * Interprets one player replica into a validated `GmTurnDecision` by asking
 * the model with an observer-safe `GmContext`. The Director itself never
 * executes an operation or writes state: the gateway revalidates and routes
 * accepted proposals through the deterministic engine, or persists a bounded
 * zero-event ConversationTurn for pure speech. Shadow mode remains observational.
 */

import { createHash } from "node:crypto";
import { ProviderRequestError, ProviderUnavailableError, toProviderFailure } from "@skald/world";
import type { ChatMessage, ModelRouter, ProviderId, ProviderRequestFailure } from "@skald/world";
import {
  GM_CONTRACT_VERSION,
  classifyPlayerInput,
  classifyReplicaClauses,
  isQuestionLikeInput,
  parseIntent,
  sameRussianStem,
  validateGmTurnDecision,
  type ClarificationOption,
  type GmContext,
  type GmTurnDecision,
  type VisibleActorKey,
} from "@skald/intent-parser";
import { GM_DIRECTOR_SYSTEM_PROMPT, buildGmDecisionPrompt } from "../conversation/gm-prompt.js";
import type { GmContextBundle } from "../conversation/gm-context.js";
import type { MasterTurnGatewayOutcome, MasterTurnSnapshot } from "./master-turn-gateway.js";
import { bindSceneSurface } from "./master-turn-validator.js";

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
  /** Sanitized provider failure details; raw messages and bodies are excluded. */
  readonly providerFailure?: ProviderRequestFailure | undefined;
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
  /**
   * Optional single-flight registry owned by the caller (never a hidden
   * global): concurrent calls with the SAME turnKey share one provider call.
   * Omit it for no dedup (tests, one-shot scripts).
   */
  readonly flight?: GmDirectorFlight | undefined;
}

/**
 * Extract a structured provider failure through the router's bounded Error.cause
 * chain. ProviderUnavailableError often wraps the original request failure;
 * diagnostics need the inner status without retaining arbitrary error text.
 */
function providerFailureFromError(error: unknown): ProviderRequestFailure | undefined {
  let current: unknown = error;
  let provider: ProviderId | undefined;
  let model: string | undefined;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current instanceof ProviderUnavailableError) {
      provider ??= current.provider;
      model ??= current.model;
      if (current.cause === undefined || current.cause === current) return undefined;
      current = current.cause;
      continue;
    }
    if (current instanceof ProviderRequestError) return toProviderFailure(current) ?? undefined;
    if (current instanceof Error && current.cause !== undefined && current.cause !== current) {
      current = current.cause;
      continue;
    }
    return toProviderFailure(current, {
      ...(provider ? { provider } : {}),
      ...(model ? { model } : {}),
      category: "interpret",
    }) ?? undefined;
  }
  return undefined;
}

/**
 * Single-flight registry: turnKey → the in-flight (or just-settled) director
 * call. Owned by the runtime that serves requests; entries are removed as
 * soon as the promise settles, so the map never caches results — it only
 * collapses concurrency.
 */
export type GmDirectorFlight = Map<string, Promise<GmDirectorResult>>;

/** Creates an empty single-flight registry for one runtime/server. */
export function createGmDirectorFlight(): GmDirectorFlight {
  return new Map();
}

export type GmDirectorResult =
  | { readonly status: "decision"; readonly decision: GmTurnDecision; readonly trace: GmDirectorTrace; readonly shared?: boolean }
  | { readonly status: "fallback"; readonly reason: string; readonly trace: GmDirectorTrace; readonly shared?: boolean };

/** Bounded live interpretation budget; invalid configuration retains the 4s default. */
export function gmDirectorLiveTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.GM_DIRECTOR_LIVE_TIMEOUT_MS;
  if (raw === undefined || !/^[1-9][0-9]*$/u.test(raw)) return 4_000;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1_000 && value <= 20_000 ? value : 4_000;
}

/** Best-effort JSON object extraction from a model reply (never throws). */
export function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === "{") depth += 1;
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
 * Closed normalization of two observed wire aliases: addressee strings for
 * `gm`/`meta`, and a plain clarification string instead of `{ question }`.
 * The normalized result still goes through the full contract validator; this
 * does not relax semantic, handle, or field validation.
 */
export function normalizeDecisionShape(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const decision = raw as Record<string, unknown>;
  const addressee = decision["addressee"];
  let normalized = decision;
  if (typeof addressee === "string") {
    const token = addressee.trim().toLowerCase();
    if (token === "gm" || token === "мастер" || token === "master") {
      normalized = { ...normalized, addressee: { kind: "gm" } };
    } else if (token === "meta" || token === "система" || token === "system") {
      normalized = { ...normalized, addressee: { kind: "meta" } };
    }
  }
  const clarification = normalized["clarification"];
  if (normalized["kind"] === "clarification" && typeof clarification === "string") {
    const question = clarification.trim();
    if (question.length > 0) normalized = { ...normalized, clarification: { question } };
  }
  return normalized === decision ? raw : normalized;
}

/**
 * Single-flight entry point: concurrent calls with the same `turnKey` share
 * ONE provider call (the follower receives the leader's result marked
 * `shared: true` so it can skip duplicate diagnostics). Without a `flight`
 * registry this is a direct pass-through.
 */
export async function interpretGmDecision(input: GmDirectorInput): Promise<GmDirectorResult> {
  const flight = input.flight;
  if (!flight) return interpretGmDecisionOnce(input);
  // Defense in depth: scope by the replica TEXT as well as the caller's
  // turnKey, so one shared registry can never serve the same key to two
  // different requests (cross-world or changed-text collisions).
  const flightKey = `${input.turnKey}|${createHash("sha256").update(input.input).digest("hex").slice(0, 16)}`;
  const existing = flight.get(flightKey);
  if (existing) {
    const shared = await existing;
    return { ...shared, shared: true };
  }
  const leader = interpretGmDecisionOnce(input);
  // Track the SETTLED promise (never rejects in practice: provider errors are
  // mapped to fallbacks) and always release the key on settle.
  const tracked = leader.finally(() => { flight.delete(flightKey); });
  flight.set(flightKey, tracked);
  return tracked;
}

/** Run one director interpretation. Pure side-effect free with respect to the world. */
async function interpretGmDecisionOnce(input: GmDirectorInput): Promise<GmDirectorResult> {
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
    providerFailure?: ProviderRequestFailure;
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
  let providerStartedAt = Date.now();
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: GM_DIRECTOR_SYSTEM_PROMPT },
      { role: "user", content: buildGmDecisionPrompt(input.input, input.context) },
    ];
    providerStartedAt = Date.now();
    const response = await input.router.chat("interpret", messages, {
      dataClass: "player_input",
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      priority: "interactive",
    });
    trace.providerLatencyMs = Date.now() - providerStartedAt;
    // Attribution: which provider/model actually answered (ChatResult fields
    // are sanitized ids, never keys or prompts).
    trace.provider = response.provider;
    trace.model = response.model;
    trace.usedFallback = response.usedFallback;
    if (response.tier !== undefined) trace.tier = response.tier;
    replyText = typeof response.text === "string" ? response.text : "";
  } catch (error) {
    trace.providerLatencyMs = Date.now() - providerStartedAt;
    const providerFailure = providerFailureFromError(error);
    if (providerFailure) {
      trace.providerFailure = Object.freeze({ ...providerFailure });
      trace.provider = providerFailure.provider;
      trace.model = providerFailure.model;
    }
    // Keep sanitized ids even for legacy errors without structured metadata.
    const err = error as { provider?: unknown; model?: unknown };
    if (!trace.provider && typeof err?.provider === "string") trace.provider = err.provider.slice(0, 40);
    if (!trace.model && typeof err?.model === "string") trace.model = err.model.slice(0, 80);
    return fallback("provider_error");
  }

  const parsed = extractJsonObject(replyText);
  if (!parsed) return fallback("shape:not_json");

  // Raw compliance (no server-side alias applied) vs compliance after the
  // closed normalization; only the normalized form may become a decision.
  const validationOptions = {
    allowedHandles: input.handleKeys,
    allowedActorHandles: input.context.actors.map((actor) => actor.handle),
    allowedFactIds: input.context.knownFacts.map((fact) => fact.factId),
    allowedNpcFacts: input.context.npcFacts.map(({ factId, subjectHandle }) => ({ factId, subjectHandle })),
  };
  const rawValidation = validateGmTurnDecision(parsed, validationOptions);
  trace.rawSchemaValid = rawValidation.ok;

  const normalized = normalizeDecisionShape(parsed);
  const validated = validateGmTurnDecision(normalized, validationOptions);
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

/** Live-conversation flag (P3): the director may translate decisions into gateway outcomes. */
export function gmDirectorLiveEnabled(): boolean {
  const value = process.env["GM_DIRECTOR_LIVE"];
  return value === "1" || value === "true" || value === "on";
}

const REPEAT_REQUEST_PATTERN = /(?:повтори|повторить|скажи\s+заново|скажи\s+еще\s+раз|что\s+ты\s+(?:только\s+что\s+|сейчас\s+)?(?:сказал|говорил|ответил))/iu;
const EXPLICIT_SPEECH_DIRECTIVE = /^(?:спроси|спросить|спрошу|спросишь|спросит|спросим|скажи|сказать|обратись|обратиться|позови|позвать|окликни|окликнуть)\b/iu;

function isSafeRenderedDossierText(text: string): boolean {
  return text.trim().length > 0
    && !/(?:person|object|route|location)_[a-z0-9_-]+|contact:[a-z0-9:_-]+|\b(?:targetRef|internalId|locationId|observerRef)\b|\be[a-f0-9]{12}\b/iu.test(text);
}

/** Closed social-act phrasing for NPC/master drafts (single source). */
const SOCIAL_PHRASES = {
  greeting: "Здравствуй.",
  farewell: "До встречи.",
  thanks: "Спасибо.",
  gratitude_acknowledgement: "Пожалуйста.",
  acknowledge: "Я тебя слышу.",
  ask_topic: "О чём ты хочешь поговорить?",
  no_knowledge: "У меня нет подтверждённых сведений об этом.",
  no_commitment: "Я не могу обещать, что это будет сделано.",
} as const;

/** Closed part-scoped gap: this question part has no eligible answer. */
const QUESTION_PART_GAP_TEXT = "Об этом я не могу сказать ничего определённого.";

/** Punctuation- and case-insensitive text normalization for containment checks. */
function normalizeReplicaText(value: string): string {
  return value.toLowerCase().replace(/ё/gu, "е").replace(/[^a-zа-я0-9]+/gu, " ").trim();
}

function normContains(outer: string, inner: string): boolean {
  const normalizedOuter = normalizeReplicaText(outer);
  const normalizedInner = normalizeReplicaText(inner);
  return normalizedInner.length > 0 && normalizedOuter.includes(normalizedInner);
}

/**
 * A conservative necessary check, not a proof of semantic entailment: a
 * selected free-text dossier fact must retain the content words of the
 * player's question. Unsupported paraphrases clarify until structured
 * question/fact bindings can establish their relationship (P7).
 */
export function npcFactsCoverQuestion(question: string, facts: readonly string[]): boolean {
  const words = (value: string) => value.toLowerCase().replace(/ё/gu, "е").match(/[а-яa-z0-9]+/giu) ?? [];
  const stop = new Set([
    // closed question-word list
    "кого", "кому", "какой", "какая", "какое", "какие", "почему", "зачем", "сколько", "куда", "откуда", "когда", "есть", "этого", "этой", "этом", "этот", "вашего", "вашей",
    // closed request-frame verbs: the frame of a question is not its topic
    "расскажи", "расскажите", "рассказать", "поведай", "поведайте", "поведать", "скажи", "скажите", "сказать", "объясни", "объясните", "объяснить", "опиши", "опишите", "описать", "покажи", "покажите", "показать", "просвети", "просветить", "спросить", "спроси", "спросите", "хочу", "хотел", "хотелбы", "узнать", "поподробнее", "подробнее",
  ]);
  const topicWords = words(question).filter((word) => word.length >= 4 && !stop.has(word));
  const factWords = facts.flatMap(words);
  return topicWords.length > 0 && topicWords.every((word) => factWords.some((factWord) => sameRussianStem(word, factWord)));
}

/** Closed motivation markers: the fragment asks for a REASON. */
// NOTE: JavaScript \b is ASCII-only and never matches beside Cyrillic
// letters, so every boundary here is spelled as an explicit lookaround.
const MOTIVATION_QUESTION_RE = /(?<![а-яё])(?:почему|зачем|отчего)(?![а-яё-])/iu;
/** Closed causal markers an authored fact may use to state a reason. */
const CAUSAL_FACT_RE = /(?<![а-яё])(?:потому|чтобы|ради|причин(?:а|ы|е|у|ой|ам))(?![а-яё])/iu;
/** Closed past-time markers: the fragment asks about a PAST state/event. */
const HISTORICAL_QUESTION_RE = /(?<![а-яё])(?:вчера|позавчера|прошл\w+|давно|раньше|когда-то|в\s+тот\s+день)(?![а-яё])/iu;
/** A who-question about someone other than the addressee's own identity. */
const WHO_ABOUT_OTHERS_RE = /^\s*(?:а\s+)?(?:кто|кого|кому|кем)(?![а-яё-])/iu;
const WHO_ABOUT_ADDRESSEE_RE = /(?<![а-яё])(?:кто\s+ты|ты\s+кто|кем\s+ты|кто\s+такой)(?![а-яё])/iu;
/** Closed self-reference markers: the fact names the addressee as the answer. */
const SELF_REFERENCE_FACT_RE = /(?<![а-яё])(?:я|меня|мне|мною|мой|моя|моё|мои)(?![а-яё])/iu;

function namesPersonToken(factText: string): boolean {
  const tokens = factText.split(/\s+/u).slice(1);
  return tokens.some((token) => /^[А-ЯЁ][а-яё]/u.test(token));
}

/**
 * Aspect-level necessary check (P3 anti-substitution): matching the topic
 * words is necessary but NOT sufficient. A public dossier fact states what
 * IS; it cannot fabricate a REASON, recall a PAST event, or invent the PERSON
 * a who-question asks about. The closed exceptions keep the check honest in
 * both directions:
 * - a motivation fragment is answerable only by an explicitly causal fact;
 * - a past-time fragment is answerable by nothing in the current public
 *   dossier slice (authored history facts arrive with the P5 voice work);
 * - a who-about-others fragment is answerable only by a fact that names the
 *   addressee itself or a proper-name token.
 * Deterministic and pure; never a proof of full entailment (P7 remains open).
 */
export function npcFactAspectAllows(question: string, factText: string): boolean {
  if (MOTIVATION_QUESTION_RE.test(question) && !CAUSAL_FACT_RE.test(factText)) return false;
  if (HISTORICAL_QUESTION_RE.test(question)) return false;
  if (WHO_ABOUT_OTHERS_RE.test(question.trim()) && !WHO_ABOUT_ADDRESSEE_RE.test(question)) {
    if (!SELF_REFERENCE_FACT_RE.test(factText) && !namesPersonToken(factText)) return false;
  }
  return true;
}

/** Whether ONE dossier fact can be presented as an answer to the question. */
export function npcFactAnswersQuestion(question: string, factText: string): boolean {
  return npcFactsCoverQuestion(question, [factText]) && npcFactAspectAllows(question, factText);
}

/** Whether any of the addressee's eligible facts answers the question. */
export function npcFactsAnswerQuestion(question: string, facts: readonly string[]): boolean {
  return facts.some((text) => npcFactAnswersQuestion(question, text));
}

/**
 * On provider failure, answer an explicitly addressed NPC question with an
 * honest lack-of-evidence response only when the observer-safe dossier has no
 * fact that covers the question. A unique current-scene binding is required;
 * ambiguity and questions supported by dossier facts remain with the normal
 * degraded-path clarification.
 */
export function fallbackForUnsupportedAddressedNpcQuestion(
  input: string,
  bundle: GmContextBundle,
  snapshot: MasterTurnSnapshot,
): MasterTurnGatewayOutcome | null {
  const speechQuestion = /^\s*(?:спросить|спроси|спросите|спрошу|спрашиваю|расспросить|расспрошу|поинтересоваться|поинтересуюсь)\s+(?:у\s+)?([^,!?;—:]{2,100})\s*[,—:]\s*(.+)$/iu.exec(input);
  const addressed = speechQuestion ?? /^\s*(?:эй\b[\s,]+)?([^,!?;—:]{2,100})\s*[,—:]\s*(.+)$/iu.exec(input);
  const target = addressed?.[1]?.trim();
  const question = addressed?.[2]?.trim();
  if (!target || !question || !/[?？]/u.test(question)) return null;

  const binding = bindSceneSurface(target, snapshot.scene.context.knownPeople.map((person) => ({
    observerRef: person.observerRef,
    label: person.label,
    knownAs: person.knownAs,
    addressForms: person.portrait?.addressForms ?? [],
  })));
  if (binding.status !== "unique") return null;
  const handle = [...bundle.handleToObserverRef].find(([, ref]) => ref === binding.entry.observerRef)?.[0];
  if (!handle) return null;
  const availableFacts = bundle.context.npcFacts
    .filter((fact) => fact.subjectHandle === handle)
    .map((fact) => fact.text);
  if (npcFactsAnswerQuestion(question, availableFacts)) return null;

  return applyGmDirectorDecision({
    schemaVersion: 2,
    addressee: { kind: "npc", handle },
    kind: "conversation",
    response: { segments: [{ kind: "social", act: "no_knowledge" }] },
  }, bundle, input, snapshot);
}

/**
 * Read-only P3 adapter. Structured action/question proposals are bound and
 * validated by the gateway through the existing V2 pipeline, not here.
 * Clarifications expose only scene-allowed candidates; conversation drafts
 * render a closed fact selection or non-factual social acts without a second
 * model call. NPC disclosures are limited to eligible dossier facts owned by
 * the exact visible addressee.
 */
export function applyGmDirectorDecision(
  decision: GmTurnDecision,
  bundle: GmContextBundle,
  input: string,
  snapshot: MasterTurnSnapshot,
): MasterTurnGatewayOutcome | null {
  const revision = Object.freeze({
    worldTime: snapshot.world.time,
    eventNumber: snapshot.world.eventNumber,
  });
  const clauses = classifyReplicaClauses(input, parseIntent);
  const classification = classifyPlayerInput(input, parseIntent);
  const singleInquiry = clauses.actions.length === 0
    && clauses.unknown.length === 0
    && clauses.inquiries.length === 1
    ? clauses.inquiries[0]!.inquiry
    : null;

  const resolveHandlePerson = (handle: VisibleActorKey | undefined) => {
    if (!handle) return null;
    const observerRef = bundle.handleToObserverRef.get(handle);
    if (!observerRef) return null;
    const person = snapshot.scene.context.knownPeople.find((entry) => entry.observerRef === observerRef);
    if (!person) return null;
    return { observerRef: person.observerRef, label: person.label };
  };

  const asReadOnlyInquiry = (subjectHandle?: VisibleActorKey): MasterTurnGatewayOutcome | null => {
    if (!singleInquiry) return null;
    const subject = subjectHandle ? resolveHandlePerson(subjectHandle) : null;
    if (subjectHandle && !subject) return null;
    if (subjectHandle) {
      const explicitFocus = singleInquiry.focus?.surface;
      if (!explicitFocus) return null;
      const boundFocus = bindSceneSurface(explicitFocus, snapshot.scene.context.knownPeople.map((person) => ({
        observerRef: person.observerRef,
        label: person.label,
        knownAs: person.knownAs,
        addressForms: person.portrait?.addressForms ?? [],
      })));
      if (boundFocus.status !== "unique" || boundFocus.entry.observerRef !== subject?.observerRef) return null;
    }
    return {
      status: "inquiry",
      inquiry: Object.freeze({
        ...singleInquiry,
        rawText: input,
        source: "llm" as const,
        ...(subject
          ? { focus: Object.freeze({ observerRef: subject?.observerRef, surface: subject.label }) }
          : {}),
      }),
    };
  };

  const explicitQuestionAddress = (text: string) => {
    const speechQuestion = /^\s*(?:спросить|спроси|спросите|спрошу|спрашиваю|расспросить|расспрошу|поинтересоваться|поинтересуюсь)\s+(?:у\s+)?([^,!?;—:]{2,100})\s*[,—:]\s*(.+)$/iu.exec(text);
    const match = speechQuestion ?? /^\s*(?:эй\b[\s,]+)?([^,!?;—:]{2,100})\s*[,—:]\s*(.+)$/iu.exec(text);
    if (!match) return null;
    const entries = snapshot.scene.context.knownPeople.map((person) => ({
      observerRef: person.observerRef,
      label: person.label,
      knownAs: person.knownAs,
      addressForms: person.portrait?.addressForms ?? [],
    }));
    return {
      binding: bindSceneSurface(match[1]!.trim(), entries),
      questionText: match[2]!.trim(),
      speechWrapped: speechQuestion !== null,
    };
  };

  const isSingleUnregisteredQuestion = (text: string): boolean => {
    if (classifyPlayerInput(text, parseIntent).kind !== "inquiry_candidate") return false;
    const questionClauses = classifyReplicaClauses(text, parseIntent);
    return questionClauses.actions.length === 0
      && questionClauses.inquiries.length === 0
      && questionClauses.unknown.length === 1;
  };

  /**
   * P3 multi-part NPC question (ADR-0028 amendment). The model proposes the
   * question STRUCTURE (parts + verbatim replica fragments + which eligible
   * fact or explicit gap answers which part); this adapter owns the truth:
   * the addressee is grounded exactly like the single-question bridge; the
   * fragments must be real, ordered, non-overlapping spans of the QUESTION
   * PORTION of the replica; every question-like clause of that portion must
   * be covered (a lost question part rejects the whole decision); and every
   * fact binding must pass the per-part word+aspect meaning check or degrade
   * to an honest part-scoped gap. One composed NPC reply, zero Domain
   * Events, zero time. Any violation returns null (fail closed).
   */
  const multiPartConversationOutcome = (): MasterTurnGatewayOutcome | null => {
    const plan = decision.questionPlan;
    if (!plan || decision.addressee.kind !== "npc") return null;
    // Extracted before any closure: narrowing of a union field does not
    // survive into callbacks below.
    const addresseeHandle: VisibleActorKey = decision.addressee.handle;
    const speaker = resolveHandlePerson(addresseeHandle);
    const reference = speaker ? snapshot.scene.references.get(speaker.observerRef) : null;
    if (!speaker || !reference) return null;

    // Address grounding is shared with the single-question bridge: an
    // explicit address before a comma/dash, or a speech directive wrapper.
    // The whole-replica classification gate mirrors that bridge too.
    if (classification.kind !== "inquiry_candidate" && classification.kind !== "speech") return null;
    const addressInfo = explicitQuestionAddress(input);
    if (!addressInfo) return null;
    if (!addressInfo.speechWrapped
      && !(addressInfo.binding.status === "unique" && addressInfo.binding.entry.observerRef === speaker.observerRef)) return null;
    const questionStart = input.indexOf(addressInfo.questionText);
    if (questionStart < 0) return null;

    // The question portion is analyzed on its own: an executable action or a
    // registered world inquiry inside it keeps its own path and must not be
    // silently re-scoped to NPC dossier facts. Unresolved discourse frames
    // («расскажите про…», «скажи…») are tolerated only when a fragment
    // grounds them, exactly like the fallback conversation path.
    const questionPortion = input.slice(questionStart);
    const portionClauses = classifyReplicaClauses(questionPortion, parseIntent);
    const executablePortionAction = portionClauses.actions.some(({ intent }) =>
      intent.type === "InteractionCommand"
      || intent.type === "JourneyIntent"
      || (intent.type === "ActionIntentCommand" && intent.operation !== "unknown" && intent.operation !== "speak" && intent.operation !== "call"));
    if (executablePortionAction || portionClauses.inquiries.length > 0) return null;
    const portionFrames = portionClauses.actions
      .filter(({ intent }) => intent.type === "ActionIntentCommand"
        && (intent.operation === "unknown" || intent.operation === "speak" || intent.operation === "call"))
      .map(({ text }) => text);

    // Fragments are verbatim, ordered, non-overlapping spans of the question
    // portion, in replica order.
    const spans: { readonly partId: string; readonly start: number; readonly end: number; readonly text: string }[] = [];
    for (const fragment of plan.fragments) {
      const start = input.indexOf(fragment.text);
      if (start < 0 || fragment.text.trim().length === 0 || start < questionStart) return null;
      const end = start + fragment.text.length;
      if (spans.some((span) => start < span.end && end > span.start)) return null;
      spans.push({ partId: fragment.partId, start, end, text: fragment.text });
    }
    spans.sort((left, right) => left.start - right.start);

    // Coverage: every question-like clause of the portion must be covered by
    // a fragment (nothing asked may be dropped); tolerated discourse frames
    // must be grounded the same way; other unknown clauses are accounted for
    // only when a fragment covers them or they sit before the first question
    // fragment, so nothing said is silently lost.
    const preambleEnd = spans[0]!.start;
    for (const clause of [...portionClauses.unknown, ...portionFrames]) {
      const covered = spans.some((span) => normContains(clause, span.text) || normContains(span.text, clause));
      if (covered) continue;
      if (isQuestionLikeInput(clause) || /[?？]/u.test(clause)) return null;
      const clauseStart = questionPortion.indexOf(clause);
      if (clauseStart < 0 || clauseStart + clause.length > preambleEnd - questionStart) return null;
    }

    // Preamble segments: social acts only, rendered before the answers.
    const preambleSegments = decision.response!.segments.filter((segment) => !("partId" in segment));
    if (preambleSegments.some((segment) => segment.kind !== "social")) return null;
    const preambleTexts = preambleSegments.flatMap((segment) => segment.kind === "social" ? [SOCIAL_PHRASES[segment.act]] : []);

    // Per-part answers, in replica order: a bound fact that passes the
    // word+aspect check renders verbatim; otherwise the part degrades to an
    // explicit gap; a part with neither a binding nor a gap is a lost
    // question and rejects the whole decision.
    const partTexts: string[] = [];
    for (const span of spans) {
      const partSegments = decision.response!.segments.filter((segment) => "partId" in segment && segment.partId === span.partId);
      if (partSegments.length === 0) return null;
      let explicitGap = false;
      const factTexts: string[] = [];
      for (const segment of partSegments) {
        if (segment.kind === "social") {
          if (segment.act !== "no_knowledge") return null;
          explicitGap = true;
          continue;
        }
        const fact = bundle.context.npcFacts.find((entry) => entry.factId === segment.factId
          && entry.subjectHandle === addresseeHandle);
        if (!fact || !isSafeRenderedDossierText(fact.text)) return null;
        factTexts.push(fact.kind === "npc_belief" ? "Я считаю: " + fact.text : fact.text);
      }
      const answeringFacts = factTexts.filter((text) => npcFactAnswersQuestion(span.text, text));
      if (answeringFacts.length > 0) {
        partTexts.push(answeringFacts.join(" "));
      } else if (explicitGap || factTexts.length > 0) {
        // A bound fact that fails the per-part meaning check is a
        // substitution attempt: degrade the part to an honest gap instead
        // of dropping the OTHER answered parts with it.
        partTexts.push(QUESTION_PART_GAP_TEXT);
      } else {
        // No binding and no explicit gap: the model dropped a question part
        // the player asked. Never render a partial answer.
        return null;
      }
    }

    const text = [...preambleTexts, ...partTexts].join(" ").trim();
    if (!text || /(?:person|object|route|location)_[a-z0-9_-]+|\be[a-f0-9]{12}\b/iu.test(text)) return null;
    return {
      status: "conversation",
      text: speaker.label + ": «" + text + "»",
      revision,
      speaker: { observerRef: speaker.observerRef, label: speaker.label, internalId: reference.internalId },
    };
  };

  if (decision.kind === "clarification" && decision.clarification) {
    // A clarification executes nothing. Physical/unsupported action wording
    // must not discard a validated question and trigger a second parser/model
    // path; exact safe commands are protected by the gateway fast path.
    if (clauses.inquiries.length > 1) return null;
    const question = decision.clarification.question.trim();
    // Do not forward malformed or internal-looking text into the player UI.
    if (!question || question.length > 360 || /(?:person|object|route|location)_[a-z0-9_-]+|\be[a-f0-9]{12}\b/iu.test(question)) return null;
    const handles = decision.clarification.candidateHandles ?? [];
    if (new Set(handles).size !== handles.length) return null;
    const candidates: { readonly handle: VisibleActorKey; readonly observerRef: string; readonly label: string; readonly description: string }[] = [];
    for (const handle of handles) {
      const person = resolveHandlePerson(handle);
      if (!person) return null;
      const actor = bundle.context.actors.find((entry) => entry.handle === handle);
      candidates.push({
        handle,
        observerRef: person.observerRef,
        label: person.label,
        description: actor?.visibleDescription.trim() ?? "",
      });
    }
    const labelCounts = new Map<string, number>();
    for (const candidate of candidates) {
      const key = candidate.label.trim().toLowerCase().replace(/ё/gu, "е");
      labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
    }
    const options: ClarificationOption[] = candidates.map((candidate, index) => {
      const key = candidate.label.trim().toLowerCase().replace(/ё/gu, "е");
      const duplicate = (labelCounts.get(key) ?? 0) > 1;
      const sameDescription = candidates.filter((other) => other.label === candidate.label && other.description === candidate.description).length > 1;
      const label = duplicate
        ? candidate.description && !sameDescription
          ? candidate.label + " — " + candidate.description
          : candidate.label + " (вариант " + (index + 1) + ")"
        : candidate.label;
      return Object.freeze({
        optionId: "candidate-" + (index + 1),
        label,
        referentRefs: Object.freeze([candidate.observerRef]),
      });
    });
    options.push(Object.freeze({ optionId: "rephrase", label: "Уточнить намерение" }));
    return { status: "clarification", question, options: Object.freeze(options) };
  }

  if (decision.kind === "world_question") {
    // The legacy inquiry adapter must not turn a free-form "who" question
    // into a place-knowledge dump just because clause classification found
    // that broad registered query. Let the gateway clarify instead.
    if (singleInquiry?.queryId === "known_place_knowledge"
      && /^(?:а\s+)?(?:кто|кого|кому|кем)\b/iu.test(input.trim())) return null;
    return asReadOnlyInquiry(decision.subjectHandle);
  }

  if (decision.kind === "conversation" && decision.response) {
    // A draft cannot erase a deterministically understood question/action.
    // Keep the same whole-replica discipline as the V2 proposal path.
    const explicitAddress = classification.kind === "inquiry_candidate" || classification.kind === "speech"
      ? explicitQuestionAddress(input)
      : null;
    if (explicitAddress && (explicitAddress.speechWrapped || explicitAddress.binding.status !== "absent")
      && isSingleUnregisteredQuestion(explicitAddress.questionText)) {
      if (decision.addressee.kind !== "npc" || explicitAddress.binding.status !== "unique") return null;
      const addressedHandle = decision.addressee.handle;
      const speaker = resolveHandlePerson(addressedHandle);
      const reference = speaker ? snapshot.scene.references.get(speaker.observerRef) : null;
      const responseIsClosedNoKnowledge = decision.response.segments.length === 1
        && decision.response.segments[0]?.kind === "social"
        && decision.response.segments[0].act === "no_knowledge";
      const selectedNpcFactIds = decision.response.segments.flatMap((segment) => segment.kind === "npc_fact" ? [segment.factId] : []);
      const responseIsClosedNpcDisclosure = selectedNpcFactIds.length === decision.response.segments.length
        && selectedNpcFactIds.length > 0
        && new Set(selectedNpcFactIds).size === selectedNpcFactIds.length;
      if (!speaker
        || !reference
        || explicitAddress.binding.entry.observerRef !== speaker.observerRef
        || !isSingleUnregisteredQuestion(explicitAddress.questionText)
        || (!responseIsClosedNoKnowledge && !responseIsClosedNpcDisclosure)) return null;
      if (responseIsClosedNoKnowledge) {
        return {
          status: "conversation",
          text: speaker.label + ": «У меня нет подтверждённых сведений об этом.»",
          revision,
          speaker: { observerRef: speaker.observerRef, label: speaker.label, internalId: reference.internalId },
        };
      }
      const disclosedFacts: string[] = [];
      for (const factId of selectedNpcFactIds) {
        const fact = bundle.context.npcFacts.find((entry) => entry.factId === factId
          && entry.subjectHandle === addressedHandle);
        if (!fact || !isSafeRenderedDossierText(fact.text)) return null;
        disclosedFacts.push(fact.kind === "npc_belief" ? "Я считаю: " + fact.text : fact.text);
      }
      if (!npcFactsAnswerQuestion(explicitAddress.questionText, disclosedFacts)) {
        // The NPC has no fact that answers this question — either no topic
        // overlap, or the overlap is aspect-insufficient (a plain state fact
        // cannot stand in for a reason, a past event or a who). Do not turn
        // an unrelated but valid dossier fact into an answer or send the
        // player back into a generic clarification loop: fail closed as an
        // honest in-character lack of knowledge.
        return {
          status: "conversation",
          text: speaker.label + ": «У меня нет подтверждённых сведений об этом.»",
          revision,
          speaker: { observerRef: speaker.observerRef, label: speaker.label, internalId: reference.internalId },
        };
      }
      return {
        status: "conversation",
        text: speaker.label + ": «" + disclosedFacts.join(" ") + "»",
        revision,
        speaker: { observerRef: speaker.observerRef, label: speaker.label, internalId: reference.internalId },
      };
    }
    if (decision.questionPlan) return multiPartConversationOutcome();
    if (singleInquiry) return asReadOnlyInquiry();
    const explicitSpeechAction = clauses.actions.some(({ intent }) =>
      intent.type === "ActionIntentCommand" && (intent.operation === "speak" || intent.operation === "call"));
    if (explicitSpeechAction && EXPLICIT_SPEECH_DIRECTIVE.test(input.trim())) return null;
    if (classification.kind === "inquiry_candidate") {
      const hasBoundAnswer = decision.response.segments.length > 0
        && decision.response.segments.every((segment) => segment.kind === "fact"
          || segment.kind === "npc_fact"
          || (segment.kind === "social" && segment.act === "no_knowledge"));
      if (decision.addressee.kind !== "gm" || !hasBoundAnswer) return null;
    }
    if (clauses.inquiries.length > 0 || clauses.actions.some(({ intent }) =>
      intent.type !== "ActionIntentCommand" || (intent.operation !== "unknown" && intent.operation !== "speak" && intent.operation !== "call"))) return null;
    const speaker = decision.addressee.kind === "npc" ? resolveHandlePerson(decision.addressee.handle) : null;
    if (decision.addressee.kind === "npc" && !speaker) return null;
    const parts: string[] = [];
    for (const segment of decision.response.segments) {
      if (segment.kind === "social") parts.push(SOCIAL_PHRASES[segment.act]);
      else {
        if (speaker || segment.kind === "npc_fact") return null;
        const fact = bundle.context.knownFacts.find((entry) => entry.factId === segment.factId);
        if (!fact) return null;
        parts.push(fact.text);
      }
    }
    const text = parts.join(" ");
    if (!text || /(?:person|object|route|location)_[a-z0-9_-]+|\be[a-f0-9]{12}\b/iu.test(text)) return null;
    const reference = speaker ? snapshot.scene.references.get(speaker.observerRef) : null;
    if (speaker && !reference) return null;
    return {
      status: "conversation",
      text: speaker ? speaker.label + ": «" + text + "»" : text,
      revision,
      ...(speaker && reference ? { speaker: { observerRef: speaker.observerRef, label: speaker.label, internalId: reference.internalId } } : {}),
    };
  }

  if (decision.kind === "conversation" && (decision.addressee.kind === "gm" || decision.addressee.kind === "meta")) {
    if (REPEAT_REQUEST_PATTERN.test(input.toLowerCase().replace(/ё/gu, "е"))) {
      return {
        status: "plan",
        plan: Object.freeze({
          contextRevision: revision,
          kind: "meta" as const,
          execution: null,
          postActionInquiries: Object.freeze([]),
          metaInquiry: Object.freeze({ type: "MetaRequest" as const, operation: "repeat_last_answer" as const }),
          deferredClauses: Object.freeze([]),
          focus: Object.freeze([]),
          goal: null,
          conversationRelation: null,
        }),
        scene: snapshot.scene,
      };
    }
    return asReadOnlyInquiry();
  }

  return null;
}
