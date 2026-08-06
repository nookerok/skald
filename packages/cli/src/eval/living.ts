/**
 * Living World Metrics and Simulation Health Report
 * (packages/cli/src/eval/living.ts).
 *
 * Measures whether the world is alive, not just correct:
 *   - Emergence: new causal chains (root-to-leaf causation paths), cross-system
 *     chains (>=3 distinct event types on one path) and average chain depth;
 *   - Diversity: distinct event types fired vs registered;
 *   - Knowledge growth: belief count before and after a long probe;
 *   - Idle simulation: fraction of churn/gate events vs meaningful change;
 *   - Rule reachability: fraction of registered rules that actually fired.
 * The probe is a deterministic long offline run; the report is commit-pinned.
 */

import type { DomainEvent } from "@skald/event-bus";
import { EventType, buildBeliefModel } from "@skald/world";
import { runCommandCycle, runOfflineTicks } from "../index.js";
import { createHarness } from "./harness.js";
import { currentCommit, serializeLog } from "./quality.js";
import type { RuleCoverage } from "./types.js";

/** Gate/engine churn: events that record intent or bookkeeping, not world change. */
export const CHURN_EVENT_TYPES: ReadonlySet<string> = new Set([
  "TickPassed", "HeatRadiated", "ActionAttempted", "ActionValidated",
  "InteractionRequested", "InteractionTimeValidated", "TargetResolved",
  "InteractionValidated", "MoveRequested", "GiveRequested", "GiveValidated",
  "ActionRejected", "CommandRejected", "JourneyRequested", "JourneyValidated",
]);

export interface EmergenceMetrics {
  readonly components: number;
  readonly chains: number;
  readonly crossSystemChains: number;
  readonly avgChainDepth: number;
  readonly maxDepth: number;
}

export interface LivingProbeResult {
  readonly template: string;
  readonly ticks: number;
  readonly eventCount: number;
  readonly determinism: boolean;
  readonly distinctTypes: number;
  readonly totalRegisteredTypes: number;
  readonly meaningfulTypes: number;
  readonly idleRatio: number;
  readonly emergence: EmergenceMetrics;
  readonly knowledgeGrowth: number;
  readonly ruleCoverage: RuleCoverage;
  readonly seenEventTypes: ReadonlySet<string>;
}

export interface HealthReport {
  readonly commit: string;
  readonly probe: { readonly template: string; readonly ticks: number; readonly eventCount: number };
  /** Scores in [0,1]; the CLI renders them as 0..100. */
  readonly metrics: {
    readonly livingness: number;
    readonly emergence: number;
    readonly ruleReachability: number;
    readonly informationHonesty: number;
    readonly presentation: number;
    readonly narrativeDiversity: number;
    readonly knowledgeGrowth: number;
    readonly idleSimulation: number;
    readonly averageChainDepth: number;
    readonly deadRules: number;
  };
  readonly determinism: boolean;
  readonly emergence: EmergenceMetrics;
  readonly diversityRate: number;
  readonly idleRatio: number;
}

export function computeEmergence(log: readonly DomainEvent[]): EmergenceMetrics {
  const byId = new Map<string, DomainEvent>();
  const children = new Map<string, string[]>();
  for (const event of log) byId.set(event.eventId, event);
  for (const event of log) {
    if (event.causationId) {
      const list = children.get(event.causationId) ?? [];
      list.push(event.eventId);
      children.set(event.causationId, list);
    }
  }
  const roots = log.filter((e) => !e.causationId || !byId.has(e.causationId));

  let chains = 0;
  let crossSystemChains = 0;
  let depthSum = 0;
  let pathCount = 0;
  let maxDepth = 0;

  const walk = (id: string, types: ReadonlySet<string>, depth: number): void => {
    const next = children.get(id) ?? [];
    if (next.length === 0) {
      chains++;
      pathCount++;
      depthSum += depth;
      maxDepth = Math.max(maxDepth, depth);
      if (types.size >= 3) crossSystemChains++;
      return;
    }
    for (const child of next) {
      const childEvent = byId.get(child);
      if (!childEvent) continue;
      const extended = new Set(types);
      extended.add(childEvent.type);
      walk(child, extended, depth + 1);
    }
  };

  for (const root of roots) walk(root.eventId, new Set([root.type]), 1);

  return {
    components: roots.length,
    chains,
    crossSystemChains,
    avgChainDepth: pathCount === 0 ? 0 : depthSum / pathCount,
    maxDepth,
  };
}

