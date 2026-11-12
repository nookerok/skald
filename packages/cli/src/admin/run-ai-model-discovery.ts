/**
 * One bounded discovery scan. Intended for the systemd oneshot and local
 * diagnostics; it writes sanitized evidence only and never touches world DB.
 */

import { AIDiscoveryCoordinator } from "./ai-discovery-coordinator.js";

function triggerFromArgs(): "daily" | "manual" {
  const value = process.argv.find((arg) => arg.startsWith("--trigger="))?.slice("--trigger=".length) ?? "daily";
  if (value !== "daily" && value !== "manual") throw new Error("--trigger must be daily or manual");
  return value;
}

const coordinator = new AIDiscoveryCoordinator();
const result = await coordinator.refresh(triggerFromArgs());
const snapshot = await coordinator.store.snapshot();
const output = {
  schema: "SKALD_AI_DISCOVERY_CLI_V1",
  state: result.state,
  runId: result.runId ?? null,
  reportSha256: result.reportSha256 ?? null,
  status: result.report?.status ?? snapshot.lastAttempt?.status ?? "unknown",
  freshness: snapshot.freshness,
  nextRunAt: snapshot.nextRunAt,
  candidates: result.report?.candidates.length ?? 0,
  screeningPass: result.report?.candidates.filter((candidate) => candidate.screening === "pass").length ?? 0,
  screeningFailed: result.report?.candidates.filter((candidate) => candidate.screening === "fail").length ?? 0,
  screeningNotRun: result.report?.candidates.filter((candidate) => candidate.screening === "not_run").length ?? 0,
  providerCallCount: result.report?.providerCallCount ?? 0,
};
process.stdout.write(JSON.stringify(output) + "\n");
if (result.state !== "complete" || result.report?.status !== "complete") process.exitCode = 1;
