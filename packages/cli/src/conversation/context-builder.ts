/**
 * Bounded Master conversation context (ADR-0028, plan_6 Stage 4, plan_7 transcript memory).
 *
 * A pure read-side builder over stored ConversationTurn rows plus the
 * observer-safe scene: the last replicas, surface-level referent focus, the
 * pending clarification, structured mentions, the player's goal, the
 * dramatic thread and observer-safe knowledge split into facts vs
 * uncertainties. Player text is carried verbatim as untrusted game
 * data — the prompt layer must frame it as data, never as instructions.
 * No Domain Events, no World State, no persistence writes.
 *
 * Memory model (plan_7 §§1,3,4,7):
 * - `recentTurns`/`recentFocus` keep their legacy bounded shapes so the
 *   focus stack and meta answers behave as before; `lastTurns` is the
 *   plan_7 window (<=12 replicas, ~7k chars, shown narration preferred).
 * - Structured memory comes from `conversation_context_json` metadata and
 *   degrades fail-closed to the legacy heuristic when a row has none.
 * - `observerRef` handles are transient: they are re-matched against the
 *   current scene on every build and never read from stored rows.
 * - Closing rules for clarification live here; K4 narrows the inquiry case
 *   (a foreign inquiry stops closing the pending question).
 */

import { parseIntent } from "@skald/intent-parser";
import {
  isGenericActionFallback,
  narrationKey,
  type MasterTurnSceneContext,
  type TurnNarration,
} from "@skald/world";
import type {
  ConversationMemoryMentionKind,
  ConversationTurn,
  ConversationTurnRecord,
} from "./types.js";

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

/** One plan_7 conversation replica with its stored response kind. */
export interface ConversationMessage {
  readonly speaker: "player" | "master";
  readonly text: string;
  readonly turnSeq: number;
  readonly responseKind?: ConversationTurn["responseKind"] | undefined;
}

/** A structured mention with a transient scene handle (never persisted). */
export interface ConversationMention {
  readonly kind: ConversationMemoryMentionKind;
  readonly role: "target" | "addressee" | "destination" | "topic" | "instrument";
  readonly label: string;
  readonly observerRef?: string | undefined;
  readonly turnSeq: number;
}

/** The player's stated goal: an interpretation, never World State. */
export interface ActivePlayerGoal {
  readonly summary: string;
  readonly originTurnSeq: number;
  readonly relatedMentions: readonly string[];
}

/** Read-side focus: why the master holds this thread now. */
export interface DramaticThread {
  readonly source: "pending_clarification" | "player_goal" | "observed_situation" | "personal_hook";
  readonly title: string;
  readonly originTurnSeq?: number | undefined;
}

/** One observer-safe knowledge line (facts: seen; uncertainties: told/inferred/doubt). */
export interface ConversationKnowledge {
  readonly text: string;
}

/** An unresolved Master question: the latest clarification turn. */
export interface PendingClarification {
  readonly question: string;
  readonly options: readonly { readonly optionId: string; readonly label: string }[];
  readonly turnSeq: number;
}

/** Bounded conversation input for the Master Turn interpreter. */
export interface MasterConversationContext {
  readonly recentTurns: readonly MasterConversationTurn[];
  readonly recentFocus: readonly ConversationReferent[];
  readonly pendingClarification: PendingClarification | null;
  readonly schemaVersion: 1;
  readonly lastTurns: readonly ConversationMessage[];
  readonly currentScene: MasterTurnSceneContext | null;
  readonly recentlyMentionedEntities: readonly ConversationMention[];
  readonly activePlayerGoal: ActivePlayerGoal | null;
  readonly currentDramaticThread: DramaticThread | null;
  readonly knownFacts: readonly ConversationKnowledge[];
  readonly knownUncertainties: readonly ConversationKnowledge[];
  readonly truncated: boolean;
}

/** Optional read-side inputs for the plan_7 contract (all default to absent). */
export interface ConversationContextInput {
  /** Ready narrations keyed by narrationKey(worldTime, correlationId). */
  readonly narrations?: ReadonlyMap<number | string, TurnNarration> | undefined;
  /** Current observer-safe scene: knowledge, situation and mention matching. */
  readonly scene?: MasterTurnSceneContext | undefined;
  /** Player's own vow for the personal-hook thread fallback. */
  readonly personalHook?: string | null | undefined;
  /** Rows scanned for clarification/goal; older history stays invisible. */
  readonly scanLimit?: number | undefined;
}

