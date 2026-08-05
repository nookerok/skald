import { describe, it, expect } from "vitest";
import { classifyCrossingCondition, computeCrossingTravelTicks } from "../../src/rules/crossing-condition.js";
import type { CrossingDefinition } from "@skald/world";

const TEST_CROSSING: CrossingDefinition = {
  crossingId: "test_crossing",
  watercourseId: "test_river",
  openAtOrBelow: 55,
  difficultAtOrBelow: 75,
  closedAbove: 75,
  baseTravelCostTicks: 2,
};

describe("classifyCrossingCondition", () => {
  it("open when level <= 55", () => {
    expect(classifyCrossingCondition(20, TEST_CROSSING)).toBe("open");
    expect(classifyCrossingCondition(55, TEST_CROSSING)).toBe("open");
  });

  it("difficult when 56-75", () => {
    expect(classifyCrossingCondition(56, TEST_CROSSING)).toBe("difficult");
    expect(classifyCrossingCondition(65, TEST_CROSSING)).toBe("difficult");
    expect(classifyCrossingCondition(75, TEST_CROSSING)).toBe("difficult");
  });

  it("closed when > 75", () => {
    expect(classifyCrossingCondition(76, TEST_CROSSING)).toBe("closed");
    expect(classifyCrossingCondition(90, TEST_CROSSING)).toBe("closed");
  });
});

describe("computeCrossingTravelTicks", () => {
  it("open returns base cost", () => {
    expect(computeCrossingTravelTicks("open", 2)).toBe(2);
  });

  it("difficult returns base + 2", () => {
    expect(computeCrossingTravelTicks("difficult", 2)).toBe(4);
  });

  it("closed returns Infinity", () => {
    expect(computeCrossingTravelTicks("closed", 2)).toBe(Infinity);
  });
});
