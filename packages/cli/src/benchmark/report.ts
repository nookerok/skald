/**
 * Benchmark Report — generates formatted reports (ADR-0020 §10).
 */

import type { BenchmarkReport } from "./common.js";
import { BUDGETS } from "./common.js";

/**
 * Format a benchmark report as markdown.
 */
export function formatReport(report: BenchmarkReport): string {
  const lines: string[] = [];

  lines.push("# Orange Pi Benchmark Report");
  lines.push("");
  lines.push(`**Commit:** ${report.environment.commit}`);
  lines.push(`**Device:** ${report.environment.hostname}`);
  lines.push(`**Node:** ${report.environment.nodeVersion}`);
  lines.push(`**DB events:** ${report.environment.dbEvents}`);
  lines.push(`**DB size:** ${(report.environment.dbBytes / 1024 / 1024).toFixed(1)} MiB`);
  lines.push(`**Worlds:** ${report.environment.worldCount}`);
  lines.push(`**Timestamp:** ${report.environment.timestamp}`);
  lines.push("");

  // Replay
  lines.push("## Replay");
  lines.push("");
  lines.push(`| Metric | Value | Budget | Status |`);
  lines.push(`|--------|-------|--------|--------|`);
  lines.push(`| Cold p95 | ${report.replay.dbOpenMs.toFixed(0)}ms | < ${BUDGETS.replayColdMs}ms | ${report.replay.readinessMs < BUDGETS.replayColdMs ? "PASS" : "FAIL"} |`);
  lines.push(`| Warm p95 | ${report.replay.worldReplayMs.toFixed(0)}ms | < ${BUDGETS.replayWarmMs}ms | ${report.replay.worldReplayMs < BUDGETS.replayWarmMs ? "PASS" : "FAIL"} |`);
  lines.push(`| RSS peak | ${(report.replay.rssBytes / 1024 / 1024).toFixed(1)} MiB | < ${(BUDGETS.maxRssBytes / 1024 / 1024).toFixed(0)} MiB | ${report.replay.rssBytes < BUDGETS.maxRssBytes ? "PASS" : "FAIL"} |`);
  lines.push(`| Events | ${report.replay.eventCount} | - | - |`);
  lines.push(`| Digest equality | ${report.replay.digestMatch ? "PASS" : "FAIL"} | PASS | ${report.replay.digestMatch ? "PASS" : "FAIL"} |`);
  lines.push("");

  // DTO Size
  lines.push("## DTO Size");
  lines.push("");
  lines.push(`| Endpoint | Raw | Gzip | Forbidden | Status |`);
  lines.push(`|----------|-----|------|-----------|--------|`);
  for (const dto of report.dtoSize) {
    const sizeStatus = dto.rawBytes <= BUDGETS.maxDtoBytes ? "PASS" : "FAIL";
    const privacyStatus = dto.forbiddenFieldCount === 0 ? "PASS" : "FAIL";
    lines.push(`| ${dto.route} | ${(dto.rawBytes / 1024).toFixed(1)} KiB | ${(dto.gzipBytes / 1024).toFixed(1)} KiB | ${dto.forbiddenFieldCount} | ${sizeStatus}/${privacyStatus} |`);
  }
  lines.push("");

  // Latency
  lines.push("## Latency");
  lines.push("");
  lines.push(`| Endpoint | Cold p95 | Warm p95 | Errors |`);
  lines.push(`|----------|----------|----------|--------|`);
  for (const lat of report.latency) {
    const coldStatus = lat.cold.p95 < BUDGETS.mapColdP95Ms ? "PASS" : "FAIL";
    const warmStatus = lat.warm.p95 < BUDGETS.mapWarmP95Ms ? "PASS" : "FAIL";
    lines.push(`| ${lat.route} | ${lat.cold.p95.toFixed(0)}ms (${coldStatus}) | ${lat.warm.p95.toFixed(0)}ms (${warmStatus}) | ${lat.cold.errors + lat.warm.errors} |`);
  }
  lines.push("");

  // Memory
  lines.push("## Memory");
  lines.push("");
  lines.push(`| Metric | Value | Budget | Status |`);
  lines.push(`|--------|-------|--------|--------|`);
  lines.push(`| RSS | ${(report.memory.rssBytes / 1024 / 1024).toFixed(1)} MiB | < ${(BUDGETS.maxRssBytes / 1024 / 1024).toFixed(0)} MiB | ${report.memory.rssBytes < BUDGETS.maxRssBytes ? "PASS" : "FAIL"} |`);
  lines.push(`| Heap used | ${(report.memory.heapUsedBytes / 1024 / 1024).toFixed(1)} MiB | - | - |`);
  lines.push("");

  // Browser QA
  lines.push("## Browser QA");
  lines.push("");
  lines.push(`| Viewport | Status |`);
  lines.push(`|----------|--------|`);
  lines.push(`| Desktop (1440×900) | ${report.browserQA.desktop} |`);
  lines.push(`| Mobile (390×844) | ${report.browserQA.mobile} |`);
  lines.push("");

  // Overall
  lines.push("## Result");
  lines.push("");
  lines.push(`**${report.pass ? "PASS" : "FAIL"}**`);
  if (report.failures.length > 0) {
    lines.push("");
    lines.push("### Failures");
    for (const f of report.failures) {
      lines.push(`- ${f}`);
    }
  }

  return lines.join("\n");
}

/**
 * Generate a machine-readable JSON report.
 */
export function formatJSONReport(report: BenchmarkReport): string {
  return JSON.stringify(report, null, 2);
}
