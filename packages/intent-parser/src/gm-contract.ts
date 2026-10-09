/**
 * Conversation Director contract (SKALD S0 / P0).
 *
 * The versioned wire contract between the conversation layer and the LLM:
 * the director receives a `GmContext` and must return a `GmTurnDecision`.
 * Both are validated with a STRICT schema — no extra keys, no unknown
 * operations, no arbitrary handles — so an invalid structure never reaches the
 * authoritative World Engine.
 *
 * This module is pure and changes nothing on the live path; P0 only fixes the
 * contract and its validator.
 */

import { INTENT_CAPABILITIES } from "./intent-proposal.js";
import { TURN_LEGACY_OPERATIONS } from "./turn-proposal.js";

/** Contract version carried on every context and decision. */
export const GM_CONTRACT_VERSION = 1;

/** An opaque, server-assigned actor handle (e.g. "e1"). Never a domain ID. */
export type VisibleActorKey = string;

/** How well the player knows an actor, from the scene/biography. */
export type FamiliarityTier = "stranger" | "acquaintance" | "familiar" | "trusted";

export interface GmSceneContext {
  readonly locationDescription: string;
  readonly worldTime: string;
  readonly sceneEngagement: { readonly state: "near" | "engaged"; readonly label: string } | null;
}

export interface GmActor {
  readonly handle: VisibleActorKey;
  readonly displayName?: string;
  readonly visibleDescription: string;
  readonly familiarityTier: FamiliarityTier;
  readonly conversationalState?: string;
}

export interface GmHistoryTurn {
  readonly speaker: "player" | "master";
  readonly text: string;
  readonly turnSeq: number;
}

export interface GmKnownFact {
  readonly factId: string;
  readonly subjectHandle?: VisibleActorKey;
  readonly text: string;
}

export interface SupportedOperationDescriptor {
  readonly verb: string;
  readonly kind: "interaction" | "legacy" | "journey";
}

/** The observer-safe context the model receives. Never the whole World. */
export interface GmContext {
  schemaVersion: 1;
  scene: GmSceneContext;
  actors: readonly GmActor[];
  recentTurns: readonly GmHistoryTurn[];
  pendingQuestion: { question: string; candidateHandles?: readonly VisibleActorKey[] } | null;
  knownFacts: readonly GmKnownFact[];
  supportedOperations: readonly SupportedOperationDescriptor[];
}

export type GmAddressee =
  | { readonly kind: "gm" }
  | { readonly kind: "npc"; readonly handle: VisibleActorKey }
  | { readonly kind: "meta" };

export type GmTurnKind = "conversation" | "world_question" | "clarification" | "action" | "mixed";

/** The structured interpretation result. Steps are validated in S3 (P6). */
export interface GmTurnDecision {
  schemaVersion: 1;
  addressee: GmAddressee;
  kind: GmTurnKind;
  steps?: readonly unknown[];
  clarification?: {
    question: string;
    candidateHandles?: readonly VisibleActorKey[];
  };
}

export type GmValidationResult =
  | { readonly ok: true; readonly decision: GmTurnDecision }
  | { readonly ok: false; readonly errors: readonly string[] };

const GmTurnKindSet = new Set<string>(["conversation", "world_question", "clarification", "action", "mixed"]);
const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectExtraKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, errors: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${path}: unknown field "${key}"`);
  }
}

function validateHandle(handle: unknown, path: string, errors: string[]): handle is VisibleActorKey {
  if (typeof handle !== "string" || handle.length === 0 || !HANDLE_PATTERN.test(handle)) {
    errors.push(`${path}: invalid handle`);
    return false;
  }
  return true;
}

/**
 * Strictly validate a decision. Every rule from the plan is enforced here so a
 * malformed structure is never forwarded to the World Engine. Pure, no throw.
 */
export function validateGmTurnDecision(
  raw: unknown,
  options: { readonly allowedHandles?: readonly VisibleActorKey[] } = {},
): GmValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ["decision: not an object"] };
  }
  collectExtraKeys(raw, ["schemaVersion", "addressee", "kind", "steps", "clarification"], "decision", errors);

  if (raw["schemaVersion"] !== GM_CONTRACT_VERSION) {
    errors.push(`decision: schemaVersion must be ${GM_CONTRACT_VERSION}`);
  }

  const addressee = raw["addressee"];
  if (!isPlainObject(addressee)) {
    errors.push("addressee: missing or not an object");
  } else {
    collectExtraKeys(addressee, ["kind", "handle"], "addressee", errors);
    const addresseeKind = addressee["kind"];
    if (addresseeKind === "npc") {
      if (!validateHandle(addressee["handle"], "addressee.handle", errors)) { /* recorded */ }
      else if (options.allowedHandles && !options.allowedHandles.includes(addressee["handle"] as VisibleActorKey)) {
        errors.push(`addressee.handle: "${String(addressee["handle"])}" is not a visible actor in this scene`);
      }
    } else if (addresseeKind !== "gm" && addresseeKind !== "meta") {
      errors.push(`addressee.kind: unknown "${String(addresseeKind)}"`);
    }
  }

  const kind = raw["kind"];
  if (typeof kind !== "string" || !GmTurnKindSet.has(kind)) {
    errors.push(`kind: unknown "${String(kind)}"`);
  }

  if ("steps" in raw) {
    if (!Array.isArray(raw["steps"])) errors.push("steps: must be an array");
    else if (kind === "conversation" || kind === "world_question") errors.push("steps: not allowed for this kind");
  }

  if ("clarification" in raw) {
    const c = raw["clarification"];
    if (!isPlainObject(c)) {
      errors.push("clarification: must be an object");
    } else {
      collectExtraKeys(c, ["question", "candidateHandles"], "clarification", errors);
      if (typeof c["question"] !== "string" || c["question"].trim().length === 0) {
        errors.push("clarification.question: required non-empty string");
      }
      if ("candidateHandles" in c) {
        if (!Array.isArray(c["candidateHandles"])) errors.push("clarification.candidateHandles: must be an array");
        else for (const handle of c["candidateHandles"] as unknown[]) validateHandle(handle, "clarification.candidateHandles[]", errors);
      }
      if (kind !== "clarification") errors.push("clarification: only allowed when kind is clarification");
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, decision: raw as unknown as GmTurnDecision };
}

/** The closed vocabulary the director may name as supported operations. */
export function supportedOperations(): readonly SupportedOperationDescriptor[] {
  return Object.freeze([
    ...INTENT_CAPABILITIES.interactionVerbs.map((verb) => ({ verb: String(verb), kind: "interaction" as const })),
    ...TURN_LEGACY_OPERATIONS.map((verb) => ({ verb: String(verb), kind: "legacy" as const })),
  ]);
}
