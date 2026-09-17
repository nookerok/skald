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
  missingReferent,
  multipleReferents,
  multipleThings,
  parseIntent,
  sameRussianStem,
  stemRussianToken,
  unclearPrimaryAction,
  unknownObservedTarget,
  validateActionProposal,
  validateTurnProposal,
  type ActionIntentCommand,
  type AmbiguitySlot,
  type ClarificationOption,
  type ExecutableIntent,
  type InquiryRequest,
  type PlayerInputClassification,
  type TurnConversationRelation,
  type TurnProposalV2,
} from "@skald/intent-parser";
import type { AIDiagnosticSink, ChatMessage, MasterSceneReference, MasterTurnSceneContext, MasterTurnSceneSnapshot, ModelRouter, ReadonlyWorld } from "@skald/world";
import { describeConversationContext, type MasterConversationContext } from "../conversation/context-builder.js";
import type { FramedClarification } from "../conversation/types.js";
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
  /**
   * Frame mechanics, set only while resolving a pending clarification:
   * suppressFrame skips frame matching so the re-interpreted original
   * cannot loop back into the same frame.
   */
  readonly suppressFrame?: boolean | undefined;
}

/**
 * Link to the pending clarification this turn answers. The gateway
 * computes it deterministically when a frame answer re-runs the framed
 * original; persistence writes it verbatim into turn metadata and the
 * question closes. Standalone replicas carry no link: the legacy close
 * rules decide (foreign inquiry/meta never closes, action does).
 */
export interface PendingClarificationLink {
  readonly relation: "resolves";
  readonly clarificationTurnSeq: number;
}

