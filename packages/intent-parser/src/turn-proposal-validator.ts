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
  parseTurnProposal,
  type ProposedReferent,
  type TurnProposalV2,
} from "./turn-proposal.js";

/** Static validation outcome for a TurnProposalV2. */
export type TurnProposalValidation =
  | { readonly status: "accepted"; readonly proposal: TurnProposalV2 }
  | { readonly status: "clarification"; readonly question: string; readonly options: readonly ClarificationOption[] }
  | { readonly status: "invalid"; readonly reason: string };

/**
 * Validates untrusted JSON as a TurnProposalV2. Returns the frozen proposal
 * when it is statically consistent, a clarification when the model reports
 * ambiguity, or invalid with a sanitized reason (never player text).
 */
export function validateTurnProposal(raw: unknown): TurnProposalValidation {
  const authority = findAuthorityField(raw);
  if (authority) return { status: "invalid", reason: `proposal contains authority field: ${authority}` };
  const proposal = parseTurnProposal(raw);
  if (!proposal) return { status: "invalid", reason: "proposal does not match TurnProposalV2" };

  const consistency = checkKindConsistency(proposal);
  if (consistency) return consistency;
  const placement = checkQuestionPlacement(proposal);
  if (placement) return placement;
  const valency = checkTargetValency(proposal);
  if (valency) return valency;
  const membership = checkReferentMembership(proposal);
  if (membership) return membership;

  if (proposal.ambiguity) {
    return {
      status: "clarification",
      question: proposal.ambiguity.question,
      options: proposal.ambiguity.candidates.map((label, index) => ({ optionId: `option-${index + 1}`, label })),
    };
  }
  if (proposal.primaryIntent === null) {
    return { status: "invalid", reason: "proposal primary intent is missing without ambiguity" };
  }
  return { status: "accepted", proposal };
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
        return { status: "invalid", reason: "action turn requires an action primary intent" };
      }
      return null;
    case "inquiry":
      if (!primary || primary.kind !== "inquiry") {
        return { status: "invalid", reason: "inquiry turn requires an inquiry primary intent" };
      }
      return null;
    case "speech":
      if (!primary || primary.kind !== "speech") {
        return { status: "invalid", reason: "speech turn requires a speech primary intent with utterance" };
      }
      return null;
    case "mixed":
      if (!primary || (primary.kind !== "interaction" && primary.kind !== "journey" && primary.kind !== "legacy")) {
        return { status: "invalid", reason: "mixed turn requires one executable action primary intent" };
      }
      if (!proposal.question && proposal.supportingClauses.length === 0) {
        return { status: "invalid", reason: "mixed turn requires a question or supporting clause" };
      }
      return null;
    case "meta":
      if (!primary || primary.kind !== "meta") {
        return { status: "invalid", reason: "meta turn requires a registered meta operation" };
      }
      if (proposal.supportingClauses.length > 0) {
        return { status: "invalid", reason: "meta turn carries no supporting clauses" };
      }
      return null;
  }
}

/** A turn-level question is allowed only for mixed/inquiry turns. */
function checkQuestionPlacement(proposal: TurnProposalV2): TurnProposalValidation | null {
  if (!proposal.question) return null;
  if (proposal.kind === "mixed" || proposal.kind === "inquiry") return null;
  return { status: "invalid", reason: "question is allowed only for mixed or inquiry turns" };
}

/** Enforces target valency for interaction verbs and legacy operations. */
function checkTargetValency(proposal: TurnProposalV2): TurnProposalValidation | null {
  const primary = proposal.primaryIntent;
  if (!primary) return null;
  if (proposal.kind !== "action" && proposal.kind !== "mixed") return null;
  if (primary.kind === "journey") {
    if (!primary.destination.surface.trim()) {
      return { status: "invalid", reason: "journey destination is missing" };
    }
    if (primary.destination.role !== "destination") {
      return { status: "invalid", reason: "journey destination must use the destination role" };
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
    return { status: "invalid", reason: "turn target must use the target role" };
  }
  if (valency === "forbidden" && proposal.target) {
    return { status: "invalid", reason: "action forbids a target" };
  }
  if (valency === "required" && !proposal.target) {
    return { status: "invalid", reason: "action requires a target" };
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
      return { status: "invalid", reason: `referent ${referent.observerRef} is not declared` };
    }
    if (declared !== referent.surface) {
      return { status: "invalid", reason: `referent ${referent.observerRef} surface mismatch` };
    }
  }
  if (proposal.addressedEntity && proposal.addressedEntity.role !== "addressee") {
    return { status: "invalid", reason: "addressed entity must use the addressee role" };
  }
  return null;
}
