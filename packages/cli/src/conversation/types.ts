import type { ExecutableIntent, TurnProposalV2 } from "@skald/intent-parser";

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
  /** Non-authoritative memory metadata; absent (null) for legacy rows. */
  readonly contextMetadata?: ConversationMemoryMetadataV1 | null | undefined;
}

/** Internal persistence record; requestHash and contextMetadata never reach the player-facing DTO. */
export interface ConversationTurnRecord extends ConversationTurn {
  readonly requestHash: string;
  readonly contextMetadata: ConversationMemoryMetadataV1 | null;
}

/**
 * Persisted memory metadata (plan_7 §3, `conversation_context_json`).
 *
 * Read-side interpretation of one turn only: structured mentions, the
 * player's stated goal, a clarification payload, the relation of this turn
 * to a pending clarification, and the dramatic thread active at turn time.
 * Never World State: rows never drive Rules, and the world never reads them.
 * Never persisted here: raw model responses, prompts, entity/event/location
 * ids, Canon, hidden facts, confidence, Event fragments.
 * ObserverRef handles persist ONLY inside clarification options and framed
 * candidates (review P1): they are transient display handles, re-resolved
 * against the answer-time scene before any use, and never enter prompts.
 */
export type ConversationMemoryMentionKind = "person" | "object" | "route" | "topic";

export type ConversationMemoryMentionRole =
  | "target"
  | "addressee"
  | "destination"
  | "topic"
  | "instrument";

export interface ConversationMemoryMention {
  readonly kind: ConversationMemoryMentionKind;
  readonly role: ConversationMemoryMentionRole;
  readonly label: string;
}

export interface ConversationMemoryClarificationOption {
  readonly optionId: string;
  readonly label: string;
  /**
   * observerRefs this option selects (attached by scene-aware producers).
   * Absent for scene-free producers; the consumer re-resolves the label.
   */
  readonly referentRefs?: readonly string[] | undefined;
  /** Executable alternative for action options (conflicting actions). */
  readonly intentPatch?: { readonly actionText: string } | undefined;
}

/** Referent slot a clarification choice fills inside a stored candidate. */
export type FramedReferentSlot = "target" | "addressee" | "destination";

/**
 * Closed structured candidate persisted with a clarification (review P1):
 * the proposal or deterministic intent plus the single slot the choice
 * fills and the scene revision it was asked at. The consumer revalidates
 * after patching — no second model call. Exactly one of proposal/intent.
 */
export interface FramedClarification {
  readonly slot: FramedReferentSlot;
  readonly revision: {
    readonly worldTime: number;
    readonly eventNumber: number;
  };
  readonly proposal?: TurnProposalV2 | undefined;
  readonly intent?: ExecutableIntent | undefined;
}

export type ConversationContinuationRelation = "resolves" | "continues" | "new_topic" | "cancels";

export type ConversationDramaticThreadSource = "player_goal" | "observed_situation" | "personal_hook";

export interface ConversationMemoryMetadataV1 {
  readonly schemaVersion: 1;
  readonly mentions?: readonly ConversationMemoryMention[] | undefined;
  readonly goal?: { readonly summary: string } | undefined;
  readonly clarification?: {
    readonly question: string;
    readonly options: readonly ConversationMemoryClarificationOption[];
    readonly framed?: FramedClarification | undefined;
  } | undefined;
  readonly continuation?: {
    readonly relation: ConversationContinuationRelation;
    readonly clarificationTurnSeq?: number | undefined;
  } | undefined;
  readonly dramaticThread?: {
    readonly source: ConversationDramaticThreadSource;
    readonly title: string;
  } | undefined;
}

/** Build-side budgets for persisted metadata (plan_7 §3). */
export const CONVERSATION_MEMORY_MAX_MENTIONS = 8;
export const CONVERSATION_MEMORY_MAX_LABEL = 120;
export const CONVERSATION_MEMORY_MAX_GOAL = 140;
export const CONVERSATION_MEMORY_MAX_QUESTION = 500;
export const CONVERSATION_MEMORY_MAX_OPTIONS = 6;
export const CONVERSATION_MEMORY_MAX_OPTION_ID = 40;
export const CONVERSATION_MEMORY_MAX_OPTION_LABEL = 80;
export const CONVERSATION_MEMORY_MAX_OPTION_REFS = 4;
export const CONVERSATION_MEMORY_MAX_OPTION_REF = 40;
export const CONVERSATION_MEMORY_MAX_ACTION_TEXT = 120;
export const CONVERSATION_MEMORY_MAX_THREAD_TITLE = 140;