/** Turns per world kept in the legacy window (plan range is 8-12). */
export const MASTER_CONVERSATION_MAX_TURNS = 10;

/** Characters kept per replica. */
export const MASTER_CONVERSATION_MAX_TEXT = 500;

/** Focus hints kept, most recent first. */
export const MASTER_CONVERSATION_MAX_FOCUS = 8;

/** Characters kept per focus surface. */
export const MASTER_CONVERSATION_MAX_SURFACE = 120;

/** Plan_7 window: replicas in lastTurns (pending clarification appends separately). */
export const CONVERSATION_LAST_TURNS_MAX_MESSAGES = 12;

/**
 * Plan_7 window: total characters across lastTurns. Vacuous under the
 * 500-char replica cap by construction (12×500 < 7000); it guards future
 * cap raises, the count bound engages first today.
 */
export const CONVERSATION_LAST_TURNS_MAX_CHARS = 7000;

/** Rows scanned newest-first for clarification, goal and mentions. */
export const CONVERSATION_SCAN_TURNS = 30;

/** Structured mentions kept, most recent first. */
export const CONVERSATION_MAX_MENTIONS = 8;

/** Knowledge lines kept per side (facts vs uncertainties). */
export const CONVERSATION_MAX_KNOWLEDGE = 8;

/** Characters kept per knowledge line. */
export const CONVERSATION_MAX_KNOWLEDGE_TEXT = 160;

/** Characters kept per dramatic-thread title. */
export const CONVERSATION_MAX_THREAD_TITLE = 140;

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

function freeze<T>(value: T): T {
  return Object.freeze(value);
}

function isTechnicalMasterText(text: string): boolean {
  return isGenericActionFallback(text) || TECHNICAL_MASTER_TEXT.test(text);
}

function recordMetadata(turn: ConversationTurn): ConversationTurnRecord["contextMetadata"] {
  return (turn as ConversationTurnRecord).contextMetadata ?? null;
}

/** Empty context used when the builder cannot run (diagnosed as failed). */
export const EMPTY_MASTER_CONVERSATION: MasterConversationContext = freeze({
  recentTurns: freeze([]),
  recentFocus: freeze([]),
  pendingClarification: null,
  schemaVersion: 1 as const,
  lastTurns: freeze([]),
  currentScene: null,
  recentlyMentionedEntities: freeze([]),
  activePlayerGoal: null,
  currentDramaticThread: null,
  knownFacts: freeze([]),
  knownUncertainties: freeze([]),
  truncated: false,
});

/** Secret-free counts for the conversation_context diagnostic (§9). */
export interface ConversationContextSummary {
  readonly messageCount: number;
  readonly mentionCount: number;
  readonly hasPendingClarification: boolean;
  readonly hasGoal: boolean;
  readonly hasDramaticThread: boolean;
  readonly truncated: boolean;
}

export function describeConversationContext(context: MasterConversationContext): ConversationContextSummary {
  return {
    messageCount: context.lastTurns.length,
    mentionCount: context.recentlyMentionedEntities.length,
    hasPendingClarification: context.pendingClarification !== null,
    hasGoal: context.activePlayerGoal !== null,
    hasDramaticThread: context.currentDramaticThread !== null,
    truncated: context.truncated,
  };
}

/**
 * Builds the bounded conversation context for one world. Pure and
 * deterministic: the same stored rows always yield the same context, so a
 * reload changes nothing.
 */
