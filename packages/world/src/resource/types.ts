/** Canonical resource definitions and runtime state. */

export type ResourceQualityBand = "poor" | "common" | "rich";

export interface ResourceExtractionMethod {
  readonly id: string;
  readonly maximumPerAction: number;
  readonly difficulty: number;
}

export interface ResourceRegenerationDefinition {
  readonly intervalWorldTime: number;
  readonly amountUnits: number;
  readonly maximumUnits: number;
  readonly blockedBy: readonly string[];
}

export interface ResourceNodeDefinition {
  readonly id: string;
  readonly resourceKind: string;
  readonly locationId: string;
  readonly capacityUnits: number;
  readonly initialStockUnits: number;
  readonly quality: ResourceQualityBand;
  readonly extractionMethods: readonly ResourceExtractionMethod[];
  readonly regeneration: ResourceRegenerationDefinition | null;
  readonly canonicalRefs: readonly string[];
}

export interface ResourceNodeState {
  readonly nodeId: string;
  readonly stockUnits: number;
  readonly depleted: boolean;
  readonly lastChangedWorldTime: number;
}

export interface ResourceReadView {
  readonly definitions: ReadonlyMap<string, ResourceNodeDefinition>;
  readonly states: ReadonlyMap<string, ResourceNodeState>;
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

export interface ResourceRegeneratedPayload {
  readonly nodeId: string;
  readonly amountUnits: number;
}
