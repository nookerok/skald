/**
 * Benchmark Common — shared types and utilities (ADR-0020).
 */

export interface BenchmarkEnvironment {
  readonly commit: string;
  readonly hostname: string;
  readonly nodeVersion: string;
  readonly dbEvents: number;
  readonly dbBytes: number;
  readonly worldCount: number;
  readonly timestamp: string;
}

export interface ReplayMetrics {
  readonly dbOpenMs: number;
  readonly eventLoadMs: number;
  readonly worldReplayMs: number;
  readonly spatialReplayMs: number;
  readonly observerIndexMs: number;
  readonly readinessMs: number;
  readonly eventCount: number;
  readonly dbBytes: number;
  readonly rssBytes: number;
  readonly digestMatch: boolean;
}

export interface DTOMetrics {
  readonly route: string;
  readonly statusCode: number;
  readonly rawBytes: number;
  readonly gzipBytes: number;
  readonly parseMs: number;
  readonly revision: number;
  readonly forbiddenFieldCount: number;
  readonly forbiddenFields: readonly string[];
}

export interface LatencyMetrics {
  readonly route: string;
  readonly cold: { readonly min: number; readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number; readonly errors: number };
  readonly warm: { readonly min: number; readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number; readonly errors: number };
}

export interface MemoryMetrics {
  readonly rssBytes: number;
  readonly heapUsedBytes: number;
  readonly heapTotalBytes: number;
  readonly externalBytes: number;
}

export interface BenchmarkReport {
  readonly environment: BenchmarkEnvironment;
  readonly replay: ReplayMetrics;
  readonly dtoSize: readonly DTOMetrics[];
  readonly latency: readonly LatencyMetrics[];
  readonly memory: MemoryMetrics;
  readonly browserQA: { readonly desktop: "PASS" | "FAIL" | "BLOCKED"; readonly mobile: "PASS" | "FAIL" | "BLOCKED" };
  readonly pass: boolean;
  readonly failures: readonly string[];
}

/** Forbidden fields that must not appear in observer DTOs */
export const FORBIDDEN_FIELDS = [
  "eventId",
  "causationId",
  "activeSituations",
  "fullRegion",
  "tiles",
  "cells",
  "riverProcesses",
  "riverStates",
  "crossingDefinitions",
  "crossingStates",
  "travelRelations",
  "pendingChecks",
  "heatSources",
  "heatMap",
  "burnedTrees",
  "strategy",
  "lastActionTick",
] as const;

/** Performance budgets */
export const BUDGETS = {
  replayColdMs: 10_000,
  replayWarmMs: 5_000,
  mapWarmP95Ms: 250,
  mapColdP95Ms: 750,
  healthP95Ms: 50,
  stateP95Ms: 150,
  observerSessionP95Ms: 500,
  maxDtoBytes: 250 * 1024,
  maxRssBytes: 256 * 1024 * 1024,
} as const;

/**
 * Scan a DTO for forbidden fields.
 * Returns list of found forbidden field names.
 */
export function scanForForbiddenFields(dto: unknown, forbidden: readonly string[]): string[] {
  const found: string[] = [];
  if (dto === null || dto === undefined || typeof dto !== "object") return found;

  if (Array.isArray(dto)) {
    for (const item of dto) {
      found.push(...scanForForbiddenFields(item, forbidden));
    }
    return found;
  }

  for (const key of Object.keys(dto as Record<string, unknown>)) {
    if (forbidden.includes(key)) {
      found.push(key);
    }
    const value = (dto as Record<string, unknown>)[key];
    if (value && typeof value === "object") {
      found.push(...scanForForbiddenFields(value, forbidden));
    }
  }

  return [...new Set(found)];
}

/**
 * Compute gzip size of a string (approximate using deflate).
 * For accurate measurement, use zlib in the actual benchmark.
 */
export function estimateGzipSize(json: string): number {
  // Rough estimate: gzip overhead + ~30% compression for JSON
  return Math.ceil(json.length * 0.35);
}

/**
 * Compute percentiles from a sorted array.
 */
export function percentiles(sorted: readonly number[]): { min: number; p50: number; p95: number; p99: number; max: number } {
  if (sorted.length === 0) return { min: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  return {
    min: sorted[0]!,
    p50: sorted[Math.floor(sorted.length * 0.5)]!,
    p95: sorted[Math.floor(sorted.length * 0.95)]!,
    p99: sorted[Math.floor(sorted.length * 0.99)]!,
    max: sorted[sorted.length - 1]!,
  };
}
