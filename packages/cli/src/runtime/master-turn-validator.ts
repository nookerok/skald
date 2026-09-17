/**
 * Contextual Master Turn validation (ADR-0028, plan_6 Stage 7.2).
 *
 * A pure pre-check over a statically valid TurnProposalV2, the scene
 * reference table (Stage 3) and the current ReadonlyWorld. It verifies that
 * every observerRef exists in the current table with a matching surface,
 * that addressees are known people, destinations are known routes,
 * accessible items stay accessible, targets pass the shared resolver, and
 * inquiry focus stays observer-safe. Anything stale, unknown or ambiguous
 * becomes a natural clarification with no Events; malformed input is
 * invalid. The result is a transient ValidatedMasterTurnPlan — never a
 * Domain Event, Projection or Event Log entry.
 *
 * Precondition: the proposal passed validateTurnProposal (Stage 7.1).
 * World authority stays with Rules: this layer only pre-checks, and the
 * revision it captures lets the queue revalidate before execution (Stage 8).
 */

import {
  isItemAccessible,
  resolveInteractionTarget,
  type AIDiagnosticSink,
  type MasterTurnSceneSnapshot,
  type ReadonlyWorld,
} from "@skald/world";
import {
  conflictingActions,
  inferAmbiguitySlot,
  isInquiryQueryId,
  multipleReferents,
  stemRussianToken,
  validateActionProposal,
  type AmbiguitySlot,
  type ClarificationOption,
  type ExecutableIntent,
  type InquiryRequest,
  type ProposedReferent,
  type TurnConversationRelation,
  type TurnMetaOperation,
  type TurnProposalKind,
  type TurnProposalV2,
} from "@skald/intent-parser";
import type { FramedClarification } from "../conversation/types.js";
import { emitMasterTurnDiagnostic } from "./master-turn-diagnostics.js";

/** Turn kinds a validated plan may carry. */
export type TurnKind = TurnProposalKind;

/** One validated conversation referent for downstream focus tracking. */
export interface ValidatedConversationReferent {
  readonly observerRef: string | null;
  readonly surface: string;
  readonly kind: "target" | "addressee" | "topic" | "destination";
}

/** A noticed but unexecuted clause with its deferral reason. */
export interface DeferredClause {
  readonly text: string;
  readonly reason: "secondary_action" | "requires_new_turn";
}

/** A closed read-only meta request (Stage 12 registry, validated). */
export interface RegisteredMetaRequest {
  readonly type: "MetaRequest";
  readonly operation: TurnMetaOperation;
}

/**
 * Transient execution plan for one replica: at most one primary intent
 * plus read-only questions (plan_9 §1: every understood question is
 * answered, never silently dropped). Owned by the request, never stored.
 *
 * Memory handoff (plan_7 §7): the model's stated goal and its reported
 * relation to the pending clarification travel with the plan so the HTTP
 * layer can persist them as read-side metadata. Both stay non-authoritative
 * interpretations — neither drives Rules nor moves time by itself.
 */
export interface ValidatedMasterTurnPlan {
  readonly contextRevision: {
    readonly worldTime: number;
    readonly eventNumber: number;
  };
  readonly kind: TurnKind;
  readonly execution: {
    readonly intent: ExecutableIntent;
  } | null;
  readonly postActionInquiries: readonly InquiryRequest[];
  readonly metaInquiry: RegisteredMetaRequest | null;
  readonly deferredClauses: readonly DeferredClause[];
  readonly focus: readonly ValidatedConversationReferent[];
  readonly goal?: string | null | undefined;
  readonly conversationRelation?: TurnConversationRelation | null | undefined;
}

/**
 * Player-facing clarification option: the single canonical option shape
 * (review P1). Referent choices carry their scene refs when resolvable;
 * action alternatives carry their executable text; selection is checked by
 * this data, never by id prefix.
 */
export type MasterTurnClarificationOption = ClarificationOption;

/**
 * Exact-first scene binding for model-proposed surfaces (review P1): a
 * referent without observerRef never becomes a target on its own. Whole
 * display-label (or alias) equality wins first, then unique stem overlap
 * across the label vocabulary; a tie for best overlap stays ambiguous,
 * no overlap binds nothing. Same discipline as the gateway speak binder.
 */
interface SceneBindEntry {
  readonly observerRef: string;
  readonly label: string;
  readonly knownAs: readonly string[];
}

type SceneBindResult =
  | { readonly status: "unique"; readonly entry: SceneBindEntry }
  | { readonly status: "ambiguous"; readonly labels: readonly string[] }
  | { readonly status: "absent" };

