import type {
  GameShellSnapshot,
  ShellDelta,
  JournalNarration,
  JournalTurn,
  NarrativeEntry,
  PresentationEntry,
  PresentationThread,
  PresentationThreadEntry,
  TurnPresentation,
  TurnResponse,
} from "@skald/world";
import { localizedPlayerText } from "@skald/world";
import { narrationHandle, readSideHandle } from "../conversation/identity.js";

/** Normal player DTO for a turn; internal map coordinates stay server-side. */
export type PlayerFacingPresentationEntry = Pick<PresentationEntry, "kind" | "importance" | "discoveryMark" | "text" | "timestamp">;
export type PlayerFacingResponse = Omit<TurnResponse, "sourceEventIds">;
export type PlayerFacingPresentation = {
  readonly response: PlayerFacingResponse | null;
  readonly primary: PlayerFacingPresentationEntry | null;
  readonly notable: readonly PlayerFacingPresentationEntry[];
  readonly background: readonly PlayerFacingPresentationEntry[];
  readonly suppressedEventCount: number;
  readonly worldTime: number;
};

/** Minimal state revision exposed to the normal player shell. */
export type PlayerFacingState = {
  readonly worldTime: number;
  readonly eventNumber: number;
  readonly lastActionTick: number;
  readonly routerAvailable: boolean;
};

/** Journal narration without provider/model internals. */
export type PlayerFacingJournalNarration = Pick<JournalNarration, "text" | "usedFallback">;

/** Journal turn without persistence, correlation or provenance identifiers. */
export type PlayerFacingJournalTurn = Omit<JournalTurn, "turnId" | "correlationId" | "presentation" | "sourceEventIds" | "narrativeLLM"> & {
  readonly turnHandle: string;
  readonly narrationHandle: string;
  readonly narrationState?: "pending" | "ready" | "unavailable" | "not_requested";
  readonly presentation: PlayerFacingPresentation;
  readonly narrativeLLM?: PlayerFacingJournalNarration | undefined;
};

/** Thread entry with only prose and player-safe lifecycle fields. */
export type PlayerFacingThreadEntry = Omit<PresentationThreadEntry, "turnId" | "sourceEventIds" | "sourceEventTypes"> & { readonly turnHandle: string };

/** Thread grouping with no internal key. The UI can use its local array index. */
export type PlayerFacingThread = Omit<PresentationThread, "threadKey" | "entries"> & {
  readonly threadHandle: string;
  readonly entries: readonly PlayerFacingThreadEntry[];
};

/** Narrative entry without event provenance or projection-owned world state. */
export type PlayerFacingNarrativeEntry = Omit<NarrativeEntry, "sourceEventIds">;

/**
 * Public Game Shell snapshot. The internal builder is also used by inquiry
 * resolution, so it deliberately retains ids and coordinates. The HTTP
 * boundary must project that object before returning it to the browser.
 */
export type PlayerFacingGameShellSnapshot = Omit<GameShellSnapshot, "worldId" | "world" | "currentSituation" | "lastTurn"> & {
  readonly world: Omit<GameShellSnapshot["world"], "position" | "locationId" | "connectedLocations"> & {
    readonly connectedLocations?: readonly { label: string; detail?: string }[];
  };
  readonly currentSituation: Omit<NonNullable<GameShellSnapshot["currentSituation"]>, "situationId"> | null;
  readonly lastTurn: Omit<NonNullable<GameShellSnapshot["lastTurn"]>, "turnId"> | null;
};

/** Remove internal world, event and persistence references from Game Shell. */
export function toPlayerFacingGameShellSnapshot(snapshot: GameShellSnapshot): PlayerFacingGameShellSnapshot {
  const { worldId: _worldId, world, currentSituation, lastTurn, ...rest } = snapshot;
  const { position: _position, locationId: _locationId, connectedLocations, ...safeWorld } = world;
  const safeTurn = lastTurn
    ? (({ turnId: _turnId, ...turn }) => turn)(lastTurn)
    : null;
  const safeSituation = currentSituation
    ? (({ situationId: _situationId, ...situation }) => situation)(currentSituation)
    : null;
  return {
    ...rest,
    world: {
      ...safeWorld,
      ...(connectedLocations ? { connectedLocations: connectedLocations.map(({ id: _id, ...location }) => location) } : {}),
    },
    currentSituation: safeSituation,
    lastTurn: safeTurn,
  };
}

