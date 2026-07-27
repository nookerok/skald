import type { TurnPresentation, PresentationImportance, DiscoveryMark } from "../presentation/types.js";

export interface JournalTurn {
  readonly turnId: string;
  readonly worldTime: number;
  readonly presentation: TurnPresentation;
  readonly sourceEventIds: readonly string[];
}

export interface PresentationThreadEntry {
  readonly turnId: string;
  readonly worldTime: number;
  readonly text: string;
  readonly importance: PresentationImportance;
  readonly discoveryMark: DiscoveryMark;
  readonly sourceEventIds: readonly string[];
}

export interface PresentationThread {
  readonly threadKey: string;
  readonly label: string;
  readonly firstWorldTime: number;
  readonly lastWorldTime: number;
  readonly entries: readonly PresentationThreadEntry[];
}

export interface TurnJournal {
  readonly turns: readonly JournalTurn[];
  readonly threads: readonly PresentationThread[];
  readonly worldTime: number;
}
