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
  type MasterTurnSceneSnapshot,
  type ReadonlyWorld,
} from "@skald/world";
import {
  isInquiryQueryId,
  validateActionProposal,
  type ExecutableIntent,
  type InquiryRequest,
  type ProposedReferent,
  type TurnMetaOperation,
  type TurnProposalKind,
  type TurnProposalV2,
} from "@skald/intent-parser";

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
 * plus an optional read-only question. Owned by the request, never stored.
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
  readonly postActionInquiry: InquiryRequest | null;
  readonly metaInquiry: RegisteredMetaRequest | null;
  readonly deferredClauses: readonly DeferredClause[];
  readonly focus: readonly ValidatedConversationReferent[];
}

/** Player-facing clarification option. */
export interface MasterTurnClarificationOption {
  readonly optionId: string;
  readonly label: string;
}

/** Contextual validation outcome. Reasons stay sanitized (no internals). */
export type MasterTurnValidation =
  | { readonly status: "accepted"; readonly plan: ValidatedMasterTurnPlan }
  | { readonly status: "clarification"; readonly question: string; readonly options: readonly MasterTurnClarificationOption[] }
  | { readonly status: "invalid"; readonly reason: string };

/** Input for contextual validation. */
export interface MasterTurnValidationInput {
  readonly proposal: TurnProposalV2;
  readonly scene: MasterTurnSceneSnapshot;
  readonly world: ReadonlyWorld;
  readonly rawText: string;
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
type MappedNullableInquiry =
  | { readonly status: "accepted"; readonly inquiry: InquiryRequest | null }
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
 */
export function validateMasterTurnPlan(input: MasterTurnValidationInput): MasterTurnValidation {
  const { proposal, scene, world, rawText } = input;

  if (proposal.ambiguity) {
    return {
      status: "clarification",
      question: proposal.ambiguity.question,
      options: proposal.ambiguity.candidates.map((label, index) => ({ optionId: `option-${index + 1}`, label })),
    };
  }
  if (proposal.primaryIntent === null) {
    return { status: "invalid", reason: "proposal primary intent is missing" };
  }

  const revision = freeze({ worldTime: world.time, eventNumber: world.eventNumber });
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
        postActionInquiry: null,
        metaInquiry: freeze({ type: "MetaRequest" as const, operation: proposal.primaryIntent.operation }),
        deferredClauses: freeze([]),
        focus: freeze(focus),
      }),
    };
  }

  if (proposal.kind === "inquiry") {
    if (proposal.primaryIntent.kind !== "inquiry") return { status: "invalid", reason: "inquiry turn requires an inquiry primary intent" };
    const inquiry = checkQuestionFocus(proposal.primaryIntent.queryId, proposal.primaryIntent.focus, proposal.primaryIntent.relation, scene, rawText, track);
    if (inquiry.status !== "accepted") return inquiry;
    const topUp = checkTopQuestion(proposal, scene, rawText, track, inquiry.inquiry);
    if (topUp.status !== "accepted") return topUp;
    return {
      status: "accepted",
      plan: freeze({
        contextRevision: revision,
        kind: proposal.kind,
        execution: null,
        postActionInquiry: topUp.inquiry,
        metaInquiry: null,
        deferredClauses: collectDeferred(proposal, track),
        focus: freeze(focus),
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
    if (addressee.ref) track(freeze({ observerRef: addressee.ref.observerRef, surface: addressee.ref.surface, kind: "addressee" as const }));
    const intent: ExecutableIntent = freeze({
      type: "ActionIntentCommand" as const,
      mode: "communicate" as const,
      operation: "speak" as const,
      ...(addressee.ref ? { target: { raw: addressee.ref.surface } } : {}),
      utterance: proposal.primaryIntent.utterance,
      rawText,
      interpretation: freeze({ source: "llm" as const, confidence: 1, ambiguities: freeze([]) }),
    });
    const structural = validateActionProposal(intent);
    if (!structural.ok) {
      return { status: "clarification", question: structural.clarification, options: [{ optionId: "rephrase", label: "Переформулировать" }] };
    }
    return {
      status: "accepted",
      plan: freeze({
        contextRevision: revision,
        kind: proposal.kind,
        execution: freeze({ intent }),
        postActionInquiry: null,
        metaInquiry: null,
        deferredClauses: collectDeferred(proposal, track),
        focus: freeze(focus),
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
  const structural = validateActionProposal(mapped.intent);
  if (!structural.ok) {
    return { status: "clarification", question: structural.clarification, options: [{ optionId: "rephrase", label: "Переформулировать" }] };
  }
  const topQuestion = checkTopQuestion(proposal, scene, rawText, track, null);
  if (topQuestion.status !== "accepted") return topQuestion;
  return {
    status: "accepted",
    plan: freeze({
      contextRevision: revision,
      kind: proposal.kind,
      execution: freeze({ intent: mapped.intent }),
      postActionInquiry: topQuestion.inquiry,
      metaInquiry: null,
      deferredClauses: collectDeferred(proposal, track),
      focus: freeze(focus),
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
  if (target.ref) track(freeze({ observerRef: target.ref.observerRef, surface: target.ref.surface, kind: "target" as const }));
  const surface = target.ref?.surface;

  if (primary.kind === "interaction") {
    const advised = adviseTarget(world, primary.verb, surface);
    if (advised) return advised;
    const accessible = checkAccessible(world, target.ref);
    if (accessible) return accessible;
    if (primary.verb === "use") {
      const affordance = checkAffordance(world, target.ref);
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

  const advised = adviseTarget(world, primary.operation, surface);
  if (advised) return advised;
  const accessible = checkAccessible(world, target.ref);
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

/** Advisory resolver pre-check: missing or ambiguous targets clarify before the queue. */
function adviseTarget(world: ReadonlyWorld, verb: string, surface: string | undefined): UnacceptedValidation | null {
  if (!surface) return null;
  const resolution = resolveInteractionTarget(world, verb, surface);
  if (resolution.kind === "resolved") return null;
  if (resolution.kind === "ambiguous") {
    return {
      status: "clarification",
      question: "Уточни, что именно ты имеешь в виду.",
      options: resolution.candidates.slice(0, 4).map((candidate, index) => ({ optionId: `candidate-${index + 1}`, label: candidate.name })),
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

/** Top-level question wins; the first supporting question fills in when absent. */
function checkTopQuestion(
  proposal: TurnProposalV2,
  scene: MasterTurnSceneSnapshot,
  rawText: string,
  track: (entry: ValidatedConversationReferent) => void,
  fallback: InquiryRequest | null,
): MappedNullableInquiry {
  const supporting = proposal.supportingClauses.find((clause) => clause.kind === "question");
  const question = proposal.question ?? (supporting ? { queryId: supporting.queryId, focus: supporting.focus, relation: undefined } : undefined);
  if (!question) return { status: "accepted", inquiry: fallback };
  const checked = checkQuestionFocus(question.queryId, question.focus, question.relation, scene, rawText, track);
  if (checked.status !== "accepted") return checked;
  return { status: "accepted", inquiry: checked.inquiry };
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