const MEMORY_MENTION_KINDS: ReadonlySet<string> = new Set(["person", "object", "route", "topic"]);
const MEMORY_MENTION_ROLES: ReadonlySet<string> = new Set(["target", "addressee", "destination", "topic", "instrument"]);
const MEMORY_CONTINUATION_RELATIONS: ReadonlySet<string> = new Set(["resolves", "continues", "new_topic", "cancels"]);
const MEMORY_THREAD_SOURCES: ReadonlySet<string> = new Set(["player_goal", "observed_situation", "personal_hook"]);
const MEMORY_TOP_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion", "mentions", "goal", "clarification", "continuation", "dramaticThread",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCleanText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function cappedText(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function parseMention(raw: unknown): ConversationMemoryMention | null {
  if (!isRecord(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== 3 || !keys.includes("kind") || !keys.includes("role") || !keys.includes("label")) return null;
  if (!MEMORY_MENTION_KINDS.has(raw.kind as string) || !MEMORY_MENTION_ROLES.has(raw.role as string)) return null;
  if (!isCleanText(raw.label, CONVERSATION_MEMORY_MAX_LABEL)) return null;
  return { kind: raw.kind as ConversationMemoryMentionKind, role: raw.role as ConversationMemoryMentionRole, label: raw.label as string };
}

function parseClarificationOption(raw: unknown): ConversationMemoryClarificationOption | null {
  if (!isRecord(raw)) return null;
  const keys = Object.keys(raw);
  if (!keys.includes("optionId") || !keys.includes("label")) return null;
  if (!keys.every((key) => key === "optionId" || key === "label" || key === "referentRefs" || key === "intentPatch")) return null;
  if (!isCleanText(raw.optionId, CONVERSATION_MEMORY_MAX_OPTION_ID)) return null;
  if (!isCleanText(raw.label, CONVERSATION_MEMORY_MAX_OPTION_LABEL)) return null;
  const option: {
    optionId: string;
    label: string;
    referentRefs?: readonly string[];
    intentPatch?: { readonly actionText: string };
  } = { optionId: raw.optionId as string, label: raw.label as string };
  if (raw.referentRefs !== undefined) {
    if (!Array.isArray(raw.referentRefs) || raw.referentRefs.length === 0 || raw.referentRefs.length > CONVERSATION_MEMORY_MAX_OPTION_REFS) return null;
    const refs: string[] = [];
    for (const ref of raw.referentRefs) {
      if (!isCleanText(ref, CONVERSATION_MEMORY_MAX_OPTION_REF)) return null;
      refs.push(ref as string);
    }
    option.referentRefs = refs;
  }
  if (raw.intentPatch !== undefined) {
    if (!isRecord(raw.intentPatch) || Object.keys(raw.intentPatch).length !== 1) return null;
    if (!isCleanText(raw.intentPatch.actionText, CONVERSATION_MEMORY_MAX_ACTION_TEXT)) return null;
    option.intentPatch = { actionText: raw.intentPatch.actionText as string };
  }
  return option;
}

function parseRevision(raw: unknown): { readonly worldTime: number; readonly eventNumber: number } | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.worldTime !== "number" || !Number.isSafeInteger(raw.worldTime) || (raw.worldTime as number) < 0) return null;
  if (typeof raw.eventNumber !== "number" || !Number.isSafeInteger(raw.eventNumber) || (raw.eventNumber as number) < 0) return null;
  if (!Object.keys(raw).every((key) => key === "worldTime" || key === "eventNumber")) return null;
  return { worldTime: raw.worldTime as number, eventNumber: raw.eventNumber as number };
}

/**
 * Fail-closed parse of a stored framed candidate: exactly one of proposal
 * / intent, a closed slot, a sane revision. Semantic revalidation happens
 * at answer time; anything off degrades to plain re-interpretation.
 */
