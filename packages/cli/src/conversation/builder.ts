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
import type { InquiryRequest, TurnConversationRelation } from "@skald/intent-parser";
import { composeMasterTurnResponse } from "./master-turn-response.js";
import type { DeferredClause } from "../runtime/master-turn-validator.js";
import type {
  ConversationContinuationRelation,
  ConversationInputClass,
  ConversationMemoryMention,
  ConversationMemoryMetadataV1,
  ConversationResponseKind,
  ConversationTurn,
  ConversationTurnDraft,
  ConversationTurnRecord,
} from "./types.js";

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
  contextMetadata?: ConversationMemoryMetadataV1 | null | undefined;
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
    contextMetadata: params.contextMetadata ?? null,
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
  contextMetadata?: ConversationMemoryMetadataV1 | null | undefined;
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
    contextMetadata: params.contextMetadata ?? null,
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
  contextMetadata?: ConversationMemoryMetadataV1 | null | undefined;
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
    contextMetadata: params.contextMetadata ?? null,
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
  contextMetadata?: ConversationMemoryMetadataV1 | null | undefined;
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
    contextMetadata: params.contextMetadata ?? null,
  };
}

/**
 * Assembles the read-side memory metadata for one persisted turn (plan_7 §3).
 *
 * Pure and total: validated-plan focus becomes mentions (the observerRef
 * prefix recovers the person/object/route/topic category; a surfaceless
 * destination without a handle falls back to route, anything else without a
 * handle is skipped rather than invented), the stated goal becomes the
 * goal plus its dramatic thread, and the model-reported relation to the
 * pending clarification becomes the continuation link. Returns null when
 * the turn establishes no memory.
 */
export interface TurnMemoryFocus {
  readonly observerRef: string | null;
  readonly surface: string;
  readonly kind: "target" | "addressee" | "topic" | "destination";
}

export interface TurnMemoryInput {
  readonly focus?: readonly TurnMemoryFocus[] | undefined;
  readonly goal?: string | null | undefined;
  readonly relation?: TurnConversationRelation | null | undefined;
  readonly pendingClarificationSeq?: number | null | undefined;
  readonly clarification?: {
    readonly question: string;
    readonly options: readonly { readonly optionId: string; readonly label: string }[];
  } | null | undefined;
}

const MEMORY_RELATION_MAP: Record<TurnConversationRelation, ConversationContinuationRelation> = {
  continuation: "continues",
  new_topic: "new_topic",
  cancel_pending: "cancels",
};

function memoryMentionCategory(
  observerRef: string | null,
  kind: TurnMemoryFocus["kind"],
): ConversationMemoryMention["kind"] | null {
  if (observerRef) {
    const prefix = observerRef.split("_")[0];
    if (prefix === "person" || prefix === "object" || prefix === "route" || prefix === "topic") return prefix;
  }
  // A destination without a handle is still a route by construction.
  if (kind === "destination") return "route";
  return null;
}

export function buildTurnMemoryMetadata(input: TurnMemoryInput): ConversationMemoryMetadataV1 | null {
  const mentions: ConversationMemoryMention[] = [];
  for (const entry of input.focus ?? []) {
    if (mentions.length >= 8) break;
    const label = entry.surface.trim();
    if (!label) continue;
    const category = memoryMentionCategory(entry.observerRef, entry.kind);
    if (!category) continue;
    mentions.push({ kind: category, role: entry.kind, label });
  }
  const goal = (input.goal ?? "").trim();
  const clarification = input.clarification;
  const relation = input.relation ?? null;
  if (mentions.length === 0 && !goal && !clarification && !relation) return null;
  return {
    schemaVersion: 1,
    ...(mentions.length > 0 ? { mentions } : {}),
    ...(goal ? { goal: { summary: goal.slice(0, 140) } } : {}),
    ...(clarification ? {
      clarification: {
        question: clarification.question,
        options: clarification.options.slice(0, 6).map((option) => ({ ...option })),
      },
    } : {}),
    ...(relation ? {
      continuation: {
        relation: MEMORY_RELATION_MAP[relation],
        ...(input.pendingClarificationSeq !== undefined && input.pendingClarificationSeq !== null
          ? { clarificationTurnSeq: input.pendingClarificationSeq }
          : {}),
      },
    } : {}),
    ...(goal ? { dramaticThread: { source: "player_goal" as const, title: goal.slice(0, 140) } } : {}),
  };
}

/** Strip persistence-only requestHash before a player-facing JSON response. */
export function toConversationTurnDTO(turn: ConversationTurnRecord): ConversationTurn & { readonly narrationHandle: string } {
  const { requestHash: _requestHash, contextMetadata: _contextMetadata, ...publicTurn } = turn;
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
