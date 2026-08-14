export type EpistemicClass = "established_fact" | "observed_fact" | "testimony" | "inference" | "interpretation";

export interface EpistemicNarrativeFact {
  readonly text: string;
  readonly epistemicClass: EpistemicClass;
  readonly sourceEventIds: readonly string[];
}

import type { DomainEvent } from "@skald/event-bus";

export type PresentationImportance = "primary" | "notable" | "background";
export type DiscoveryMark = "trace" | "echo" | "omen" | null;

export interface PresentationTemplate {
  readonly id: string;
  readonly listens: readonly string[];
  present(event: DomainEvent, world: import("../projection.js").ReadonlyWorld): PresentationCandidate | null;
}

export interface PresentationCandidate {
  readonly templateId: string;
  readonly kind: "action" | "observation" | "consequence" | "situation" | "relation" | "world" | "time";
  readonly defaultImportance: PresentationImportance;
  readonly rank: number;
  readonly discoveryMark: DiscoveryMark;
  readonly epistemicClass: EpistemicClass;
  readonly text: string;
  readonly timestamp: number;
  readonly sourceEventIds: readonly string[];
  readonly groupKey: string | null;
  readonly threadKey: string | null;
  readonly threadLabel: string | null;
}

export interface PresentationEntry {
  readonly kind: PresentationCandidate["kind"];
  readonly importance: PresentationImportance;
  readonly discoveryMark: DiscoveryMark;
  readonly epistemicClass: EpistemicClass;
  readonly text: string;
  readonly timestamp: number;
  readonly sourceEventIds: readonly string[];
  readonly threadKey: string | null;
  readonly threadLabel: string | null;
}

export interface TurnPresentation {
  readonly primary: PresentationEntry | null;
  readonly notable: readonly PresentationEntry[];
  readonly background: readonly PresentationEntry[];
  readonly suppressedEventCount: number;
  readonly worldTime: number;
  readonly playerPosition: { readonly x: number; readonly y: number };
}
