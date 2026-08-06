/**
 * Run a single eval scenario (packages/cli/src/eval/run-scenario.ts).
 *
 * Usage:
 *   node --import tsx packages/cli/src/eval/run-scenario.ts <scenario.json> [--transcript]
 *
 * Loads a scenario, drives the deterministic core, and prints the report.
 * Exit code 0 on PASS, 1 on FAIL. `--transcript` prints the compact
 * player-facing dump for interface critique.
 */

import { readFileSync } from "node:fs";
import { createHarness } from "./harness.js";
import { renderSummary, renderTranscript, buildTranscriptArtifact } from "./report.js";
import type { Scenario } from "./types.js";

const file = process.argv[2];
if (!file) {
  console.error("usage: run-scenario.ts <scenario.json> [--transcript|--transcript-json]");
  process.exit(2);
}

const scenario = JSON.parse(readFileSync(file, "utf8")) as Scenario;
const harness = createHarness(scenario.worldTemplate, scenario.name);
const report = harness.runScenario(scenario);

if (process.argv.includes("--transcript-json")) {
  // Transcript Benchmark artifact: the stable player-facing document any LLM
  // can analyse and answer structured questions about.
  process.stdout.write(JSON.stringify(buildTranscriptArtifact(report), null, 2) + "\n");
} else if (process.argv.includes("--transcript")) {
  console.log(renderTranscript(report));
  console.log();
}

console.log(renderSummary(report));
process.exit(report.pass ? 0 : 1);