interface ProbeRun {
  readonly log: readonly DomainEvent[];
  readonly coverage: RuleCoverage;
  readonly startBeliefs: number;
  readonly endBeliefs: number;
}

function runProbeOnce(template: string, ticks: number, actions: readonly string[]): ProbeRun {
  const harness = createHarness(template, "living-probe");
  const app = harness.app;
  const world = app.projection.getSnapshot();
  const startBeliefs = buildBeliefModel(app.bus.query(), world, "player").beliefs.size;

  let actionIdx = 0;
  for (const action of actions) runCommandCycle(app, action, `living:action:${actionIdx++}`);
  let remaining = ticks;
  let chunk = 0;
  while (remaining > 0) {
    const count = Math.min(100, remaining);
    runOfflineTicks(app, count, `living:ticks:${chunk++}`);
    remaining -= count;
  }

  const log = app.bus.query();
  const endBeliefs = buildBeliefModel(log, app.projection.getSnapshot(), "player").beliefs.size;
  return { log, coverage: harness.getRuleCoverage(), startBeliefs, endBeliefs };
}

export function runLivingProbe(options?: { template?: string; ticks?: number; actions?: readonly string[] }): LivingProbeResult {
  const template = options?.template ?? "living_region";
  const ticks = options?.ticks ?? 150;
  const actions = options?.actions ?? ["give help to guild"];

  const a = runProbeOnce(template, ticks, actions);
  const b = runProbeOnce(template, ticks, actions);
  const determinism = serializeLog(a.log) === serializeLog(b.log);
  const log = a.log;

  const types = new Set(log.map((e) => e.type));
  const churnCount = log.filter((e) => CHURN_EVENT_TYPES.has(e.type)).length;
  const meaningfulTypes = types.size - [...types].filter((t) => CHURN_EVENT_TYPES.has(t)).length;

  const emergence = computeEmergence(log);
  const knowledgeGrowth = a.endBeliefs - a.startBeliefs;

  return {
    template,
    ticks,
    eventCount: log.length,
    determinism,
    distinctTypes: types.size,
    totalRegisteredTypes: Object.keys(EventType).length,
    meaningfulTypes,
    idleRatio: log.length === 0 ? 0 : churnCount / log.length,
    emergence,
    knowledgeGrowth,
    ruleCoverage: a.coverage,
    seenEventTypes: types,
  };
}

/**
 * Build the health report. Honesty/presentation must come from a measured
 * source (the scenario-library audit rates) — they are never fabricated here.
 */
export function buildHealthReport(
  probe: LivingProbeResult,
  deadRules = 0,
  playerQuality: { readonly informationHonesty: number; readonly presentation: number },
): HealthReport {
  const crossSystemRatio = probe.emergence.chains === 0 ? 0 : probe.emergence.crossSystemChains / probe.emergence.chains;
  const knowledgeNorm = Math.min(1, probe.knowledgeGrowth / 10);
  const firedRules = probe.ruleCoverage.fired.size;
  const ruleReachability = probe.ruleCoverage.total === 0 ? 0 : firedRules / probe.ruleCoverage.total;
  const diversityRate = probe.distinctTypes / (probe.totalRegisteredTypes || 1);
  const narrativeDiversity = probe.meaningfulTypes / (probe.totalRegisteredTypes || 1);

  // Livingness: average of the four "is the world alive" signals.
  const livingness = (diversityRate + crossSystemRatio + knowledgeNorm + ruleReachability) / 4;

  return {
    commit: currentCommit(),
    probe: { template: probe.template, ticks: probe.ticks, eventCount: probe.eventCount },
    metrics: {
      livingness,
      emergence: crossSystemRatio,
      ruleReachability,
      informationHonesty: playerQuality.informationHonesty,
      presentation: playerQuality.presentation,
      narrativeDiversity,
      knowledgeGrowth: knowledgeNorm,
      idleSimulation: probe.idleRatio,
      averageChainDepth: probe.emergence.avgChainDepth,
      deadRules,
    },
    determinism: probe.determinism,
    emergence: probe.emergence,
    diversityRate,
    idleRatio: probe.idleRatio,
  };
}
