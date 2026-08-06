/**
 * Rule Dependency Graph and reachability classification
 * (packages/cli/src/eval/rule-graph.ts).
 *
 * Builds rule -> event -> rule edges from the registered composition and from
 * what a long probe actually fired, then classifies every rule:
 *
 *   critical  fired in most scenarios (core, high-usage)
 *   common    fired in two or more scenarios
 *   rare      fired in exactly one scenario
 *   dormant   never fired, but one of its trigger event types occurred — a
 *             missing scenario or an unmet value precondition
 *   dead      never fired and none of its trigger event types ever occurred —
 *             unreachable in current content
 *
 * The graph and classification are deterministic.
 */

import { createRules } from "@skald/world";
import type { RuleCoverage } from "./types.js";

export type RuleStatus = "dead" | "dormant" | "rare" | "common" | "critical";

export interface RuleGraphNode {
  readonly id: string;
  readonly kind: "rule" | "event";
}

export interface RuleGraphEdge {
  readonly from: string;
  readonly to: string;
  readonly label: "listens" | "produces";
}

export interface RuleClassificationEntry {
  readonly ruleId: string;
  readonly phase: string;
  readonly listens: readonly string[];
  readonly produces: readonly string[];
  readonly status: RuleStatus;
  readonly scenariosFired: number;
  readonly totalFired: number;
}

export interface RuleGraph {
  readonly nodes: readonly RuleGraphNode[];
  readonly edges: readonly RuleGraphEdge[];
  readonly classification: readonly RuleClassificationEntry[];
}

interface RuleInfo {
  id: string;
  phase: string;
  listens: string[];
  produces: string[];
}

function ruleInventory(): RuleInfo[] {
  return createRules().listRules().map((rule) => ({
    id: rule.id,
    phase: rule.phase,
    listens: [...rule.listens],
    produces: [...rule.produces],
  }));
}

/**
 * Build the static dependency graph: every registered rule with its listens/
 * produces edges, plus a classification seeded from observed firing data and
 * the set of event types that actually occurred.
 */
export function buildRuleGraph(
  firedCounts: ReadonlyMap<string, number>,
  scenariosFired: ReadonlyMap<string, number>,
  seenEventTypes: ReadonlySet<string>,
): RuleGraph {
  const rules = ruleInventory();
  const nodes = new Map<string, RuleGraphNode>();
  const edges: RuleGraphEdge[] = [];

  for (const rule of rules) {
    nodes.set(`rule:${rule.id}`, { id: `rule:${rule.id}`, kind: "rule" });
    for (const type of rule.listens) {
      nodes.set(`event:${type}`, { id: `event:${type}`, kind: "event" });
      edges.push({ from: `event:${type}`, to: `rule:${rule.id}`, label: "listens" });
    }
    for (const type of rule.produces) {
      nodes.set(`event:${type}`, { id: `event:${type}`, kind: "event" });
      edges.push({ from: `rule:${rule.id}`, to: `event:${type}`, label: "produces" });
    }
  }

  const classification = rules.map((rule) => {
    const totalFired = firedCounts.get(rule.id) ?? 0;
    const firedIn = scenariosFired.get(rule.id) ?? 0;
    let status: RuleStatus;
    if (totalFired > 0 && firedIn >= 2) status = "common";
    else if (totalFired > 0) status = "rare";
    else if (rule.listens.some((type) => seenEventTypes.has(type))) status = "dormant";
    else status = "dead";
    return {
      ruleId: rule.id,
      phase: rule.phase,
      listens: rule.listens,
      produces: rule.produces,
      status,
      scenariosFired: firedIn,
      totalFired,
    };
  });

  return { nodes: [...nodes.values()], edges, classification };
}

/**
 * Resolve which event types a probe log actually produced so the classification
 * can tell "dormant (trigger seen, precondition unmet)" from "dead".
 */
export function seenEventTypesFromCoverage(coverage: RuleCoverage): Set<string> {
  const seen = new Set<string>();
  for (const types of coverage.produced.values()) for (const type of types) seen.add(type);
  return seen;
}
