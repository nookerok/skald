/**
 * Latency Benchmark — measures API response times (ADR-0020 §7).
 */

import { performance } from "node:perf_hooks";
import type { LatencyMetrics } from "./common.js";
import { percentiles } from "./common.js";

export interface LatencyBenchmarkOptions {
  readonly baseUrl: string;
  readonly worldId: string;
  readonly route: string;
  readonly coldRuns: number;
  readonly warmRuns: number;
}

/**
 * Measure latency for a single endpoint.
 */
async function measureLatency(
  baseUrl: string,
  route: string,
  runs: number,
): Promise<{ min: number; p50: number; p95: number; p99: number; max: number; errors: number }> {
  const times: number[] = [];
  let errors = 0;

  for (let i = 0; i < runs; i++) {
    try {
      const t0 = performance.now();
      const response = await fetch(`${baseUrl}${route}`);
      await response.text();
      const elapsed = performance.now() - t0;

      if (response.ok) {
        times.push(elapsed);
      } else {
        errors++;
      }
    } catch {
      errors++;
    }
  }

  times.sort((a, b) => a - b);
  const p = percentiles(times);
  return { ...p, errors };
}

/**
 * Run latency benchmark for a single endpoint.
 */
export async function runLatencyBenchmark(options: LatencyBenchmarkOptions): Promise<LatencyMetrics> {
  const formattedRoute = options.route.replace(":id", options.worldId);

  // Cold requests (first request after idle)
  const cold = await measureLatency(options.baseUrl, formattedRoute, options.coldRuns);

  // Warm requests (consecutive)
  const warm = await measureLatency(options.baseUrl, formattedRoute, options.warmRuns);

  return {
    route: formattedRoute,
    cold,
    warm,
  };
}