export type MasterTurnGatewayOutcome =
  | { readonly status: "deterministic"; readonly intent: ExecutableIntent; readonly pendingLink?: PendingClarificationLink | undefined }
  | { readonly status: "inquiry"; readonly inquiry: InquiryRequest; readonly pendingLink?: PendingClarificationLink | undefined }
  | { readonly status: "plan"; readonly plan: ValidatedMasterTurnPlan; readonly scene: MasterTurnSceneSnapshot; readonly pendingLink?: PendingClarificationLink | undefined }
  | {
    readonly status: "clarification";
    readonly question: string;
    readonly options: readonly ClarificationOption[];
    readonly relation?: TurnConversationRelation | null | undefined;
    readonly pendingLink?: PendingClarificationLink | undefined;
    /**
     * Closed structured candidate (review P1): persisted with the question
     * so an exact answer fills the slot and revalidates without a second
     * model call. Absent for legacy rows and slot-less questions.
     */
    readonly framed?: FramedClarification | undefined;
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
 * Last-resort generic wording (plan_9 §2): used only when no classified
 * generator applies, and always diagnosed as an interpretation defect.
 */
function genericFallback(options?: MasterTurnGatewayOptions): MasterTurnGatewayOutcome {
  emitMasterTurnDiagnostic(options?.diagnostics, {
    category: "generic_clarification_fallback",
    outcome: "defect",
    phase: "fallback",
    correlationId: options?.correlationId,
    worldTime: options?.worldTime,
  });
  return clarificationFallback();
}

/** Observer-safe person entry the speak binder reads; scene referents fit structurally. */
export interface SpeakAddresseeCandidate {
  readonly observerRef: string;
  readonly label: string;
  readonly knownAs: readonly string[];
}

/**
 * Deterministic speak/call addressee binding (plan_9 §2, §14 beat 4).
 *
 * - unique: the utterance stem-matches exactly one display label (several
 *   entities sharing one label collapse to the first in scene order — one
 *   role, one address);
 * - ambiguous: several distinct labels matched — the question names them;
 * - absent: a bare greeting (or a pronoun-only utterance, owned by the
 *   pronoun path) names nothing, or the named surface matches nobody.
 */
export type SpeakAddresseeBinding =
  | { readonly status: "unique"; readonly addressee: SpeakAddresseeCandidate }
  | { readonly status: "ambiguous"; readonly labels: readonly string[] }
  | { readonly status: "absent"; readonly named: boolean };

/** Prepositions and particles carrying no referent meaning in an utterance. */
const SPEAK_ADDRESS_PREPOSITIONS: ReadonlySet<string> = new Set([
  "к", "ко", "у", "с", "со", "о", "об", "в", "во", "на", "про", "для", "до", "от", "из", "за", "под", "над",
]);

function speakUtteranceWords(utterance: string): readonly string[] {
  return utterance
    .toLowerCase()
    .replace(/ё/gu, "е")
    .split(/[^a-zа-я0-9]+/iu)
    .filter((word) => word.length > 0 && !SPEAK_ADDRESS_PREPOSITIONS.has(word));
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

export type FrameMatch =
  | { readonly status: "matched"; readonly option: ClarificationOption }
  | { readonly status: "ambiguous" }
  | { readonly status: "none" };

function normalizeFrameText(value: string): string {
  return value.toLowerCase().replace(/ё/gu, "е").replace(/[?!.,;:]+$/u, "").replace(/\s+/gu, " ").trim();
}

function frameStems(value: string): readonly string[] {
  return normalizeFrameText(value)
    .split(/[^a-zа-я0-9]+/iu)
    .filter((word) => word.length > 0)
    .map((word) => stemRussianToken(word))
    .filter((word) => word.length >= 3);
}

/**
 * Matches a replica against persisted clarification options (review P0):
 * exact normalized-label match first (identical display labels collapse
 * to the first option, consistent with the speak binder), then unique
 * stem overlap with the option vocabulary (scene aliases fold into the
 * stem tier). A tie for best overlap stays ambiguous; no overlap matches
 * nothing. Selection is checked by option data (labels, refs, patches),
 * never by id prefix. Pure and total.
 */
export function matchFrameOption(
  input: string,
  options: readonly ClarificationOption[],
): FrameMatch {
  const norm = normalizeFrameText(input);
  if (!norm) return { status: "none" };
  const seen = new Map<string, ClarificationOption>();
  for (const option of options) {
    const key = normalizeFrameText(option.label);
    if (key.length > 0 && !seen.has(key)) seen.set(key, option);
  }
  const unique = [...seen.values()];
  const exact = unique.filter((option) => normalizeFrameText(option.label) === norm);
  if (exact.length > 0) return { status: "matched", option: exact[0]! };
  const inputWords = new Set(frameStems(input));
  let best: ClarificationOption | null = null;
  let bestHits = 0;
  let tied = false;
  for (const option of unique) {
    const labelWords = frameStems(option.label);
    if (labelWords.length === 0) continue;
    const hits = labelWords.filter((word) => inputWords.has(word)).length;
    if (hits > bestHits) {
      best = option;
      bestHits = hits;
      tied = false;
    } else if (hits === bestHits && hits > 0) {
      tied = true;
    }
  }
  if (!best || bestHits === 0) return { status: "none" };
  if (tied) return { status: "ambiguous" };
  return { status: "matched", option: best };
}

/**
 * Binds a speak/call utterance to observer-safe scene people. Pure and
 * total: no world access, no events, no network. The same utterance and
 * scene always yield the same binding. Matching is exact-first: a full
 * display label wins over any shared word, so an explicit "Ночному
 * перевозчику" never asks which ferryman. A contiguous stem phrase outranks
 * even bag overlap (both ferrymen "fully" match a long replica by words,
 * but only one label is actually named). Identical display labels
 * collapse to the first entry (one role); distinct labels with tied
 * overlap stay ambiguous.
 */
export function bindSpeakAddressee(
  utterance: string | null | undefined,
  people: readonly SpeakAddresseeCandidate[],
): SpeakAddresseeBinding {
  const words = speakUtteranceWords(utterance ?? "");
  if (words.length === 0 || words.every((word) => isUnresolvedFocusSurface(word))) {
    return freeze({ status: "absent" as const, named: false });
  }
  const byLabel = new Map<string, SpeakAddresseeCandidate[]>();
  for (const person of people) {
    const key = person.label.trim().toLowerCase().replace(/ё/gu, "е");
    if (key.length === 0) continue;
    const list = byLabel.get(key) ?? [];
    list.push(person);
    byLabel.set(key, list);
  }
  const inputSequence = words.map((word) => stemRussianToken(word)).filter((word) => word.length >= 3);
  const scored = [...byLabel.entries()].map(([label, entries]) => {
    const labelWords = label.split(/[^a-zа-я0-9]+/iu).filter((word) => word.length > 0)
      .map((word) => stemRussianToken(word)).filter((word) => word.length >= 3);
    const inputStems = new Set(inputSequence);
    return {
      label: entries[0]!.label.trim(),
      entries,
      phrase: labelWords.length > 0 && containsStemPhrase(inputSequence, labelWords),
      full: labelWords.length > 0 && labelWords.every((word) => inputStems.has(word)),
      hits: labelWords.filter((word) => inputStems.has(word)).length,
    };
  }).filter((entry) => entry.hits > 0);
  if (scored.length === 0) return freeze({ status: "absent" as const, named: true });
  const phrased = scored.filter((entry) => entry.phrase);
  if (phrased.length === 1) return freeze({ status: "unique" as const, addressee: phrased[0]!.entries[0]! });
  const full = scored.filter((entry) => entry.full);
  if (full.length === 1) return freeze({ status: "unique" as const, addressee: full[0]!.entries[0]! });
  if (full.length > 1) {
    return freeze({ status: "ambiguous" as const, labels: freeze(full.slice(0, 3).map((entry) => entry.label)) });
  }
  const best = Math.max(...scored.map((entry) => entry.hits));
  const winners = scored.filter((entry) => entry.hits === best);
  if (winners.length === 1) return freeze({ status: "unique" as const, addressee: winners[0]!.entries[0]! });
  return freeze({ status: "ambiguous" as const, labels: freeze(winners.slice(0, 3).map((entry) => entry.label)) });
}

/**
 * True when the label stem sequence occurs contiguously in the input stem
 * sequence ("ночн, перевозч" inside "к, ночн, перевозч, спрош…").
 * Declensions fold through the stemmer; filler words break contiguity.
 * Pure and total. Mirrored in the validator surface binder.
 */
function containsStemPhrase(input: readonly string[], label: readonly string[]): boolean {
  if (label.length === 0 || input.length < label.length) return false;
  outer: for (let start = 0; start + label.length <= input.length; start += 1) {
    for (let offset = 0; offset < label.length; offset += 1) {
      if (input[start + offset] !== label[offset]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Degraded-path speak/call fallback: bind the addressee deterministically
 * or clarify through the classified taxonomy — never the generic last
 * resort. Returns null when the intent is not speak/call (normal flow
 * continues). Emits only sanitized operational dimensions.
 */
function speakAddresseeFallback(
  deterministic: ReturnType<typeof parseIntent>,
  snapshot: MasterTurnSnapshot,
  options?: MasterTurnGatewayOptions,
): MasterTurnGatewayOutcome | null {
  if (deterministic.type !== "ActionIntentCommand") return null;
  if (deterministic.operation !== "speak" && deterministic.operation !== "call") return null;
  const command = deterministic as ActionIntentCommand;
  const binding = bindSpeakAddressee(command.utterance ?? null, snapshot.scene.context.knownPeople);
  if (binding.status === "unique") {
    const intent: ActionIntentCommand = freeze({
      ...command,
      target: freeze({ raw: binding.addressee.label }),
      interpretation: freeze({ ...command.interpretation, ambiguities: freeze([]) }),
    });
    if (validateActionProposal(intent).ok) {
      emitMasterTurnDiagnostic(options?.diagnostics, {
        category: "speak_addressee_bound",
        outcome: "accepted",
        phase: "fallback",
        correlationId: options?.correlationId,
        worldTime: options?.worldTime,
        referentCount: 1,
      });
      return { status: "deterministic", intent };
    }
  }
  if (binding.status === "ambiguous") {
    const classified = multipleReferents(binding.labels, true);
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "clarification_returned",
      outcome: "clarification",
      phase: "fallback",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
      referentCount: binding.labels.length,
    });
    return { status: "clarification", question: classified.question, options: classified.options };
  }
  if (binding.status === "absent" && !binding.named) {
    const classified = missingReferent({ kind: "person" });
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "clarification_returned",
      outcome: "clarification",
      phase: "fallback",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
    });
    return { status: "clarification", question: classified.question, options: classified.options };
  }
  const surface = (command.utterance ?? "").trim();
  const classified = unknownObservedTarget(surface.length > 0 ? surface : command.rawText);
  emitMasterTurnDiagnostic(options?.diagnostics, {
    category: "clarification_returned",
    outcome: "clarification",
    phase: "fallback",
    correlationId: options?.correlationId,
    worldTime: options?.worldTime,
  });
  return { status: "clarification", question: classified.question, options: classified.options };
}

/**
 * Re-resolves one frame option label against the CURRENT scene: labels
 * are transient display, never persisted handles, so the answer-time
 * scene decides. Returns the matching observerRefs (empty when stale).
 */
function frameOptionRefs(label: string, scene: MasterTurnSceneContext): readonly string[] {
  const wanted = label.trim().toLowerCase().replace(/ё/gu, "е");
  if (!wanted) return [];
  const refs: string[] = [];
  const consider = (observerRef: string, labels: readonly string[]): void => {
    if (refs.includes(observerRef)) return;
    if (labels.some((entry) => entry.trim().toLowerCase().replace(/ё/gu, "е") === wanted)) refs.push(observerRef);
  };
  for (const person of scene.knownPeople) consider(person.observerRef, [person.label, ...person.knownAs]);
  for (const object of scene.visibleObjects) consider(object.observerRef, [object.label, ...object.knownAs]);
  for (const item of scene.accessibleItems) consider(item.observerRef, [item.label, ...item.knownAs]);
  for (const route of scene.knownRoutes) consider(route.observerRef, [route.label, ...route.knownAs]);
  return freeze(refs);
}

/**
 * Derives a scene restricted to the resolved referents for re-running the
 * framed original: every downstream matcher (pronouns, speak binder,
 * validator, prompt) then sees only the chosen addressee, so the same
 * ambiguity cannot recur. References stay consistent by construction.
 * Every ref-bearing collection filters by the one allowed set (review P2):
 * people, objects, items, routes and topics — the static action registry
 * and ambient situation/location carry no refs and stay.
 */
function restrictSceneToRefs(
  snapshot: MasterTurnSnapshot,
  keep: ReadonlySet<string>,
): MasterTurnSnapshot {
  const context = snapshot.scene.context;
  const references = new Map<string, MasterSceneReference>();
  for (const [observerRef, reference] of snapshot.scene.references) {
    if (keep.has(observerRef)) references.set(observerRef, reference);
  }
  return {
    ...snapshot,
    scene: {
      ...snapshot.scene,
      context: {
        ...context,
        knownPeople: context.knownPeople.filter((person) => keep.has(person.observerRef)),
        visibleObjects: context.visibleObjects.filter((object) => keep.has(object.observerRef)),
        accessibleItems: context.accessibleItems.filter((item) => keep.has(item.observerRef)),
        knownRoutes: context.knownRoutes.filter((route) => keep.has(route.observerRef)),
        knownTopics: context.knownTopics.filter((topic) => keep.has(topic.observerRef)),
      },
      references,
    },
  };
}

function resolvesLink(turnSeq: number): PendingClarificationLink {
  return { relation: "resolves", clarificationTurnSeq: turnSeq };
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
      const classified = unclearPrimaryAction({
        surface: binding.mention.surface,
        speak: deterministic.type === "ActionIntentCommand" && deterministic.operation === "speak",
      });
      emitMasterTurnDiagnostic(options?.diagnostics, {
        category: "pronoun_topic",
        outcome: "clarification",
        phase: "routing",
        correlationId: options?.correlationId,
        worldTime: options?.worldTime,
      });
      return { kind: "clarification", outcome: { status: "clarification", question: classified.question, options: classified.options } };
    }
    // Frame continuity: each named candidate travels as a selectable
    // option (candidate-N) so an exact answer resolves first-try instead
    // of looping. The generic rephrase stays last.
    const named = binding.candidates.slice(0, 3)
      .map((candidate) => ({ candidate, label: sceneLabelForRef(scene, candidate) }))
      .filter((entry): entry is { candidate: string; label: string } => entry.label !== null)
      .slice(0, 3);
    if (named.length === 0) return { kind: "same" };
    const labels = named.map((entry) => entry.label);
    const hasPerson = binding.classes.includes("person");
    const hasThing = binding.classes.includes("thing");
    const classified = hasPerson && !hasThing
      ? multipleReferents(labels, true)
      : !hasPerson && hasThing
        ? multipleThings(labels)
        : multipleReferents(labels, false);
    const candidateOptions = named.map((entry, index) => ({
      optionId: `candidate-${index + 1}`,
      label: entry.label,
      referentRefs: [entry.candidate],
    }));
    const questionOptions = [...candidateOptions, ...classified.options];
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "pronoun_ambiguous",
      outcome: "clarification",
      phase: "routing",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
    });
    // Structured candidate (review P1): the deterministic intent plus its
    // fillable slot, so an exact answer patches and revalidates without a
    // second model call. The revision pins the asking scene.
    const executable = deterministic.type === "ActionIntentCommand" || deterministic.type === "InteractionCommand" || deterministic.type === "JourneyIntent"
      ? deterministic
      : null;
    const slot: AmbiguitySlot | null = !executable ? null
      : executable.type === "ActionIntentCommand" && (executable.operation === "speak" || executable.operation === "call") ? "addressee"
      : executable.type === "JourneyIntent" ? "destination"
      : "target";
    return {
      kind: "clarification",
      outcome: {
        status: "clarification",
        question: classified.question,
        options: questionOptions,
        ...(executable && slot ? { framed: { slot, intent: executable, revision: snapshot.scene.context.revision } } : {}),
      },
    };
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
    const classified = missingReferent({
      kind: hasTopic ? "topic" : hasPlace ? "place"
        : mention ? "either"
        : hasPerson && !hasThing ? "person"
        : !hasPerson && hasThing ? "thing" : "either",
      ...(mention ? { mention } : {}),
    });
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "pronoun_missing",
      outcome: "clarification",
      phase: "routing",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
    });
    return { kind: "clarification", outcome: { status: "clarification", question: classified.question, options: classified.options } };
  }

  if (binding.resolution !== "single" || !binding.mention) return { kind: "same" };
  const surface = binding.mention.surface;

  // Topic bindings never rewrite an action: they name the follow-up question.
  if (binding.classes.length === 1 && binding.classes[0] === "topic") {
    const classified = unclearPrimaryAction({
      surface,
      speak: deterministic.type === "ActionIntentCommand" && deterministic.operation === "speak",
    });
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "pronoun_topic",
      outcome: "clarification",
      phase: "routing",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
    });
    return { kind: "clarification", outcome: { status: "clarification", question: classified.question, options: classified.options } };
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
 * The single meta option id: a rephrase is never a frame selection, so it
 * never consumes a replica. Checked by exact id, never by prefix.
 */
