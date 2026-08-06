/**
 * Simulation Quality Report (packages/cli/src/eval/quality.ts).
 *
 * Turns the eval harness from pass/fail into quantitative quality metrics:
 *   - determinism: two independent runs of the same scenario commit identical
 *     event logs (byte-for-byte);
 *   - purity: replaying the Event Log rebuilds the identical world;
 *   - presentation honesty and knowledge honesty (no internal truth leaks);
 *   - rule coverage: fraction of registered rules that fired at least once.
 * The report is deterministic (pinned to the current commit) and comparable
 * between commits for CI gates.
 */

import { execSync } from "node:child_process";
import type { DomainEvent } from "@skald/event-bus";
import { createHarness } from "./harness.js";
import type { QualityReport, RuleCoverageEntry, Scenario, ScenarioQuality } from "./types.js";

/** Deterministic commit pin; "unknown" outside a git worktree. */
export function currentCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function serializeLog(events: readonly DomainEvent[]): string {
  return events
    .map((e) => JSON.stringify([e.eventId, e.type, e.schemaVersion, e.payload, e.timestamp, e.correlationId, e.causationId]))
    .join("\n");
}

export { serializeLog };

export interface EvaluatedScenario {
  readonly quality: ScenarioQuality;
  readonly ruleFired: ReadonlyMap<string, number>;
}

/** Score one scenario: run it twice, audit both, and compare the logs. */
export function evaluateScenario(scenario: Scenario): EvaluatedScenario {
  const a = createHarness(scenario.worldTemplate, scenario.name);
  const reportA = a.runScenario(scenario);
  const coverageA = a.getRuleCoverage();

  const b = createHarness(scenario.worldTemplate, scenario.name);
  b.runScenario(scenario);
  const coverageB = b.getRuleCoverage();

  const logA = a.app.bus.query();
  const logB = b.app.bus.query();
  // Critical checks use the random-dice infrastructure (Math.random lives
  // outside Rules by design, ADR-0022 note). A scenario that triggers one is
  // not reproducible: determinism is honestly false, never assumed.
  const touchesDice = logA.some((e) => e.type === "CriticalCheckRequested");

  const quality: ScenarioQuality = {
    name: scenario.name,
    tags: [...(scenario.tags ?? [])],
    worldTemplate: scenario.worldTemplate,
    pass: reportA.pass,
    stepCount: reportA.steps.length,
    eventCount: logA.length,
    determinism: !touchesDice && serializeLog(logA) === serializeLog(logB),
    purity: reportA.audit.purity,
    noTruthLeak: reportA.audit.noTruthLeak,
    presentationHonest: reportA.audit.presentationHonest,
    idempotency: reportA.audit.idempotency,
    ruleCoverage: coverageA.total === 0 ? 0 : coverageA.fired.size / coverageA.total,
  };

  // Union of both runs: a rule fires if it fired in either identical run.
  const ruleFired = new Map<string, number>();
  for (const [id, count] of coverageA.fired) ruleFired.set(id, count);
  for (const [id, count] of coverageB.fired) ruleFired.set(id, (ruleFired.get(id) ?? 0) + count);

  return { quality, ruleFired };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function buildQualityReport(scenarios: readonly Scenario[]): QualityReport {
  const evaluated = scenarios.map(evaluateScenario);

  const totalRules = new Set<string>();
  const phaseOf = new Map<string, string>();
  const scenariosFired = new Map<string, number>();
  const totalFired = new Map<string, number>();
  const perScenario = evaluated.map(({ quality }) => quality);

  // Rule inventory is the same composition for every template; take it from the
  // first harness so the report lists exactly what the engine can run.
  if (scenarios.length > 0) {
    const probe = createHarness(scenarios[0]!.worldTemplate, "probe");
    for (const rule of probe.app.registry.listRules()) {
      totalRules.add(rule.id);
      phaseOf.set(rule.id, rule.phase);
    }
  }

  for (const { ruleFired } of evaluated) {
    for (const [id, count] of ruleFired) {
      scenariosFired.set(id, (scenariosFired.get(id) ?? 0) + 1);
      totalFired.set(id, (totalFired.get(id) ?? 0) + count);
    }
  }

  const ruleCoverage: RuleCoverageEntry[] = [...totalRules].sort().map((id) => ({
    ruleId: id,
    phase: phaseOf.get(id) ?? "?",
    scenariosFired: scenariosFired.get(id) ?? 0,
    totalFired: totalFired.get(id) ?? 0,
  }));

  const n = evaluated.length;
  const rate = (predicate: (q: ScenarioQuality) => boolean): number => (n === 0 ? 0 : round(evaluated.filter(({ quality }) => predicate(quality)).length / n));
  const firedRules = ruleCoverage.filter((entry) => entry.totalFired > 0).length;

  return {
    commit: currentCommit(),
    scenarioCount: n,
    totalRules: totalRules.size,
    metrics: {
      scenarioPassRate: rate((q) => q.pass),
      determinismRate: rate((q) => q.determinism),
      purityRate: rate((q) => q.purity),
      presentationHonestRate: rate((q) => q.presentationHonest),
      noTruthLeakRate: rate((q) => q.noTruthLeak),
      ruleCoverageRate: totalRules.size === 0 ? 0 : round(firedRules / totalRules.size),
    },
    ruleCoverage,
    perScenario,
  };
}
