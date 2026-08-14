/** Event-derived action capability and epistemic read contracts. */

export type Affordance =
  | "anchor"
  | "secure"
  | "tie"
  | "descend"
  | "assist_climbing"
  | "strike"
  | "drive_nail"
  | "break"
  | "shape"
  | "repair"
  | "illuminate"
  | "ignite"
  | "signal"
  | "contain"
  | "experiment";

export type ItemPlacement =
  | { readonly kind: "location"; readonly locationId: string }
  | { readonly kind: "carried"; readonly holderId: string }
  | { readonly kind: "container"; readonly containerId: string };

export interface ItemDefinition {
  readonly itemId: string;
  readonly mass: number;
  readonly portable: boolean;
  readonly affordances: readonly Affordance[];
  readonly containerCapacityMass: number | null;
}

export interface SubjectCondition {
  readonly conditionId: string;
  readonly subjectId: string;
  readonly kind: string;
  readonly blockedAffordances: readonly Affordance[];
  readonly unavailableTechniques: readonly string[];
}

export interface ProficiencyEvidence {
  readonly evidenceId: string;
  readonly subjectId: string;
  readonly affordance: Affordance;
  readonly techniqueId: string | null;
  readonly contextTags: readonly string[];
  readonly outcome: "achieved" | "not_achieved";
  readonly sourceEventId?: string;
}

export interface EpistemicClaim {
  readonly claimId: string;
  readonly observerId: string;
  readonly sourceId: string | null;
  readonly sourceEventId?: string;
  readonly proposition: string;
  readonly status: "testimony_only" | "supported" | "contradicted";
  readonly evidenceIds: readonly string[];
  readonly receivedAt: number | null;
}

export interface ActionCapabilityReadView {
  readonly itemDefinitions: ReadonlyMap<string, ItemDefinition>;
  readonly placements: ReadonlyMap<string, ItemPlacement>;
  readonly owners: ReadonlyMap<string, string>;
  readonly conditions: ReadonlyMap<string, SubjectCondition>;
  readonly knowledge: ReadonlyMap<string, ReadonlySet<string>>;
  readonly proficiencyEvidence: readonly ProficiencyEvidence[];
  readonly claims: ReadonlyMap<string, EpistemicClaim>;
}

export interface CapabilityQuestion {
  readonly subjectId: string;
  readonly affordance: Affordance;
  readonly instrumentId: string;
  readonly techniqueId?: string;
  readonly requiredKnowledgeId?: string;
  readonly contextTags?: readonly string[];
}

/** Contextual answer, never stored as character progression. */
export interface CapabilityAssessment {
  readonly canAttempt: boolean;
  readonly canPerform: boolean;
  readonly canPerformReliably: boolean;
  readonly reasons: readonly string[];
}