function normalizeBindText(value: string): string {
  return value.trim().toLowerCase().replace(/ё/gu, "е").replace(/[?!.,;:]+$/u, "").trim();
}

/**
 * Exact-first scene binding (exported for tests; the validator is the
 * only production caller).
 */
export function bindSceneSurface(
  surface: string,
  entries: readonly SceneBindEntry[],
): SceneBindResult {
  const norm = normalizeBindText(surface);
  if (!norm) return { status: "absent" };
  const byLabel = new Map<string, SceneBindEntry[]>();
  for (const entry of entries) {
    const key = normalizeBindText(entry.label);
    if (key.length === 0) continue;
    const list = byLabel.get(key) ?? [];
    list.push(entry);
    byLabel.set(key, list);
  }
  // Identical display labels collapse to the first entry (one role).
  const distinct = [...byLabel.values()].map((list) => list[0]!);
  const exact = distinct.filter((entry) =>
    normalizeBindText(entry.label) === norm
    || entry.knownAs.some((alias) => normalizeBindText(alias) === norm),
  );
  if (exact.length > 0) return { status: "unique", entry: exact[0]! };
  const stemWord = (word: string): string | null => {
    const stemmed = stemRussianToken(word);
    return stemmed.length >= 3 ? stemmed : null;
  };
  const sequenceOf = (text: string): readonly string[] =>
    normalizeBindText(text).split(/[^a-zа-я0-9]+/iu).filter((word) => word.length > 0)
      .map((word) => stemWord(word))
      .filter((word): word is string => word !== null);
  // A contiguous stem phrase outranks bag overlap: in "К Ночному
  // перевозчику. Спрошу…" both ferrymen match by words, but only one
  // label is actually named. Mirrors the gateway speak binder.
  const inputSequence = sequenceOf(surface);
  const phrased = distinct.filter((entry) =>
    [entry.label, ...entry.knownAs].some((text) => {
      const phrase = sequenceOf(text);
      if (phrase.length === 0 || inputSequence.length < phrase.length) return false;
      outer: for (let start = 0; start + phrase.length <= inputSequence.length; start += 1) {
        for (let offset = 0; offset < phrase.length; offset += 1) {
          if (inputSequence[start + offset] !== phrase[offset]) continue outer;
        }
        return true;
      }
      return false;
    }),
  );
  if (phrased.length === 1) return { status: "unique", entry: phrased[0]! };
  const inputStems = new Set(
    norm.split(/[^a-zа-я0-9]+/iu).filter((word) => word.length > 0)
      .map((word) => stemWord(word))
      .filter((word): word is string => word !== null),
  );
  const vocabOf = (entry: SceneBindEntry): readonly string[] => [entry.label, ...entry.knownAs]
    .flatMap((text) => normalizeBindText(text).split(/[^a-zа-я0-9]+/iu))
    .filter((word) => word.length > 0)
    .map((word) => stemWord(word))
    .filter((word): word is string => word !== null);
  let best: SceneBindEntry | null = null;
  let bestHits = 0;
  let tied = false;
  for (const entry of distinct) {
    const hits = vocabOf(entry).filter((word) => inputStems.has(word)).length;
    if (hits > bestHits) {
      best = entry;
      bestHits = hits;
      tied = false;
    } else if (hits === bestHits && hits > 0) {
      tied = true;
    }
  }
  if (!best || bestHits === 0) return { status: "absent" };
  if (tied) {
    const labels: string[] = [];
    for (const entry of distinct) {
      if (vocabOf(entry).filter((word) => inputStems.has(word)).length === bestHits && !labels.includes(entry.label)) {
        labels.push(entry.label);
      }
      if (labels.length >= 3) break;
    }
    return { status: "ambiguous", labels };
  }
  return { status: "unique", entry: best };
}

/** Closed verb stems marking a second action clause inside a target surface. */
const TARGET_CLAUSE_VERBS = "(?:иду|идти|ищ|осматр|осмотр|рассмотр|огля|посмотр|слуш|прислуш|скаж|спрос|спрош|позо|наблюд|двиг|возьм|бер|откро)";

/**
 * Splits a compound tail ("X и ищу Y") off a model-proposed target
 * surface. The head stays a candidate target; the tail returns for an
 * explicit conflicting-actions clarification so no understood part is
 * lost silently. Question tails are cut the same way. Returns null when
 * the surface is a single clause. Exported for tests.
 */