export function buildMasterConversationContext(
  turns: readonly ConversationTurn[],
  worldId: string,
  input: ConversationContextInput = {},
): MasterConversationContext {
  const scanLimit = input.scanLimit ?? CONVERSATION_SCAN_TURNS;
  const rows = turns
    .filter((turn) => turn.worldId === worldId)
    .sort((left, right) => left.turnSeq - right.turnSeq);
  const scan = rows.slice(-Math.max(1, Math.floor(scanLimit)));
  const window = scan.filter((turn) => !isTechnicalMasterText(turn.responseText)).slice(-MASTER_CONVERSATION_MAX_TURNS);

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

  const pendingClarification = collectPendingClarification(scan);
  const lastTurns = collectLastTurns(scan, input.narrations);
  let truncated = lastTurns.truncated || scan.length >= Math.max(1, Math.floor(scanLimit));
  if (pendingClarification && !lastTurns.messages.some(
    (message) => message.speaker === "master" && message.turnSeq === pendingClarification.turnSeq,
  )) {
    // The pending question stays addressable even past the window edge.
    lastTurns.messages.push(freeze({
      speaker: "master" as const,
      text: truncate(pendingClarification.question, MASTER_CONVERSATION_MAX_TEXT),
      turnSeq: pendingClarification.turnSeq,
      responseKind: "clarification" as const,
    }));
  }
  const scene = input.scene ?? null;
  const mentions = collectMentions(scan, scene);
  const goal = collectGoal(scan, lastTurns.messages);
  const thread = selectDramaticThread(pendingClarification, goal, scene, input.personalHook ?? null);
  const knowledge = collectKnowledge(scene);

  return freeze({
    recentTurns: freeze(recentTurns),
    recentFocus: collectFocus(window),
    pendingClarification,
    schemaVersion: 1 as const,
    lastTurns: freeze(lastTurns.messages),
    currentScene: scene,
    recentlyMentionedEntities: mentions,
    activePlayerGoal: goal,
    currentDramaticThread: thread,
    knownFacts: knowledge.facts,
    knownUncertainties: knowledge.uncertainties,
    truncated,
  });
}

/**
 * Plan_7 window over the scan, newest first then ascending: at most 12
 * replicas within the char budget. The master side prefers the shown
 * narration (§4): a ready TurnNarration paired by worldTime+correlationId
 * replaces the deterministic responseText; technical master texts drop the
 * replica while the player replica is always kept.
 */
function collectLastTurns(
  scan: readonly ConversationTurn[],
  narrations: ReadonlyMap<number | string, TurnNarration> | undefined,
): { messages: ConversationMessage[]; truncated: boolean } {
  const ascending: ConversationMessage[] = [];
  let chars = 0;
  let truncated = false;
  for (let index = scan.length - 1; index >= 0; index -= 1) {
    if (ascending.length >= CONVERSATION_LAST_TURNS_MAX_MESSAGES) {
      truncated = true;
      break;
    }
    const turn = scan[index]!;
    const replicas: ConversationMessage[] = [];
    const masterText = shownMasterText(turn, narrations);
    if (masterText !== null) {
      replicas.push({ speaker: "master" as const, text: masterText, turnSeq: turn.turnSeq, responseKind: turn.responseKind });
    }
    replicas.push({
      speaker: "player" as const,
      text: truncate(turn.playerText, MASTER_CONVERSATION_MAX_TEXT),
      turnSeq: turn.turnSeq,
    });
    const cost = replicas.reduce((sum, replica) => sum + replica.text.length, 0);
    if (chars + cost > CONVERSATION_LAST_TURNS_MAX_CHARS && ascending.length > 0) {
      truncated = true;
      break;
    }
    chars += cost;
    // Turns iterate newest-first; replicas push master-then-player so the
    // single final reverse yields ascending player-then-master order.
    for (const replica of replicas) {
      ascending.push(freeze(replica));
    }
  }
  ascending.reverse();
  return { messages: ascending, truncated };
}

/** Shown master text for one turn, or null when the replica is dropped. */
function shownMasterText(
  turn: ConversationTurn,
  narrations: ReadonlyMap<number | string, TurnNarration> | undefined,
): string | null {
  if (isTechnicalMasterText(turn.responseText)) return null;
  const override = shownNarrationText(turn, narrations);
  return truncate(override ?? turn.responseText, MASTER_CONVERSATION_MAX_TEXT);
}

/**
 * Ready narration paired by worldTime+correlationId. Fallback rows,
 * foreign correlations and legacy uncorrelated rows never substitute.
 */
