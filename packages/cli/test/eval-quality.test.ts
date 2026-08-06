/**
 * Simulation quality system tests (packages/cli/test/eval-quality.test.ts).
 *
 * Covers the quality report builder, the CI comparator, the transcript
 * artifact and the AI Benchmark consensus analyzer.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildQualityReport } from "../src/eval/quality.js";
import { compareReports } from "../src/eval/compare-reports.js";
import { analyzeAnswers, type Answer } from "../src/eval/benchmark/run-benchmark.js";
import { buildTranscriptArtifact } from "../src/eval/report.js";
import { renderHtml } from "../src/eval/html.js";
import { createHarness } from "../src/eval/harness.js";
import type { Scenario } from "../src/eval/types.js";

function loadScenarios(): Scenario[] {
  const dir = resolve(import.meta.dirname, "../eval-scenarios");
  return readdirSync(dir).filter((name) => name.endsWith(".json")).sort()
    .map((name) => JSON.parse(readFileSync(resolve(dir, name), "utf8")) as Scenario);
}

describe("Simulation Quality Report", () => {
  it("builds deterministic metrics for the real scenario library", () => {
    const report = buildQualityReport(loadScenarios());
    expect(report.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(report.scenarioCount).toBeGreaterThanOrEqual(3);
    expect(report.totalRules).toBeGreaterThan(10);
    expect(report.metrics.determinismRate).toBe(1);
    expect(report.metrics.purityRate).toBe(1);
    expect(report.metrics.scenarioPassRate).toBe(1);
    expect(report.metrics.ruleCoverageRate).toBeGreaterThan(0);
    expect(report.metrics.ruleCoverageRate).toBeLessThanOrEqual(1);
    expect(report.perScenario.every((s) => s.determinism)).toBe(true);
    expect(report.ruleCoverage.some((r) => r.totalFired > 0)).toBe(true);
  });

  it("lists exactly the registered rules and their firing state", () => {
    const report = buildQualityReport(loadScenarios());
    const ids = new Set(report.ruleCoverage.map((r) => r.ruleId));
    expect(ids.size).toBe(report.totalRules);
    for (const entry of report.ruleCoverage) {
      expect(entry.scenariosFired).toBeLessThanOrEqual(report.scenarioCount);
    }
  });
});

describe("compareReports CI gate", () => {
  it("passes when the report is unchanged", () => {
    const report = buildQualityReport(loadScenarios());
    const result = compareReports(report, report);
    expect(result.pass).toBe(true);
    expect(result.regressed).toEqual([]);
  });

  it("flags a regression in a metric and in stopped rules", () => {
    const report = buildQualityReport(loadScenarios());
    const regressed = {
      ...report,
      commit: "fake",
      metrics: { ...report.metrics, purityRate: 0.5 },
      ruleCoverage: report.ruleCoverage.map((r) => (r.totalFired > 0 ? { ...r, totalFired: 0, scenariosFired: 0 } : r)),
    };
    const result = compareReports(report, regressed);
    expect(result.pass).toBe(false);
    expect(result.regressed).toContain("purityRate");
    expect(result.regressed.some((r) => r.includes("ruleCoverage"))).toBe(true);
    expect(result.lines.join(" ")).toContain("Rules that stopped firing");
  });
});

describe("AI Benchmark consensus", () => {
  const mk = (model: string, issues: string[], missing: string[] = []): Answer => ({
    model,
    understanding: "x",
    missingInfo: missing,
    interfaceIssues: issues,
    improvements: [],
    expectedNextEvents: [],
  });

  it("detects an interface issue two models independently report", () => {
    const report = analyzeAnswers([
      mk("gpt", ["Непонятно, почему караван исчез"]),
      mk("claude", ["Непонятно, почему караван исчез"]),
      mk("gemini", ["Другой баг"]),
    ]);
    expect(report.consensus.interfaceIssues).toHaveLength(1);
    expect(report.consensus.interfaceIssues[0]!.models).toHaveLength(2);
    expect(report.divergent.interfaceIssues).toHaveLength(1);
    expect(report.consensusCount).toBe(1);
  });

  it("keeps divergent single-model findings separate", () => {
    const report = analyzeAnswers([mk("gpt", ["Только я это вижу"]), mk("claude", ["Другое"])]);
    expect(report.consensus.interfaceIssues).toHaveLength(0);
    expect(report.divergent.interfaceIssues).toHaveLength(2);
  });
});

describe("transcript artifact and HTML", () => {
  it("buildTranscriptArtifact exposes the player-facing turns and final belief", () => {
    const scenario = loadScenarios().find((s) => s.name === "world-reaction")!;
    const harness = createHarness(scenario.worldTemplate, scenario.name);
    const artifact = buildTranscriptArtifact(harness.runScenario(scenario));
    expect(artifact.scenario).toBe("world-reaction");
    expect(artifact.turns.length).toBeGreaterThan(0);
    expect(artifact.turns[0]!.worldTime).toBeGreaterThanOrEqual(1);
    expect(artifact.finalBelief).not.toBeNull();
  });

  it("renderHtml is deterministic and includes metrics and scenarios", () => {
    const html = renderHtml(buildQualityReport(loadScenarios()));
    expect(html).toContain("Simulation Quality Report");
    expect(html).toContain("ruleCoverageRate");
    expect(html).toContain("living-region");
  });
});
