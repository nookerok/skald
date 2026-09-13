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
  isUnresolvedFocusSurface,
  parseIntent,
  sameRussianStem,
  validateActionProposal,
  validateTurnProposal,
  type ExecutableIntent,
  type InquiryRequest,
  type PlayerInputClassification,
  type TurnConversationRelation,
} from "@skald/intent-parser";
import type { AIDiagnosticSink, ChatMessage, MasterTurnSceneContext, MasterTurnSceneSnapshot, ModelRouter, ReadonlyWorld } from "@skald/world";
import { describeConversationContext, type MasterConversationContext } from "../conversation/context-builder.js";
import { bindTurnPronouns, type PronounBinding } from "../conversation/focus-stack.js";
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
    readonly relation?: TurnConversationRelation | null | undefined;
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

type PronounStep =
  | { readonly kind: "same" }
  | {
    readonly kind: "rewritten";
    readonly input: string;
    readonly classification: PlayerInputClassification;
    readonly deterministic: ReturnType<typeof parseIntent>;
  }
  | { readonly kind: "inquiry"; readonly inquiry: InquiryRequest }
  | { readonly kind: "clarification"; readonly outcome: MasterTurnGatewayOutcome };

/** Prepositions stripped before testing whether a target is a bare pronoun. */
const PRONOUN_TARGET_PREPOSITIONS = /^(?:к|ко|в|во|на|у|о|об|от|до|по|про|с|со|из|за|под|над|перед|между|через|для)\s+/iu;

/** Returns the pronoun surface when the whole target is one, else null. */
function pronounTargetSurface(targetRaw: string | undefined): string | null {
  if (!targetRaw) return null;
  const stripped = targetRaw.trim().replace(/[?!.,;:]+$/u, "").replace(PRONOUN_TARGET_PREPOSITIONS, "").trim();
  if (!stripped || stripped.includes(" ") || !isUnresolvedFocusSurface(stripped)) return null;
  return stripped;
}

/**
 * True when the deterministic proposal addresses its referent only through
 * an unresolved pronoun surface. Such proposals must never execute via a
 * timeout/parse fallback: without a settled focus binding there is no
 * observer-safe referent to act on.
 */
function deterministicHasUnresolvedPronoun(deterministic: ReturnType<typeof parseIntent>): boolean {
  if (deterministic.type === "ActionIntentCommand" || deterministic.type === "InteractionCommand") {
    if (pronounTargetSurface(deterministic.target?.raw) !== null) return true;
    return false;
  }
  if (deterministic.type === "JourneyIntent") {
    return isUnresolvedFocusSurface(deterministic.destination.raw.trim().replace(/[?!.,;:]+$/u, ""));
  }
  return false;
}

/** Specific clarification for a pronoun-bearing proposal that lost its model path. */
function pronounFallbackClarification(): MasterTurnGatewayOutcome {
  return {
    status: "clarification",
    question: "Кого или что ты имеешь в виду? Назови явно.",
    options: rephraseOption(),
  };
}

/**
 * True when a mention surface names a scene person or object (stem word
 * match over labels and known aliases). Used for topic pronouns ("сделаю
 * это"): the recent mention usually means the discussed referent, not one
 * of the knowledge sentences, so the follow-up names it directly.
 */
function mentionNamesSceneReferent(surface: string, scene: MasterTurnSceneContext): boolean {
  const words = surface
    .toLowerCase()
    .replace(/ё/gu, "е")
    .split(/[^a-zа-я0-9]+/iu)
    .filter((word) => word.length > 0);
  if (words.length === 0) return false;
  const labels = [...scene.knownPeople, ...scene.visibleObjects, ...scene.accessibleItems]
    .flatMap((entry) => [entry.label, ...(entry.knownAs ?? [])]);
  return words.some((word) =>
    labels.some((label) =>
      label
        .toLowerCase()
        .replace(/ё/gu, "е")
        .split(/[^a-zа-я0-9]+/iu)
        .some((labelWord) => labelWord.length > 0 && sameRussianStem(word, labelWord)),
    ),
  );
}

/** Player-visible label for an observerRef, or null when it left the scene. */
function sceneLabelForRef(scene: MasterTurnSceneContext, observerRef: string): string | null {  const lists: ReadonlyArray<{ observerRef: string; label?: string; text?: string }> = [
    ...scene.knownPeople,
    ...scene.visibleObjects,
    ...scene.accessibleItems,
    ...scene.knownRoutes,
    ...scene.knownTopics,
  ];
  for (const entry of lists) {
    if (entry.observerRef === observerRef) {
      const label = (entry.label ?? (entry as { text?: unknown }).text);
      if (typeof label === "string" && label.trim().length > 0) return label.trim();
      return null;
    }
  }
  return null;
}