function shownNarrationText(
  turn: ConversationTurn,
  narrations: ReadonlyMap<number | string, TurnNarration> | undefined,
): string | null {
  if (!narrations || turn.correlationId === "") return null;
  const narration = narrations.get(narrationKey(turn.worldTimeAfter, turn.correlationId));
  if (!narration || narration.usedFallback) return null;
  const text = narration.text.trim();
  return text === "" ? null : text;
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
 * do not answer the pending question. Structured question/options restore
 * from memory metadata when the row carries them (K4 narrows the inquiry
 * case so a foreign inquiry no longer closes the question).
 */
function collectPendingClarification(scan: readonly ConversationTurn[]): PendingClarification | null {
  for (let index = scan.length - 1; index >= 0; index -= 1) {
    const turn = scan[index]!;
    if (turn.responseKind === "action_outcome" || turn.responseKind === "mixed_outcome" || turn.responseKind === "inquiry_answer") return null;
    if (turn.responseKind === "speech_reaction") return null;
    if (turn.responseKind !== "clarification") continue;
    // Technical master texts never enter LLM context, not even as questions.
    if (isTechnicalMasterText(turn.responseText)) continue;
    const stored = recordMetadata(turn)?.clarification;
    return freeze({
      question: truncate(stored?.question ?? turn.responseText, MASTER_CONVERSATION_MAX_TEXT),
      options: freeze(stored ? stored.options.map((option) => freeze({ ...option })) : []),
      turnSeq: turn.turnSeq,
    });
  }
  return null;
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/ё/gu, "е").replace(/\s+/gu, " ").trim();
}

/**
 * Matches one mention surface against the current scene. Handles are
 * transient: a stored label re-resolves on every build and never persists.
 */
function matchSceneMention(
  surface: string,
  scene: MasterTurnSceneContext | null,
): { kind: ConversationMemoryMentionKind; observerRef: string } | null {
  if (!scene) return null;
  const wanted = normalizeLabel(surface);
  if (wanted.length < 2) return null;
  const groups: ReadonlyArray<{
    kind: ConversationMemoryMentionKind;
    entries: ReadonlyArray<{ observerRef: string; labels: readonly string[] }>;
  }> = [
    { kind: "person", entries: scene.knownPeople.map((entry) => ({ observerRef: entry.observerRef, labels: entry.knownAs })) },
    {
      kind: "object",
      entries: [
        ...scene.visibleObjects.map((entry) => ({ observerRef: entry.observerRef, labels: entry.knownAs })),
        ...scene.accessibleItems.map((entry) => ({ observerRef: entry.observerRef, labels: entry.knownAs })),
      ],
    },
    { kind: "route", entries: scene.knownRoutes.map((entry) => ({ observerRef: entry.observerRef, labels: entry.knownAs })) },
    { kind: "topic", entries: scene.knownTopics.map((entry) => ({ observerRef: entry.observerRef, labels: [entry.text] })) },
  ];
  const wantedWords = wanted.split(" ").filter((word) => word.length >= 3);
  const matches = (labels: readonly string[]): boolean => labels.some((label) => {
    const normalized = normalizeLabel(label);
    if (!normalized) return false;
    if (normalized === wanted) return true;
    const labelWords = normalized.split(" ").filter((word) => word.length >= 3);
    return wantedWords.some((word) => labelWords.includes(word))
      || labelWords.some((word) => wantedWords.includes(word));
  });
  for (const group of groups) {
    for (const entry of group.entries) {
      if (matches(entry.labels)) return { kind: group.kind, observerRef: entry.observerRef };
    }
  }
  return null;
}

/**
 * Structured mentions, newest first: persisted metadata mentions first,
 * then a scene-resolved journey destination from the legacy heuristic.
 * Bare target surfaces without a scene match are skipped — a mention must
 * never invent a category (§1).
 */
function collectMentions(
  scan: readonly ConversationTurn[],
  scene: MasterTurnSceneContext | null,
): readonly ConversationMention[] {
  const mentions: ConversationMention[] = [];
  const seen = new Set<string>();
  const push = (mention: ConversationMention): void => {
    if (mentions.length >= CONVERSATION_MAX_MENTIONS) return;
    const key = `${mention.kind}:${normalizeLabel(mention.label)}`;
    if (seen.has(key)) return;
    seen.add(key);
    mentions.push(freeze(mention));
  };
  for (let index = scan.length - 1; index >= 0; index -= 1) {
    const turn = scan[index]!;
    const stored = recordMetadata(turn)?.mentions;
    if (stored) {
      for (const entry of stored) {
        const matched = matchSceneMention(entry.label, scene);
        push(freeze({
          kind: entry.kind,
          role: entry.role,
          label: truncate(entry.label, MASTER_CONVERSATION_MAX_SURFACE),
          ...(matched ? { observerRef: matched.observerRef } : {}),
          turnSeq: turn.turnSeq,
        }));
      }
      continue;
    }
    if ((turn.inputClass !== "action" && turn.inputClass !== "mixed")
      || (turn.responseKind !== "action_outcome" && turn.responseKind !== "mixed_outcome")) continue;
    const candidate = focusFromPlayerText(turn.playerText, turn.turnSeq);
    if (!candidate || candidate.kind !== "destination") continue;
    const matched = matchSceneMention(candidate.surface, scene);
    push(freeze({
      kind: "route" as const,
      role: "destination" as const,
      label: candidate.surface,
      ...(matched ? { observerRef: matched.observerRef } : {}),
      turnSeq: turn.turnSeq,
    }));
  }
  return freeze(mentions);
}