function parseFramedClarification(raw: unknown): FramedClarification | null {
  if (!isRecord(raw)) return null;
  if (!Object.keys(raw).every((key) => key === "slot" || key === "revision" || key === "proposal" || key === "intent")) return null;
  if (raw.slot !== "target" && raw.slot !== "addressee" && raw.slot !== "destination") return null;
  const revision = parseRevision(raw.revision);
  if (!revision) return null;
  const hasProposal = raw.proposal !== undefined;
  const hasIntent = raw.intent !== undefined;
  if (hasProposal === hasIntent) return null;
  if (hasProposal && !isRecord(raw.proposal)) return null;
  if (hasIntent && !isRecord(raw.intent)) return null;
  return {
    slot: raw.slot,
    revision,
    ...(hasProposal ? { proposal: raw.proposal as TurnProposalV2 } : {}),
    ...(hasIntent ? { intent: raw.intent as ExecutableIntent } : {}),
  };
}

/**
 * Fail-closed parse of the `conversation_context_json` column. Any shape
 * violation — unknown keys, oversized strings, bad enums — yields null so a
 * corrupt row degrades to the legacy heuristic instead of poisoning context.
 */
export function parseConversationMemoryMetadata(raw: unknown): ConversationMemoryMetadataV1 | null {
  if (raw === null || raw === undefined) return null;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim() === "") return null;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed)) return null;
  if (parsed.schemaVersion !== 1) return null;
  if (!Object.keys(parsed).every((key) => MEMORY_TOP_KEYS.has(key))) return null;
  const result: {
    schemaVersion: 1;
    mentions?: ConversationMemoryMention[];
    goal?: { summary: string };
    clarification?: { question: string; options: ConversationMemoryClarificationOption[]; framed?: FramedClarification };
    continuation?: { relation: ConversationContinuationRelation; clarificationTurnSeq?: number };
    dramaticThread?: { source: ConversationDramaticThreadSource; title: string };
  } = { schemaVersion: 1 };
  if (parsed.mentions !== undefined) {
    if (!Array.isArray(parsed.mentions) || parsed.mentions.length > CONVERSATION_MEMORY_MAX_MENTIONS) return null;
    const mentions: ConversationMemoryMention[] = [];
    for (const entry of parsed.mentions) {
      const mention = parseMention(entry);
      if (!mention) return null;
      mentions.push(mention);
    }
    result.mentions = mentions;
  }
  if (parsed.goal !== undefined) {
    if (!isRecord(parsed.goal) || Object.keys(parsed.goal).length !== 1) return null;
    if (!isCleanText(parsed.goal.summary, CONVERSATION_MEMORY_MAX_GOAL)) return null;
    result.goal = { summary: parsed.goal.summary as string };
  }
  if (parsed.clarification !== undefined) {
    if (!isRecord(parsed.clarification)) return null;
    const keys = Object.keys(parsed.clarification);
    if (!keys.includes("question") || !keys.includes("options")) return null;
    if (!keys.every((key) => key === "question" || key === "options" || key === "framed")) return null;
    if (!isCleanText(parsed.clarification.question, CONVERSATION_MEMORY_MAX_QUESTION)) return null;
    if (!Array.isArray(parsed.clarification.options) || parsed.clarification.options.length > CONVERSATION_MEMORY_MAX_OPTIONS) return null;
    const options: ConversationMemoryClarificationOption[] = [];
    for (const entry of parsed.clarification.options) {
      const option = parseClarificationOption(entry);
      if (!option) return null;
      options.push(option);
    }
    const framed = parsed.clarification.framed !== undefined
      ? parseFramedClarification(parsed.clarification.framed)
      : undefined;
    if (parsed.clarification.framed !== undefined && !framed) return null;
    result.clarification = {
      question: parsed.clarification.question as string,
      options,
      ...(framed ? { framed } : {}),
    };
  }
  if (parsed.continuation !== undefined) {
    if (!isRecord(parsed.continuation)) return null;
    if (!MEMORY_CONTINUATION_RELATIONS.has(parsed.continuation.relation as string)) return null;
    const out: { relation: ConversationContinuationRelation; clarificationTurnSeq?: number } = {
      relation: parsed.continuation.relation as ConversationContinuationRelation,
    };
    if (parsed.continuation.clarificationTurnSeq !== undefined) {
      if (typeof parsed.continuation.clarificationTurnSeq !== "number"
        || !Number.isSafeInteger(parsed.continuation.clarificationTurnSeq)
        || (parsed.continuation.clarificationTurnSeq as number) < 0) return null;
      out.clarificationTurnSeq = parsed.continuation.clarificationTurnSeq as number;
    }
    if (!Object.keys(parsed.continuation).every((key) => key === "relation" || key === "clarificationTurnSeq")) return null;
    result.continuation = out;
  }
  if (parsed.dramaticThread !== undefined) {
    if (!isRecord(parsed.dramaticThread)) return null;
    const keys = Object.keys(parsed.dramaticThread);
    if (keys.length !== 2 || !keys.includes("source") || !keys.includes("title")) return null;
    if (!MEMORY_THREAD_SOURCES.has(parsed.dramaticThread.source as string)) return null;
    if (!isCleanText(parsed.dramaticThread.title, CONVERSATION_MEMORY_MAX_THREAD_TITLE)) return null;
    result.dramaticThread = {
      source: parsed.dramaticThread.source as ConversationDramaticThreadSource,
      title: parsed.dramaticThread.title as string,
    };
  }
  return result;
}

