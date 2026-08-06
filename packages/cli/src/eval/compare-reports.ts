/**
 * Compare two Simulation Quality Reports (packages/cli/src/eval/compare-reports.ts).
 *
 * Usage:
 *   node --import tsx packages/cli/src/eval/compare-reports.ts base.json new.json
 *
 * `compareReports` is the pure, testable core. The CLI wrapper prints the diff
 * and exits 1 when any metric regressed — the PR gate "the world got no worse".
 * Deterministic and read-only.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { QualityReport } from "./types.js";

export interface CompareResult {
  readonly lines: readonly string[];
  readonly regressed: readonly string[];
  readonly pass: boolean;
}

const EPSILON = 0.001;

export function compareReports(base: QualityReport, next: QualityReport): CompareResult {
  const lines: string[] = [];
  const regressed: string[] = [];
  const metricKeys = Object.keys(base.metrics) as Array<keyof QualityReport["metrics"]>;

  lines.push("=== Simulation Quality diff ===");
  lines.push(`  base: ${base.commit} (${base.scenarioCount} scenarios)`);
  lines.push(`  new:  ${next.commit} (${next.scenarioCount} scenarios)`);
  lines.push("");

  for (const key of metricKeys) {
    const before = base.metrics[key];
    const after = next.metrics[key];
    const delta = after - before;
    const sign = delta > EPSILON ? "+" : "";
    lines.push(`  ${key.padEnd(24)} ${(before * 100).toFixed(1).padStart(6)}% -> ${(after * 100).toFixed(1).padStart(6)}%  (${sign}${(delta * 100).toFixed(1)}%)`);
    if (after < before - EPSILON) regressed.push(key);
  }

  const basePass = new Map(base.perScenario.map((s) => [s.name, s.pass]));
  const changed: string[] = [];
  for (const scenario of next.perScenario) {
    const before = basePass.get(scenario.name);
    if (before === undefined) changed.push(`+ new scenario: ${scenario.name}`);
    else if (before && !scenario.pass) changed.push(`- now failing: ${scenario.name}`);
    else if (!before && scenario.pass) changed.push(`+ now passing: ${scenario.name}`);
  }
  if (changed.length > 0) {
    lines.push("");
    lines.push("Scenario changes:");
    for (const line of changed) lines.push(`  ${line}`);
  }

  const baseUsed = new Set(base.ruleCoverage.filter((r) => r.totalFired > 0).map((r) => r.ruleId));
  const nowUnused = next.ruleCoverage.filter((r) => r.totalFired === 0 && baseUsed.has(r.ruleId)).map((r) => r.ruleId);
  if (nowUnused.length > 0) {
    lines.push("");
    lines.push(`Rules that stopped firing: ${nowUnused.join(", ")}`);
    regressed.push("ruleCoverage (stopped firing)");
  }

  lines.push("");
  lines.push(regressed.length === 0 ? "COMPARE PASS: no metric regressed" : `COMPARE FAIL: regressed -> ${regressed.join(", ")}`);
  return { lines, regressed, pass: regressed.length === 0 };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  const basePath = process.argv[2];
  const newPath = process.argv[3];
  if (!basePath || !newPath) {
    console.error("usage: compare-reports.ts <base.json> <new.json>");
    process.exit(2);
  }
  const base = JSON.parse(readFileSync(basePath, "utf8")) as QualityReport;
  const next = JSON.parse(readFileSync(newPath, "utf8")) as QualityReport;
  const result = compareReports(base, next);
  for (const line of result.lines) console.log(line);
  process.exit(result.pass ? 0 : 1);
}
