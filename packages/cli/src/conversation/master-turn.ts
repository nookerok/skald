/**
 * Unified player-facing MasterTurn envelope (plan_9 §6).
 *
 * One input ends in exactly one object: a stable opaque turnKey, the turn
 * kind, the world-time span, the deterministic master text, and the
 * narration lifecycle at response time. Internal identifiers (turn
 * sequences, correlations, request keys) never cross this boundary; the
 * browser keys bubbles and polls narration off turnKey/handles derived
 * here. Pure data shaping: no world access, no events, no network.
 */

import { readSideHandle } from "./identity.js";
import type { ConversationResponseKind } from "./types.js";

/** Player-facing turn kinds: read-side record kinds plus contextual clarification. */
export type MasterTurnKind =
  | "inquiry_answer"
  | "action_outcome"
  | "action_rejection"
  | "speech_reaction"
  | "mixed_outcome"
  | "meta_answer"
  | "contextual_clarification";

/** One input, one MasterTurn. Narration text arrives later via the journal. */
export interface MasterTurnDTO {
  readonly turnKey: string;
  readonly kind: MasterTurnKind;
  readonly worldTimeBefore: number;
  readonly worldTimeAfter: number;
  readonly deterministicText: string;
  readonly narration: {
    readonly status: "pending" | "not_requested";
  };
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

/**
 * Stable opaque turn key, deterministic per (world, idempotency key):
 * identical retries share it, reloads keep it, and no database sequence,
 * correlation or client key text ever reaches the browser through it.
 */
export function masterTurnKey(worldId: string, idempotencyKey: string): string {
  return readSideHandle("master-turn", `${worldId}:${idempotencyKey}`);
}

/** Read-side response kinds map one-to-one, except clarification. */
export function masterTurnKindOf(responseKind: ConversationResponseKind): MasterTurnKind {
  return responseKind === "clarification" ? "contextual_clarification" : responseKind;
}

export function buildMasterTurn(input: {
  readonly worldId: string;
  readonly idempotencyKey: string;
  readonly kind: MasterTurnKind;
  readonly worldTimeBefore: number;
  readonly worldTimeAfter: number;
  readonly deterministicText: string;
  readonly narrationPending: boolean;
}): MasterTurnDTO {
  return freeze({
    turnKey: masterTurnKey(input.worldId, input.idempotencyKey),
    kind: input.kind,
    worldTimeBefore: input.worldTimeBefore,
    worldTimeAfter: input.worldTimeAfter,
    deterministicText: input.deterministicText,
    narration: freeze({ status: input.narrationPending ? "pending" as const : "not_requested" as const }),
  });
}
