/**
 * Observer Thread Journal — pure deterministic builder.
 *
 * Everything here is synchronous and derives only from the observer-scoped
 * journal (skipOfflineTurns), the observer-scoped BeliefModel and the
 * observer checkpoint memory. No network, SQLite, LLM, Date.now(),
 * Math.random() or hidden globals. All outputs are deeply frozen.
 *
 * Threads are capped at MAX_THREADS (8) and evidence at MAX_EVIDENCE (3) per
 * thread; counts are derived from the returned DTO so the numbers always
 * match the rendered cards.
 */

import type { DomainEvent } from "@skald/event-bus";
import type { BeliefModelDTO, PatternId } from "../observation/types.js";
import type { PresentationThread, TurnJournal } from "../journal/types.js";
import { buildTurnJournal } from "../journal/builder.js";
import type { CheckpointState, ObserverCheckpoint, WorldRevision } from "../presence/types.js";
import {
  classifyThread,
  computeThreadRef,
  definitionForThreadKey,
  threadKeyToPatternId,
  type ThreadSignal,
} from "./definitions.js";
import type {
  ObserverThreadDTO,
  ObserverThreadJournalDTO,
  ThreadKnowledgeState,
  ThreadKnownLifecycle,
} from "./types.js";

/** Maximum number of threads returned in the journal DTO. */
export const MAX_THREADS = 8;
/** Maximum number of evidence entries per thread in the DTO. */
export const MAX_EVIDENCE = 3;
/** Maximum number of recently-resolved threads reported in counts. */
export const MAX_RECENTLY_RESOLVED = 3;
/** Ticks after which a remembered thread becomes uncertain. */
export const REMEMBERED_MAX_AGE = 3;

function deepFreeze<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (v && typeof v === "object") deepFreeze(v);
  }
  return obj;
}

/** Distinct pattern ids involved in the current contradictions (mirrors presence). */
export function contradictedPatternIds(model: BeliefModelDTO): PatternId[] {
  const involved = new Set<PatternId>();
  for (const contradiction of model.contradictions) {
    for (const belief of model.beliefs) {
      const hypothesisHit = belief.openHypotheses.some(
        (hypothesis) => contradiction.involvedHypothesisIds.includes(hypothesis.id),
      );
      const evidenceHit = belief.supportingEvidence.some(
        (entry) => contradiction.involvedEvidenceIds.includes(entry.id),
      );
      if (hypothesisHit || evidenceHit) involved.add(belief.patternId);
    }
  }
  return [...involved].sort();
}

function knowledgeStateOf(input: {
  contradicted: boolean;
  lastObservedAt: number;
  currentWorldTime: number;
}): ThreadKnowledgeState {
  if (input.contradicted) return "contradicted";
  if (input.lastObservedAt === input.currentWorldTime) return "observed";
  if (input.currentWorldTime - input.lastObservedAt <= REMEMBERED_MAX_AGE) return "remembered";
  return "uncertain";
}

function lifecycleOf(signal: ThreadSignal | null): ThreadKnownLifecycle {
  if (signal === "resolve") return "resolved";
  if (signal === "start" || signal === "develop") return "active";
  return "unknown";
}

function fallbackSummary(lifecycle: ThreadKnownLifecycle): string {
  switch (lifecycle) {
    case "resolved": return "Ты видел, как это завершилось.";
    case "active": return "При последнем наблюдении это продолжалось.";
    case "unknown": return "О происходящем нет надёжных сведений.";
  }
}

function uncertaintyText(knowledgeState: ThreadKnowledgeState, hasMemory: boolean): string | null {
  switch (knowledgeState) {
    case "uncertain":
      return hasMemory
        ? "После твоего ухода новых признаков не было."
        : "Новых признаков давно не было.";
    case "contradicted":
      return "Новые свидетельства ставят прежние сведения под сомнение.";
    default:
      return null;
  }
}

function changeKindFor(input: {
  contradicted: boolean;
  knownAtCheckpoint: boolean;
  lifecycle: ThreadKnownLifecycle;
  checkpointLifecycle: ThreadKnownLifecycle | null;
  lastObservedAt: number;
  checkpointTime: number;
}): "appeared" | "developed" | "resolved" | "contradicted" | null {
  if (input.contradicted) return "contradicted";
  if (input.knownAtCheckpoint && input.checkpointLifecycle !== "resolved" && input.lifecycle === "resolved") {
    return "resolved";
  }
  if (!input.knownAtCheckpoint) return "appeared";
  if (input.lastObservedAt > input.checkpointTime) return "developed";
  return null;
}

/**
 * Deterministic display order for the journal: changed → contradicted →
 * uncertain → observed active → resolved → lastObservedAt desc → ref asc.
 */
function threadSortRank(thread: ObserverThreadDTO): number {
  if (thread.changeSincePresence !== null) return 0;
  if (thread.knowledgeState === "contradicted") return 1;
  if (thread.knowledgeState === "uncertain") return 2;
  if (thread.knownLifecycle === "active" && thread.knowledgeState === "observed") return 3;
  if (thread.knownLifecycle === "resolved") return 4;
  return 5;
}

