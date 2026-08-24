export type GuidanceMode = "onboarding" | "free_play";

export type GuidancePhase =
  | "first_action"
  | "explore_world"
  | "test_trace"
  | "strengthen_hypothesis"
  | "observe_consequence"
  | "review_discovery"
  | "free_play";

/** A natural-language example. It is never an executable command. */
export interface GuidanceIntentExample {
  readonly id: string;
  readonly text: string;
  readonly description?: string;
}

export interface GuidanceNavigation {
  readonly id: string;
  readonly label: string;
  readonly view: "journal" | "discoveries";
}

/** Internal registry kind; never serialized in PlayerGuidance v2. */
export type GuidanceSuggestionKind = "command" | "navigate";

/**
 * Legacy action identifiers remain available to simulation/evaluation code
 * through GUIDANCE_ACTIONS, but are intentionally absent from this DTO.
 */
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

export interface PlayerGuidanceV2 {
  readonly schemaVersion: 2;
  readonly mode: GuidanceMode;
  readonly phase: GuidancePhase;
  readonly title: string;
  readonly text: string;
  readonly intentExamples: readonly GuidanceIntentExample[];
  readonly navigation: readonly GuidanceNavigation[];
  readonly relatedDiscoveryId: string | null;
  readonly worldTime: number;
}

/** Current player-facing guidance contract. Kept as a short migration alias. */
export type PlayerGuidance = PlayerGuidanceV2;
