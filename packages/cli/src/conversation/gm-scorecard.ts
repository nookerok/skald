/**
 * Conversation Director shadow scorecard (SKALD S0).
 *
 * A pure, reproducible scorer: one fixed corpus, one decision per replica, six
 * separately reported dimensions (schema validity, addressee, kind, handles,
 * latency, fallback). It never scores prose quality and never executes.
 */

import type { GmDirectorTrace } from "../runtime/conversation-director.js";
import type { GmTurnDecision } from "@skald/intent-parser";

export interface GmScoreExpectation {
  readonly addresseeKind: "gm" | "npc" | "meta";
  readonly kind: string;
  /** Allowed actor handles for this replica (server-assigned). */
  readonly allowedHandles?: readonly string[];
}

export interface GmScoreEntry {
  readonly input: string;
  readonly expected: GmScoreExpectation;
  readonly trace: GmDirectorTrace;
  readonly decision?: GmTurnDecision | undefined;
}

export interface GmDimensionResult {
  readonly dimension: string;
  readonly total: number;
  readonly passed: number;
  readonly failures: readonly string[];
}

export interface GmScorecard {
  readonly contractVersion: number;
  readonly corpusSize: number;
  readonly schemaValid: number;
  readonly decision: number;
  readonly fallback: number;
  readonly p50LatencyMs: number | null;
  readonly p95LatencyMs: number | null;
  readonly dimensions: readonly GmDimensionResult[];
}

function percentile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** Score one entry against its expectation across every dimension. */
export function scoreGmCorpus(entries: readonly GmScoreEntry[]): GmScorecard {
  const dims: Record<string, { total: number; passed: number; failures: string[] }> = {
    schema: { total: 0, passed: 0, failures: [] },
    addressee: { total: 0, passed: 0, failures: [] },
    kind: { total: 0, passed: 0, failures: [] },
    handles: { total: 0, passed: 0, failures: [] },
  };
  const latencies: number[] = [];
  let decision = 0;
  let fallback = 0;

  for (const entry of entries) {
    dims.schema.total += 1;
    if (entry.trace.schemaValid) dims.schema.passed += 1;
    else dims.schema.failures.push(entry.input);
    if (entry.trace.totalLatencyMs > 0) latencies.push(entry.trace.totalLatencyMs);

    if (!entry.decision) {
      fallback += 1;
      continue;
    }
    decision += 1;
    const decisionValue = entry.decision;

    dims.addressee.total += 1;
    if (decisionValue.addressee.kind === entry.expected.addresseeKind) dims.addressee.passed += 1;
    else dims.addressee.failures.push(entry.input);

    dims.kind.total += 1;
    if (decisionValue.kind === entry.expected.kind) dims.kind.passed += 1;
    else dims.kind.failures.push(entry.input);

    dims.handles.total += 1;
    if (decisionValue.addressee.kind !== "npc") {
      dims.handles.passed += 1;
    } else {
      const handle = (decisionValue.addressee as { handle?: string }).handle;
      const allowed = entry.expected.allowedHandles ?? [];
      if (typeof handle === "string" && allowed.includes(handle)) dims.handles.passed += 1;
      else dims.handles.failures.push(entry.input);
    }
  }

  latencies.sort((a, b) => a - b);
  return {
    contractVersion: entries[0]?.trace.contractVersion ?? 0,
    corpusSize: entries.length,
    schemaValid: dims.schema.passed,
    decision,
    fallback,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    dimensions: Object.entries(dims).map(([dimension, d]) => ({
      dimension, total: d.total, passed: d.passed, failures: Object.freeze([...d.failures]),
    })),
  };
}
