export type GuidanceMode = "onboarding" | "free_play";

export type GuidancePhase =
  | "first_action"
  | "explore_world"
  | "test_trace"
  | "strengthen_hypothesis"
  | "observe_consequence"
  | "review_discovery"
  | "free_play";

export type GuidanceSuggestionKind = "command" | "navigate";

export type GuidanceActionId =
  | "move_north"
  | "move_south"
  | "move_east"
  | "move_west"
  | "wait"
  | "give_help"
  | "give_respect"
  | "give_fear"
  | "open_journal"
  | "open_discoveries";

export interface GuidanceSuggestion {
  readonly id: string;
  readonly kind: GuidanceSuggestionKind;
  readonly actionId: GuidanceActionId;
  readonly label: string;
  readonly description: string;
  readonly input: string | null;
  readonly view: "journal" | "discoveries" | null;
}

export interface PlayerGuidance {
  readonly schemaVersion: 1;
  readonly mode: GuidanceMode;
  readonly phase: GuidancePhase;
  readonly title: string;
  readonly text: string;
  readonly suggestions: readonly GuidanceSuggestion[];
  readonly relatedDiscoveryId: string | null;
  readonly worldTime: number;
}
