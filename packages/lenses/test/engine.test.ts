import { describe, expect, it } from "vitest";
import { createLensEngine } from "@skald/lenses";
import type { ObservationRecord } from "@skald/observation";

const record: ObservationRecord = {
  id: "observation:ridge:terrain", observerId: "player", targetId: "ridge", lens: "terrain",
  observedAt: 4, confidence: 0.8, freshness: 1, source: "direct", evidence: [], hypothesisIds: [],
  payload: { kind: "terrain", slope: 0.4 },
};

describe("Lens Engine", () => {
  it("projects a record without renderer or simulation access", () => {
    const view = createLensEngine().view(record);
    expect(view).toMatchObject({ lens: "terrain", targetId: "ridge", confidence: 0.8 });
    expect(view?.payload).toEqual({ kind: "terrain", slope: 0.4 });
  });

  it("does not reinterpret a record through another lens", () => {
    expect(createLensEngine().view(record, "ecology")).toBeNull();
  });
});
