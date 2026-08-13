export type AdventureInspection = "shell" | "map" | "journal" | "discoveries" | "presence";

export type AdventureStep =
  | { readonly say: string }
  | { readonly choose: string }
  | { readonly answerClarification: string }
  | { readonly inspect: AdventureInspection }
  | { readonly offlineTicks: number }
  | { readonly acknowledge: true }
  | { readonly restartServer: true }
  | { readonly reconnect: true }
  | { readonly continueWorld: true }
  | { readonly enterPresence: true }
  | { readonly disconnect: true }
  | { readonly assert: readonly AdventureCheck[] };

export type AdventureCheck =
  | "world_is_living_region"
  | "map_has_current_position"
  | "conversation_has_master_reply"
  | "rumour_does_not_reveal_coordinates"
  | "route_alternative_available"
  | "rumour_was_received"
  | "rumour_is_player_visible"
  | "clarification_was_requested"
  | "journey_is_multitick"
  | "journey_reached_ruins"
  | "world_changed_during_journey"
  | "conditioned_route_choice"
  | "meaningful_player_choices"
  | "discovery_reached_hypothesis"
  | "discovery_evidence_loop"
  | "discovery_is_not_canon_truth"
  | "returned_to_waystation"
  | "map_knowledge_grew"
  | "chronicle_has_adventure_arc"
  | "offline_world_progressed"
  | "offline_did_not_move_player"
  | "offline_has_no_personal_observation_leak"
  | "presence_has_at_most_three_highlights"
  | "restart_preserved_journal"
  | "restart_preserved_map"
  | "chat_has_no_raw_internal_keys"
  | "chronicle_is_ordered";

export interface AdventureScenario {
  readonly name: string;
  readonly worldId: string;
  readonly worldTemplateId: string;
  readonly saveLabel: string;
  readonly characterName: string;
  readonly characterPresetId: string;
  readonly description?: string;
  readonly turns: readonly AdventureStep[];
}

export interface AdventureSnapshot {
  readonly state?: Record<string, unknown>;
  readonly shell?: Record<string, unknown>;
  readonly map?: Record<string, unknown>;
  readonly journal?: Record<string, unknown>;
  readonly discoveries?: Record<string, unknown>;
  readonly presence?: Record<string, unknown>;
  readonly observerThreads?: Record<string, unknown>;
  readonly events?: readonly Record<string, unknown>[];
}

export interface AdventureStepResult {
  readonly index: number;
  readonly step: AdventureStep;
  readonly statusCode: number;
  readonly body: Record<string, unknown>;
  readonly snapshot: AdventureSnapshot;
  readonly failures: readonly string[];
}

export interface AdventureRunResult {
  readonly scenario: AdventureScenario;
  readonly steps: readonly AdventureStepResult[];
  readonly report: AdventureReport;
}

export interface AdventureReport {
  readonly requiredBeatsCovered: number;
  readonly meaningfulPlayerChoices: number;
  readonly journeyLegsCompleted: number;
  readonly worldChangesEncountered: number;
  readonly discoveriesAdvanced: number;
  readonly mapKnowledgeGrowth: number;
  readonly offlineMeaningfulEvents: number;
  readonly chatAlternationIntegrity: boolean;
  readonly chronicleCoverage: number;
  readonly narrationDuplicateRate: number;
  readonly truthLeakCount: number;
  readonly orphanResponseCount: number;
  readonly replayPurity: boolean;
  readonly idempotency: boolean;
  readonly persistenceRestart: boolean;
  readonly offlineObservationLeak: number;
  readonly missingRequiredBeats: readonly string[];
  readonly pass: boolean;
}

export interface AdventureContext {
  readonly scenario: AdventureScenario;
  readonly steps: readonly AdventureStepResult[];
  readonly current: AdventureSnapshot;
  readonly initial: AdventureSnapshot;
  readonly restartBefore?: AdventureSnapshot;
  readonly events: readonly Record<string, unknown>[];
  readonly previousClarification: boolean;
  readonly previousResponse?: Record<string, unknown>;
  readonly offlineStart?: AdventureSnapshot;
}