export function splitTargetCompound(surface: string): { head: string; tail: string } | null {
  const text = surface.trim();
  if (!text) return null;
  const question = text.indexOf("?");
  const declarative = question >= 0 ? text.slice(0, question).trim() : text;
  const tailQuestion = question >= 0 ? text.slice(question + 1).trim() : "";
  // Note: \b is ASCII-only in JS (even with the u flag), so a Cyrillic
  // verb stem needs an explicit letter lookahead as its boundary.
  const compound = new RegExp(`^(.*?)\\s+(?:и|а)\\s+(?:я\\s+)?(${TARGET_CLAUSE_VERBS}[а-яё]*)(?![а-яёa-z0-9])(.*)$`, "iu").exec(declarative);
  if (compound?.[1]?.trim()) {
    const head = compound[1].trim().replace(/[,;]+$/u, "").trim();
    const tail = `${compound[2] ?? ""}${compound[3] ?? ""}`.trim();
    if (head && tail) return { head, tail };
  }
  if (tailQuestion) return { head: declarative, tail: tailQuestion };
  return null;
}

/** Contextual validation outcome. Reasons stay sanitized (no internals). */
export type MasterTurnValidation =
  | { readonly status: "accepted"; readonly plan: ValidatedMasterTurnPlan }
  | {
    readonly status: "clarification";
    readonly question: string;
    readonly options: readonly MasterTurnClarificationOption[];
    /**
     * Closed structured candidate (review P1): the proposal plus its
     * fillable slot and asking revision, so an exact answer revalidates
     * without a second model call. Absent for slot-less questions.
     */
    readonly framed?: FramedClarification | undefined;
  }
  | { readonly status: "invalid"; readonly reason: string };

/** Input for contextual validation. */
export interface MasterTurnValidationInput {
  readonly proposal: TurnProposalV2;
  readonly scene: MasterTurnSceneSnapshot;
  readonly world: ReadonlyWorld;
  readonly rawText: string;
  readonly diagnostics?: AIDiagnosticSink | undefined;
}

/** Non-accepted outcomes shared by the mapping helpers below. */
type UnacceptedValidation = Exclude<MasterTurnValidation, { readonly status: "accepted" }>;

/** Mapping outcomes with distinct accepted payloads so narrowing works. */
type MappedIntent =
  | { readonly status: "accepted"; readonly intent: ExecutableIntent }
  | UnacceptedValidation;
type MappedInquiry =
  | { readonly status: "accepted"; readonly inquiry: InquiryRequest }
  | UnacceptedValidation;
type MappedInquiries =
  | { readonly status: "accepted"; readonly inquiries: readonly InquiryRequest[] }
  | UnacceptedValidation;