/** Replaces the first whole-word occurrence of a pronoun with a surface. Pronoun forms are closed-vocabulary lowercase letters, safe to inline. */
function substitutePronoun(input: string, pronoun: string, surface: string): string {
  return input.replace(new RegExp(`(^|[^\\p{L}\\p{N}_])${pronoun}($|[^\\p{L}\\p{N}_])`, "iu"), `$1${surface}$2`);
}

function rephraseOption(): readonly [{ readonly optionId: string; readonly label: string }] {
  return [{ optionId: "rephrase", label: "Уточнить намерение" }];
}

/**
 * Deterministic pronoun resolution before any model call. The focus stack
 * binds the replica's single pronoun group against the snapshot scene:
 * a settled binding rewrites the replica with its mention surface for the
 * LLM prompt (the caller keeps it off the fast path so validated plans
 * retain focus/goal/ambiguity metadata), or answers immediately when the
 * rewritten replica is a direct inquiry; an ambiguous binding asks a
 * specific question naming scene candidates — except a topic pronoun whose
 * mention names a scene person/object, which asks about that referent
 * instead of quoting knowledge sentences; a missing binding asks
 * specifically when the turn addresses it, and stays on the LLM path
 * inside larger compounds. Topic bindings on speak ask who to address,
 * other topics nudge with the named topic. Anything else (no pronouns,
 * several groups) returns same so the existing fast-path/LLM flow decides.
 */
