import type { GuidanceSuggestion } from "../guidance/types.js";

export interface CharacterView {
  displayName: string;
  wound: string;
  promise: string;
  principle: string;
  consequences: CharacterEffectView[];
  relations: RelationView[];
}

export interface CharacterEffectView {
  label: string;
}

export interface RelationView {
  targetLabel: string;
  relationLabel: string;
  value: number;
}

export interface WorldContextView {
  position: { x: number; y: number };
  heatLevel: number;
  heatDescription: string | null;
  locationId?: string | undefined;
  locationName?: string | undefined;
  locationDescription?: string | undefined;
  connectedLocations?: Array<{ id: string; label: string; detail?: string }> | undefined;
}

export type AttentionLevel = "calm" | "stirring" | "noticed" | "watched" | "pressured";

export interface AttentionView {
  level: AttentionLevel;
  marks: number;
  maxMarks: 5;
  explanation: string;
}

export interface SituationView {
  situationId: string;
  title: string;
  description: string;
  effects: { label: string; tone: "neutral" | "warning" | "danger" }[];
  startedAt: number;
  remainingTicks: number | null;
}

export interface CausalStep {
  kind: "intention" | "action" | "outcome" | "observation" | "consequence";
  text: string;
  critical?: {
    success: string;
    failure: string;
    difficulty?: number;
    modifiers: readonly { label: string; delta: number }[];
  };
}

export interface DiscoverySignalView {
  stage: "trace" | "hypothesis" | "discovered";
  title: string;
  text: string;
}

export interface PlayerFacingEntry {
  kind: string;
  importance: "primary" | "notable" | "background";
  discoveryMark: "trace" | "omen" | "echo" | null;
  text: string;
  timestamp: number;
}

export interface PlayerTurnView {
  turnId: string;
  worldTime: number;
  primary: PlayerFacingEntry | null;
  notable: readonly PlayerFacingEntry[];
  background: readonly PlayerFacingEntry[];
  causalChain: readonly CausalStep[];
  discoverySignals: readonly DiscoverySignalView[];
}

export type PlayerFacingScope = "visible" | "known" | "global";
export type ActivityOrigin = "player" | "world_tick" | "consequence";

export interface WorldActivityItem {
  kind: string;
  text: string;
  timestamp: number;
  scope: PlayerFacingScope;
  origin: ActivityOrigin;
}

export interface KnowledgeSummary {
  facts: { title: string; text: string }[];
  hypotheses: { title: string; text: string }[];
  traces: { title: string; text: string }[];
  recentEvidence: { text: string; worldTime: number; kind: string }[];
}

export interface GameShellSnapshot {
  schemaVersion: 1;
  worldId: string;
  revision: { worldTime: number; eventNumber: number };
  character: CharacterView;
  world: WorldContextView;
  currentSituation: SituationView | null;
  attention: AttentionView;
  lastTurn: PlayerTurnView | null;
  recentActivity: readonly WorldActivityItem[];
  knowledge: KnowledgeSummary;
  beliefModel: import("../observation/types.js").BeliefModelDTO;
  suggestions: readonly GuidanceSuggestion[];
}

export interface ShellDelta {
  revision: { worldTime: number; eventNumber: number };
  turn: PlayerTurnView | null;
  currentSituation: SituationView | null;
  attention: AttentionView;
  activity: readonly WorldActivityItem[];
  knowledge: KnowledgeSummary;
  beliefModel: import("../observation/types.js").BeliefModelDTO;
  suggestions: readonly GuidanceSuggestion[];
}