function isFrameSelectable(option: ClarificationOption): boolean {
  return option.optionId !== "rephrase";
}

/**
 * Fills one referent slot of a stored proposal with the chosen answer and
 * drops the resolved ambiguity. The contextual validator re-checks the
 * patched proposal (observerRef/surface consistency included), so a wrong
 * slot guess degrades to re-interpretation instead of executing.
 */
function patchProposalReferent(
  proposal: TurnProposalV2,
  slot: AmbiguitySlot,
  observerRef: string,
  surface: string,
): TurnProposalV2 {
  const { ambiguity: _resolved, ...rest } = proposal;
  void _resolved;
  const referent = freeze({ role: slot, observerRef, surface });
  return freeze({
    ...rest,
    ...(slot === "target" ? { target: referent } : {}),
    ...(slot === "addressee" ? { addressedEntity: referent } : {}),
    ...(slot === "destination" && rest.primaryIntent?.kind === "journey"
      ? { primaryIntent: freeze({ ...rest.primaryIntent, destination: referent }) }
      : {}),
    referents: freeze(rest.referents.map((entry) => entry.role === slot ? referent : entry)),
  }) as TurnProposalV2;
}

/**
 * Fills the unresolved slot of a stored deterministic intent with the
 * chosen answer surface. World-side resolution happens later at preflight
 * against the bound label. Returns null for shapes with no such slot.
 */