/** A scene-table hit, or a surface-only mention without a table entry. */
interface CheckedRef {
  readonly observerRef: string | null;
  readonly surface: string;
  readonly internalId: string | null;
  readonly tableKind: string | null;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function normalizeSurface(value: string): string {
  return value.trim().toLowerCase().replace(/ё/gu, "е");
}

/** Stale-reference clarification shared by the contextual checks. */
type MasterTurnStaleClarification = Extract<MasterTurnValidation, { readonly status: "clarification" }>;

function staleClarification(surface: string): MasterTurnStaleClarification {
  return {
    status: "clarification",
    question: `«${surface}» сейчас не удаётся связать с тем, что видно. Назови это иначе или осмотрись.`,
    options: [{ optionId: "rephrase", label: "Переформулировать" }],
  };
}

/**
 * Validates one replica plan against the current scene table and world.
 * Pure and read-only: no Events, no Projection writes, no network calls.
 * The optional diagnostics sink receives one taxonomy event per
 * non-accepted outcome; accepted plans stay silent.
 */
export function validateMasterTurnPlan(input: MasterTurnValidationInput): MasterTurnValidation {
  const result = validateMasterTurnPlanInner(input);
  if (input.diagnostics && result.status === "clarification") {
    emitMasterTurnDiagnostic(input.diagnostics, {
      category: input.proposal.ambiguity ? "clarification_returned" : "referent_rejected",
      outcome: "clarification",
      phase: "context_validation",
      turnKind: input.proposal.kind,
      referentCount: input.proposal.referents.length,
      clauseCount: input.proposal.supportingClauses.length,
      contextWorldTime: input.world.time,
      contextEventNumber: input.world.eventNumber,
      worldTime: input.world.time,
    });
  }
  return result;
}

/**
 * Copies the model's non-authoritative memory handoff onto the plan: the
 * stated goal (capped prose) and the reported relation to the pending
 * clarification. Validation of both already happened statically.
 */
function planMemory(proposal: TurnProposalV2): Pick<ValidatedMasterTurnPlan, "goal" | "conversationRelation"> {
  const goal = proposal.goal !== undefined ? proposal.goal.slice(0, 140) : null;
  return freeze({
    goal: goal && goal.length > 0 ? goal : null,
    conversationRelation: proposal.conversationRelation ?? null,
  });
}

function validateMasterTurnPlanInner(input: MasterTurnValidationInput): MasterTurnValidation {
  const { proposal, scene, world, rawText } = input;

  if (proposal.ambiguity) {
    const slot = inferAmbiguitySlot(proposal);
    return {
      status: "clarification",
      question: proposal.ambiguity.question,
      options: proposal.ambiguity.candidates.map((label, index) => ({ optionId: `option-${index + 1}`, label })),
      ...(slot ? { framed: framedCandidate(proposal, slot, scene) } : {}),
    };
  }
  if (proposal.primaryIntent === null) {
    return { status: "invalid", reason: "proposal primary intent is missing" };
  }

  const revision = freeze({ worldTime: world.time, eventNumber: world.eventNumber });
  const memory = planMemory(proposal);
  const focus: ValidatedConversationReferent[] = [];
  const track = (entry: ValidatedConversationReferent): void => {
    const key = entry.observerRef ?? `surface:${entry.kind}:${entry.surface}`;
    if (!focus.some((existing) => (existing.observerRef ?? `surface:${existing.kind}:${existing.surface}`) === key)) {
      focus.push(entry);
    }
  };

  if (proposal.kind === "meta") {
    if (proposal.primaryIntent.kind !== "meta") return { status: "invalid", reason: "meta turn requires a meta primary intent" };
    return {
      status: "accepted",
      plan: freeze({
        contextRevision: revision,
        kind: proposal.kind,
        execution: null,
        postActionInquiries: freeze([]),
        metaInquiry: freeze({ type: "MetaRequest" as const, operation: proposal.primaryIntent.operation }),
        deferredClauses: freeze([]),
        focus: freeze(focus),
        ...memory,
      }),
    };
  }

  if (proposal.kind === "inquiry") {
    if (proposal.primaryIntent.kind !== "inquiry") return { status: "invalid", reason: "inquiry turn requires an inquiry primary intent" };
    const inquiry = checkQuestionFocus(proposal.primaryIntent.queryId, proposal.primaryIntent.focus, proposal.primaryIntent.relation, scene, rawText, track);
    if (inquiry.status !== "accepted") return inquiry;
    const topUp = checkTopQuestions(proposal, scene, rawText, track, inquiry.inquiry);
    if (topUp.status !== "accepted") return topUp;
    return {
      status: "accepted",
      plan: freeze({
        contextRevision: revision,
        kind: proposal.kind,
        execution: null,
        postActionInquiries: topUp.inquiries,
        metaInquiry: null,
        deferredClauses: collectDeferred(proposal, track),
        focus: freeze(focus),
        ...memory,
      }),
    };
  }

  if (proposal.kind === "speech") {
    if (proposal.primaryIntent.kind !== "speech") return { status: "invalid", reason: "speech turn requires a speech primary intent" };
    const addressee = checkRef(proposal.addressedEntity, scene);
    if (addressee.error) return addressee.error;
    if (addressee.ref && addressee.ref.tableKind !== null && addressee.ref.tableKind !== "person") {
      return staleClarification(addressee.ref.surface);
    }
    // A surface-only addressee binds against known people exact-first;
    // ambiguity clarifies with frame options, an unknown name passes
    // through (addressing the absent is still addressing someone).
    let addresseeSurface = addressee.ref?.surface ?? null;
    if (!addressee.ref?.observerRef && proposal.addressedEntity?.surface) {
      const people = scene.context.knownPeople.map((entry) => ({
        observerRef: entry.observerRef, label: entry.label, knownAs: entry.knownAs,
      }));
      const bound = bindSceneSurface(proposal.addressedEntity.surface, people);
      if (bound.status === "ambiguous") {
        const classified = multipleReferents(bound.labels, true);
        return {
          status: "clarification",
          question: classified.question,
          options: [...frameCandidateOptions(bound.labels, scene), ...classified.options],
          framed: framedCandidate(proposal, "addressee", scene),
        };
      }
      if (bound.status === "unique") {
        addresseeSurface = bound.entry.label;
        track(freeze({ observerRef: bound.entry.observerRef, surface: bound.entry.label, kind: "addressee" as const }));
      }
    }
    if (addressee.ref) track(freeze({ observerRef: addressee.ref.observerRef, surface: addressee.ref.surface, kind: "addressee" as const }));
    const intent: ExecutableIntent = freeze({
      type: "ActionIntentCommand" as const,
      mode: "communicate" as const,
      operation: "speak" as const,
      ...(addresseeSurface ? { target: { raw: addresseeSurface } } : {}),
      utterance: proposal.primaryIntent.utterance,
      rawText,
      interpretation: freeze({ source: "llm" as const, confidence: 1, ambiguities: freeze([]) }),
    });
    // Structural scope is the primary span: the full replica legitimately
    // holds deferred clauses and questions (explicitly preserved, never
    // silent), so SECOND_ACTION must not scan it.
    const structural = validateActionProposal({ ...intent, rawText: proposal.primaryIntent.sourceText });
    if (!structural.ok) {
      return { status: "clarification", question: structural.clarification, options: [{ optionId: "rephrase", label: "Переформулировать" }] };
    }
    return {
      status: "accepted",
      plan: freeze({
        contextRevision: revision,
        kind: proposal.kind,
        execution: freeze({ intent }),
        postActionInquiries: freeze([]),
        metaInquiry: null,
        deferredClauses: collectDeferred(proposal, track),
        focus: freeze(focus),
        ...memory,
      }),
    };
  }

  if (proposal.kind !== "action" && proposal.kind !== "mixed") {
    return { status: "invalid", reason: "unsupported turn kind" };
  }
  const primary = proposal.primaryIntent;
  if (primary.kind !== "interaction" && primary.kind !== "journey" && primary.kind !== "legacy") {
    return { status: "invalid", reason: "action turn requires an action primary intent" };
  }
  if (proposal.kind === "mixed" && !proposal.question && proposal.supportingClauses.length === 0) {
    return { status: "invalid", reason: "mixed turn requires a question or supporting clause" };
  }

  const mapped = mapPrimaryAction(primary, proposal, scene, world, rawText, track);
  if (mapped.status !== "accepted") return mapped;
  // Structural scope is the primary span (see the speech branch above).
  const structural = validateActionProposal({ ...mapped.intent, rawText: primary.sourceText });
  if (!structural.ok) {
    return { status: "clarification", question: structural.clarification, options: [{ optionId: "rephrase", label: "Переформулировать" }] };
  }
  const topQuestions = checkTopQuestions(proposal, scene, rawText, track, null);
  if (topQuestions.status !== "accepted") return topQuestions;
  return {
    status: "accepted",
    plan: freeze({
      contextRevision: revision,
      kind: proposal.kind,
      execution: freeze({ intent: mapped.intent }),
      postActionInquiries: topQuestions.inquiries,
      metaInquiry: null,
      deferredClauses: collectDeferred(proposal, track),
      focus: freeze(focus),
      ...memory,
    }),
  };
}

/** Checks one referent against the scene table. Surface-only mentions pass through for world-side resolution. */
function checkRef(
  referent: ProposedReferent | undefined,
  scene: MasterTurnSceneSnapshot,
): { readonly ref: CheckedRef | null; readonly error: UnacceptedValidation | null } {
  if (!referent) return { ref: null, error: null };
  if (!referent.observerRef) {
    return { ref: freeze({ observerRef: null, surface: referent.surface, internalId: null, tableKind: null }), error: null };
  }
  const entry = scene.references.get(referent.observerRef);
  if (!entry || normalizeSurface(entry.label) !== normalizeSurface(referent.surface)) {
    return { ref: null, error: staleClarification(referent.surface) };
  }
  return {
    ref: freeze({ observerRef: referent.observerRef, surface: referent.surface, internalId: entry.internalId, tableKind: entry.kind }),
    error: null,
  };
}

function focusRole(role: ProposedReferent["role"]): ValidatedConversationReferent["kind"] {
  if (role === "addressee") return "addressee";
  if (role === "topic") return "topic";
  if (role === "destination") return "destination";
  return "target";
}

/** Maps the primary action to an existing transient command with world pre-checks. */
function mapPrimaryAction(
  primary: Extract<TurnProposalV2["primaryIntent"], { kind: "interaction" | "journey" | "legacy" }>,
  proposal: TurnProposalV2,
  scene: MasterTurnSceneSnapshot,
  world: ReadonlyWorld,
  rawText: string,
  track: (entry: ValidatedConversationReferent) => void,
): MappedIntent {
  const interpretation = freeze({ source: "llm" as const, confidence: 1, ambiguities: freeze([]) });
  const manner = proposal.manner ?? firstSupportingValue(proposal, "manner");
  const goal = proposal.goal ?? firstSupportingValue(proposal, "constraint");

  if (primary.kind === "journey") {
    const destination = checkRef(primary.destination, scene);
    if (destination.error) return destination.error;
    if (destination.ref?.observerRef && destination.ref.tableKind !== "route") {
      return staleClarification(destination.ref.surface);
    }
    if (destination.ref) track(freeze({ observerRef: destination.ref.observerRef, surface: destination.ref.surface, kind: "destination" as const }));
    return {
      status: "accepted",
      intent: freeze({
        type: "JourneyIntent" as const,
        destination: { raw: primary.destination.surface },
        ...(primary.routeHint?.trim() ? { routeHint: { raw: primary.routeHint.trim() } } : {}),
        rawText,
        interpretation,
      }),
    };
  }

  const target = checkRef(proposal.target, scene);
  if (target.error) return target.error;
  // A surface-only referent never becomes a target on its own (review
  // P1): compounds split into an explicit conflicting-actions
  // clarification, bound surfaces resolve exact-first, ambiguity
  // clarifies with selectable frame options, and only the remainder
  // reaches the world-side resolver.
  let surface: string | null = target.ref?.surface ?? null;
  let boundRef: CheckedRef | null = target.ref?.observerRef ? target.ref : null;
  if (target.ref) track(freeze({ observerRef: target.ref.observerRef, surface: target.ref.surface, kind: "target" as const }));
  if (!boundRef && proposal.target?.surface) {
    const bound = bindProposalTarget(proposal.target.surface, scene);
    if (bound.status === "compound") {
      const classified = conflictingActions([bound.head, bound.tail]);
      return { status: "clarification", question: classified.question, options: classified.options };
    }
    if (bound.status === "ambiguous") {
      const classified = multipleReferents(bound.labels, false);
      return {
        status: "clarification",
        question: classified.question,
        options: [...frameCandidateOptions(bound.labels, scene), ...classified.options],
        framed: framedCandidate(proposal, "target", scene),
      };
    }
    if (bound.status === "bound") {
      const entry = scene.references.get(bound.observerRef);
      boundRef = freeze({
        observerRef: bound.observerRef,
        surface: bound.label,
        internalId: entry?.internalId ?? null,
        tableKind: entry?.kind ?? null,
      });
      surface = bound.label;
      track(freeze({ observerRef: bound.observerRef, surface: bound.label, kind: "target" as const }));
    }
  }

  if (primary.kind === "interaction") {
    const advised = adviseTarget(world, primary.verb, surface ?? undefined, scene, proposal);
    if (advised) return advised;
    const accessible = checkAccessible(world, boundRef ?? target.ref);
    if (accessible) return accessible;
    if (primary.verb === "use") {
      const affordance = checkAffordance(world, boundRef ?? target.ref);
      if (affordance) return affordance;
    }
    return {
      status: "accepted",
      intent: freeze({
        type: "InteractionCommand" as const,
        verb: primary.verb,
        ...(surface ? { target: { raw: surface } } : {}),
        ...(goal ? { goal } : {}),
        ...(manner ? { manner } : {}),
        rawText,
        interpretation,
      }),
    };
  }

  const advised = adviseTarget(world, primary.operation, surface ?? undefined, scene, proposal);
  if (advised) return advised;
  const accessible = checkAccessible(world, boundRef ?? target.ref);
  if (accessible) return accessible;
  return {
    status: "accepted",
    intent: freeze({
      type: "ActionIntentCommand" as const,
      mode: primary.operation === "wait" ? ("wait" as const) : primary.operation === "speak" || primary.operation === "call" ? ("communicate" as const) : ("interact" as const),
      operation: primary.operation,
      ...(surface ? { target: { raw: surface } } : {}),
      ...(goal ? { goal } : {}),
      ...(manner ? { manner } : {}),
      rawText,
      interpretation,
    }),
  };
}

/** All scene entries a model-proposed surface may bind to. */
function sceneBindEntries(scene: MasterTurnSceneSnapshot): SceneBindEntry[] {
  const context = scene.context;
  return [
    ...context.visibleObjects.map((entry) => ({ observerRef: entry.observerRef, label: entry.label, knownAs: entry.knownAs })),
    ...context.knownPeople.map((entry) => ({ observerRef: entry.observerRef, label: entry.label, knownAs: entry.knownAs })),
    ...context.accessibleItems.map((entry) => ({ observerRef: entry.observerRef, label: entry.label, knownAs: entry.knownAs })),
    ...context.knownRoutes.map((entry) => ({ observerRef: entry.observerRef, label: entry.label, knownAs: entry.knownAs })),
  ];
}

type ProposalTargetBind =
  | { readonly status: "bound"; readonly observerRef: string; readonly label: string }
  | { readonly status: "ambiguous"; readonly labels: readonly string[] }
  | { readonly status: "compound"; readonly head: string; readonly tail: string }
  | { readonly status: "absent" };

/**
 * Binds a model-proposed target surface before it may become an intent
 * target (review P1): compounds split into an explicit conflicting-actions
 * clarification, bound surfaces resolve exact-first, ambiguity clarifies
 * with selectable frame options, and only the remainder reaches the
 * world-side resolver.
 */
function bindProposalTarget(
  surface: string,
  scene: MasterTurnSceneSnapshot,
): ProposalTargetBind {
  const split = splitTargetCompound(surface);
  if (split) return { status: "compound", head: split.head, tail: split.tail };
  const bound = bindSceneSurface(surface, sceneBindEntries(scene));
  if (bound.status === "unique") {
    return { status: "bound", observerRef: bound.entry.observerRef, label: bound.entry.label };
  }
  if (bound.status === "ambiguous") return { status: "ambiguous", labels: bound.labels };
  return { status: "absent" };
}

function frameCandidateOptions(
  labels: readonly string[],
  scene?: MasterTurnSceneSnapshot,
): readonly MasterTurnClarificationOption[] {
  return Object.freeze(labels.slice(0, 3).map((label, index) => {
    const refs = scene ? refsForLabels([label], scene) : [];
    return Object.freeze({
      optionId: `candidate-${index + 1}`,
      label,
      ...(refs.length > 0 ? { referentRefs: refs } : {}),
    });
  }));
}

/**
 * Resolves candidate labels to current scene refs (exact-first). Labels
 * without a hit resolve at answer time instead — the option stays
 * label-only rather than inventing a handle.
 */
function refsForLabels(labels: readonly string[], scene: MasterTurnSceneSnapshot): readonly string[] {
  const entries = sceneBindEntries(scene);
  const refs: string[] = [];
  for (const label of labels) {
    const bound = bindSceneSurface(label, entries);
    if (bound.status === "unique" && !refs.includes(bound.entry.observerRef)) refs.push(bound.entry.observerRef);
  }
  return Object.freeze(refs);
}

/**
 * Builds the stored structured candidate for one referent-slot
 * clarification (review P1): the proposal, the fillable slot and the
 * asking scene revision. An exact answer patches the slot and revalidates
 * with no second model call.
 */
function framedCandidate(
  proposal: TurnProposalV2,
  slot: AmbiguitySlot,
  scene: MasterTurnSceneSnapshot,
): FramedClarification {
  return {
    slot,
    proposal,
    revision: { ...scene.context.revision },
  };
}

/** Advisory resolver pre-check: missing or ambiguous targets clarify before the queue. */
function adviseTarget(
  world: ReadonlyWorld,
  verb: string,
  surface: string | undefined,
  scene: MasterTurnSceneSnapshot,
  proposal: TurnProposalV2,
): UnacceptedValidation | null {
  if (!surface) return null;
  const resolution = resolveInteractionTarget(world, verb, surface);
  if (resolution.kind === "resolved") return null;
  if (resolution.kind === "ambiguous") {
    const labels = resolution.candidates.slice(0, 4).map((candidate) => candidate.name);
    return {
      status: "clarification",
      question: "Уточни, что именно ты имеешь в виду.",
      options: frameCandidateOptions(labels, scene),
      framed: framedCandidate(proposal, "target", scene),
    };
  }
  return staleClarification(surface);
}

/** Known capability items must stay accessible; other referents pass through. */
function checkAccessible(world: ReadonlyWorld, ref: CheckedRef | null): UnacceptedValidation | null {
  if (!ref?.internalId) return null;
  const definitions = world.actionCapabilities?.itemDefinitions;
  if (!definitions?.has(ref.internalId)) return null;
  if (isItemAccessible(world, "player", ref.internalId)) return null;
  return {
    status: "clarification",
    question: `«${ref.surface}» сейчас недоступен. Выбери что-то из видимого или осмотрись.`,
    options: [{ optionId: "rephrase", label: "Выбрать другое" }],
  };
}

/** Using an item requires a registered affordance on its definition. */
function checkAffordance(world: ReadonlyWorld, ref: CheckedRef | null): UnacceptedValidation | null {
  if (!ref?.internalId) return null;
  const definition = world.actionCapabilities?.itemDefinitions.get(ref.internalId);
  if (!definition || definition.affordances.length > 0) return null;
  return {
    status: "clarification",
    question: `«${ref.surface}» так использовать не получится.`,
    options: [{ optionId: "rephrase", label: "Выбрать другое действие" }],
  };
}

/** Validates one inquiry (primary or question) with observer-safe focus. */
function checkQuestionFocus(
  queryId: string,
  focus: ProposedReferent | undefined,
  relation: InquiryRequest["relation"],
  scene: MasterTurnSceneSnapshot,
  rawText: string,
  track: (entry: ValidatedConversationReferent) => void,
): MappedInquiry {
  if (!isInquiryQueryId(queryId)) return { status: "invalid", reason: "unknown inquiry query" };
  if (!focus) {
    return {
      status: "accepted",
      inquiry: freeze({
        type: "InquiryRequest" as const,
        queryId: queryId as InquiryRequest["queryId"],
        rawText,
        confidence: 1 as const,
        source: "llm" as const,
        ...(relation ? { relation } : {}),
      }),
    };
  }
  const checked = checkRef(focus, scene);
  if (checked.error) return checked.error;
  if (checked.ref) track(freeze({ observerRef: checked.ref.observerRef, surface: checked.ref.surface, kind: focusRole(focus.role) }));
  return {
    status: "accepted",
    inquiry: freeze({
      type: "InquiryRequest" as const,
      queryId: queryId as InquiryRequest["queryId"],
      rawText,
      confidence: 1 as const,
      source: "llm" as const,
      focus: freeze({ ...(focus.observerRef ? { observerRef: focus.observerRef } : {}), surface: focus.surface }),
      ...(relation ? { relation } : {}),
    }),
  };
}

/**
 * Top-level question plus every supporting question, in order. Each one is
 * validated on its own: a single bad question clarifies specifically about
 * that part instead of sinking the understood rest (plan_9 §1: no silent
 * loss). With no questions at all the fallback inquiry (if any) answers.
 */
function checkTopQuestions(
  proposal: TurnProposalV2,
  scene: MasterTurnSceneSnapshot,
  rawText: string,
  track: (entry: ValidatedConversationReferent) => void,
  fallback: InquiryRequest | null,
): MappedInquiries {
  const questions: { readonly queryId: string; readonly focus: ProposedReferent | undefined; readonly relation: InquiryRequest["relation"] }[] = [];
  if (proposal.question) {
    questions.push({ queryId: proposal.question.queryId, focus: proposal.question.focus, relation: proposal.question.relation });
  }
  for (const clause of proposal.supportingClauses) {
    if (clause.kind !== "question") continue;
    questions.push({ queryId: clause.queryId, focus: clause.focus, relation: undefined });
  }
  if (questions.length === 0) return { status: "accepted", inquiries: fallback ? freeze([fallback]) : freeze([]) };
  const inquiries: InquiryRequest[] = [];
  for (const question of questions) {
    const checked = checkQuestionFocus(question.queryId, question.focus, question.relation, scene, rawText, track);
    if (checked.status !== "accepted") return checked;
    inquiries.push(checked.inquiry);
  }
  return { status: "accepted", inquiries: freeze(inquiries) };
}

/** Deferred actions plus speech topics land in deferred clauses and focus. */
function collectDeferred(
  proposal: TurnProposalV2,
  track: (entry: ValidatedConversationReferent) => void,
): readonly DeferredClause[] {
  const deferred: DeferredClause[] = [];
  for (const clause of proposal.supportingClauses) {
    if (clause.kind === "deferred_action") {
      deferred.push(freeze({ text: clause.summary, reason: "secondary_action" as const }));
    }
    if (clause.kind === "speech_topic") {
      track(freeze({ observerRef: clause.topic.observerRef ?? null, surface: clause.topic.surface, kind: "topic" as const }));
    }
  }
  return freeze(deferred);
}

/** First supporting value promotes to intent goal/manner when top-level is absent. */
function firstSupportingValue(proposal: TurnProposalV2, kind: "constraint" | "manner"): string | undefined {
  const clause = proposal.supportingClauses.find((entry) => entry.kind === kind);
  if (!clause || (clause.kind !== "constraint" && clause.kind !== "manner")) return undefined;
  return clause.value;
}
