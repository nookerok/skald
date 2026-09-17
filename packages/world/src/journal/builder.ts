import type { DomainEvent } from "@skald/event-bus";
import { WorldProjector } from "../projection.js";
import { selectTurnPresentation } from "../presentation/selector.js";
import type { PresentationEntry } from "../presentation/types.js";
import { sanitizePlayerFacingText } from "../game-shell/player-facing.js";
import type { JournalNarration, JournalTurn, PresentationThread, PresentationThreadEntry, TurnJournal } from "./types.js";
import type { TurnNarration } from "../narrative-llm.js";
import { narrationKey } from "./identity.js";

function deepFreeze<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (v && typeof v === "object") deepFreeze(v);
  }
  return obj;
}

/**
 * Deterministic opaque key for one authoring command's journal slices.
 * Same causal root always yields the same key; the key never reveals the
 * internal event id. FNV-1a 32-bit, same algorithm as the observer-thread
 * refs, with its own domain seed.
 */
export function computeMasterTurnKey(rootEventId: string): string {
  let hash = 0x811c9dc5;
  const seed = `master-turn:v1:${rootEventId}`;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `mt-${(hash >>> 0).toString(36)}`;
}

/**
 * Causal root of one event within the log: follow causationId until an
 * event without a known cause. Cycle-guarded and total — a missing link
 * or a cycle stops the walk at the last reachable event, so every event
 * always resolves to exactly one root.
 */
function causalRoot(event: DomainEvent, byId: ReadonlyMap<string, DomainEvent>): DomainEvent {
  let current = event;
  const seen = new Set<string>([current.eventId]);
  while (typeof current.causationId === "string" && current.causationId.length > 0) {
    const parent = byId.get(current.causationId);
    if (!parent || seen.has(parent.eventId)) break;
    seen.add(parent.eventId);
    current = parent;
  }
  return current;
}

/** Options controlling how turns are collected into a journal. */
export interface BuildTurnJournalOptions {
  /**
   * When true, turns containing a `TickPassed` with `playerOffline: true`
   * still advance the internal projection (the historical projection stays
   * complete) but produce no presentation and no thread entries: the observer
   * could not have seen them.
   */
  readonly skipOfflineTurns?: boolean;
}

function turnIsOffline(events: readonly DomainEvent[]): boolean {
  return events.some(
    (event) => event.type === "TickPassed" && (event.payload as { playerOffline?: boolean }).playerOffline === true,
  );
}

/**
 * World development with no authoring player replica: an offline player tick
 * (advance / absence) possibly with its derived consequences, but no online
 * tick and nothing from the command request pipeline. The feed renders such
 * turns as a scene separator, never as an answer. Online ticks (wait,
 * journey steps) and command turns are never autonomous.
 */
function turnIsAutonomous(events: readonly DomainEvent[]): boolean {
  if (events.length === 0) return false;
  let offlineTick = false;
  for (const event of events) {
    if (event.type === "TickPassed") {
      if ((event.payload as { playerOffline?: boolean }).playerOffline === true) {
        offlineTick = true;
        continue;
      }
      return false;
    }
    if (/(Requested|Validated)$/.test(event.type)) return false;
  }
  return offlineTick;
}

/**
 * Pure, non-authoritative read-side merge: attach stored literary narrations to
 * journal turns by time and correlation. Uncorrelated legacy rows attach only
 * when the full journal has a single turn at that time. Fallback narrations are
 * never surfaced — the deterministic template is already authoritative there.
 */
export function attachTurnNarrations(
  turns: readonly JournalTurn[],
  narrations: ReadonlyMap<number | string, TurnNarration>,
  allTurns: readonly JournalTurn[] = turns,
): JournalTurn[] {
  return turns.map((t) => {
    const sameTimeCount = allTurns.filter((candidate) => candidate.worldTime === t.worldTime).length;
    const narration = narrations.get(narrationKey(t.worldTime, t.correlationId))
      ?? (sameTimeCount === 1 ? narrations.get(t.worldTime) : undefined);
    if (!narration || narration.usedFallback) return t;

    // Keep persistence/operational fields out of the player-facing journal
    // DTO. In particular, fallbackReason must never be serialized here.
    const journalNarration: JournalNarration = {
      text: narration.text,
      model: narration.model,
      usedFallback: false,
      latencyMs: narration.latencyMs,
    };
    return { ...t, narrativeLLM: journalNarration };
  });
}

