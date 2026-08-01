import type { DomainEvent } from "@skald/event-bus";
import { WorldProjector } from "../projection.js";
import { selectTurnPresentation } from "../presentation/selector.js";
import type { PresentationEntry } from "../presentation/types.js";
import { sanitizePlayerFacingText } from "../game-shell/player-facing.js";
import type { JournalTurn, PresentationThread, PresentationThreadEntry, TurnJournal } from "./types.js";

function deepFreeze<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (v && typeof v === "object") deepFreeze(v);
  }
  return obj;
}

export function buildTurnJournal(events: readonly DomainEvent[]): TurnJournal {
  const projector = new WorldProjector();
  const turns: JournalTurn[] = [];
  const threadMap = new Map<string, PresentationThreadEntry[]>();
  const threadLabels = new Map<string, string>();
  let lastTimestamp = 0;

  // Single sequential pass over the canonical Event Log
  let currentTurnEvents: DomainEvent[] = [];

  function flushTurn() {
    if (currentTurnEvents.length === 0) return;
    const ts = currentTurnEvents[0]!.timestamp;

    // Apply all events of this turn to the projector
    for (const e of currentTurnEvents) projector.apply(e);
    const snapshot = projector.getSnapshot();
    const rawPresentation = selectTurnPresentation(currentTurnEvents, snapshot);
    const sanitizeEntry = (entry: PresentationEntry): PresentationEntry => ({
      ...entry,
      text: sanitizePlayerFacingText(entry.text),
      ...(entry.threadLabel ? { threadLabel: sanitizePlayerFacingText(entry.threadLabel) } : {}),
    });
    const presentation = {
      primary: rawPresentation.primary ? sanitizeEntry(rawPresentation.primary) : null,
      notable: rawPresentation.notable.map(sanitizeEntry),
      background: rawPresentation.background.map(sanitizeEntry),
      suppressedEventCount: rawPresentation.suppressedEventCount,
      worldTime: rawPresentation.worldTime,
      playerPosition: rawPresentation.playerPosition,
    };

    const turnId = `turn:${ts}`;
    turns.push({
      turnId,
      worldTime: ts,
      presentation,
      sourceEventIds: currentTurnEvents.map((e) => e.eventId),
    });

    // Collect thread entries from this turn
    const allEntries: PresentationEntry[] = [];
    if (presentation.primary) allEntries.push(presentation.primary);
    allEntries.push(...presentation.notable);
    allEntries.push(...presentation.background);

    for (const entry of allEntries) {
      if (!entry.threadKey) continue;
      const list = threadMap.get(entry.threadKey) ?? [];
      list.push({
        turnId,
        worldTime: ts,
        text: sanitizePlayerFacingText(entry.text),
        importance: entry.importance,
        discoveryMark: entry.discoveryMark,
        sourceEventIds: entry.sourceEventIds,
      });
      threadMap.set(entry.threadKey, list);
      if (entry.threadLabel) threadLabels.set(entry.threadKey, sanitizePlayerFacingText(entry.threadLabel));
    }

    currentTurnEvents = [];
  }

  for (const e of events) {
    // Monotonic check — applies to ALL timestamps including 0
    if (e.timestamp < lastTimestamp) {
      throw new Error(`Non-monotonic timestamp in Event Log: ${e.timestamp} < ${lastTimestamp}`);
    }

    if (e.timestamp === 0) {
      // Bootstrap allowed only at the start, before any positive-timestamp event
      if (lastTimestamp > 0) {
        throw new Error(`Bootstrap event at timestamp 0 after turn timestamp ${lastTimestamp}`);
      }
      projector.apply(e);
      continue;
    }

    if (e.timestamp !== lastTimestamp && currentTurnEvents.length > 0) {
      flushTurn();
    }

    currentTurnEvents.push(e);
    lastTimestamp = e.timestamp;
  }

  // Flush the last turn
  flushTurn();

  // Build threads
  const threads: PresentationThread[] = [];
  for (const [key, entries] of threadMap) {
    const sorted = deepFreeze([...entries].sort((a, b) => a.worldTime - b.worldTime));
    threads.push(deepFreeze({
      threadKey: key,
      label: threadLabels.get(key) ?? sanitizePlayerFacingText(key),
      firstWorldTime: sorted[0]!.worldTime,
      lastWorldTime: sorted[sorted.length - 1]!.worldTime,
      entries: sorted,
    }));
  }
  threads.sort((a, b) => a.firstWorldTime - b.firstWorldTime);

  return deepFreeze({
    turns: deepFreeze(turns),
    threads: deepFreeze(threads),
    worldTime: events.length > 0 ? events[events.length - 1]!.timestamp : 0,
  });
}
