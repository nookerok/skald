/**
 * HTML report renderer (packages/cli/src/eval/html.ts).
 *
 * Self-contained, deterministic HTML (inline CSS, no external assets) so the
 * Simulation Quality Report can be committed or attached to CI runs and
 * diffed between commits.
 */

import type { QualityReport } from "./types.js";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function bar(value: number): string {
  const width = Math.max(0, Math.min(100, Math.round(value * 100)));
  const color = value >= 0.9 ? "#2ecc71" : value >= 0.6 ? "#f1c40f" : "#e74c3c";
  return `<div class="bar"><div class="fill" style="width:${width}%;background:${color}"></div></div>`;
}

export function renderHtml(report: QualityReport): string {
  const metricRows = (Object.entries(report.metrics) as Array<[string, number]>)
    .map(([key, value]) => `<tr><td>${key}</td><td class="num">${pct(value)}</td><td>${bar(value)}</td></tr>`)
    .join("");

  const scenarioRows = report.perScenario
    .map((s) => {
      const checks = [
        ["pass", s.pass], ["determinism", s.determinism], ["purity", s.purity],
        ["no-leak", s.noTruthLeak], ["honest", s.presentationHonest], ["idem", s.idempotency],
      ].map(([label, ok]) => `<span class="chip ${ok ? "ok" : "bad"}">${label}: ${ok ? "✓" : "✗"}</span>`).join(" ");
      return `<tr><td>${s.name}</td><td>${(s.tags ?? []).join(", ")}</td><td class="num">${s.stepCount}</td><td class="num">${s.eventCount}</td><td class="num">${pct(s.ruleCoverage)}</td><td>${checks}</td></tr>`;
    })
    .join("");

  const ruleRows = report.ruleCoverage
    .map((r) => `<tr class="${r.totalFired > 0 ? "" : "unused"}"><td>${r.ruleId}</td><td>${r.phase}</td><td class="num">${r.scenariosFired}</td><td class="num">${r.totalFired}</td><td>${r.totalFired > 0 ? "✓" : "✗"}</td></tr>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>Skald Simulation Quality Report</title>
<style>
  body{font-family:system-ui,sans-serif;margin:2rem;color:#1b2a33;background:#f6f8f9}
  h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:2rem}
  table{border-collapse:collapse;width:100%;margin-top:.5rem;font-size:.85rem}
  th,td{border:1px solid #cfd8dc;padding:.4rem .6rem;text-align:left;vertical-align:top}
  th{background:#e3eaee}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .bar{width:120px;height:8px;background:#e0e6ea;border-radius:4px;overflow:hidden}
  .fill{height:100%}
  .chip{display:inline-block;font-size:.72rem;padding:.05rem .35rem;border-radius:3px;margin-right:.25rem}
  .ok{background:#e8f8ee;color:#1e7a3a}.bad{background:#fdecea;color:#b3261e}
  tr.unused td{color:#9aa7ad}
  .meta{color:#5b6a72;font-size:.8rem}
</style></head><body>
<h1>Skald — Simulation Quality Report</h1>
<p class="meta">commit: <code>${report.commit}</code> · scenarios: ${report.scenarioCount} · registered rules: ${report.totalRules}</p>
<h2>Metrics</h2>
<table><tr><th>Metric</th><th>Value</th><th></th></tr>${metricRows}</table>
<h2>Rule Coverage</h2>
<table><tr><th>Rule</th><th>Phase</th><th>Scenarios</th><th>Fired</th><th>Used</th></tr>${ruleRows}</table>
<h2>Scenarios</h2>
<table><tr><th>Scenario</th><th>Tags</th><th>Steps</th><th>Events</th><th>Rule cov</th><th>Checks</th></tr>${scenarioRows}</table>
</body></html>`;
}
