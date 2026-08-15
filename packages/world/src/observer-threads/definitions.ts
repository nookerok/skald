/**
 * Observer Thread definitions — declarative registry of long-lived processes.
 *
 * Real thread keys come only from existing Presentation Templates; no new
 * Event kinds or thread keys are invented here. Lifecycle signals are
 * classified from the canonical Domain Event types behind each journal entry:
 * start/develop keep the thread "active", resolve marks it "resolved". When
 * the available semantics do not justify a claim, the classification falls
 * back to "unknown" — a thread is never completed by silence.
 */

import type { PresentationThread } from "../journal/types.js";

/** Lifecycle signal one journal entry contributes to its thread. */
export type ThreadSignal = "start" | "develop" | "resolve";

/**
 * One registered long-lived process family. `match` selects journal thread
 * keys; signal arrays name the canonical Event types that move the thread.
 */
export interface ObserverThreadDefinition {
  readonly match: (threadKey: string) => boolean;
  readonly startEventTypes: readonly string[];
  readonly developEventTypes: readonly string[];
  readonly resolveEventTypes: readonly string[];
  /** Player-facing title; never a raw key. */
  readonly titleFor: (thread: PresentationThread) => string;
  /** Player-facing summary for the latest observed signal. */
  readonly describeFor: (signal: ThreadSignal) => string;
}

/** Signal precedence for equal-timestamp entries: resolve > develop > start. */
const SIGNAL_RANK: Record<ThreadSignal, number> = { start: 1, develop: 2, resolve: 3 };

export function signalRank(signal: ThreadSignal): number {
  return SIGNAL_RANK[signal];
}

/**
 * Deterministic opaque player-facing ref for a thread key. The same key
 * always yields the same ref; the ref never reveals the internal key.
 * FNV-1a 32-bit, same algorithm as the belief revision digest.
 */
export function computeThreadRef(threadKey: string): string {
  let hash = 0x811c9dc5;
  const seed = `observer-thread:v1:${threadKey}`;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `ot-${(hash >>> 0).toString(36)}`;
}

/**
 * Maps a thread key to the belief pattern it may participate in, or null.
 * Only `consequence:*` keys align with an existing pattern id
 * (observation/builder.ts). TODO: situation threads have no belief pattern
 * yet, so they can never be contradicted; revisit when a situation pattern
 * exists.
 */
export function threadKeyToPatternId(threadKey: string): string | null {
  if (threadKey.startsWith("consequence:")) return threadKey;
  return null;
}

const FOREST_FIRE: ObserverThreadDefinition = {
  match: (threadKey) => threadKey === "situation:forest_fire",
  startEventTypes: ["ForestFireStarted", "SituationStarted"],
  developEventTypes: ["TreeBurned"],
  resolveEventTypes: ["SituationEnded"],
  titleFor: () => "Лесной пожар",
  describeFor: (signal) => {
    switch (signal) {
      case "start": return "Ты заметил, как в лесу начался пожар.";
      case "develop": return "При последнем наблюдении пожар продолжался.";
      case "resolve": return "Ты видел, как пожар завершился.";
    }
  },
};

const GENERIC_SITUATION: ObserverThreadDefinition = {
  match: (threadKey) => threadKey.startsWith("situation:"),
  startEventTypes: ["SituationStarted"],
  developEventTypes: [],
  resolveEventTypes: ["SituationEnded"],
  titleFor: (thread) => thread.label,
  describeFor: (signal) => {
    switch (signal) {
      case "start": return "Ты заметил начало перемен в мире.";
      case "develop": return "При последнем наблюдении происходящее продолжалось.";
      case "resolve": return "Ты видел, как происходящее завершилось.";
    }
  },
};

const CONSEQUENCE: ObserverThreadDefinition = {
  match: (threadKey) => threadKey.startsWith("consequence:"),
  // ConsequenceCreated is an internal scheduling event (see observation/builder.ts)
  // and never surfaces a thread entry; the player notices a consequence only when
  // it manifests (AudacityTriggered / ConsequenceFired).
  startEventTypes: ["AudacityTriggered"],
  developEventTypes: ["ConsequenceFired"],
  // TODO: ConsequenceExpired has no player-facing presentation entry today,
  // so the journal never sees a completion signal for consequences. Until a
  // visible completion signal exists, a consequence thread may only claim
  // "active at last observation" or age into uncertainty — never an ending.
  resolveEventTypes: [],
  titleFor: (thread) => thread.label,
  describeFor: (signal) => {
    switch (signal) {
      case "start": return "Ты заметил последствие своих действий.";
      case "develop": return "Последствие проявилось при твоём наблюдении.";
      case "resolve": return "Ты видел, как последствие исчерпало себя.";
    }
  },
};

/** Declarative registry in deterministic registration order. */
export const OBSERVER_THREAD_DEFINITIONS: readonly ObserverThreadDefinition[] = [
  FOREST_FIRE,
  GENERIC_SITUATION,
  CONSEQUENCE,
];

/** First definition matching the key, or null (key is not a thread). */
export function definitionForThreadKey(threadKey: string): ObserverThreadDefinition | null {
  return OBSERVER_THREAD_DEFINITIONS.find((definition) => definition.match(threadKey)) ?? null;
}

/** Classifies the latest signal of a thread, or null when unclassifiable. */
export function classifyThread(thread: PresentationThread): ThreadSignal | null {
  let latest: ThreadSignal | null = null;
  let latestTime = -1;
  for (const entry of thread.entries) {
    for (const type of entry.sourceEventTypes) {
      const signal = signalForEventType(thread.threadKey, type);
      if (!signal) continue;
      const rank = signalRank(signal);
      if (
        entry.worldTime > latestTime ||
        (entry.worldTime === latestTime && latest !== null && rank > signalRank(latest))
      ) {
        latest = signal;
        latestTime = entry.worldTime;
      }
    }
  }
  return latest;
}

function signalForEventType(threadKey: string, eventType: string): ThreadSignal | null {
  const definition = definitionForThreadKey(threadKey);
  if (!definition) return null;
  if (definition.startEventTypes.includes(eventType)) return "start";
  if (definition.developEventTypes.includes(eventType)) return "develop";
  if (definition.resolveEventTypes.includes(eventType)) return "resolve";
  return null;
}
