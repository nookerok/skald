/**
 * Conversation Director contract (SKALD S0 / P0).
 *
 * The versioned wire contract between the conversation layer and the LLM:
 * the director receives a `GmContext` and must return a `GmTurnDecision`.
 * Both are validated with a STRICT schema — no extra keys, no unknown
 * operations, no arbitrary handles — so an invalid structure never reaches the
 * authoritative World Engine.
 *
 * V2 adds an optional closed proposal and one-call response draft for P3.
 * Legacy V1 classifications remain readable, but cannot carry V2 payloads.
 * This module remains pure; execution authority stays with the World Engine.
 */

import { INTENT_CAPABILITIES } from "./intent-proposal.js";
import { TURN_LEGACY_OPERATIONS, type TurnProposalV2 } from "./turn-proposal.js";
import { parseGmProposal } from "./gm-proposal.js";

/** Contract version carried on every context and decision. */
export const GM_CONTRACT_VERSION = 2;

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
  schemaVersion: 1 | 2;
  scene: GmSceneContext;
  actors: readonly GmActor[];
  /** Non-person scene candidates; handles are opaque, just like actor handles. */
  referents?: readonly { readonly handle: VisibleActorKey; readonly kind: "object" | "route" | "topic"; readonly label: string }[];
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

/**
 * A one-call conversation draft: facts are selected by ID, never rewritten.
 * Social acts carry no asserted world fact, NPC permission or commitment.
 * Free NPC knowledge/voice requires the separate dossier/disclosure contract.
 */
export type GmResponseSegment =
  | { readonly kind: "social"; readonly act: "greeting" | "farewell" | "thanks" | "acknowledge" | "ask_topic" | "no_knowledge" | "no_commitment" }
  | { readonly kind: "fact"; readonly factId: string };

/** Structured interpretation. Plans are proposals, never executable authority. */
export interface GmTurnDecision {
  schemaVersion: 1 | 2;
  /** Who RESPONDS: master, a visible NPC, or the system. */
  addressee: GmAddressee;
  kind: GmTurnKind;
  /** V2 proposal with opaque handles in ref slots; server binds and revalidates. */
  proposal?: TurnProposalV2;
  /** Validated and rendered by the server in the same call as interpretation. */
  response?: { readonly segments: readonly GmResponseSegment[] };
  /**
   * WHO the decision is ABOUT (the question's topic), when that differs from
   * who responds: «Как он выглядит?» is addressed to the master with the NPC
   * as subject. Observer-safe handle, never an internal id. Only on
   * question-shaped kinds (world_question, clarification, mixed).
   */
  subjectHandle?: VisibleActorKey;
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
  options: { readonly allowedHandles?: readonly VisibleActorKey[]; readonly allowedActorHandles?: readonly VisibleActorKey[]; readonly allowedFactIds?: readonly string[] } = {},
): GmValidationResult {
  const errors: string[] = [];
  const actorHandles = options.allowedActorHandles ?? options.allowedHandles;
  if (!isPlainObject(raw)) {
    return { ok: false, errors: ["decision: not an object"] };
  }
  collectExtraKeys(raw, ["schemaVersion", "addressee", "kind", "subjectHandle", "clarification", "proposal", "response"], "decision", errors);

  if (raw["schemaVersion"] !== 1 && raw["schemaVersion"] !== GM_CONTRACT_VERSION) {
    errors.push(`decision: schemaVersion must be 1 (legacy classification) or ${GM_CONTRACT_VERSION}`);
  }
  if (raw["schemaVersion"] === 1 && ("proposal" in raw || "response" in raw)) {
    errors.push("decision: live payload requires schemaVersion 2");
  }

  const addressee = raw["addressee"];
  if (!isPlainObject(addressee)) {
    errors.push("addressee: missing or not an object");
  } else {
    const addresseeKind = addressee["kind"];
    // A handle belongs ONLY to npc, even when it names a visible actor.
    collectExtraKeys(addressee, addresseeKind === "npc" ? ["kind", "handle"] : ["kind"], "addressee", errors);
    if (addresseeKind === "npc") {
      if (!validateHandle(addressee["handle"], "addressee.handle", errors)) { /* recorded */ }
      else if (actorHandles && !actorHandles.includes(addressee["handle"] as VisibleActorKey)) {
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

  if ("subjectHandle" in raw) {
    // The topic of a question-shaped turn only: a conversation or an action
    // has no separate subject from its addressee.
    if (kind !== "world_question" && kind !== "clarification" && kind !== "mixed") {
      errors.push("subjectHandle: only allowed for kind world_question, clarification or mixed");
    }
    if (validateHandle(raw["subjectHandle"], "subjectHandle", errors)) {
      if (actorHandles && !actorHandles.includes(raw["subjectHandle"] as VisibleActorKey)) {
        errors.push(`subjectHandle: "${String(raw["subjectHandle"])}" is not a visible actor in this scene`);
      }
    }
  }

  if (kind === "clarification" && !("clarification" in raw)) {
    errors.push("clarification: required for kind clarification");
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
        else for (const handle of c["candidateHandles"] as unknown[]) {
          if (!validateHandle(handle, "clarification.candidateHandles[]", errors)) continue;
          // The scene allowlist applies to EVERY handle, not just the addressee:
          // a candidate that is not visible in this scene is a fabricated actor.
          if (actorHandles && !actorHandles.includes(handle as VisibleActorKey)) {
            errors.push(`clarification.candidateHandles[]: "${String(handle)}" is not a visible actor in this scene`);
          }
        }
      }
      if (kind !== "clarification") errors.push("clarification: only allowed when kind is clarification");
    }
  }

  if ("proposal" in raw) {
    const proposal = parseGmProposal(raw["proposal"], options.allowedHandles);
    if (!proposal) errors.push("proposal: invalid closed plan or invisible handle");
    else if (!(kind === "action" && proposal.kind === "action")
      && !(kind === "mixed" && proposal.kind === "mixed")
      && !(kind === "world_question" && proposal.kind === "inquiry")
      && !(kind === "clarification" && proposal.ambiguity)) {
      errors.push("proposal: kind does not agree with decision");
    }
  }
  if ("response" in raw) {
    const response = raw["response"];
    if (kind !== "conversation") errors.push("response: only allowed for conversation");
    if (!isPlainObject(response)) errors.push("response: must be an object");
    else {
      collectExtraKeys(response, ["segments"], "response", errors);
      const segments = response["segments"];
      if (!Array.isArray(segments) || segments.length < 1 || segments.length > 8) {
        errors.push("response.segments: expected 1..8 segments");
      } else for (const segment of segments) {
        if (!isPlainObject(segment)) { errors.push("response.segment: not an object"); continue; }
        if (segment["kind"] === "social") {
          collectExtraKeys(segment, ["kind", "act"], "response.segment", errors);
          if (typeof segment["act"] !== "string" || !["greeting", "farewell", "thanks", "acknowledge", "ask_topic", "no_knowledge", "no_commitment"].includes(segment["act"])) {
            errors.push("response.segment: unsupported social act");
          }
        } else if (segment["kind"] === "fact") {
          collectExtraKeys(segment, ["kind", "factId"], "response.segment", errors);
          if (typeof segment["factId"] !== "string"
            || !options.allowedFactIds?.includes(segment["factId"])) errors.push("response.segment: unknown fact");
          // Knowing a player fact does not grant an NPC knowledge of it.
          if (isPlainObject(addressee) && addressee["kind"] === "npc") errors.push("response.segment: NPC disclosure requires a dossier");
        } else errors.push("response.segment: unknown kind");
      }
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
