/**
 * DTO Size Benchmark — measures response sizes and privacy (ADR-0020 §6).
 */

import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import type { DTOMetrics } from "./common.js";
import { FORBIDDEN_FIELDS, scanForForbiddenFields } from "./common.js";

export interface DTOSizeBenchmarkOptions {
  readonly baseUrl: string;
  readonly worldId: string;
  readonly routes: readonly string[];
}

/**
 * Measure DTO size for a single endpoint.
 */
async function measureDTOSize(
  baseUrl: string,
  route: string,
): Promise<DTOMetrics> {
  const t0 = performance.now();
  const response = await fetch(`${baseUrl}${route}`);
  const parseMs = performance.now() - t0;

  if (!response.ok) {
    return {
      route,
      statusCode: response.status,
      rawBytes: 0,
      gzipBytes: 0,
      parseMs,
      revision: 0,
      forbiddenFieldCount: 0,
      forbiddenFields: [],
    };
  }

  const rawText = await response.text();
  const rawBytes = Buffer.byteLength(rawText, "utf-8");

  // Gzip size
  const gzipBuffer = gzipSync(Buffer.from(rawText, "utf-8"));
  const gzipBytes = gzipBuffer.length;

  // Parse to check for forbidden fields
  let dto: unknown;
  try {
    dto = JSON.parse(rawText);
  } catch {
    return {
      route,
      statusCode: response.status,
      rawBytes,
      gzipBytes,
      parseMs,
      revision: 0,
      forbiddenFieldCount: 0,
      forbiddenFields: [],
    };
  }

  const forbiddenFields = scanForForbiddenFields(dto, FORBIDDEN_FIELDS as unknown as string[]);
  const revision = (dto as Record<string, unknown>)?.revision as number ?? 0;

  return {
    route,
    statusCode: response.status,
    rawBytes,
    gzipBytes,
    parseMs,
    revision,
    forbiddenFieldCount: forbiddenFields.length,
    forbiddenFields,
  };
}

/**
 * Run DTO size benchmark for all configured routes.
 */
export async function runDTOSizeBenchmark(options: DTOSizeBenchmarkOptions): Promise<readonly DTOMetrics[]> {
  const results: DTOMetrics[] = [];

  for (const route of options.routes) {
    const formattedRoute = route.replace(":id", options.worldId);
    const metrics = await measureDTOSize(options.baseUrl, formattedRoute);
    results.push(metrics);
  }

  return results;
}