function patchExecutableIntent(
  intent: ExecutableIntent,
  slot: AmbiguitySlot,
  surface: string,
): ExecutableIntent | null {
  if (slot === "target" && intent.type === "InteractionCommand") {
    return freeze({ ...intent, target: freeze({ raw: surface }) });
  }
  if (slot === "addressee" && intent.type === "ActionIntentCommand"
    && (intent.operation === "speak" || intent.operation === "call")) {
    return freeze({ ...intent, target: freeze({ raw: surface }) });
  }
  if (slot === "destination" && intent.type === "JourneyIntent") {
    return freeze({ ...intent, destination: freeze({ raw: surface }) });
  }
  return null;
}

/**
 * Resolves a frame answer against the closed structured candidate (review
 * P1): a fresh scene revision revalidates the slot-filled proposal or
 * intent with no model call. A stale revision, a failed revalidation or
 * any shape surprise returns null so the caller falls back to
 * re-interpretation. Never throws.
 */
function tryResolveFramed(
  pending: NonNullable<MasterConversationContext["pendingClarification"]>,
  label: string,
  observerRef: string,
  snapshot: MasterTurnSnapshot,
  options?: MasterTurnGatewayOptions,
): MasterTurnGatewayOutcome | null {
  const framed = pending.framed;
  if (!framed) return null;
  const revision = snapshot.scene.context.revision;
  if (framed.revision.worldTime !== revision.worldTime || framed.revision.eventNumber !== revision.eventNumber) return null;
  try {
    if (framed.proposal) {
      const staticCheck = validateTurnProposal(framed.proposal);
      if (staticCheck.status !== "accepted") return null;
      const patched = patchProposalReferent(staticCheck.proposal, framed.slot, observerRef, label);
      const validation = validateMasterTurnPlan({ proposal: patched, scene: snapshot.scene, world: snapshot.world, rawText: pending.originalInput ?? "" });
      if (validation.status !== "accepted") return null;
      emitMasterTurnDiagnostic(options?.diagnostics, {
        category: "clarification_resolved",
        outcome: "plan",
        phase: "routing",
        correlationId: options?.correlationId,
        worldTime: options?.worldTime,
        referentCount: 1,
      });
      return { status: "plan", plan: validation.plan, scene: snapshot.scene, pendingLink: resolvesLink(pending.turnSeq) };
    }
    if (framed.intent) {
      const patched = patchExecutableIntent(framed.intent, framed.slot, label);
      if (!patched) return null;
      if (!validateActionProposal(patched).ok) return null;
      emitMasterTurnDiagnostic(options?.diagnostics, {
        category: "clarification_resolved",
        outcome: "deterministic",
        phase: "routing",
        correlationId: options?.correlationId,
        worldTime: options?.worldTime,
        referentCount: 1,
      });
      return { status: "deterministic", intent: patched, pendingLink: resolvesLink(pending.turnSeq) };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Consumes a pending clarification frame before the parser/LLM (review
 * P1). Selection is checked by option data, never by id prefix: every
 * non-rephrase option is matchable, an action patch runs its own text, a
 * referent choice fills the stored slot (revalidated, no second model
 * call) or re-runs the framed original against the restricted scene.
 * Anything else falls through untouched so standalone replicas proceed
 * under the legacy close rules. Returns null when no frame applies.
 */
async function interpretFramedInput(
  input: string,
  snapshot: MasterTurnSnapshot,
  router: ModelRouter | null,
  options?: MasterTurnGatewayOptions,
): Promise<MasterTurnGatewayOutcome | null> {
  const pending = snapshot.conversation.pendingClarification ?? null;
  if (!pending || !pending.originalInput) return null;
  const selectable = (pending.options ?? []).filter(isFrameSelectable);
  if (selectable.length === 0) return null;
  const match = matchFrameOption(input, selectable);
  if (match.status === "none" || match.status === "ambiguous") return null;
  const chosen = match.option;
  // An action alternative answers by doing the named part: run its own
  // text, never the whole compound again.
  if (chosen.intentPatch?.actionText) {
    const inner = await interpretMasterTurn(chosen.intentPatch.actionText, snapshot, router, { ...options, suppressFrame: true });
    if (inner.status === "unsupported" || inner.status === "unavailable") return inner;
    if (inner.status !== "deterministic" && inner.status !== "inquiry" && inner.status !== "plan") return null;
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "clarification_resolved",
      outcome: inner.status,
      phase: "routing",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
      referentCount: 0,
    });
    return { ...inner, pendingLink: resolvesLink(pending.turnSeq) };
  }
  const storedRefs = (chosen.referentRefs ?? []).filter((ref) => snapshot.scene.references.has(ref));
  const refs = storedRefs.length > 0 ? storedRefs : frameOptionRefs(chosen.label, snapshot.scene.context);
  if (refs.length === 0) {
    // Explicit refs gone stale: the named entity is gone, say so. A bare
    // label with no scene resolution falls through instead — the replica
    // may be its own action, not an answer.
    if (chosen.referentRefs?.length) {
      const classified = missingReferent({ kind: "either", mention: chosen.label });
      emitMasterTurnDiagnostic(options?.diagnostics, {
        category: "clarification_returned",
        outcome: "clarification",
        phase: "fallback",
        correlationId: options?.correlationId,
        worldTime: options?.worldTime,
      });
      return { status: "clarification", question: classified.question, options: classified.options };
    }
    return null;
  }
  const framed = tryResolveFramed(pending, chosen.label, refs[0]!, snapshot, options);
  if (framed) return framed;
  const forced = restrictSceneToRefs(snapshot, new Set(refs));
  const inner = await interpretMasterTurn(pending.originalInput, forced, router, { ...options, suppressFrame: true });
  if (inner.status === "unsupported" || inner.status === "unavailable") return inner;
  emitMasterTurnDiagnostic(options?.diagnostics, {
    category: "clarification_resolved",
    outcome: inner.status,
    phase: "routing",
    correlationId: options?.correlationId,
    worldTime: options?.worldTime,
    referentCount: refs.length,
  });
  return { ...inner, pendingLink: resolvesLink(pending.turnSeq) };
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
  // Pending-clarification frame (review P0): an answer naming one of the
  // offered options resolves first-try; a standalone replica moves on.
  // Both run before the parser/LLM so a new question or action is never
  // trapped inside an old clarification route.
  if (!options?.suppressFrame) {
    const framed = await interpretFramedInput(input, snapshot, router, options);
    if (framed) return framed;
  }
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
    const speakBound = speakAddresseeFallback(deterministic, snapshot, options);
    if (speakBound) return speakBound;
    const mapped = mapLegacyFallback(fallbackForDeterministic(deterministic));
    if (mapped) return mapped;
    return genericFallback(options);
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
    return fallbackAfterModelFailure(deterministic, snapshot, options);
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
    return fallbackAfterModelFailure(deterministic, snapshot, options);
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
  if (staticCheck.status === "clarification") {
    // Stamp the asking scene revision onto the structured candidate so an
    // exact answer revalidates without a second model call (review P1).
    return {
      status: "clarification",
      question: staticCheck.question,
      options: staticCheck.options,
      ...(staticCheck.relation !== undefined ? { relation: staticCheck.relation } : {}),
      ...(staticCheck.framedProposal ? {
        framed: {
          slot: staticCheck.framedProposal.slot,
          proposal: staticCheck.framedProposal.proposal,
          revision: snapshot.scene.context.revision,
        },
      } : {}),
    };
  }
  if (staticCheck.status === "invalid") {
    emitMasterTurnDiagnostic(options?.diagnostics, {
      category: "proposal_schema_rejected",
      outcome: "invalid",
      phase: "schema_validation",
      correlationId: options?.correlationId,
      worldTime: options?.worldTime,
    });
    return fallbackAfterModelFailure(deterministic, snapshot, options);
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
    return {
      status: "clarification",
      question: contextual.question,
      options: contextual.options,
      ...(contextual.framed ? { framed: contextual.framed } : {}),
    };
  }
  return fallbackAfterModelFailure(deterministic, snapshot, options);
}

/**
 * Shared degraded-model fallback (plan_9 §2): pronoun-bound replicas ask
 * specifically; structurally broken proposals clarify through the same
 * structural validator the fast path uses (so a degraded model never
 * executes what the fast path would clarify, e.g. "ждать дверь"); safe
 * proposals execute; speak/call binds its addressee deterministically or
 * clarifies through the taxonomy; deterministic clarifications survive;
 * only the true remainder hits the generic last resort (diagnosed as a
 * defect).
 */
function fallbackAfterModelFailure(
  deterministic: ReturnType<typeof parseIntent>,
  snapshot: MasterTurnSnapshot,
  options?: MasterTurnGatewayOptions,
): MasterTurnGatewayOutcome {
  if (deterministicHasUnresolvedPronoun(deterministic)) return pronounFallbackClarification();
  if (
    deterministic.type === "ActionIntentCommand"
    || deterministic.type === "InteractionCommand"
    || deterministic.type === "JourneyIntent"
  ) {
    const structural = validateActionProposal(deterministic);
    if (!structural.ok) {
      return {
        status: "clarification",
        question: structural.clarification,
        options: [{ optionId: "rephrase", label: "Переформулировать действие" }],
      };
    }
    if (isSafeDeterministic(deterministic)) {
      return { status: "deterministic", intent: deterministic };
    }
  }
  const deterministicClarification = clarificationFromDeterministic(deterministic);
  if (deterministicClarification) return mapLegacyFallback(deterministicClarification) ?? genericFallback(options);
  return speakAddresseeFallback(deterministic, snapshot, options) ?? genericFallback(options);
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
