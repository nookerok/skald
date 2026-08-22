import { createHash } from "node:crypto";
import type { DomainEvent } from "@skald/event-bus";
import { selectTurnPresentation } from "@skald/world";
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
  const responseText = response?.text ?? presentation.primary?.text ?? "Ты начинаешь действовать, но пока не видишь заметного результата.";
  return {
    worldId: params.worldId,
    correlationId: params.correlationId,
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
export function toConversationTurnDTO(turn: ConversationTurnRecord): ConversationTurn {
  const { requestHash: _requestHash, ...publicTurn } = turn;
  return publicTurn;
}
