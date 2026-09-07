/**
 * Bounded Master conversation context (ADR-0028, plan_6 Stage 4).
 *
 * A pure read-side builder over stored ConversationTurn rows: the last few
 * turns, surface-level referent focus from accepted actions, and the pending
 * clarification, if any. Player text is carried verbatim as untrusted game
 * data — the prompt layer (later stage) must frame it as data, never as
 * instructions. No Domain Events, no World State, no persistence changes.
 *
 * Notes for later stages:
 * - Focus here covers target/destination surfaces re-parsed deterministically
 *   from accepted action turns only. Inquiry focus arrives with the inquiry
 *   extension (Stage 6), speech addressees with speech metadata (Stage 11),
 *   and the pronoun priority stack with the focus stack (Stage 5).
 * - pendingClarification carries empty options: stored turns keep no
 *   structured options, only responseText. Structured clarification metadata
 *   needs a persistence migration (persistence stage).
 * - Schema finding: conversation_turns HAS CHECK constraints on input_class
 *   and response_kind (persistence/schema.ts v9), so extending those enums
 *   (speech/mixed/meta, Stage 11) requires a migration. A nullable JSON
 *   metadata column would not touch the CHECKs.
 */

import { parseIntent } from "@skald/intent-parser";
import { isGenericActionFallback } from "@skald/world";
import type { ConversationTurn } from "./types.js";

/** One bounded replica inside the conversation window. */
export interface MasterConversationTurn {
  readonly speaker: "player" | "master";
  readonly text: string;
  readonly turnSeq: number;
}

/** A surface-level referent hint from an accepted action turn. */
export interface ConversationReferent {
  readonly kind: "target" | "destination" | "topic" | "addressee";
  readonly surface: string;
  readonly turnSeq: number;
}

/** An unresolved Master question: the latest clarification turn. */
export interface PendingClarification {
  readonly question: string;
  readonly options: readonly string[];
  readonly turnSeq: number;
}

/** Bounded conversation input for the Master Turn interpreter. */
export interface MasterConversationContext {
  readonly recentTurns: readonly MasterConversationTurn[];
  readonly recentFocus: readonly ConversationReferent[];
  readonly pendingClarification: PendingClarification | null;
}

/** Turns per world kept in the window (plan range is 8-12). */
export const MASTER_CONVERSATION_MAX_TURNS = 10;

/** Characters kept per replica. */
export const MASTER_CONVERSATION_MAX_TEXT = 500;

/** Focus hints kept, most recent first. */
export const MASTER_CONVERSATION_MAX_FOCUS = 8;

/** Characters kept per focus surface. */
export const MASTER_CONVERSATION_MAX_SURFACE = 120;

/**
 * Legacy technical master texts never enter LLM context: old generic
 * placeholders plus anything leaking interpreter internals. Current natural
 * clarification questions pass through — they carry the pending question.
 */
const TECHNICAL_MASTER_TEXT =
  /unknown|confidence|observerRef|additionalClauses|schemaVersion|validator|entityId|eventId|sourceEventIds|internal/i;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function isTechnicalMasterText(text: string): boolean {
  return isGenericActionFallback(text) || TECHNICAL_MASTER_TEXT.test(text);
}

/**
 * Builds the bounded conversation context for one world. Pure and
 * deterministic: the same stored rows always yield the same context, so a
 * reload changes nothing.
 */
export function buildMasterConversationContext(
  turns: readonly ConversationTurn[],
  worldId: string,
): MasterConversationContext {
  const window = turns
    .filter((turn) => turn.worldId === worldId && !isTechnicalMasterText(turn.responseText))
    .sort((left, right) => left.turnSeq - right.turnSeq)
    .slice(-MASTER_CONVERSATION_MAX_TURNS);

  const recentTurns: MasterConversationTurn[] = [];
  for (const turn of window) {
    recentTurns.push(freeze({
      speaker: "player" as const,
      text: truncate(turn.playerText, MASTER_CONVERSATION_MAX_TEXT),
      turnSeq: turn.turnSeq,
    }));
    recentTurns.push(freeze({
      speaker: "master" as const,
      text: truncate(turn.responseText, MASTER_CONVERSATION_MAX_TEXT),
      turnSeq: turn.turnSeq,
    }));
  }

  return freeze({
    recentTurns: freeze(recentTurns),
    recentFocus: collectFocus(window),
    pendingClarification: collectPendingClarification(window),
  });
}

/**
 * Surface focus from accepted action turns, most recent first, deduplicated.
 * Mixed turns executed their primary like actions, so their targets count.
 */
function collectFocus(window: readonly ConversationTurn[]): readonly ConversationReferent[] {
  const focus: ConversationReferent[] = [];
  const seen = new Set<string>();
  for (let index = window.length - 1; index >= 0; index -= 1) {
    const turn = window[index]!;
    if ((turn.inputClass !== "action" && turn.inputClass !== "mixed")
      || (turn.responseKind !== "action_outcome" && turn.responseKind !== "mixed_outcome")) continue;
    const candidate = focusFromPlayerText(turn.playerText, turn.turnSeq);
    if (!candidate) continue;
    const key = `${candidate.kind}:${candidate.surface}`;
    if (seen.has(key)) continue;
    seen.add(key);
    focus.push(candidate);
    if (focus.length >= MASTER_CONVERSATION_MAX_FOCUS) break;
  }
  return freeze(focus);
}

/** Re-parses one accepted player text for its target/destination surface. */
function focusFromPlayerText(playerText: string, turnSeq: number): ConversationReferent | null {
  let parsed: ReturnType<typeof parseIntent>;
  try {
    parsed = parseIntent(playerText);
  } catch {
    return null;
  }
  if (parsed.type === "JourneyIntent") {
    const surface = truncate(parsed.destination.raw.trim(), MASTER_CONVERSATION_MAX_SURFACE);
    if (!surface) return null;
    return freeze({ kind: "destination" as const, surface, turnSeq });
  }
  if (parsed.type === "ActionIntentCommand" || parsed.type === "InteractionCommand") {
    const raw = parsed.target?.raw?.trim();
    if (!raw) return null;
    return freeze({ kind: "target" as const, surface: truncate(raw, MASTER_CONVERSATION_MAX_SURFACE), turnSeq });
  }
  return null;
}

/**
 * The latest clarification turn with no accepted action/inquiry after it.
 * Executed action, mixed and speech turns resolve it; read-only meta turns
 * do not answer the pending question.
 */
function collectPendingClarification(window: readonly ConversationTurn[]): PendingClarification | null {
  for (let index = window.length - 1; index >= 0; index -= 1) {
    const turn = window[index]!;
    if (turn.responseKind === "action_outcome" || turn.responseKind === "mixed_outcome" || turn.responseKind === "inquiry_answer") return null;
    if (turn.responseKind === "speech_reaction") return null;
    if (turn.responseKind !== "clarification") continue;
    return freeze({
      question: truncate(turn.responseText, MASTER_CONVERSATION_MAX_TEXT),
      // Stored turns keep no structured options; see module notes.
      options: freeze([]),
      turnSeq: turn.turnSeq,
    });
  }
  return null;
}

function freeze<T>(value: T): T {
  return Object.freeze(value);
}
