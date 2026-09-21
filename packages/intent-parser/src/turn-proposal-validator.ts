/**
 * Static TurnProposalV2 validation (plan_6 Stage 7.1).
 *
 * Pure shape, registry and consistency checks without world access:
 * schema version, turn kind, kind/primary agreement, closed
 * verb/operation/query/meta registries, target valency, question placement,
 * speech utterance, supporting-clause bounds, referent-table membership and
 * authority-field rejection. Contextual checks against the live world
 * (observerRef existence, affordances, routes) belong to the later
 * server-side master-turn validator, not here.
 */

import { targetRequirementForInteraction, targetRequirementForOperation } from "./deterministic-interpreter.js";
import type { ClarificationOption } from "./intent-proposal.js";
import {
  TURN_AUTHORITY_FIELDS,
  diagnoseTurnProposalShape,
  parseTurnProposal,
  type ProposalShapeCode,
  type ProposedReferent,
  type TurnConversationRelation,
  type TurnProposalV2,
} from "./turn-proposal.js";

/** Closed static rejection codes: safe for production diagnostics. */
export type TurnProposalInvalidCode =
  | "authority_field"
  | "shape"
  | "kind_primary_mismatch"
  | "question_placement"
  | "valency"
  | "referent_membership"
  | "primary_missing";

/** Static validation outcome for a TurnProposalV2. */
export type TurnProposalValidation =
  | { readonly status: "accepted"; readonly proposal: TurnProposalV2 }
  | {
    readonly status: "clarification";
    readonly question: string;
    readonly options: readonly ClarificationOption[];
    readonly relation?: TurnConversationRelation | null | undefined;
    /**
     * Closed structured candidate for frame resolution (review P1): the
     * proposal plus the single surface-only slot the choice fills. The
     * consumer stamps the scene revision and revalidates after patching —
     * no second model call. Absent when no single slot is identifiable.
     */
    readonly framedProposal?: FramedProposalCandidate | undefined;
  }
  | { readonly status: "invalid"; readonly code: TurnProposalInvalidCode; readonly reason: string; readonly shapeCode?: ProposalShapeCode | undefined; readonly shapeKey?: string | undefined };

/** Referent slot a clarification choice fills inside a stored proposal. */
export type AmbiguitySlot = "target" | "addressee" | "destination";

/** Closed structured candidate: proposal plus its single fillable slot. */
export interface FramedProposalCandidate {
  readonly proposal: TurnProposalV2;
  readonly slot: AmbiguitySlot;
}

/**
 * Identifies the single surface-only referent a clarification choice
 * fills: the turn target first, then the addressee, then a journey
 * destination. Null when no single slot is identifiable (the frame then
 * falls back to re-interpretation). Pure and total.
 */
export function inferAmbiguitySlot(proposal: TurnProposalV2): AmbiguitySlot | null {
  if (proposal.target && !proposal.target.observerRef) return "target";
  if (proposal.addressedEntity && !proposal.addressedEntity.observerRef) return "addressee";
  if (proposal.primaryIntent?.kind === "journey" && !proposal.primaryIntent.destination.observerRef) return "destination";
  return null;
}

/**
 * Validates untrusted JSON as a TurnProposalV2. Returns the frozen proposal
 * when it is statically consistent, a clarification when the model reports
 * ambiguity, or invalid with a sanitized reason (never player text).
 */
export function validateTurnProposal(raw: unknown): TurnProposalValidation {
  const authority = findAuthorityField(raw);
  if (authority) return { status: "invalid", code: "authority_field", reason: `proposal contains authority field: ${authority}` };
  const proposal = parseTurnProposal(raw);
  if (!proposal) {
    const shape = diagnoseTurnProposalShape(raw);
    return {
      status: "invalid",
      code: "shape",
      shapeCode: shape.code,
      ...(shape.key ? { shapeKey: shape.key } : {}),
      reason: `proposal does not match TurnProposalV2 (${shape.code}${shape.key ? `:${shape.key}` : ""})`,
    };
  }

  // A proposal that reports ONLY ambiguity carries a null primaryIntent by
  // contract; kind consistency must not reject a field the schema allows.
  if (proposal.primaryIntent === null) {
    if (proposal.ambiguity) return ambiguityClarification(proposal);
    return { status: "invalid", code: "primary_missing", reason: "proposal primary intent is missing without ambiguity" };
  }

  const consistency = checkKindConsistency(proposal);
  if (consistency) return consistency;
  const placement = checkQuestionPlacement(proposal);
  if (placement) return placement;
  const valency = checkTargetValency(proposal);
  if (valency) return valency;
  const membership = checkReferentMembership(proposal);
  if (membership) return membership;

  if (proposal.ambiguity) return ambiguityClarification(proposal);
  return { status: "accepted", proposal };
}

/** Maps a reported ambiguity onto a clarification (with its structured slot). */
function ambiguityClarification(proposal: TurnProposalV2): TurnProposalValidation {
  const slot = inferAmbiguitySlot(proposal);
  return {
    status: "clarification",
    question: proposal.ambiguity!.question,
    options: proposal.ambiguity!.candidates.map((label, index) => ({ optionId: `option-${index + 1}`, label })),
    ...(proposal.conversationRelation !== undefined ? { relation: proposal.conversationRelation } : {}),
    ...(slot ? { framedProposal: { proposal, slot } } : {}),
  };
}

/**
 * Finds the first authority-violating key anywhere in untrusted JSON.
 * Returns the key name or null. Bounded against deep or cyclic input.
 */
