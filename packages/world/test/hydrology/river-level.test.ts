import { describe, it, expect } from "vitest";
import { computeRiverLevel, classifyRiverBand } from "@skald/world";
import type { RiverProcessDefinition } from "@skald/world";

const TEST_PROCESS: RiverProcessDefinition = {
  processId: "test-river",
  watercourseId: "test_watercourse",
  baselineLevel: 40,
  minimumLevel: 20,
  maximumLevel: 90,
  cycleLengthTicks: 16,
  phaseOffset: 0,
  riseRate: 8,
  fallRate: 5,
};

describe("computeRiverLevel", () => {
  it("starts at baseline when phaseOffset=0 and worldTime=0", () => {
    const level = computeRiverLevel(TEST_PROCESS, 0);
    expect(level).toBe(40);
  });

  it("rises during first half of cycle", () => {
    const level4 = computeRiverLevel(TEST_PROCESS, 4);
    expect(level4).toBeGreaterThan(40);
  });

  it("reaches maximum at midpoint", () => {
    const level = computeRiverLevel(TEST_PROCESS, 8);
    expect(level).toBe(90);
  });

  it("falls during second half of cycle", () => {
    const level12 = computeRiverLevel(TEST_PROCESS, 12);
    expect(level12).toBeLessThan(90);
    expect(level12).toBeGreaterThan(40);
  });

  it("returns to baseline at end of cycle", () => {
    const level = computeRiverLevel(TEST_PROCESS, 16);
    expect(level).toBe(40);
  });

  it("clamps to minimumLevel", () => {
    // At T=0, level should be at baseline (40), not minimum
    const level = computeRiverLevel(TEST_PROCESS, 0);
    expect(level).toBeGreaterThanOrEqual(TEST_PROCESS.minimumLevel);
  });

  it("clamps to maximumLevel", () => {
    const level = computeRiverLevel(TEST_PROCESS, 8);
    expect(level).toBeLessThanOrEqual(TEST_PROCESS.maximumLevel);
  });

  it("is deterministic — same input always gives same output", () => {
    for (let t = 0; t < 32; t++) {
      expect(computeRiverLevel(TEST_PROCESS, t)).toBe(computeRiverLevel(TEST_PROCESS, t));
    }
  });

  it("cycles correctly across multiple cycles", () => {
    expect(computeRiverLevel(TEST_PROCESS, 0)).toBe(computeRiverLevel(TEST_PROCESS, 16));
    expect(computeRiverLevel(TEST_PROCESS, 4)).toBe(computeRiverLevel(TEST_PROCESS, 20));
    expect(computeRiverLevel(TEST_PROCESS, 8)).toBe(computeRiverLevel(TEST_PROCESS, 24));
  });

  it("handles phaseOffset", () => {
    const process = { ...TEST_PROCESS, phaseOffset: 4 };
    // At T=4 with offset 4, cycle position = 0 → baseline
    const level = computeRiverLevel(process, 4);
    expect(level).toBe(40);
  });

  it("returns integer values", () => {
    for (let t = 0; t < 16; t++) {
      const level = computeRiverLevel(TEST_PROCESS, t);
      expect(Number.isInteger(level)).toBe(true);
    }
  });
});

describe("classifyRiverBand", () => {
  it("classifies low band", () => {
    expect(classifyRiverBand(20, TEST_PROCESS)).toBe("low");
    expect(classifyRiverBand(30, TEST_PROCESS)).toBe("low");
  });

  it("classifies normal band", () => {
    expect(classifyRiverBand(45, TEST_PROCESS)).toBe("normal");
  });

  it("classifies high band", () => {
    expect(classifyRiverBand(65, TEST_PROCESS)).toBe("high");
  });

  it("classifies flood band", () => {
    expect(classifyRiverBand(85, TEST_PROCESS)).toBe("flood");
    expect(classifyRiverBand(90, TEST_PROCESS)).toBe("flood");
  });
});
