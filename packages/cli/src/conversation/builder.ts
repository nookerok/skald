import { createHash } from "node:crypto";
import { narrationHandle } from "./identity.js";
import type { DomainEvent } from "@skald/event-bus";
import {
  actionFallbackText,
  buildBackgroundNarrativeContext,
  buildGameShellSnapshot,
  buildInquiryAnswer,
  isGenericActionFallback,
  localizedPlayerText,
  selectTurnPresentation,
} from "@skald/world";
import type { ReadonlyWorld } from "@skald/world";
import type { InquiryRequest } from "@skald/intent-parser";
import { composeMasterTurnResponse } from "./master-turn-response.js";
import type { DeferredClause } from "../runtime/master-turn-validator.js";
import type { ConversationInputClass, ConversationResponseKind, ConversationTurn, ConversationTurnDraft, ConversationTurnRecord } from "./types.js";

/**
 * True for turns that change the world: their idempotency keys replay as
 * duplicate_request instead of a read-side replay. Speech mutates through
 * the communicate pipeline; meta/clarification/inquiry never do.
 */
export function isWorldChangingTurn(inputClass: ConversationInputClass): boolean {
  return inputClass === "action" || inputClass === "mixed" || inputClass === "speech";
}

/** Stable hash used to reject re-use of an idempotency key with other text. */
export function conversationRequestHash(playerText: string): string {
  return createHash("sha256").update(JSON.stringify({ playerText })).digest("hex");
}

export function conversationCorrelationId(idempotencyKey: string): string {
  return `conversation:${idempotencyKey}`;
}

/** Shared outcome prose for action turns: presentation text or a deterministic fallback. */
function actionOutcomeText(
  playerText: string,
  stagedEvents: readonly DomainEvent[],
  projectedWorld: ReadonlyWorld,
): { readonly text: string; readonly rejected: boolean } {
  const presentation = selectTurnPresentation(stagedEvents, projectedWorld);
  const response = presentation.response;
  const rejected = response?.kind === "action_rejection";
  const candidateText = response?.text ?? presentation.primary?.text;
  const text = candidateText && !isGenericActionFallback(candidateText)
    ? candidateText
    : actionFallbackText(playerText, rejected ? "rejection" : "outcome");
  return { text, rejected };
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
  const outcome = actionOutcomeText(params.playerText, params.stagedEvents, params.projectedWorld);
  const responseKind: ConversationResponseKind = outcome.rejected ? "action_rejection" : "action_outcome";
  const responseText = outcome.text;
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

export function buildSpeechConversationTurn(params: {
  worldId: string;
  correlationId: string;
  idempotencyKey: string;
  playerText: string;
  worldTimeBefore: number;
  stagedEvents: readonly DomainEvent[];
  projectedWorld: ReadonlyWorld;
}): ConversationTurnDraft {
  const outcome = actionOutcomeText(params.playerText, params.stagedEvents, params.projectedWorld);
  const correlationId = params.stagedEvents.some((event) => event.correlationId === params.correlationId)
    ? params.correlationId
    : params.stagedEvents[params.stagedEvents.length - 1]?.correlationId ?? params.correlationId;
  return {
    worldId: params.worldId,
    correlationId,
    idempotencyKey: params.idempotencyKey,
    requestHash: conversationRequestHash(params.playerText),
    playerText: params.playerText,
    inputClass: "speech",
    worldTimeBefore: params.worldTimeBefore,
    worldTimeAfter: params.projectedWorld.time,
    responseKind: "speech_reaction",
    responseText: outcome.text,
  };
}

export function buildReadSideConversationTurn(params: {
  worldId: string;
  idempotencyKey: string;
  playerText: string;
  inputClass: Exclude<ConversationInputClass, "action" | "mixed" | "speech">;
  responseKind: Exclude<ConversationResponseKind, "action_outcome" | "action_rejection" | "mixed_outcome" | "speech_reaction">;
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

/**
 * Builds the single durable turn for a mixed replica: the full player text
 * plus one combined Master answer (primary outcome, post-action inquiry
 * answer, deferred note). The draft is meant for the same durable commit as
 * the staged Events: pass the returned closure as prepareCommitContext so
 * Events and transcript commit atomically. Player text never becomes an
 * Event; the inquiry is answered from the post-action snapshot only.
 */
export function buildMixedConversationTurn(params: {
  worldId: string;
  correlationId: string;
  idempotencyKey: string;
  playerText: string;
  worldTimeBefore: number;
  /** Committed log before this turn; the inquiry reads pre-events plus staged. */
  preEvents: readonly DomainEvent[];
  stagedEvents: readonly DomainEvent[];
  projectedWorld: ReadonlyWorld;
  profile: { readonly background_id?: string | null } | null;
  characterProfile: {
    readonly display_name: string;
    readonly wound: string;
    readonly promise: string;
    readonly principle: string;
    readonly background_id?: string | null;
  } | null;
  inquiry: InquiryRequest | null;
  deferred: readonly DeferredClause[];
}): ConversationTurnDraft {
  const outcome = actionOutcomeText(params.playerText, params.stagedEvents, params.projectedWorld);
  let inquiryText: string | null = null;
  if (params.inquiry) {
    const postEvents = [...params.preEvents, ...params.stagedEvents];
    const shell = buildGameShellSnapshot(postEvents, params.projectedWorld, params.characterProfile, params.worldId, undefined);
    const background = buildBackgroundNarrativeContext(postEvents, params.projectedWorld, params.profile);
    inquiryText = buildInquiryAnswer(params.inquiry, { shell, background }).answer;
  }
  const response = composeMasterTurnResponse({
    kind: "mixed",
    actionPresentation: { text: outcome.text, rejected: outcome.rejected },
    inquiryAnswer: inquiryText === null ? null : { text: inquiryText },
    speechReaction: null,
    metaAnswer: null,
    deferredClauses: params.deferred,
    clarification: null,
  });
  return {
    worldId: params.worldId,
    correlationId: params.correlationId,
    idempotencyKey: params.idempotencyKey,
    requestHash: conversationRequestHash(params.playerText),
    playerText: params.playerText,
    inputClass: "mixed",
    worldTimeBefore: params.worldTimeBefore,
    worldTimeAfter: params.projectedWorld.time,
    responseKind: "mixed_outcome",
    responseText: response.text,
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
