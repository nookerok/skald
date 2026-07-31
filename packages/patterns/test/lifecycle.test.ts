import { describe, expect, it } from "vitest";
import {
  PATTERN_LIFECYCLE_TRANSITIONS,
  canTransitionPatternLifecycle,
  transitionPatternLifecycle,
  type PatternLifecycle,
} from "@skald/patterns";

describe("Pattern Ontology lifecycle", () => {
  it("exposes a closed v1.0 state graph", () => {
    expect(PATTERN_LIFECYCLE_TRANSITIONS.latent).toEqual(["observed"]);
    expect(PATTERN_LIFECYCLE_TRANSITIONS.dissolved).toEqual([]);
    expect(canTransitionPatternLifecycle("observed", "emerging")).toBe(true);
    expect(canTransitionPatternLifecycle("latent", "stable")).toBe(false);
  });

  it("transitions immutably and increments the version", () => {
    const lifecycle: PatternLifecycle = { state: "observed", changedAt: 2, version: 1 };
    const next = transitionPatternLifecycle(lifecycle, { from: "observed", to: "emerging", at: 3 });
    expect(next).toEqual({ state: "emerging", changedAt: 3, version: 2 });
    expect(lifecycle).toEqual({ state: "observed", changedAt: 2, version: 1 });
  });

  it("rejects illegal and stale transitions", () => {
    const lifecycle: PatternLifecycle = { state: "dissolved", changedAt: 4, version: 2 };
    expect(() => transitionPatternLifecycle(lifecycle, { from: "dissolved", to: "stable", at: 5 })).toThrow("Illegal");
    expect(() => transitionPatternLifecycle({ ...lifecycle, state: "observed" }, { from: "latent", to: "observed", at: 5 })).toThrow("Illegal");
  });
});
