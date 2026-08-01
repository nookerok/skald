import type { LensId, ObservationRecord } from "@skald/observation";
import type { LensEngine, LensFunction, LensViewModel } from "./types.js";

function createLens(lens: LensId): LensFunction {
  return Object.freeze({
    lens,
    transform(record: ObservationRecord): LensViewModel | null {
      if (record.lens !== lens || record.payload.kind !== lens) return null;
      return Object.freeze({
        lens,
        targetId: record.targetId,
        observedAt: record.observedAt,
        confidence: record.confidence,
        freshness: record.freshness,
        payload: record.payload,
      });
    },
  });
}

/** Terrain lens: exposes only the terrain payload already present in a record. */
export const terrainLens = createLens("terrain");
/** Ecology lens: exposes only the ecology payload already present in a record. */
export const ecologyLens = createLens("ecology");
/** Relations lens: exposes only the relations payload already present in a record. */
export const relationsLens = createLens("relations");
/** Emergence lens: exposes only the emergence payload already present in a record. */
export const emergenceLens = createLens("emergence");
/** History lens: exposes only the history payload already present in a record. */
export const historyLens = createLens("history");
/** Prediction lens: exposes only the prediction payload already present in a record. */
export const predictionLens = createLens("prediction");

/** Creates a configurable pure lens engine. */
export function createLensEngine(lenses: readonly LensFunction[] = [terrainLens, ecologyLens, relationsLens, emergenceLens, historyLens, predictionLens]): LensEngine {
  const registry = new Map(lenses.map((lens) => [lens.lens, lens] as const));
  const frozenRegistry = new Proxy(registry, { get(target, property: string | symbol) {
    if (property === "set" || property === "delete" || property === "clear") return () => { throw new TypeError("immutable"); };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as ReadonlyMap<LensId, LensFunction>;
  return Object.freeze({
    lenses: frozenRegistry,
    view(record: ObservationRecord, lens: LensId = record.lens): LensViewModel | null {
      return registry.get(lens)?.transform(record) ?? null;
    },
  });
}