export function findAuthorityField(raw: unknown): string | null {
  const denied = new Set(TURN_AUTHORITY_FIELDS);
  const seen = new Set<object>();
  const stack: unknown[] = [raw];
  let steps = 0;
  while (stack.length > 0) {
    if (++steps > 500) return null;
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const entry of current) stack.push(entry);
      continue;
    }
    for (const key of Object.keys(current)) {
      if (denied.has(key)) return key;
      stack.push((current as Record<string, unknown>)[key]);
    }
  }
  return null;
}

/** Enforces kind/primary agreement and per-kind structural requirements. */
function checkKindConsistency(proposal: TurnProposalV2): TurnProposalValidation | null {
  const primary = proposal.primaryIntent;
  switch (proposal.kind) {
    case "action":
      if (!primary || (primary.kind !== "interaction" && primary.kind !== "journey" && primary.kind !== "legacy")) {
        return { status: "invalid", code: "kind_primary_mismatch", reason: "action turn requires an action primary intent" };
      }
      return null;
    case "inquiry":
      if (!primary || primary.kind !== "inquiry") {
        return { status: "invalid", code: "kind_primary_mismatch", reason: "inquiry turn requires an inquiry primary intent" };
      }
      return null;
    case "speech":
      if (!primary || primary.kind !== "speech") {
        return { status: "invalid", code: "kind_primary_mismatch", reason: "speech turn requires a speech primary intent with utterance" };
      }
      return null;
    case "mixed":
      if (!primary || (primary.kind !== "interaction" && primary.kind !== "journey" && primary.kind !== "legacy")) {
        return { status: "invalid", code: "kind_primary_mismatch", reason: "mixed turn requires one executable action primary intent" };
      }
      if (!proposal.question && proposal.supportingClauses.length === 0) {
        return { status: "invalid", code: "kind_primary_mismatch", reason: "mixed turn requires a question or supporting clause" };
      }
      return null;
    case "meta":
      if (!primary || primary.kind !== "meta") {
        return { status: "invalid", code: "kind_primary_mismatch", reason: "meta turn requires a registered meta operation" };
      }
      if (proposal.supportingClauses.length > 0) {
        return { status: "invalid", code: "kind_primary_mismatch", reason: "meta turn carries no supporting clauses" };
      }
      return null;
  }
}

/** A turn-level question is allowed only for mixed/inquiry turns. */
function checkQuestionPlacement(proposal: TurnProposalV2): TurnProposalValidation | null {
  if (!proposal.question) return null;
  if (proposal.kind === "mixed" || proposal.kind === "inquiry") return null;
  return { status: "invalid", code: "question_placement", reason: "question is allowed only for mixed or inquiry turns" };
}

/** Enforces target valency for interaction verbs and legacy operations. */
function checkTargetValency(proposal: TurnProposalV2): TurnProposalValidation | null {
  const primary = proposal.primaryIntent;
  if (!primary) return null;
  if (proposal.kind !== "action" && proposal.kind !== "mixed") return null;
  if (primary.kind === "journey") {
    if (!primary.destination.surface.trim()) {
      return { status: "invalid", code: "valency", reason: "journey destination is missing" };
    }
    if (primary.destination.role !== "destination") {
      return { status: "invalid", code: "valency", reason: "journey destination must use the destination role" };
    }
    return null;
  }
  if (primary.kind !== "interaction" && primary.kind !== "legacy") return null;
  const valency = primary.kind === "interaction"
    ? targetRequirementForInteraction(primary.verb)
    : targetRequirementForOperation(primary.operation);
  // Operations without canonical valency stay compatible (mirrors V1).
  if (valency === undefined) return null;
  if (proposal.target && proposal.target.role !== "target") {
    return { status: "invalid", code: "valency", reason: "turn target must use the target role" };
  }
  if (valency === "forbidden" && proposal.target) {
    return { status: "invalid", code: "valency", reason: "action forbids a target" };
  }
  if (valency === "required" && !proposal.target) {
    return { status: "invalid", code: "valency", reason: "action requires a target" };
  }
  return null;
}

/** Every observerRef used outside the table must be declared with equal surface. */
function checkReferentMembership(proposal: TurnProposalV2): TurnProposalValidation | null {
  const table = new Map<string, string>();
  for (const referent of proposal.referents) {
    if (referent.observerRef) table.set(referent.observerRef, referent.surface);
  }
  const used: readonly (ProposedReferent | undefined)[] = [
    proposal.addressedEntity,
    proposal.target,
    proposal.question?.focus,
    ...proposal.supportingClauses.flatMap((clause): readonly (ProposedReferent | undefined)[] => {
      if (clause.kind === "question") return [clause.focus];
      if (clause.kind === "speech_topic") return [clause.topic];
      return [];
    }),
    ...(proposal.primaryIntent?.kind === "journey" ? [proposal.primaryIntent.destination] : []),
    ...(proposal.primaryIntent?.kind === "inquiry" ? [proposal.primaryIntent.focus] : []),
  ];
  for (const referent of used) {
    if (!referent?.observerRef) continue;
    const declared = table.get(referent.observerRef);
    if (declared === undefined) {
      return { status: "invalid", code: "referent_membership", reason: `referent ${referent.observerRef} is not declared` };
    }
    if (declared !== referent.surface) {
      return { status: "invalid", code: "referent_membership", reason: `referent ${referent.observerRef} surface mismatch` };
    }
  }
  if (proposal.addressedEntity && proposal.addressedEntity.role !== "addressee") {
    return { status: "invalid", code: "referent_membership", reason: "addressed entity must use the addressee role" };
  }
  return null;
}