/**
 * The newest explicitly stated goal inside the context window. A newer
 * explicit goal replaces the previous one; an explicit cancel/new-topic
 * continuation clears it; the origin leaving the window drops it. An
 * action outcome never auto-completes it — completion is not universal.
 */
function collectGoal(
  scan: readonly ConversationTurn[],
  lastTurns: readonly ConversationMessage[],
): ActivePlayerGoal | null {
  if (lastTurns.length === 0) return null;
  let oldestKept = lastTurns[0]!.turnSeq;
  for (const message of lastTurns) {
    if (message.turnSeq < oldestKept) oldestKept = message.turnSeq;
  }
  let cancelled = false;
  for (let index = scan.length - 1; index >= 0; index -= 1) {
    const turn = scan[index]!;
    const metadata = recordMetadata(turn);
    if (metadata?.continuation
      && (metadata.continuation.relation === "cancels" || metadata.continuation.relation === "new_topic")) {
      cancelled = true;
    }
    const goal = metadata?.goal;
    if (!goal || cancelled) continue;
    if (turn.turnSeq < oldestKept) return null;
    return freeze({
      summary: goal.summary,
      originTurnSeq: turn.turnSeq,
      relatedMentions: freeze((metadata?.mentions ?? []).slice(0, 4).map((mention) => mention.label)),
    });
  }
  return null;
}

/** Deterministic thread priority: clarification > goal > situation > hook. */
function selectDramaticThread(
  pending: PendingClarification | null,
  goal: ActivePlayerGoal | null,
  scene: MasterTurnSceneContext | null,
  personalHook: string | null,
): DramaticThread | null {
  if (pending) {
    return freeze({
      source: "pending_clarification" as const,
      title: truncate(pending.question, CONVERSATION_MAX_THREAD_TITLE),
      originTurnSeq: pending.turnSeq,
    });
  }
  if (goal) {
    return freeze({
      source: "player_goal" as const,
      title: truncate(goal.summary, CONVERSATION_MAX_THREAD_TITLE),
      originTurnSeq: goal.originTurnSeq,
    });
  }
  if (scene?.currentSituation) {
    return freeze({ source: "observed_situation" as const, title: truncate(scene.currentSituation.title, CONVERSATION_MAX_THREAD_TITLE) });
  }
  const hook = (personalHook ?? "").trim();
  if (hook !== "") {
    return freeze({ source: "personal_hook" as const, title: truncate(hook, CONVERSATION_MAX_THREAD_TITLE) });
  }
  return null;
}

/**
 * Observer-safe knowledge split preserving WORLD ≠ KNOWLEDGE ≠
 * INTERPRETATION: directly seen lines are facts; told, inferred and
 * doubted lines stay uncertainties. Testimony is never upgraded to fact.
 */
function collectKnowledge(scene: MasterTurnSceneContext | null): {
  facts: readonly ConversationKnowledge[];
  uncertainties: readonly ConversationKnowledge[];
} {
  const facts: ConversationKnowledge[] = [];
  const uncertainties: ConversationKnowledge[] = [];
  for (const topic of scene?.knownTopics ?? []) {
    const line = freeze({ text: truncate(topic.text, CONVERSATION_MAX_KNOWLEDGE_TEXT) });
    if (topic.category === "seen") {
      if (facts.length < CONVERSATION_MAX_KNOWLEDGE) facts.push(line);
    } else if (uncertainties.length < CONVERSATION_MAX_KNOWLEDGE) {
      uncertainties.push(line);
    }
  }
  return { facts: freeze(facts), uncertainties: freeze(uncertainties) };
}
