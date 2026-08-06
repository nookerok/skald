/**
 * Living World probe: Simulation Health Report + Rule Dependency Graph
 * (packages/cli/src/eval/run-living.ts).
 *
 * Usage:
 *   npm run eval:living
 *
 * Runs a long deterministic offline probe on the living region, measures
 * emergence/diversity/knowledge growth/idle simulation, classifies every rule
 * (dead/dormant/rare/common/critical) and writes:
 *   eval-out/health.json      — the Simulation Health Report
 *   eval-out/rule-graph.json  — rule -> event -> rule graph + classification
 * Prints the engine dashboard. Deterministic, read-only.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHarness } from "./harness.js";
import { runLivingProbe, buildHealthReport } from "./living.js";
import { buildRuleGraph, seenEventTypesFromCoverage, type RuleClassificationEntry } from "./rule-graph.js";
import type { Scenario } from "./types.js";

const scenariosDir = resolve(import.meta.dirname, "../../eval-scenarios");
const scenarios: Scenario[] = readdirSync(scenariosDir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .map((name) => JSON.parse(readFileSync(resolve(scenariosDir, name), "utf8")) as Scenario);

const firedCounts = new Map<string, number>();
const scenariosFired = new Map<string, number>();
const seenEventTypes = new Set<string>();

// Library: one pass per scenario for per-scenario firing, seen event types and
// the measured honesty/presentation audit rates.
let honestPassed = 0;
let presentationPassed = 0;
for (const scenario of scenarios) {
  const harness = createHarness(scenario.worldTemplate, scenario.name);
  const outcome = harness.runScenario(scenario);
  const coverage = harness.getRuleCoverage();
  for (const [id, count] of coverage.fired) {
    firedCounts.set(id, (firedCounts.get(id) ?? 0) + count);
    scenariosFired.set(id, (scenariosFired.get(id) ?? 0) + 1);
  }
  for (const type of seenEventTypesFromCoverage(coverage)) seenEventTypes.add(type);
  if (outcome.audit.noTruthLeak) honestPassed++;
  if (outcome.audit.presentationHonest) presentationPassed++;
}

// Long living probe: the offline world actually evolving.
const probe = runLivingProbe();
for (const [id, count] of probe.ruleCoverage.fired) {
  firedCounts.set(id, (firedCounts.get(id) ?? 0) + count);
  scenariosFired.set(id, Math.max(scenariosFired.get(id) ?? 0, 1));
}
for (const type of probe.seenEventTypes) seenEventTypes.add(type);

const graph = buildRuleGraph(firedCounts, scenariosFired, seenEventTypes);
const deadRules = graph.classification.filter((r) => r.status === "dead" || r.status === "dormant").length;
const health = buildHealthReport(probe, deadRules, {
  informationHonesty: scenarios.length === 0 ? 0 : honestPassed / scenarios.length,
  presentation: scenarios.length === 0 ? 0 : presentationPassed / scenarios.length,
});
const firedRulesTotal = firedCounts.size;
const totalRules = graph.classification.length;

mkdirSync(dirname(resolve("eval-out/health.json")), { recursive: true });
writeFileSync("eval-out/health.json", JSON.stringify(health, null, 2) + "\n", "utf8");
writeFileSync("eval-out/rule-graph.json", JSON.stringify(graph, null, 2) + "\n", "utf8");

// Dashboard.
const m = health.metrics;
const pct = (v: number): string => `${Math.round(v * 100)}%`;
console.log(`[eval:living] probe: ${health.probe.template}, ${health.probe.ticks} ticks, ${health.probe.eventCount} events, commit ${health.commit}`);
console.log(`  determinism:        ${health.determinism ? "ok" : "VIOLATED"}`);
console.log(`  Livingness:         ${Math.round(m.livingness * 100)}`);
console.log(`  Emergence:          ${Math.round(m.emergence * 100)}`);
  console.log(`  Rule reachability:  ${Math.round(m.ruleReachability * 100)} (${firedRulesTotal}/${totalRules})`);
console.log(`  Information honesty ${Math.round(m.informationHonesty * 100)}`);
console.log(`  Presentation:       ${Math.round(m.presentation * 100)}`);
console.log(`  Narrative diversity ${Math.round(m.narrativeDiversity * 100)}`);
console.log(`  Knowledge growth:   ${Math.round(m.knowledgeGrowth * 100)}`);
console.log(`  Idle simulation:    ${pct(m.idleSimulation)}`);
console.log(`  Avg chain depth:    ${m.averageChainDepth.toFixed(1)}`);
console.log(`  Dead rules:         ${deadRules}`);
console.log(`  Emergence detail:   ${health.emergence.chains} chains, ${health.emergence.crossSystemChains} cross-system, ${health.emergence.components} components, max depth ${health.emergence.maxDepth}`);
console.log(`  Diversity:          ${probe.distinctTypes}/${probe.totalRegisteredTypes} event types, ${probe.meaningfulTypes} meaningful`);

printClassification(graph.classification);

function printClassification(classification: readonly RuleClassificationEntry[]): void {
  const groups: Record<string, string[]> = { dead: [], dormant: [], rare: [], common: [], critical: [] };
  for (const entry of classification) groups[entry.status]!.push(entry.ruleId);
  console.log("  Rule classification:");
  for (const status of ["dead", "dormant", "rare", "common", "critical"] as const) {
    const list = groups[status]!;
    if (list.length > 0) console.log(`    ${status.padEnd(9)} ${list.length.toString().padStart(2)}  ${list.join(", ")}`);
  }
}
