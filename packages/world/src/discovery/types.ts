export type DiscoveryStage = "trace" | "hypothesis" | "discovered";

export type DiscoveryResolution = "unresolved" | "supported" | "contradicted" | "inconclusive";

export type DiscoverySignalKind =
  | "trace"
  | "omen"
  | "echo"
  | "physical_trace"
  | "water_trace"
  | "movement_trace"
  | "landmark_trace"
  | "structural_trace"
  | "sound_trace"
  | "reobservation";

export type EvidenceSource =
  | "direct_observation"
  | "sound"
  | "social"
  | "environment"
  | "reconstruction";

export interface DiscoveryEvidence {
  readonly evidenceId: string;
  readonly kind: DiscoverySignalKind;
  readonly subjectRef: string;
  readonly worldTime: number;
  readonly text: string;
  readonly sourceEventIds: readonly string[];
  readonly journalTurnId: string;
  readonly confidence: number;
  readonly freshness: number;
  readonly source: EvidenceSource;
  readonly locationRef: string | null;
  readonly bearing: string | null;
  readonly contradictionGroup: string | null;
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
  readonly resolution?: DiscoveryResolution;
  readonly contradictionCount?: number;
}

export interface DiscoveryJournal {
  readonly cards: readonly DiscoveryCard[];
  readonly recentEvidence: readonly DiscoveryEvidence[];
  readonly rumors: readonly RumorRecord[];
  readonly biographyChains: readonly BiographyDiscoveryChain[];
  readonly worldTime: number;
}

export type RumorStatus = "unverified" | "supported" | "contradicted" | "faded";

export interface RumorRecord {
  readonly ref: string;
  readonly subjectRef: string;
  readonly text: string;
  readonly sourceLabel: string;
  readonly confidence: number;
  readonly status: RumorStatus;
  readonly evidenceRefs: readonly string[];
  readonly observedAt: number;
}

export type BiographyStepKind = "action" | "observation" | "trace" | "hypothesis" | "confirmation";

export interface BiographyDiscoveryStep {
  readonly ref: string;
  readonly kind: BiographyStepKind;
  readonly text: string;
  readonly worldTime: number;
  readonly locationLabel: string | null;
  readonly evidenceRef: string | null;
}

export type BiographyChainStatus = "forming" | "understood" | "contradicted";

export interface BiographyDiscoveryChain {
  readonly ref: string;
  readonly title: string;
  readonly status: BiographyChainStatus;
  readonly steps: readonly BiographyDiscoveryStep[];
}
