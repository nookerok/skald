/**
 * Living World Metrics tests (packages/cli/test/eval-living.test.ts).
 *
 * Covers the emergence computation, the living probe, the health report and
 * the dead/dormant/rare/common/critical rule classification.
 */

import { describe, it, expect } from "vitest";
import type { DomainEvent } from "@skald/event-bus";
import { computeEmergence, runLivingProbe, buildHealthReport } from "../src/eval/living.js";
import { buildRuleGraph, seenEventTypesFromCoverage } from "../src/eval/rule-graph.js";
import type { RuleCoverage } from "../src/eval/types.js";

function evt(type: string, eventId: string, timestamp: number, causationId: string | null): DomainEvent {
  return { eventId, type, schemaVersion: 1, payload: {}, timestamp, correlationId: "t", causationId };
}

describe("computeEmergence", () => {
  it("counts chains, cross-system chains and average depth", () => {
    const log = [
      evt("A", "a", 1, null),
      evt("B", "b", 2, "a"),
      evt("C", "c", 3, "b"),
      evt("D", "d", 4, null),
    ];
    const e = computeEmergence(log);
    expect(e.components).toBe(2);          // two roots
    expect(e.chains).toBe(2);              // a->b->c and d
    expect(e.crossSystemChains).toBe(1);   // a->b->c has 3 distinct types
    expect(e.avgChainDepth).toBe(2);       // (3 + 1) / 2
    expect(e.maxDepth).toBe(3);
  });
});

describe("runLivingProbe", () => {
  it("is deterministic and produces finite metrics", () => {
    const probe = runLivingProbe({ ticks: 20, actions: [] });
    expect(probe.determinism).toBe(true);
    expect(probe.eventCount).toBeGreaterThan(0);
    expect(probe.distinctTypes).toBeGreaterThan(0);
    expect(probe.idleRatio).toBeGreaterThanOrEqual(0);
    expect(probe.idleRatio).toBeLessThanOrEqual(1);
    expect(Number.isFinite(probe.knowledgeGrowth)).toBe(true);
    expect(probe.emergence.chains).toBeGreaterThan(0);
  });
});

describe("buildHealthReport", () => {
  it("produces bounded, finite dashboard scores", () => {
    const health = buildHealthReport(runLivingProbe({ ticks: 20, actions: [] }), 0, { informationHonesty: 1, presentation: 1 });
    expect(health.determinism).toBe(true);
    expect(health.commit).toMatch(/^[0-9a-f]{40}$/);
    for (const key of ["livingness", "emergence", "ruleReachability", "narrativeDiversity", "knowledgeGrowth"] as const) {
      expect(Number.isFinite(health.metrics[key])).toBe(true);
      expect(health.metrics[key]).toBeGreaterThanOrEqual(0);
      expect(health.metrics[key]).toBeLessThanOrEqual(1);
    }
    expect(health.metrics.idleSimulation).toBeGreaterThanOrEqual(0);
    expect(health.metrics.idleSimulation).toBeLessThanOrEqual(1);
    expect(health.metrics.averageChainDepth).toBeGreaterThan(0);
    expect(health.metrics.informationHonesty).toBe(1);
    expect(health.metrics.presentation).toBe(1);
  });
});

describe("rule classification", () => {
  function makeCoverage(fired: Record<string, number>): RuleCoverage {
    return {
      fired: new Map(Object.entries(fired)),
      produced: new Map(Object.entries(fired).map(([id]) => [id, ["GeneratedEvent"]])),
      total: 0,
    };
  }

  it("classifies dead vs dormant by whether the trigger type was ever seen", () => {
    const seen = new Set(["ObservationUpdated"]);
    const graph = buildRuleGraph(
      new Map(),
      new Map(),
      seen,
    );
    // consequences.repercussion listens to ObservationUpdated (seen) -> dormant.
    const repercussion = graph.classification.find((r) => r.ruleId === "consequences.repercussion")!;
    expect(repercussion.status).toBe("dormant");
    // consequences.fire listens to ConsequenceExpired (never seen) -> dead.
    const fire = graph.classification.find((r) => r.ruleId === "consequences.fire")!;
    expect(fire.status).toBe("dead");
  });

  it("classifies fired rules by scenario breadth", () => {
    const graph = buildRuleGraph(
      new Map([["relations.give", 12]]),
      new Map([["relations.give", 3]]),
      new Set(["RelationChanged"]),
    );
    expect(graph.classification.find((r) => r.ruleId === "relations.give")!.status).toBe("common");
  });

  it("seenEventTypesFromCoverage unions produced types", () => {
    const cov = makeCoverage({ "a.rule": 1 });
    const seen = seenEventTypesFromCoverage(cov);
    expect(seen.has("GeneratedEvent")).toBe(true);
  });
});