/**
 * Build-side serializer: caps every field to the §3 budgets, then encodes.
 * Returns null when the value cannot be represented (never throws).
 */
export function serializeConversationMemoryMetadata(metadata: ConversationMemoryMetadataV1 | null | undefined): string | null {
  if (metadata === null || metadata === undefined) return null;
  try {
    if (!isRecord(metadata) || metadata.schemaVersion !== 1) return null;
    const out: Record<string, unknown> = { schemaVersion: 1 };
    if (metadata.mentions !== undefined) {
      const mentions = metadata.mentions.slice(0, CONVERSATION_MEMORY_MAX_MENTIONS).map((mention) => ({
        kind: mention.kind,
        role: mention.role,
        label: cappedText(String(mention.label), CONVERSATION_MEMORY_MAX_LABEL),
      }));
      out.mentions = mentions;
    }
    if (metadata.goal !== undefined) {
      out.goal = { summary: cappedText(String(metadata.goal.summary), CONVERSATION_MEMORY_MAX_GOAL) };
    }
    if (metadata.clarification !== undefined) {
      const framed = metadata.clarification.framed;
      out.clarification = {
        question: cappedText(String(metadata.clarification.question), CONVERSATION_MEMORY_MAX_QUESTION),
        options: metadata.clarification.options.slice(0, CONVERSATION_MEMORY_MAX_OPTIONS).map((option) => ({
          optionId: cappedText(String(option.optionId), CONVERSATION_MEMORY_MAX_OPTION_ID),
          label: cappedText(String(option.label), CONVERSATION_MEMORY_MAX_OPTION_LABEL),
          ...(option.referentRefs !== undefined ? {
            referentRefs: option.referentRefs.slice(0, CONVERSATION_MEMORY_MAX_OPTION_REFS).map((ref) => cappedText(String(ref), CONVERSATION_MEMORY_MAX_OPTION_REF)),
          } : {}),
          ...(option.intentPatch !== undefined ? {
            intentPatch: { actionText: cappedText(String(option.intentPatch.actionText), CONVERSATION_MEMORY_MAX_ACTION_TEXT) },
          } : {}),
        })),
        ...(framed !== undefined ? {
          framed: {
            slot: framed.slot,
            revision: { worldTime: framed.revision.worldTime, eventNumber: framed.revision.eventNumber },
            ...(framed.proposal !== undefined ? { proposal: framed.proposal } : {}),
            ...(framed.intent !== undefined ? { intent: framed.intent } : {}),
          },
        } : {}),
      };
    }
    if (metadata.continuation !== undefined) {
      out.continuation = {
        relation: metadata.continuation.relation,
        ...(metadata.continuation.clarificationTurnSeq !== undefined
          ? { clarificationTurnSeq: metadata.continuation.clarificationTurnSeq }
          : {}),
      };
    }
    if (metadata.dramaticThread !== undefined) {
      out.dramaticThread = {
        source: metadata.dramaticThread.source,
        title: cappedText(String(metadata.dramaticThread.title), CONVERSATION_MEMORY_MAX_THREAD_TITLE),
      };
    }
    const encoded = JSON.stringify(out);
    // Round-trip through the fail-closed parser: never persist what we would not read back.
    return parseConversationMemoryMetadata(encoded) ? encoded : null;
  } catch {
    return null;
  }
}

/** @deprecated Use ConversationInputClass. */
export type InputClass = ConversationInputClass;
/** @deprecated Use ConversationResponseKind. */
export type ResponseKind = ConversationResponseKind;
