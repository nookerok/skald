/**
 * Observer Thread Journal — UX-6.2 read-model contract.
 *
 * Pure read-side types for long-lived world processes as the player knows
 * them. Nothing here is a Rule, Domain Event or Projection field. All content
 * is derived from the observer-scoped player-facing journal (which already
 * drops offline turns), the observer-scoped BeliefModel and the observer
 * checkpoint memory; hidden world state never enters these DTOs.
 *
 * `knownLifecycle` answers "what is the process doing, as far as the observer
 * can tell" (active | resolved | unknown) and `knowledgeState` answers "how
 * current is the observer's knowledge" (observed | remembered | uncertain |
 * contradicted). The two axes are orthogonal: an active thread can be
 * uncertain, and absence of a new observation never means completion.
 */

import type { WorldRevision } from "../presence/types.js";
import type { PresentationImportance } from "../presentation/types.js";

/** What the observer can claim about the process behind a thread. */
export type ThreadKnownLifecycle = "active" | "resolved" | "unknown";

/** How current the observer's knowledge of the thread is. */
export type ThreadKnowledgeState = "observed" | "remembered" | "uncertain" | "contradicted";

/** How the thread changed since the last recorded presence. */
export type ThreadChangeKind = "appeared" | "developed" | "resolved" | "contradicted";

/** One player-facing journal entry attached to a thread. */
export interface ObserverThreadEvidence {
  readonly worldTime: number;
  readonly text: string;
  readonly importance: Exclude<PresentationImportance, "background">;
}

/** Backend-computed change of the thread since the last presence. */
export interface ObserverThreadChange {
  readonly kind: ThreadChangeKind;
}

/** Player-facing thread card; internal identifiers never appear here. */
export interface ObserverThreadDTO {
  /** Opaque deterministic ref: fnv1a("observer-thread:v1:" + threadKey). */
  readonly ref: string;
  readonly title: string;
  readonly knownLifecycle: ThreadKnownLifecycle;
  readonly knowledgeState: ThreadKnowledgeState;
  /** Honest combined statement; never a hidden-truth claim. */
  readonly summary: string;
  readonly firstObservedAt: number;
  readonly lastObservedAt: number;
  readonly evidenceCount: number;
  /** Non-null only when a valid checkpoint memory exists. */
  readonly changeSincePresence: ObserverThreadChange | null;
  /** Most recent entries, capped; primary/notable only. */
  readonly evidence: readonly ObserverThreadEvidence[];
  /** Honest doubt text; non-null when the knowledge is not current. */
  readonly uncertaintyText: string | null;
}

/** Consistent aggregate of all known threads at one world revision. */
export interface ObserverThreadJournalDTO {
  readonly schemaVersion: 1;
  readonly revision: WorldRevision;
  readonly threads: readonly ObserverThreadDTO[];
  readonly counts: {
    /** Threads with knownLifecycle "active" and knowledgeState "observed". */
    readonly observedActive: number;
    /** Threads with a non-null changeSincePresence. */
    readonly changedSincePresence: number;
    /** Threads whose knowledge is not current (uncertain/contradicted). */
    readonly uncertain: number;
    /** Threads resolved since the last presence, capped at 3. */
    readonly recentlyResolved: number;
  };
}

/** Backend-computed command-response summary of thread movement. */
export interface ObserverThreadDelta {
  /** Threads not known at the checkpoint. */
  readonly opened: readonly string[];
  /** Known threads with new observed evidence since the checkpoint. */
  readonly changed: readonly string[];
  /** Known threads whose completion was observed since the checkpoint. */
  readonly resolved: readonly string[];
  /** Known threads whose knowledge is no longer current. */
  readonly becameUncertain: readonly string[];
}
