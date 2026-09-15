import { describe, it, expect } from "vitest";
import { closedCrossingText, highWaterAhead } from "../../src/journey/crossing-cause.js";
import type { SpatialReadView } from "../../src/region/types.js";

function spatial(band: "low" | "normal" | "high" | "flood" | null, kind: "crossing" | "road" = "crossing"): SpatialReadView {
  return {
    travelRelations: new Map([
      ["rel-1", { id: "rel-1", kind, fromId: "a", toId: "b", distanceMetres: 1000, baseTravelTicks: 2, terrainCost: 1, passability: "open" }],
    ]),
    crossingDefinitions: new Map([
      ["x-1", { crossingId: "rel-1", watercourseId: "river", openAtOrBelow: 1, difficultAtOrBelow: 2, closedAbove: 3, baseTravelCostTicks: 2 }],
    ]),
    riverStates: new Map(band === null ? [] : [["river", { watercourseId: "river", level: 50, band, updatedAt: 1 }]]),
  } as unknown as SpatialReadView;
}

describe("highWaterAhead", () => {
  it("is true only for high or flood bands on the crossing watercourse", () => {
    expect(highWaterAhead(spatial("high"), "rel-1")).toBe(true);
    expect(highWaterAhead(spatial("flood"), "rel-1")).toBe(true);
    expect(highWaterAhead(spatial("normal"), "rel-1")).toBe(false);
    expect(highWaterAhead(spatial("low"), "rel-1")).toBe(false);
  });
  it("never claims water without river evidence", () => {
    expect(highWaterAhead(spatial(null), "rel-1")).toBe(false);
    expect(highWaterAhead(null, "rel-1")).toBe(false);
    expect(highWaterAhead(spatial("high", "road"), "rel-1")).toBe(false);
    expect(highWaterAhead(spatial("high"), "unknown-rel")).toBe(false);
  });
});

describe("closedCrossingText", () => {
  it("names high water only with a proven cause", () => {
    expect(closedCrossingText("Город", true)).toContain("из-за высокой воды");
    expect(closedCrossingText("Город", true)).toContain("дождаться спада");
  });
  it("stays neutral without river evidence", () => {
    const text = closedCrossingText("Город", false);
    expect(text).toContain("переправа закрыта");
    expect(text).not.toContain("высокой воды");
    expect(text).not.toContain("спада");
    expect(text).toContain("Город");
  });
});
