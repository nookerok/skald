export type ConversationInputClass =
  | "action"
  | "inquiry"
  | "speech"
  | "mixed"
  | "meta"
  | "clarification";

export type ConversationResponseKind =
  | "action_outcome"
  | "action_rejection"
  | "inquiry_answer"
  | "speech_reaction"
  | "mixed_outcome"
  | "meta_answer"
  | "clarification";

export interface ConversationTurn {
  readonly turnSeq: number;
  readonly worldId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly playerText: string;
  readonly inputClass: ConversationInputClass;
  readonly worldTimeBefore: number;
  readonly worldTimeAfter: number;
  readonly responseKind: ConversationResponseKind;
  readonly responseText: string;
  readonly createdAt: number;
}

export interface ConversationTurnDraft {
  readonly worldId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly playerText: string;
  readonly inputClass: ConversationInputClass;
  readonly worldTimeBefore: number;
  readonly worldTimeAfter: number;
  readonly responseKind: ConversationResponseKind;
  readonly responseText: string;
}

/** Internal persistence record; requestHash is never sent to the player-facing DTO. */
export interface ConversationTurnRecord extends ConversationTurn {
  readonly requestHash: string;
}

/** @deprecated Use ConversationInputClass. */
export type InputClass = ConversationInputClass;
/** @deprecated Use ConversationResponseKind. */
export type ResponseKind = ConversationResponseKind;
