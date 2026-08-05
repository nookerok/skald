import { describe, it, expect } from "vitest";
import { computeSettlementTick } from "../../src/rules/settlement-pattern.js";
import type { SettlementState } from "../../src/settlement/types.js";

function makeState(overrides?: Partial<SettlementState>): SettlementState {
  return {
    settlementId: "test-settlement",
    population: 50,
    risk: 30,
    status: "active",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("Settlement Pattern (PR-7.4)", () => {
  it("computeSettlementTick is deterministic", () => {
    const state = makeState();
    const r1 = computeSettlementTick(state, 10);
    const r2 = computeSettlementTick(state, 10);
    expect(r1).toEqual(r2);
  });

  it("high risk causes population decline", () => {
    const state = makeState({ risk: 80, population: 50 });
    const result = computeSettlementTick(state, 10);
    expect(result.population).toBeLessThan(50);
  });

  it("low risk allows population growth", () => {
    const state = makeState({ risk: 20, population: 50 });
    const result = computeSettlementTick(state, 10);
    expect(result.population).toBeGreaterThan(50);
  });

  it("risk decays toward baseline", () => {
    const state = makeState({ risk: 80 });
    const result = computeSettlementTick(state, 10);
    expect(result.risk).toBeLessThan(80);
  });

  it("population cannot go below 0", () => {
    const state = makeState({ risk: 100, population: 1 });
    const result = computeSettlementTick(state, 10);
    expect(result.population).toBe(0);
  });

  it("population cannot exceed 100", () => {
    const state = makeState({ risk: 0, population: 99 });
    const result = computeSettlementTick(state, 10);
    expect(result.population).toBe(100);
  });

  it("zero population → abandoned status", () => {
    const state = makeState({ population: 0 });
    const result = computeSettlementTick(state, 10);
    expect(result.status).toBe("abandoned");
  });

  it("population decrease → declining status", () => {
    // Population 10, after tick becomes 9 (50% of 10 = 5, 9 > 5, so still active)
    // But if we start with population 1 and high risk, it goes to 0 → abandoned
    const state = makeState({ population: 1, risk: 90 });
    const result = computeSettlementTick(state, 10);
    expect(result.population).toBe(0);
    expect(result.status).toBe("abandoned");
  });
});