/** Apply the same identifier boundary to command/wait shell deltas. */
export function toPlayerFacingShellDelta(delta: ShellDelta) {
  const safeTurn = delta.turn
    ? (({ turnId: _turnId, ...turn }) => turn)(delta.turn)
    : null;
  const safeSituation = delta.currentSituation
    ? (({ situationId: _situationId, ...situation }) => situation)(delta.currentSituation)
    : null;
  return { ...delta, turn: safeTurn, currentSituation: safeSituation };
}

function playerText(text: string): string {
  return localizedPlayerText(text, "Подробности пока неясны.");
}

export function toPlayerFacingState(state: Pick<PlayerFacingState, "worldTime" | "eventNumber" | "lastActionTick" | "routerAvailable">): PlayerFacingState {
  return {
    worldTime: state.worldTime,
    eventNumber: state.eventNumber,
    lastActionTick: state.lastActionTick,
    routerAvailable: state.routerAvailable,
  };
}

/**
 * Remove event/provenance identifiers from normal player-facing HTTP DTOs.
 * Trusted diagnostics use the dedicated events endpoint instead.
 */
export function toPlayerFacingPresentation(presentation: TurnPresentation): PlayerFacingPresentation {
  const stripEntry = (entry: PresentationEntry): PlayerFacingPresentationEntry => {
    return { kind: entry.kind, importance: entry.importance, discoveryMark: entry.discoveryMark, text: playerText(entry.text), timestamp: entry.timestamp };
  };
  const response = presentation.response
    ? { kind: presentation.response.kind, text: localizedPlayerText(presentation.response.text, presentation.response.kind === "action_rejection" ? "Так действовать сейчас не получится." : "Подробности результата пока неясны.") }
    : null;
  return {
    response,
    primary: presentation.primary ? stripEntry(presentation.primary) : null,
    notable: presentation.notable.map(stripEntry),
    background: presentation.background.map(stripEntry),
    suppressedEventCount: presentation.suppressedEventCount,
    worldTime: presentation.worldTime,
  };
}

export function toPlayerFacingNarrativeEntries(entries: readonly NarrativeEntry[]): PlayerFacingNarrativeEntry[] {
  return entries
    // `world` entries are a compatibility projection dump (position, heat,
    // active consequence values, relations). The normal UI receives those
    // facts through the dedicated Knowledge and Map DTOs instead.
    .filter((entry) => entry.kind !== "world")
    .map((entry) => {
      return {
        kind: entry.kind,
        timestamp: entry.timestamp,
        importance: entry.importance,
        discoveryMark: entry.discoveryMark,
        // Keep the compatibility route safe even for action prose that still
        // mentions a grid coordinate.
        text: playerText(entry.text),
      };
    });
}

export function toPlayerFacingJournalTurns(turns: readonly JournalTurn[]): PlayerFacingJournalTurn[] {
  return turns.map((turn) => ({
    worldTime: turn.worldTime,
    turnHandle: readSideHandle("turn", turn.turnId),
    narrationHandle: narrationHandle(turn.worldTime, turn.correlationId),
    ...( "narrationState" in turn && ["pending", "ready", "unavailable", "not_requested"].includes(String(turn.narrationState))
      ? { narrationState: turn.narrationState as "pending" | "ready" | "unavailable" | "not_requested" } : {}),
    presentation: toPlayerFacingPresentation(turn.presentation),
    ...(turn.narrativeLLM
      ? { narrativeLLM: { text: playerText(turn.narrativeLLM.text), usedFallback: turn.narrativeLLM.usedFallback } }
      : {}),
  }));
}

export function toPlayerFacingThreads(threads: readonly PresentationThread[]): PlayerFacingThread[] {
  return threads.map((thread) => ({
    threadHandle: readSideHandle("thread", thread.threadKey),
    label: playerText(thread.label),
    firstWorldTime: thread.firstWorldTime,
    lastWorldTime: thread.lastWorldTime,
    entries: thread.entries.map((entry) => ({ turnHandle: readSideHandle("turn", entry.turnId), worldTime: entry.worldTime, text: playerText(entry.text), importance: entry.importance, discoveryMark: entry.discoveryMark })),
  }));
}