function resolvePronounsDeterministic(
  input: string,
  classification: PlayerInputClassification,
  deterministic: ReturnType<typeof parseIntent>,
  snapshot: MasterTurnSnapshot,
  options?: MasterTurnGatewayOptions,
): PronounStep {
  const bindings = bindTurnPronouns(input, snapshot.conversation, snapshot.scene.context);
  if (bindings.length !== 1) return { kind: "same" };
  const binding: PronounBinding = bindings[0]!;
  const scene = snapshot.scene.context;

  if (binding.resolution === "ambiguous") {
    // A topic pronoun ("сделаю это") with a mention naming a scene
    // person/object means the discussed referent — not one of the knowledge
    // sentences. Ask about it with the same wording as a settled topic.
    if (
      binding.classes.length === 1
      && binding.classes[0] === "topic"
      && binding.mention
      && mentionNamesSceneReferent(binding.mention.surface, scene)
    ) {
      const surface = binding.mention.surface;
      const isSpeak = deterministic.type === "ActionIntentCommand" && deterministic.operation === "speak";
      const question = isSpeak
        ? `У кого спросить про «${surface}»? Назови, к кому обратиться.`
        : `«${surface}» — что именно ты хочешь сделать?`;
      emitMasterTurnDiagnostic(options?.diagnostics, {
        category: "pronoun_topic",
        outcome: "clarification",
        phase: "routing",
        correlationId: options?.correlationId,
        worldTime: options?.worldTime,
      });
      return { kind: "clarification", outcome: { status: "clarification", question, options: rephraseOption() } };
    }
    const labels = binding.candidates
      .map((candidate) => sceneLabelForRef(scene, candidate))
      .filter((label): label is string => label !== null)
      .slice(0, 3);
    if (labels.length === 0) return { kind: "same" };
    const hasPerson = binding.classes.includes("person");
    const hasThing = binding.classes.includes("thing");
    const question = hasPerson && !hasThing
      ? `К кому именно — ${labels.join(" или ")}?`
      : !hasPerson && hasThing
        ? `Что именно — ${labels.join(" или ")}?`
        : `Кого или что именно — ${labels.join(" или ")}?`;
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "pronoun_ambiguous",
      outcome: "clarification",
      phase: "routing",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
    });
    return { kind: "clarification", outcome: { status: "clarification", question, options: rephraseOption() } };
  }

  if (binding.resolution === "missing") {
    const hasPerson = binding.classes.includes("person");
    const hasThing = binding.classes.includes("thing");
    const hasTopic = binding.classes.includes("topic");
    const hasPlace = binding.classes.includes("place");
    // Person/thing pronouns inside a larger compound (e.g. "Подойду к ней
    // и осмотрюсь") stay on the LLM path so a valid ambient primary is not
    // lost; a sole pronoun target or a question still asks specifically.
    // Topic/place pronouns always name their follow-up directly.
    if (!hasTopic && !hasPlace) {
      const addressed = classification.kind === "action" || classification.kind === "speech"
        ? pronounTargetSurface(
          deterministic.type === "ActionIntentCommand" || deterministic.type === "InteractionCommand"
            ? deterministic.target?.raw
            : undefined,
        ) ?? (deterministic.type === "JourneyIntent" && isUnresolvedFocusSurface(deterministic.destination.raw.trim())
          ? deterministic.destination.raw.trim()
          : null)
        : null;
      if (!addressed && classification.kind !== "inquiry_candidate") return { kind: "same" };
    }
    const mention = binding.mention?.surface;
    const question = hasTopic
      ? mention
        ? `«${mention}» сейчас не о чем спросить. Что именно ты имеешь в виду?`
        : "Что именно ты имеешь в виду? Назови тему явно."
      : hasPlace
        ? "Куда именно? Назови направление или место."
        : mention
          ? `«${mention}» сейчас нет рядом. Кого ты имеешь в виду? Назови явно.`
          : hasPerson && !hasThing
            ? "Кого ты имеешь в виду? Назови, к кому обратиться."
            : !hasPerson && hasThing
              ? "Что именно ты имеешь в виду? Назови объект."
              : "Кого или что ты имеешь в виду? Назови явно.";
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "pronoun_missing",
      outcome: "clarification",
      phase: "routing",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
    });
    return { kind: "clarification", outcome: { status: "clarification", question, options: rephraseOption() } };
  }

  if (binding.resolution !== "single" || !binding.mention) return { kind: "same" };
  const surface = binding.mention.surface;

  // Topic bindings never rewrite an action: they name the follow-up question.
  if (binding.classes.length === 1 && binding.classes[0] === "topic") {
    const isSpeak = deterministic.type === "ActionIntentCommand" && deterministic.operation === "speak";
    const question = isSpeak
      ? `У кого спросить про «${surface}»? Назови, к кому обратиться.`
      : `«${surface}» — что именно ты хочешь сделать?`;
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "pronoun_topic",
      outcome: "clarification",
      phase: "routing",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
    });
    return { kind: "clarification", outcome: { status: "clarification", question, options: rephraseOption() } };
  }

  // Person/thing/place binding: does this turn actually address it?
  const targetSurface = classification.kind === "action" || classification.kind === "speech"
    ? pronounTargetSurface(
      deterministic.type === "ActionIntentCommand" || deterministic.type === "InteractionCommand"
        ? deterministic.target?.raw
        : undefined,
    )
    : null;
  const journeySurface = deterministic.type === "JourneyIntent" && isUnresolvedFocusSurface(deterministic.destination.raw.trim())
    ? deterministic.destination.raw.trim()
    : null;
  const pronounInTarget = targetSurface ?? journeySurface;
  const candidateQuestion = classification.kind === "inquiry_candidate";
  if (!pronounInTarget && !candidateQuestion) return { kind: "same" };

  const rewritten = substitutePronoun(input, binding.pronoun, surface);
  if (rewritten === input) return { kind: "same" };
  const next = classifyPlayerInput(rewritten, parseIntent);
  if (next.kind === "inquiry") {
    // A resolved pronoun may turn a candidate into a direct question
    // ("А что за ней?" → "А что за Ограда?"). Answer it on the read-only
    // inquiry path: there is no executable intent to validate or run.
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "pronoun_resolved",
      outcome: "accepted",
      phase: "routing",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
    });
    return { kind: "inquiry", inquiry: next.inquiry };
  }
  const nextDeterministic = next.kind === "inquiry_candidate" ? parseIntent(rewritten) : next.intent;
  if ((next.kind === "action" || next.kind === "speech")
    && nextDeterministic !== null
    && (nextDeterministic.type === "ActionIntentCommand" || nextDeterministic.type === "InteractionCommand" || nextDeterministic.type === "JourneyIntent")
    && !(nextDeterministic.type === "ActionIntentCommand" && nextDeterministic.operation === "unknown")) {
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "pronoun_resolved",
      outcome: "accepted",
      phase: "routing",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
    });
    return { kind: "rewritten", input: rewritten, classification: next, deterministic: nextDeterministic };
  }
  return { kind: "same" };
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
  let classification = classifyPlayerInput(input, parseIntent);
  if (classification.kind === "inquiry") {
    return { status: "inquiry", inquiry: classification.inquiry };
  }
  let deterministic = classification.kind === "inquiry_candidate" ? parseIntent(input) : classification.intent;

  // Deterministic pronoun resolution before any model call: a single settled
  // binding rewrites the replica with its mention surface for the LLM prompt
  // (never the fast path, so validated plans keep focus/goal/ambiguity
  // metadata); an ambiguous binding asks a specific question naming scene
  // candidates; a missing binding asks specifically when the turn addresses
  // it. The original input stays untouched for transcript, rawText and
  // diagnostics; promptInput carries the resolved text into the LLM prompt.
  let promptInput = input;
  let pronounRewritten = false;
  const pronounStep = resolvePronounsDeterministic(input, classification, deterministic, snapshot, options);
  if (pronounStep.kind === "clarification") return pronounStep.outcome;
  if (pronounStep.kind === "inquiry") return { status: "inquiry", inquiry: pronounStep.inquiry };
  if (pronounStep.kind === "rewritten") {
    promptInput = pronounStep.input;
    classification = pronounStep.classification;
    deterministic = pronounStep.deterministic;
    pronounRewritten = true;
  }

  if (!pronounRewritten && classification.kind !== "inquiry_candidate" && isSimpleSafeDeterministic(promptInput, deterministic)) {
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
      && isSafeDeterministic(deterministic)
      && !deterministicHasUnresolvedPronoun(deterministic)) {
      const structural = validateActionProposal(deterministic);
      if (structural.ok) return { status: "deterministic", intent: deterministic };
    }
    if (deterministicHasUnresolvedPronoun(deterministic)) return pronounFallbackClarification();
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
  const budgetMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    raw = await withTimeout(
      requestProposal(router, promptInput, snapshot, options, budgetMs, startedAt, () => {
        emitMasterTurnDiagnostic(options?.diagnostics, {
          category: "proposal_repair_requested",
          outcome: "requested",
          phase: "response",
          correlationId: options?.correlationId,
          worldTime: options?.worldTime,
        });
      }),
      budgetMs,
    );
  } catch {
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "deterministic_fallback",
      outcome: "fallback",
      phase: "fallback",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
    });
    if (deterministicHasUnresolvedPronoun(deterministic)) return pronounFallbackClarification();
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
    if (deterministicHasUnresolvedPronoun(deterministic)) return pronounFallbackClarification();
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
    if (deterministicHasUnresolvedPronoun(deterministic)) return pronounFallbackClarification();
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
  if (deterministicHasUnresolvedPronoun(deterministic)) return pronounFallbackClarification();
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

