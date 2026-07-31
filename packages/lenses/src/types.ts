import type { LensId, LensPayload, ObservationRecord } from "@skald/observation";

/** Lens-specific, renderer-neutral view model. */
export interface LensViewModel {
  readonly lens: LensId;
  readonly targetId: string;
  readonly observedAt: number;
  readonly confidence: number;
  readonly freshness: number;
  readonly payload: LensPayload;
}

/** Pure transformation from one observation record to a lens view model. */
export interface LensFunction {
  readonly lens: LensId;
  transform(record: ObservationRecord): LensViewModel | null;
}

/** Pure registry for all supported lenses. */
export interface LensEngine {
  readonly lenses: ReadonlyMap<LensId, LensFunction>;
  view(record: ObservationRecord, lens?: LensId): LensViewModel | null;
}
