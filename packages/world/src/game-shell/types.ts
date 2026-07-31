import type { PresentationEntry } from "../presentation/types.js";
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
  source: string;
}

export interface RelationView {
  target: string;
  kind: string;
  value: number;
}

export interface WorldContextView {
  position: { x: number; y: number };
  heatLevel: number;
  heatDescription: string | null;
  locationId?: string | undefined;
  locationName?: string | undefined;
  locationDescription?: string | undefined;
  connectedLocations?: Array<{ id: string; name: string; description?: string }> | undefined;
}

export type AttentionLevel = "calm" | "stirring" | "noticed" | "watched" | "pressured";

export interface AttentionView {
  level: AttentionLevel;
  marks: number;
  maxMarks: 5;
  explanation: string;
  sourceEventIds: readonly string[];
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
  sourceEventIds: readonly string[];
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
  discoveryId: string;
}

export interface PlayerTurnView {
  turnId: string;
  worldTime: number;
  primary: PresentationEntry | null;
  notable: readonly PresentationEntry[];
  background: readonly PresentationEntry[];
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
  sourceEventIds: readonly string[];
}

export interface KnowledgeSummary {
  facts: { title: string; text: string; discoveryId: string; journalTurnId: string }[];
  hypotheses: { title: string; text: string; discoveryId: string; journalTurnId: string }[];
  traces: { title: string; text: string; discoveryId: string; journalTurnId: string }[];
  recentEvidence: { text: string; worldTime: number; kind: string; journalTurnId: string }[];
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