function buildThread(input: {
  thread: PresentationThread;
  definition: NonNullable<ReturnType<typeof definitionForThreadKey>>;
  checkpointThread: PresentationThread | null;
  knownAtCheckpoint: boolean;
  checkpointTime: number;
  hasMemory: boolean;
  contradictedPatterns: ReadonlySet<string>;
  currentWorldTime: number;
  revision: WorldRevision;
}): ObserverThreadDTO {
  const signal = classifyThread(input.thread);
  const lifecycle = lifecycleOf(signal);
  const patternId = threadKeyToPatternId(input.thread.threadKey);
  const contradicted = patternId !== null && input.contradictedPatterns.has(patternId);
  const lastObservedAt = input.thread.lastWorldTime;
  const knowledgeState = knowledgeStateOf({
    contradicted,
    lastObservedAt,
    currentWorldTime: input.currentWorldTime,
  });
  const checkpointSignal = input.checkpointThread ? classifyThread(input.checkpointThread) : null;
  const change = input.hasMemory
    ? changeKindFor({
      contradicted,
      knownAtCheckpoint: input.knownAtCheckpoint,
      lifecycle,
      checkpointLifecycle: checkpointSignal ? lifecycleOf(checkpointSignal) : null,
      lastObservedAt,
      checkpointTime: input.checkpointTime,
    })
    : null;

  const evidence = input.thread.entries
    .filter((entry): entry is PresentationThread["entries"][number] & { importance: "primary" | "notable" } =>
      entry.importance !== "background",
    )
    .slice(-MAX_EVIDENCE)
    .map((entry) => deepFreeze({
      worldTime: entry.worldTime,
      text: entry.text,
      importance: entry.importance,
    }));

  return deepFreeze({
    ref: computeThreadRef(input.thread.threadKey),
    title: input.definition.titleFor(input.thread),
    knownLifecycle: lifecycle,
    knowledgeState,
    summary: signal ? input.definition.describeFor(signal) : fallbackSummary(lifecycle),
    firstObservedAt: input.thread.firstWorldTime,
    lastObservedAt,
    evidenceCount: evidence.length,
    changeSincePresence: change ? deepFreeze({ kind: change }) : null,
    evidence: deepFreeze(evidence),
    uncertaintyText: uncertaintyText(knowledgeState, input.hasMemory),
  });
}

/**
 * Builds the full observer thread journal at one revision. Only a checkpoint
 * that resolves `valid` provides thread memory (checkpoint threads are
 * carried forward and aged); `missing` or `incompatible` means no memory of
 * threads, and change/uncertainty texts adapt accordingly. The caller passes
 * the same `checkpointState` that presence resolved for the same events, so
 * an unverifiable memory is never silently trusted.
 */
export function buildObserverThreadJournal(input: {
  events: readonly DomainEvent[];
  beliefModel: BeliefModelDTO;
  checkpoint: ObserverCheckpoint | null;
  checkpointState: CheckpointState;
  revision: WorldRevision;
}): ObserverThreadJournalDTO {
  const hasMemory = input.checkpoint !== null && input.checkpointState === "valid";
  const currentJournal = buildTurnJournal(input.events, { skipOfflineTurns: true });
  const checkpointJournal = hasMemory
    ? buildTurnJournal(input.events.slice(0, input.checkpoint!.lastPresenceEventNumber), { skipOfflineTurns: true })
    : null;
  const checkpointThreads = new Map(checkpointJournal?.threads.map((thread) => [thread.threadKey, thread]) ?? []);
  const checkpointTime = input.checkpoint?.lastPresenceWorldTime ?? 0;
  const contradicted = new Set(contradictedPatternIds(input.beliefModel));

  const threads: ObserverThreadDTO[] = [];
  for (const thread of currentJournal.threads) {
    const definition = definitionForThreadKey(thread.threadKey);
    if (!definition) continue;
    threads.push(buildThread({
      thread,
      definition,
      checkpointThread: checkpointThreads.get(thread.threadKey) ?? null,
      knownAtCheckpoint: checkpointThreads.has(thread.threadKey),
      checkpointTime,
      hasMemory,
      contradictedPatterns: contradicted,
      currentWorldTime: input.revision.worldTime,
      revision: input.revision,
    }));
  }

  const sorted = [...threads].sort((a, b) => {
    const rank = threadSortRank(a) - threadSortRank(b);
    if (rank !== 0) return rank;
    if (b.lastObservedAt !== a.lastObservedAt) return b.lastObservedAt - a.lastObservedAt;
    return a.ref.localeCompare(b.ref);
  }).slice(0, MAX_THREADS);

  const journal = deepFreeze({
    schemaVersion: 1 as const,
    revision: deepFreeze({ ...input.revision }),
    threads: deepFreeze(sorted),
    counts: deepFreeze({
      observedActive: sorted.filter((thread) => thread.knownLifecycle === "active" && thread.knowledgeState === "observed").length,
      changedSincePresence: sorted.filter((thread) => thread.changeSincePresence !== null).length,
      uncertain: sorted.filter((thread) => thread.knowledgeState === "uncertain" || thread.knowledgeState === "contradicted").length,
      recentlyResolved: Math.min(
        MAX_RECENTLY_RESOLVED,
        sorted.filter((thread) => thread.changeSincePresence?.kind === "resolved").length,
      ),
    }),
  });

  return journal;
}

export { buildTurnJournal };

export type { TurnJournal };
