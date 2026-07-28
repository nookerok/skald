export type DiscoveryStage = "trace" | "hypothesis" | "discovered";
export type DiscoverySignalKind = "trace" | "omen" | "echo";

export interface DiscoveryEvidence {
  readonly evidenceId: string;
  readonly kind: DiscoverySignalKind;
  readonly worldTime: number;
  readonly text: string;
  readonly sourceEventIds: readonly string[];
  readonly journalTurnId: string;
}

export interface DiscoveryCard {
  readonly discoveryId: string;
  readonly definitionVersion: number;
  readonly title: string;
  readonly question: string;
  readonly stage: DiscoveryStage;
  readonly summary: string;
  readonly firstSeenAt: number;
  readonly lastSeenAt: number;
  readonly evidenceCount: number;
  readonly evidence: readonly DiscoveryEvidence[];
}

export interface DiscoveryJournal {
  readonly cards: readonly DiscoveryCard[];
  readonly recentEvidence: readonly DiscoveryEvidence[];
  readonly worldTime: number;
}
