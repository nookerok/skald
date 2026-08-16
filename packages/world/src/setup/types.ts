export interface CharacterPreset {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly wound: string;
  readonly promise: string;
  readonly principle: string;
  readonly profileVersion: number;
  readonly history: string;
  readonly startingKnowledge: string;
  readonly openingHook: string;
}

export interface WorldTemplate {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly startingQuestion: string;
  readonly templateVersion: number;
  readonly available: boolean;
  readonly regionId?: string;
}

export interface RegionEntrypoint {
  readonly id: string;
  readonly regionId: string;
  readonly locationId: string;
  readonly title: string;
  readonly teaser?: string;
  readonly description: string;
  readonly atmosphere: string;
  readonly openingSituation: string;
  /** Stable spatial evidence keys included in this start's bootstrap. */
  readonly initialObservationRefs: readonly string[];
  /** Author-approved knowledge references available before the first action. */
  readonly initialKnowledgeRefs: readonly string[];
  /** Evidence keys that may seed observer reveal geometry. */
  readonly initialRevealRefs: readonly string[];
  readonly availableBackgroundIds: readonly string[];
  readonly canonicalRefs: readonly string[];
}

export interface PrologueDTO {
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly backgroundReminder: string;
  readonly locationTitle: string;
  readonly openingHook: string;
}
