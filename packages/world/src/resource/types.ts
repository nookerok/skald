/** Canonical resource definitions and runtime state. */

export type ResourceQualityBand = "poor" | "common" | "rich";
export type ResourceSourceModel = "stock" | "renewable" | "produced";
export type ResourceBlockScope = "same_location" | "region";

export interface ResourceSituationBlocker {
  readonly situationType: string;
  readonly scope: ResourceBlockScope;
}

export interface ResourceExtractionMethod {
  readonly id: string;
  readonly maximumPerAction: number;
  readonly difficulty: number;
  readonly actionCostWorldTime?: number;
  readonly requiredInstruments?: readonly string[];
}

export interface ResourceRegenerationDefinition {
  readonly model?: "interval";
  readonly intervalWorldTime: number;
  readonly amountUnits: number;
  readonly maximumUnits: number;
  readonly blockedBy: readonly (string | ResourceSituationBlocker)[];
  /** When true, blocked intervals are discarded instead of accumulated. */
  readonly pauseWhileBlocked?: boolean;
}

export interface ResourceNodeDefinition {
  readonly id: string;
  readonly resourceKind: string;
  readonly sourceModel?: ResourceSourceModel;
  readonly locationId: string;
  readonly capacityUnits: number;
  readonly initialStockUnits: number;
  readonly quality: ResourceQualityBand;
  readonly extractionMethods: readonly ResourceExtractionMethod[];
  readonly regeneration: ResourceRegenerationDefinition | null;
  readonly canonicalRefs: readonly string[];
  /** Nodes marked true require an observed location before extraction. */
  readonly requiresObservation?: boolean;
}

export interface ResourceNodeState {
  readonly nodeId: string;
  readonly stockUnits: number;
  readonly depleted: boolean;
  readonly lastChangedWorldTime: number;
}

export interface ResourceHoldingState {
  readonly ownerId: string;
  readonly resourceKind: string;
  readonly quality: ResourceQualityBand;
  readonly amountUnits: number;
  readonly lastChangedWorldTime: number;
}

export interface ResourceAmount {
  readonly resourceKind: string;
  readonly quality: ResourceQualityBand;
  readonly amountUnits: number;
}

export interface ResourceReadView {
  readonly definitions: ReadonlyMap<string, ResourceNodeDefinition>;
  readonly states: ReadonlyMap<string, ResourceNodeState>;
  readonly holdings: ReadonlyMap<string, ResourceHoldingState>;
  readonly processDefinitions: ReadonlyMap<string, ResourceProcessDefinition>;
  readonly processes: ReadonlyMap<string, ResourceProcessState>;
  readonly demandDefinitions: ReadonlyMap<string, ResourceDemandDefinition>;
  readonly demandStates: ReadonlyMap<string, ResourceDemandState>;
}

export interface ResourceExtractionRequestPayload {
  readonly nodeId: string;
  readonly methodId: string;
  readonly requestedUnits: number;
}

export interface ResourceExtractedPayload extends ResourceExtractionRequestPayload {
  readonly amountUnits: number;
  readonly actorId: string;
}

export interface ResourceTransferRequestPayload {
  readonly fromOwnerId: string;
  readonly toOwnerId: string;
  readonly resourceKind: string;
  readonly quality: ResourceQualityBand;
  readonly amountUnits: number;
}

export interface ResourceTransferredPayload extends ResourceTransferRequestPayload {}

export interface ResourceConsumeRequestPayload {
  readonly ownerId: string;
  readonly resourceKind: string;
  readonly quality: ResourceQualityBand;
  readonly amountUnits: number;
  readonly reason: string;
}

export interface ResourceConsumedPayload extends ResourceConsumeRequestPayload {}

export interface ResourceRegeneratedPayload {
  readonly nodeId: string;
  readonly amountUnits: number;
}

export interface ResourceProcessDefinition {
  readonly id: string;
  readonly locationId: string;
  readonly durationWorldTime: number;
  readonly inputs: readonly ResourceAmount[];
  readonly outputs: readonly ResourceAmount[];
  readonly blockedBy?: readonly (string | ResourceSituationBlocker)[];
  readonly canonicalRefs: readonly string[];
}

export interface ResourceProcessState {
  readonly processId: string;
  readonly ownerId: string;
  readonly startedAt: number;
  readonly completesAt: number;
  readonly inputs: readonly ResourceAmount[];
  readonly status: "active" | "completed";
}

export interface ResourceProcessStartRequestPayload {
  readonly processId: string;
  readonly ownerId: string;
}

export interface ResourceProcessStartedPayload extends ResourceProcessStartRequestPayload {
  readonly completesAt: number;
}

export interface ResourceProcessCompletedPayload {
  readonly processId: string;
  readonly ownerId: string;
}



export interface ResourceDemandDefinition {
  readonly id: string;
  readonly ownerId: string;
  readonly resourceKind: string;
  readonly quality: ResourceQualityBand;
  readonly amountPerInterval: number;
  readonly intervalWorldTime: number;
  readonly canonicalRefs: readonly string[];
}

export interface ResourceDemandState {
  readonly demandId: string;
  readonly lastEvaluatedWorldTime: number;
  readonly shortageActive: boolean;
}
