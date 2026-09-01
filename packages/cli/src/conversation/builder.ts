import { createHash } from "node:crypto";
import { narrationHandle } from "./identity.js";
import type { DomainEvent } from "@skald/event-bus";
import { actionFallbackText, isGenericActionFallback, localizedPlayerText, selectTurnPresentation } from "@skald/world";
import type { ReadonlyWorld } from "@skald/world";
import type { ConversationInputClass, ConversationResponseKind, ConversationTurn, ConversationTurnDraft, ConversationTurnRecord } from "./types.js";

/** Stable hash used to reject re-use of an idempotency key with other text. */
export function conversationRequestHash(playerText: string): string {
  return createHash("sha256").update(JSON.stringify({ playerText })).digest("hex");
}

export function conversationCorrelationId(idempotencyKey: string): string {
  return `conversation:${idempotencyKey}`;
}

export function buildActionConversationTurn(params: {
  worldId: string;
  correlationId: string;
  idempotencyKey: string;
  playerText: string;
  worldTimeBefore: number;
  stagedEvents: readonly DomainEvent[];
  projectedWorld: ReadonlyWorld;
}): ConversationTurnDraft {
  const presentation = selectTurnPresentation(params.stagedEvents, params.projectedWorld);
  const response = presentation.response;
  const responseKind: ConversationResponseKind = response?.kind === "action_rejection" ? "action_rejection" : "action_outcome";
  const candidateText = response?.text ?? presentation.primary?.text;
  const responseText = candidateText && !isGenericActionFallback(candidateText)
    ? candidateText
    : actionFallbackText(params.playerText, response?.kind === "action_rejection" ? "rejection" : "outcome");
  // Wait requests have a request correlation but their committed ticks carry
  // their own correlations. Pair the answer with the final actual tick, not
  // with a request identifier that never occurred in the Event Log.
  const correlationId = params.stagedEvents.some((event) => event.correlationId === params.correlationId)
    ? params.correlationId
    : params.stagedEvents[params.stagedEvents.length - 1]?.correlationId ?? params.correlationId;
  return {
    worldId: params.worldId,
    correlationId,
    idempotencyKey: params.idempotencyKey,
    requestHash: conversationRequestHash(params.playerText),
    playerText: params.playerText,
    inputClass: "action",
    worldTimeBefore: params.worldTimeBefore,
    worldTimeAfter: params.projectedWorld.time,
    responseKind,
    responseText,
  };
}

export function buildReadSideConversationTurn(params: {
  worldId: string;
  idempotencyKey: string;
  playerText: string;
  inputClass: Exclude<ConversationInputClass, "action">;
  responseKind: Exclude<ConversationResponseKind, "action_outcome" | "action_rejection">;
  responseText: string;
  worldTime: number;
}): ConversationTurnDraft {
  return {
    worldId: params.worldId,
    correlationId: conversationCorrelationId(params.idempotencyKey),
    idempotencyKey: params.idempotencyKey,
    requestHash: conversationRequestHash(params.playerText),
    playerText: params.playerText,
    inputClass: params.inputClass,
    worldTimeBefore: params.worldTime,
    worldTimeAfter: params.worldTime,
    responseKind: params.responseKind,
    responseText: params.responseText,
  };
}

/** Strip persistence-only requestHash before a player-facing JSON response. */
export function toConversationTurnDTO(turn: ConversationTurnRecord): ConversationTurn & { readonly narrationHandle: string } {
  const { requestHash: _requestHash, ...publicTurn } = turn;
  const fallback = turn.responseKind === "action_rejection"
    ? "Так действовать сейчас не получится."
    : turn.responseKind === "clarification"
      ? "Уточни, что именно ты хочешь сделать."
      : "Подробности пока неясны.";
  return {
    ...publicTurn,
    responseText: localizedPlayerText(turn.responseText, fallback),
    narrationHandle: narrationHandle(turn.worldTimeAfter, turn.correlationId),
  };
}
