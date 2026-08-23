import type { TurnPresentation, PresentationImportance, DiscoveryMark } from "../presentation/types.js";

/**
 * Player-facing literary narration attached to a journal turn.
 *
 * This is deliberately narrower than the persistence/internal TurnNarration
 * type: fallback reasons are operational metadata and must not cross the
 * journal HTTP boundary.
 */
export interface JournalNarration {
  readonly text: string;
  readonly model: string;
  readonly usedFallback: false;
  readonly latencyMs: number;
}

export interface JournalTurn {
  readonly turnId: string;
  readonly worldTime: number;
  /**
   * Correlation of the player command that produced this turn's selected
   * deterministic response. It is absent for autonomous turns and for a
   * timestamp batch whose response spans multiple correlations.
   */
  readonly correlationId?: string | undefined;
  readonly presentation: TurnPresentation;
  readonly sourceEventIds: readonly string[];
  /**
   * Optional non-authoritative literary narration for this turn (ADR-0024
   * "МАСТЕР" voice). Persisted as a read-side journal decoration; absent when the
   * LLM was unavailable or fell back to the deterministic template.
   */
  readonly narrativeLLM?: JournalNarration | undefined;
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
