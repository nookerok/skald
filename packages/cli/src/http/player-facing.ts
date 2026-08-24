import type { JournalTurn, NarrativeEntry, PresentationThread, TurnPresentation } from "@skald/world";

/**
 * Remove event/provenance identifiers from normal player-facing HTTP DTOs.
 * Trusted diagnostics use the dedicated events endpoint instead.
 */
export function toPlayerFacingPresentation(presentation: TurnPresentation): TurnPresentation {
  const stripEntry = <T extends { readonly sourceEventIds: readonly string[] }>(entry: T): T => ({
    ...entry,
    sourceEventIds: [],
  });
  return {
    response: presentation.response ? { ...presentation.response, sourceEventIds: [] } : null,
    primary: presentation.primary ? stripEntry(presentation.primary) : null,
    notable: presentation.notable.map(stripEntry),
    background: presentation.background.map(stripEntry),
    suppressedEventCount: presentation.suppressedEventCount,
    worldTime: presentation.worldTime,
    playerPosition: presentation.playerPosition,
  };
}

export function toPlayerFacingNarrativeEntries(entries: readonly NarrativeEntry[]): NarrativeEntry[] {
  return entries.map((entry) => ({ ...entry, sourceEventIds: [] }));
}

export function toPlayerFacingJournalTurns(turns: readonly JournalTurn[]): JournalTurn[] {
  return turns.map((turn) => ({
    ...turn,
    presentation: toPlayerFacingPresentation(turn.presentation),
    sourceEventIds: [],
  }));
}

export function toPlayerFacingThreads(threads: readonly PresentationThread[]): PresentationThread[] {
  return threads.map((thread) => ({
    ...thread,
    entries: thread.entries.map((entry) => ({ ...entry, sourceEventIds: [], sourceEventTypes: [] })),
  }));
}