export function buildTurnJournal(events: readonly DomainEvent[], options: BuildTurnJournalOptions = {}): TurnJournal {
  const projector = new WorldProjector();
  const turns: JournalTurn[] = [];
  const threadMap = new Map<string, PresentationThreadEntry[]>();
  const threadLabels = new Map<string, string>();
  let lastTimestamp = 0;
  const byId = new Map<string, DomainEvent>();
  for (const e of events) {
    if (!byId.has(e.eventId)) byId.set(e.eventId, e);
  }

  // Single sequential pass over the canonical Event Log
  let currentTurnEvents: DomainEvent[] = [];

  function flushTurn() {
    if (currentTurnEvents.length === 0) return;
    const ts = currentTurnEvents[0]!.timestamp;

    // Apply all events of this turn to the projector regardless of observer
    // scope: the historical projection must stay complete.
    for (const e of currentTurnEvents) projector.apply(e);

    if (options.skipOfflineTurns === true && turnIsOffline(currentTurnEvents)) {
      currentTurnEvents = [];
      return;
    }

    const snapshot = projector.getSnapshot();
    const rawPresentation = selectTurnPresentation(currentTurnEvents, snapshot);
    const sanitizeEntry = (entry: PresentationEntry): PresentationEntry => ({
      ...entry,
      text: sanitizePlayerFacingText(entry.text),
      ...(entry.threadLabel ? { threadLabel: sanitizePlayerFacingText(entry.threadLabel) } : {}),
    });
    const presentation = {
      response: rawPresentation.response ? {
        kind: rawPresentation.response.kind,
        text: sanitizePlayerFacingText(rawPresentation.response.text),
        sourceEventIds: rawPresentation.response.sourceEventIds,
      } : null,
      primary: rawPresentation.primary ? sanitizeEntry(rawPresentation.primary) : null,
      notable: rawPresentation.notable.map(sanitizeEntry),
      background: rawPresentation.background.map(sanitizeEntry),
      suppressedEventCount: rawPresentation.suppressedEventCount,
      worldTime: rawPresentation.worldTime,
      playerPosition: rawPresentation.playerPosition,
    };

    const responseEventIds = new Set(presentation.response?.sourceEventIds ?? []);
    const responseCorrelations = [...new Set(
      currentTurnEvents
        .filter((event) => responseEventIds.has(event.eventId))
        .map((event) => event.correlationId),
    )];
    const correlationId = responseCorrelations.length === 1 ? responseCorrelations[0] : currentTurnEvents[0]?.correlationId;

    const turnId = turns.some((turn) => turn.worldTime === ts)
      ? `turn:${ts}:${currentTurnEvents[0]!.eventId}` : `turn:${ts}`;
    // One command, one MasterTurn: all slices share the causal root of the
    // turn's first event, so a journey start and its first travel tick
    // render as one chain instead of orphaning all but one slice.
    const masterTurnKey = computeMasterTurnKey(causalRoot(currentTurnEvents[0]!, byId).eventId);
    turns.push({
      turnId,
      worldTime: ts,
      masterTurnKey,
      ...(correlationId ? { correlationId } : {}),
      ...(turnIsAutonomous(currentTurnEvents) ? { autonomous: true as const } : {}),
      presentation,
      sourceEventIds: currentTurnEvents.map((e) => e.eventId),
    });

    // Collect thread entries from this turn
    const allEntries: PresentationEntry[] = [];
    if (presentation.primary) allEntries.push(presentation.primary);
    allEntries.push(...presentation.notable);
    allEntries.push(...presentation.background);

    const typeById = new Map<string, string>();
    for (const e of currentTurnEvents) typeById.set(e.eventId, e.type);

    for (const entry of allEntries) {
      if (!entry.threadKey) continue;
      const list = threadMap.get(entry.threadKey) ?? [];
      const sourceEventTypes = [...new Set(
        entry.sourceEventIds
          .map((id) => typeById.get(id))
          .filter((type): type is string => type !== undefined),
      )];
      list.push({
        turnId,
        worldTime: ts,
        text: sanitizePlayerFacingText(entry.text),
        importance: entry.importance,
        discoveryMark: entry.discoveryMark,
        sourceEventIds: entry.sourceEventIds,
        sourceEventTypes,
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

    // Existing command cycles commit cmd-N followed by tick-N in one atomic
    // sequence. Keep that documented legacy pair together, without merging
    // arbitrary equal-time commands or autonomous tick correlations.
    const currentCorrelation = currentTurnEvents[0]?.correlationId;
    const isCommandCycleTick = currentCorrelation === `cmd-${e.timestamp}`
      && e.correlationId === `tick-${e.timestamp}`;
    if (currentTurnEvents.length > 0 && (e.timestamp !== lastTimestamp
      || (e.correlationId !== currentCorrelation && !isCommandCycleTick))) {
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
