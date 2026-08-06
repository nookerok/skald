/**
 * Run every eval scenario and emit the Simulation Quality Report
 * (packages/cli/src/eval/run-all.ts).
 *
 * Usage:
 *   npm run eval                                  # pass/fail gate (validate)
 *   npm run eval -- --json out/report.json        # JSON quality report
 *   npm run eval -- --html out/report.html        # HTML quality report
 *   npm run eval -- --tags                        # per-tag coverage summary
 *
 * Exit code 0 only when every scenario passes its assertions and the invariant
 * audit. The JSON/HTML report is deterministic and comparable across commits.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHarness } from "./harness.js";
import { renderSummary } from "./report.js";
import { buildQualityReport } from "./quality.js";
import { renderHtml } from "./html.js";
import type { QualityReport, Scenario } from "./types.js";

const scenariosDir = resolve(import.meta.dirname, "../../eval-scenarios");
const files = readdirSync(scenariosDir).filter((name) => name.endsWith(".json")).sort();

if (files.length === 0) {
  console.error("[eval] no scenarios found in packages/cli/eval-scenarios/");
  process.exit(2);
}

const args = process.argv.slice(2);
const jsonPath = args[args.indexOf("--json") + 1];
const htmlPath = args[args.indexOf("--html") + 1];
const withTags = args.includes("--tags");
const wantReport = jsonPath !== undefined || htmlPath !== undefined || withTags;

const scenarios: Scenario[] = files.map((file) =>
  JSON.parse(readFileSync(resolve(scenariosDir, file), "utf8")) as Scenario,
);

// Pass/fail gate: one run per scenario, detailed failure lines on the console.
let failed = 0;
for (const scenario of scenarios) {
  const harness = createHarness(scenario.worldTemplate, scenario.name);
  const report = harness.runScenario(scenario);
  console.log(renderSummary(report));
  if (!report.pass) failed++;
}

let report: QualityReport | null = null;
if (wantReport) {
  report = buildQualityReport(scenarios);
  if (withTags) printTagCoverage(report);
  for (const target of [jsonPath, htmlPath]) {
    if (target !== undefined) mkdirSync(dirname(target), { recursive: true });
  }
  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(`[eval] wrote ${jsonPath}`);
  }
  if (htmlPath) {
    writeFileSync(htmlPath, renderHtml(report), "utf8");
    console.log(`[eval] wrote ${htmlPath}`);
  }
  printReportSummary(report);
}

console.log(`[eval] ${failed === 0 ? "PASS" : "FAIL"} (${files.length} scenarios, ${failed} failing)`);
process.exit(failed === 0 ? 0 : 1);

function printTagCoverage(report: QualityReport): void {
  const byTag = new Map<string, { total: number; passed: number }>();
  for (const scenario of report.perScenario) {
    for (const tag of scenario.tags) {
      const entry = byTag.get(tag) ?? { total: 0, passed: 0 };
      entry.total++;
      if (scenario.pass) entry.passed++;
      byTag.set(tag, entry);
    }
  }
  console.log("[eval] per-tag coverage:");
  for (const [tag, entry] of [...byTag.entries()].sort()) {
    console.log(`  ${tag}: ${entry.passed}/${entry.total}`);
  }
}

function printReportSummary(report: QualityReport): void {
  const m = report.metrics;
  const used = report.ruleCoverage.filter((r) => r.totalFired > 0).length;
  console.log("[eval] Simulation Quality Report");
  console.log(`  commit:            ${report.commit}`);
  console.log(`  scenarioPass:      ${Math.round(m.scenarioPassRate * 100)}%`);
  console.log(`  determinism:       ${Math.round(m.determinismRate * 100)}%`);
  console.log(`  purity:            ${Math.round(m.purityRate * 100)}%`);
  console.log(`  presentation:      ${Math.round(m.presentationHonestRate * 100)}%`);
  console.log(`  knowledge honesty: ${Math.round(m.noTruthLeakRate * 100)}%`);
  console.log(`  rule coverage:     ${Math.round(m.ruleCoverageRate * 100)}% (${used}/${report.totalRules})`);
  const unused = report.ruleCoverage.filter((r) => r.totalFired === 0).map((r) => r.ruleId).join(", ");
  if (unused) console.log(`  unused rules:      ${unused}`);
}
