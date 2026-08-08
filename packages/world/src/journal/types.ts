import type { TurnPresentation, PresentationImportance, DiscoveryMark } from "../presentation/types.js";
import type { TurnNarration } from "../narrative-llm.js";

export interface JournalTurn {
  readonly turnId: string;
  readonly worldTime: number;
  readonly presentation: TurnPresentation;
  readonly sourceEventIds: readonly string[];
  /**
   * Optional non-authoritative literary narration for this turn (ADR-0024
   * "МИР" voice). Persisted as a read-side journal decoration; absent when the
   * LLM was unavailable or fell back to the deterministic template.
   */
  readonly narrativeLLM?: TurnNarration | undefined;
}

export interface PresentationThreadEntry {
  readonly turnId: string;
  readonly worldTime: number;
  readonly text: string;
  readonly importance: PresentationImportance;
  readonly discoveryMark: DiscoveryMark;
  readonly sourceEventIds: readonly string[];
  /**
   * Canonical Domain Event types behind the entry's sourceEventIds, in
   * deterministic order. Observer-scoped read models (e.g. the Observer
   * Thread Journal) classify lifecycle signals from these types; the types
   * are never exposed to the player.
   */
  readonly sourceEventTypes: readonly string[];
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