/**
 * Derives a repair note for one raw proposal, or null when the reply is
 * usable as-is. Accepted and clarification outcomes never repair; only a
 * statically invalid reply gets exactly one correction round carrying the
 * sanitized rejection reason (closed server vocabulary, never player text).
 */
function repairNoteFor(raw: unknown): string | null {
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return "Your previous reply was not JSON. Return ONLY corrected TurnProposalV2 JSON.";
  }
  if (!parsed || typeof parsed !== "object") {
    return "Your previous reply was not a JSON object. Return ONLY corrected TurnProposalV2 JSON.";
  }
  const check = validateTurnProposal(parsed);
  if (check.status === "invalid") {
    return `Your previous reply was rejected (${check.reason}). Return ONLY corrected TurnProposalV2 JSON with the exact top-level keys.`;
  }
  return null;
}

/**
 * Requests one proposal with at most one repair round. The repair reuses
 * the same snapshot and prompt plus the rejection note, squeezed into the
 * remaining overall budget. Validation afterwards is unchanged: a still
 * invalid reply follows the normal invalid path.
 */
async function requestProposal(
  router: ModelRouter,
  input: string,
  snapshot: MasterTurnSnapshot,
  options: MasterTurnGatewayOptions | undefined,
  budgetMs: number,
  startedAt: number,
  onRepair: () => void,
): Promise<unknown> {
  const first = await proposeTurn(router, input, snapshot, options);
  const note = repairNoteFor(first);
  if (!note) return first;
  onRepair();
  const remaining = Math.max(1, Math.floor(budgetMs - (performance.now() - startedAt)));
  return proposeTurn(router, input, snapshot, {
    ...options,
    repairNote: note,
    assistantPrefill: typeof first === "string" ? first.slice(0, 2000) : null,
    timeoutMs: remaining,
  });
}

async function proposeTurn(
  router: ModelRouter,
  input: string,
  snapshot: MasterTurnSnapshot,
  options?: MasterTurnGatewayOptions & {
    readonly repairNote?: string | undefined;
    readonly assistantPrefill?: string | null | undefined;
  },
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
  const messages: ChatMessage[] = [
    { role: "system", content: MASTER_TURN_SYSTEM_PROMPT },
    { role: "user", content: prompt.user },
  ];
  // A correction turn anchors on the model's own prior reply: the note alone
  // tells it that the shape was wrong, the prefill shows what to correct.
  // The prefill is echoed model output, never persisted or logged.
  if (options?.repairNote) {
    if (options.assistantPrefill) messages.push({ role: "assistant", content: options.assistantPrefill });
    messages.push({ role: "user", content: options.repairNote });
  }
  const response = await router.chat("interpret", messages, {
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
