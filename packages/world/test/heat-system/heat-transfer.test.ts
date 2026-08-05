import { describe, it, expect } from "vitest";
import { computeHeatTransfer, classifyThermalZone } from "../../src/heat/process.js";
import type { HeatProcessDefinition } from "../../src/heat/types.js";

const TEST_PROCESS: HeatProcessDefinition = {
  processId: "test-heat",
  ambientTemperature: 15,
  transferRate: 0.1,
  dissipationRate: 0.05,
  zoneThresholds: { cold: 0, warm: 25, hot: 60 },
};

describe("Heat Transfer process (PR-7.1)", () => {
  it("classifyThermalZone returns correct zones", () => {
    expect(classifyThermalZone(-5, TEST_PROCESS.zoneThresholds)).toBe("cold");
    expect(classifyThermalZone(10, TEST_PROCESS.zoneThresholds)).toBe("neutral");
    expect(classifyThermalZone(30, TEST_PROCESS.zoneThresholds)).toBe("warm");
    expect(classifyThermalZone(70, TEST_PROCESS.zoneThresholds)).toBe("hot");
  });

  it("computeHeatTransfer moves temperature toward ambient", () => {
    const state = { zoneId: "test", temperature: 30, zone: "warm" as const, exposure: 0.5, updatedAt: 0 };
    const result = computeHeatTransfer(TEST_PROCESS, state, 15, 1.0);
    // Temperature should move from 30 toward 15
    expect(result.temperature).toBeLessThan(30);
    expect(result.temperature).toBeGreaterThan(15);
  });

  it("computeHeatTransfer is deterministic", () => {
    const state = { zoneId: "test", temperature: 20, zone: "neutral" as const, exposure: 0.3, updatedAt: 0 };
    const r1 = computeHeatTransfer(TEST_PROCESS, state, 15, 1.0);
    const r2 = computeHeatTransfer(TEST_PROCESS, state, 15, 1.0);
    expect(r1).toEqual(r2);
  });

  it("wind factor affects transfer rate", () => {
    const state = { zoneId: "test", temperature: 30, zone: "warm" as const, exposure: 0.5, updatedAt: 0 };
    const calm = computeHeatTransfer(TEST_PROCESS, state, 15, 1.0);
    const windy = computeHeatTransfer(TEST_PROCESS, state, 15, 1.5);
    // Wind should move temperature faster
    expect(Math.abs(windy.temperature - 30)).toBeGreaterThan(Math.abs(calm.temperature - 30));
  });

  it("exposure decays over time", () => {
    const state = { zoneId: "test", temperature: 20, zone: "neutral" as const, exposure: 1.0, updatedAt: 0 };
    const result = computeHeatTransfer(TEST_PROCESS, state, 15, 1.0);
    expect(result.exposure).toBeLessThan(1.0);
  });

  it("temperature is clamped to [-20, 100]", () => {
    const coldState = { zoneId: "test", temperature: -15, zone: "cold" as const, exposure: 0, updatedAt: 0 };
    const coldResult = computeHeatTransfer(TEST_PROCESS, coldState, -25, 1.0);
    expect(coldResult.temperature).toBeGreaterThanOrEqual(-20);

    const hotState = { zoneId: "test", temperature: 95, zone: "hot" as const, exposure: 0, updatedAt: 0 };
    const hotResult = computeHeatTransfer(TEST_PROCESS, hotState, 110, 1.0);
    expect(hotResult.temperature).toBeLessThanOrEqual(100);
  });
});
