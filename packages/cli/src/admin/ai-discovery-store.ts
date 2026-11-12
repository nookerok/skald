/** Durable, secret-free storage and a process-safe lock for model discovery. */

import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { link, mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import type { AITaskEvaluationReport } from "./ai-task-evaluation.js";

export const AI_DISCOVERY_RUN_SCHEMA = "SKALD_AI_DISCOVERY_RUN_V1" as const;
export const AI_DISCOVERY_STALE_AFTER_MS = 36 * 60 * 60 * 1000;
export const AI_DISCOVERY_HISTORY_LIMIT = 30;
const RUN_ID_RE = /^\d{8}T\d{6}Z-[0-9a-f-]{36}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;

export interface DiscoveryRunReceipt {
  readonly schema: typeof AI_DISCOVERY_RUN_SCHEMA;
  readonly runId: string;
  readonly trigger: "daily" | "manual";
  readonly requestId?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly commit: string | null;
  readonly credentialGeneration: string;
  readonly evidenceDigest: string;
  readonly report: Readonly<Record<string, unknown>>;
}

export interface DiscoveryLastAttempt {
  readonly runId: string;
  readonly trigger: "daily" | "manual";
  readonly requestId?: string;
  readonly status: "running" | "complete" | "partial" | "blocked" | "failed" | "incomplete";
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly reportSha256?: string;
  readonly reason?: "environment_invalid" | "catalog_failed" | "screening_failed" | "write_failed";
}

export interface DiscoveryStoreSnapshot {
  readonly lastAttempt: DiscoveryLastAttempt | null;
  readonly latestManualRequest: ManualDiscoveryRequestStatus | null;
  readonly latestRun: DiscoveryRunReceipt | null;
  readonly latestSuccessfulRun: DiscoveryRunReceipt | null;
  readonly latestFailedRun: DiscoveryRunReceipt | null;
  readonly latestRunSha256: string | null;
  readonly latestDecision: AIDiscoveryDecisionReceipt | null;
  readonly latestTaskEvaluation: AITaskEvaluationSnapshot | null;
  readonly freshness: "missing" | "fresh" | "stale";
  readonly successAgeMs: number | null;
  readonly schedule: {
    readonly owner: "systemd_timer";
    readonly localTime: "04:00";
    readonly timezone: "Europe/Moscow";
    readonly installationState: "externally_managed_unverified";
  };
  readonly nextRunAt: string;
}

export interface AITaskEvaluationRequestStatus {
  readonly evaluationId: string;
  readonly decisionId: string;
  readonly candidateId: string;
  readonly acceptedAt: string;
  readonly updatedAt: string;
  readonly status: "accepted" | "running" | "complete" | "partial" | "blocked" | "failed" | "incomplete";
  readonly runId?: string;
  readonly reportSha256?: string;
}

export interface AITaskEvaluationSnapshot {
  readonly request: AITaskEvaluationRequestStatus;
  readonly report: AITaskEvaluationReport | null;
  readonly reportSha256: string | null;
}

export interface ManualDiscoveryRequestStatus {
  readonly requestId: string;
  readonly acceptedAt: string;
  readonly updatedAt: string;
  readonly status: "accepted" | "running" | "complete" | "partial" | "blocked" | "failed" | "incomplete";
  readonly runId?: string;
  readonly sharedExecution?: boolean;
}

export interface AIDiscoveryDecisionReceipt {
  readonly schema: "SKALD_AI_DISCOVERY_DECISION_V1";
  readonly decisionId: string;
  readonly requestId: string;
  readonly runId: string;
  readonly reportSha256: string;
  readonly candidateId: string;
  readonly decision: "nominate_for_task_evaluation" | "reject";
  readonly decidedAt: string;
}

export interface LockOwner {
  readonly pid: number;
  readonly host: string;
  readonly nonce: string;
  readonly startedAt: string;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

async function writeAtomic(path: string, text: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, "." + basename(path) + "." + process.pid + "." + randomUUID() + ".tmp");
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporary, path);
    await fsyncDirectory(directory);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function writeImmutable(path: string, text: string): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, "." + basename(path) + "." + process.pid + "." + randomUUID() + ".tmp");
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, path);
    await unlink(temporary);
    await fsyncDirectory(directory);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function moscowParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

/** Resolve the next daily 04:00 Europe/Moscow occurrence as an ISO instant. */
export function nextAiDiscoveryRunAt(now = new Date()): string {
  const local = moscowParts(now);
  let targetLocalUtc = Date.UTC(local.year, local.month - 1, local.day, 4, 0, 0);
  const nowLocalUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  if (targetLocalUtc <= nowLocalUtc) targetLocalUtc += 24 * 60 * 60 * 1000;
  let guess = targetLocalUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const inMoscow = moscowParts(new Date(guess));
    const representedLocalUtc = Date.UTC(inMoscow.year, inMoscow.month - 1, inMoscow.day, inMoscow.hour, inMoscow.minute, inMoscow.second);
    const adjusted = guess + (targetLocalUtc - representedLocalUtc);
    if (Math.abs(adjusted - guess) < 1000) return new Date(guess).toISOString();
    guess = adjusted;
  }
  return new Date(guess).toISOString();
}

/** Read and verify a completed immutable report and its final receipt. */
async function readCompletedRun(directory: string, runId: string): Promise<DiscoveryRunReceipt | null> {
  if (!RUN_ID_RE.test(runId)) return null;
  const runs = join(directory, "runs");
  try {
    const values = await Promise.all([
      readFile(join(runs, runId + ".json"), "utf8"),
      readFile(join(runs, runId + ".sha256"), "utf8"),
      readFile(join(runs, runId + ".complete.json"), "utf8"),
    ]);
    const reportText = values[0]!;
    const expectedHash = values[1]!.trim();
    if (!SHA256_RE.test(expectedHash) || sha256(reportText) !== expectedHash) return null;
    const receipt = JSON.parse(values[2]!) as { runId?: unknown; reportSha256?: unknown };
    if (receipt.runId !== runId || receipt.reportSha256 !== expectedHash) return null;
    const parsed = JSON.parse(reportText) as DiscoveryRunReceipt;
    if (parsed.schema !== AI_DISCOVERY_RUN_SCHEMA || parsed.runId !== runId) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readCompletedDecision(directory: string, decisionId: string): Promise<AIDiscoveryDecisionReceipt | null> {
  if (!SHA256_RE.test(decisionId)) return null;
  const decisions = join(directory, "decisions");
  try {
    const values = await Promise.all([
      readFile(join(decisions, decisionId + ".json"), "utf8"),
      readFile(join(decisions, decisionId + ".sha256"), "utf8"),
      readFile(join(decisions, decisionId + ".complete.json"), "utf8"),
    ]);
    const text = values[0]!;
    const expectedHash = values[1]!.trim();
    if (!SHA256_RE.test(expectedHash) || sha256(text) !== expectedHash) return null;
    const marker = JSON.parse(values[2]!) as { decisionId?: unknown; reportSha256?: unknown };
    if (marker.decisionId !== decisionId || marker.reportSha256 !== expectedHash) return null;
    const parsed = JSON.parse(text) as AIDiscoveryDecisionReceipt;
    return parsed.schema === "SKALD_AI_DISCOVERY_DECISION_V1"
      && parsed.decisionId === decisionId
      && parsed.requestId === decisionId ? parsed : null;
  } catch {
    return null;
  }
}

async function readTaskEvaluationRequest(directory: string, evaluationId: string): Promise<{ readonly text: string; readonly value: AITaskEvaluationRequestStatus } | null> {
  try {
    const text = await readFile(join(directory, "task-evaluations", "requests", evaluationId + ".json"), "utf8");
    const value = JSON.parse(text) as AITaskEvaluationRequestStatus;
    if (value.evaluationId !== evaluationId || value.decisionId !== evaluationId
      || !SHA256_RE.test(value.evaluationId) || typeof value.candidateId !== "string"
      || typeof value.runId !== "string" || !RUN_ID_RE.test(value.runId)
      || typeof value.reportSha256 !== "string" || !SHA256_RE.test(value.reportSha256)
      || typeof value.acceptedAt !== "string" || !Number.isFinite(Date.parse(value.acceptedAt))) return null;
    return { text, value };
  } catch {
    return null;
  }
}

async function readCompletedTaskEvaluationRequest(
  directory: string,
  evaluationId: string,
): Promise<{ readonly text: string; readonly value: AITaskEvaluationRequestStatus } | null> {
  const request = await readTaskEvaluationRequest(directory, evaluationId);
  if (!request) return null;
  const requestDirectory = join(directory, "task-evaluations", "requests");
  try {
    const [hashText, markerText] = await Promise.all([
      readFile(join(requestDirectory, evaluationId + ".sha256"), "utf8"),
      readFile(join(requestDirectory, evaluationId + ".complete.json"), "utf8"),
    ]);
    const digest = hashText.trim();
    const marker = JSON.parse(markerText) as { schema?: unknown; evaluationId?: unknown; requestSha256?: unknown };
    if (!SHA256_RE.test(digest) || sha256(request.text) !== digest
      || marker.schema !== "SKALD_AI_TASK_EVALUATION_REQUEST_COMPLETE_V1"
      || marker.evaluationId !== evaluationId || marker.requestSha256 !== digest) return null;
    return request;
  } catch {
    return null;
  }
}

async function readCompletedTaskEvaluation(
  directory: string,
  evaluationId: string,
  runId: string,
): Promise<{ readonly report: AITaskEvaluationReport; readonly reportSha256: string } | null> {
  if (!SHA256_RE.test(evaluationId)) return null;
  const request = await readCompletedTaskEvaluationRequest(directory, evaluationId);
  if (!request || !RUN_ID_RE.test(runId)) return null;
  const runs = join(directory, "task-evaluations", "runs");
  try {
    const [text, hashText, markerText] = await Promise.all([
      readFile(join(runs, runId + ".json"), "utf8"),
      readFile(join(runs, runId + ".sha256"), "utf8"),
      readFile(join(runs, runId + ".complete.json"), "utf8"),
    ]);
    const digest = hashText.trim();
    const marker = JSON.parse(markerText) as { schema?: unknown; evaluationId?: unknown; runId?: unknown; reportSha256?: unknown };
    const report = JSON.parse(text) as AITaskEvaluationReport;
    if (!SHA256_RE.test(digest) || sha256(text) !== digest
      || marker.schema !== "SKALD_AI_TASK_EVALUATION_COMPLETE_V1"
      || marker.evaluationId !== evaluationId || marker.runId !== runId || marker.reportSha256 !== digest
      || report.schema !== "SKALD_AI_TASK_EVALUATION_V1"
      || report.evidence.decisionId !== evaluationId
      || report.evidence.discoveryRunId !== request.value.runId
      || report.evidence.discoveryReportSha256 !== request.value.reportSha256
      || report.evidence.candidateId !== request.value.candidateId) return null;
    return { report, reportSha256: digest };
  } catch {
    return null;
  }
}

async function readManualRequestState(directory: string, requestId: string): Promise<ManualDiscoveryRequestStatus | null> {
  if (!SHA256_RE.test(requestId)) return null;
  try {
    const value = JSON.parse(await readFile(join(directory, "manual-requests", requestId + ".state.json"), "utf8")) as ManualDiscoveryRequestStatus;
    if (value.requestId !== requestId || typeof value.acceptedAt !== "string" || typeof value.updatedAt !== "string"
      || !["accepted", "running", "complete", "partial", "blocked", "failed", "incomplete"].includes(value.status)) return null;
    return value;
  } catch {
    return null;
  }
}

async function readManualRequestReceipt(directory: string, requestId: string): Promise<{ readonly acceptedAt: string; readonly text: string } | null> {
  if (!SHA256_RE.test(requestId)) return null;
  const path = join(directory, "manual-requests", requestId + ".json");
  try {
    const text = await readFile(path, "utf8");
    const receipt = JSON.parse(text) as { schema?: unknown; requestId?: unknown; acceptedAt?: unknown };
    if (receipt.schema !== "SKALD_AI_DISCOVERY_MANUAL_REQUEST_V1" || receipt.requestId !== requestId
      || typeof receipt.acceptedAt !== "string" || !Number.isFinite(Date.parse(receipt.acceptedAt))) return null;
    return { acceptedAt: receipt.acceptedAt, text };
  } catch {
    return null;
  }
}

async function readCompletedManualRequest(directory: string, requestId: string): Promise<{ readonly acceptedAt: string; readonly text: string } | null> {
  const receipt = await readManualRequestReceipt(directory, requestId);
  if (!receipt) return null;
  try {
    const [hashText, markerText] = await Promise.all([
      readFile(join(directory, "manual-requests", requestId + ".sha256"), "utf8"),
      readFile(join(directory, "manual-requests", requestId + ".complete.json"), "utf8"),
    ]);
    const digest = hashText.trim();
    const marker = JSON.parse(markerText) as { schema?: unknown; requestId?: unknown; requestSha256?: unknown };
    if (!SHA256_RE.test(digest) || sha256(receipt.text) !== digest
      || marker.schema !== "SKALD_AI_DISCOVERY_MANUAL_REQUEST_COMPLETE_V1"
      || marker.requestId !== requestId
      || (marker.requestSha256 !== undefined && marker.requestSha256 !== digest)) return null;
    return receipt;
  } catch {
    return null;
  }
}

function reportStatus(report: Readonly<Record<string, unknown>>): ManualDiscoveryRequestStatus["status"] {
  const status = report.status;
  return status === "complete" || status === "partial" || status === "blocked" || status === "failed"
    ? status : "failed";
}

/** Durable discovery history outside the canonical Event Log. */
export class AIDiscoveryStore {
  readonly directory: string;
  private readonly historyLimit: number;
  private readonly staleAfterMs: number;

  constructor(directory: string, options: { historyLimit?: number; staleAfterMs?: number } = {}) {
    this.directory = directory;
    this.historyLimit = Math.max(2, Math.floor(options.historyLimit ?? AI_DISCOVERY_HISTORY_LIMIT));
    this.staleAfterMs = Math.max(1, Math.floor(options.staleAfterMs ?? AI_DISCOVERY_STALE_AFTER_MS));
  }

  async begin(attempt: DiscoveryLastAttempt): Promise<void> {
    await mkdir(join(this.directory, "runs"), { recursive: true, mode: 0o700 });
    await writeAtomic(join(this.directory, "last-attempt.json"), JSON.stringify(attempt, null, 2) + "\n");
    if (attempt.trigger === "manual" && attempt.requestId) {
      await this.setManualRequestStatus(attempt.requestId, "running", attempt.startedAt, attempt.runId);
    }
  }

  /** Reserve an idempotency key for a loopback manual refresh without storing the key itself. */
  async reserveManualRequest(key: string, now = new Date()): Promise<{ readonly created: boolean; readonly requestId: string; readonly shouldStart: boolean }> {
    if (key.length < 16 || key.length > 200 || /[\u0000-\u0020]/u.test(key)) throw new Error("invalid idempotency key");
    const requestId = sha256(key);
    const directory = join(this.directory, "manual-requests");
    const receipt = {
      schema: "SKALD_AI_DISCOVERY_MANUAL_REQUEST_V1",
      requestId,
      acceptedAt: now.toISOString(),
    };
    const text = JSON.stringify(receipt, null, 2) + "\n";
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let created = true;
    try {
      await writeImmutable(join(directory, requestId + ".json"), text);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      created = false;
    }
    const stored = await readManualRequestReceipt(this.directory, requestId);
    if (!stored) throw new Error("manual discovery request receipt is invalid");
    const digest = sha256(stored.text);
    const hashPath = join(directory, requestId + ".sha256");
    let storedDigest: string | null = null;
    try { storedDigest = (await readFile(hashPath, "utf8")).trim(); } catch { /* recover incomplete reservation */ }
    if (storedDigest !== null && storedDigest !== digest) throw new Error("manual discovery request hash mismatch");
    if (storedDigest === null) await writeAtomic(hashPath, digest + "\n");
    const completePath = join(directory, requestId + ".complete.json");
    let completionValid = false;
    try {
      const marker = JSON.parse(await readFile(completePath, "utf8")) as { schema?: unknown; requestId?: unknown; requestSha256?: unknown };
      completionValid = marker.schema === "SKALD_AI_DISCOVERY_MANUAL_REQUEST_COMPLETE_V1"
        && marker.requestId === requestId
        && (marker.requestSha256 === undefined || marker.requestSha256 === digest);
      if (!completionValid) throw new Error("manual discovery request completion marker mismatch");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!completionValid) await writeAtomic(completePath, JSON.stringify({
      schema: "SKALD_AI_DISCOVERY_MANUAL_REQUEST_COMPLETE_V1",
      requestId,
      requestSha256: digest,
      acceptedAt: stored.acceptedAt,
    }, null, 2) + "\n");
    await fsyncDirectory(directory);
    let state = await readManualRequestState(this.directory, requestId);
    if (!state) {
      const completedRun = await this.findCompletedManualRun(requestId);
      state = completedRun
        ? {
          requestId,
          acceptedAt: stored.acceptedAt,
          updatedAt: completedRun.finishedAt,
          status: reportStatus(completedRun.report),
          runId: completedRun.runId,
        }
        : { requestId, acceptedAt: stored.acceptedAt, updatedAt: now.toISOString(), status: "accepted" };
      await writeAtomic(join(directory, requestId + ".state.json"), JSON.stringify(state, null, 2) + "\n");
      await writeAtomic(join(directory, "latest.json"), JSON.stringify({ requestId }, null, 2) + "\n");
    } else if (state.status === "running") {
      const completedRun = await this.findCompletedManualRun(requestId);
      if (completedRun) {
        state = await this.setManualRequestStatus(requestId, reportStatus(completedRun.report), completedRun.finishedAt, completedRun.runId);
      } else if (!await this.hasLiveRefreshLock()) {
        state = await this.setManualRequestStatus(requestId, "incomplete", now.toISOString(), state.runId);
      }
    }
    await writeAtomic(join(directory, "latest.json"), JSON.stringify({ requestId }, null, 2) + "\n");
    return { created, requestId, shouldStart: state.status === "accepted" || state.status === "incomplete" };
  }

  /**
   * Write immutable JSON, its SHA sidecar, and mutable pointers before writing
   * the completion receipt last. Readers ignore runs without that receipt.
   */
  async complete(run: DiscoveryRunReceipt, status: "complete" | "partial" | "blocked" | "failed"): Promise<string> {
    if (!RUN_ID_RE.test(run.runId)) throw new Error("invalid discovery run id");
    const runs = join(this.directory, "runs");
    await mkdir(runs, { recursive: true, mode: 0o700 });
    const text = JSON.stringify(run, null, 2) + "\n";
    const digest = sha256(text);
    const reportPath = join(runs, run.runId + ".json");
    await writeImmutable(reportPath, text);
    await writeAtomic(join(runs, run.runId + ".sha256"), digest + "\n");
    await writeAtomic(join(this.directory, "latest.json"), JSON.stringify({ runId: run.runId, reportSha256: digest }, null, 2) + "\n");
    await writeAtomic(join(this.directory, "last-attempt.json"), JSON.stringify({
      runId: run.runId,
      trigger: run.trigger,
      ...(run.requestId ? { requestId: run.requestId } : {}),
      status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      reportSha256: digest,
    } satisfies DiscoveryLastAttempt, null, 2) + "\n");
    await writeAtomic(join(runs, run.runId + ".complete.json"), JSON.stringify({
      schema: "SKALD_AI_DISCOVERY_COMPLETE_V1", runId: run.runId, reportSha256: digest, completedAt: run.finishedAt,
    }, null, 2) + "\n");
    await fsyncDirectory(runs);
    if (run.trigger === "manual" && run.requestId) {
      await this.setManualRequestStatus(run.requestId, status, run.finishedAt, run.runId).catch(() => undefined);
    }
    await this.pruneHistory();
    return digest;
  }

  /** Return a completed run only when report, digest, and final marker agree. */
  async getRun(runId: string): Promise<{ readonly receipt: DiscoveryRunReceipt; readonly reportSha256: string } | null> {
    const receipt = await readCompletedRun(this.directory, runId);
    if (!receipt) return null;
    const digest = (await readFile(join(this.directory, "runs", runId + ".sha256"), "utf8")).trim();
    return { receipt, reportSha256: digest };
  }

  /** Reserve a task-corpus run for one explicit, durable nomination. */
  async reserveTaskEvaluation(
    decision: AIDiscoveryDecisionReceipt,
    now = new Date(),
  ): Promise<{ readonly created: boolean; readonly evaluationId: string; readonly shouldStart: boolean; readonly status: AITaskEvaluationRequestStatus["status"] }> {
    if (decision.decision !== "nominate_for_task_evaluation" || !SHA256_RE.test(decision.decisionId)) {
      throw new Error("task evaluation requires a valid nomination");
    }
    const storedDecision = await readCompletedDecision(this.directory, decision.decisionId);
    if (!storedDecision || storedDecision.runId !== decision.runId
      || storedDecision.reportSha256 !== decision.reportSha256
      || storedDecision.candidateId !== decision.candidateId
      || storedDecision.decision !== "nominate_for_task_evaluation") {
      throw new Error("task evaluation nomination mismatch");
    }
    const completedSource = await this.getRun(decision.runId);
    const sourceSnapshot = await this.snapshot(now);
    if (!completedSource || completedSource.reportSha256 !== decision.reportSha256
      || sourceSnapshot.latestRun?.runId !== decision.runId
      || now.getTime() - Date.parse(completedSource.receipt.finishedAt) > this.staleAfterMs
      || Date.parse(completedSource.receipt.finishedAt) > now.getTime() + 60_000) {
      throw new Error("task evaluation evidence is stale");
    }
    const evaluationId = decision.decisionId;
    const directory = join(this.directory, "task-evaluations");
    const requests = join(directory, "requests");
    await mkdir(requests, { recursive: true, mode: 0o700 });
    const request = {
      schema: "SKALD_AI_TASK_EVALUATION_REQUEST_V1",
      evaluationId,
      decisionId: decision.decisionId,
      runId: decision.runId,
      candidateId: decision.candidateId,
      reportSha256: decision.reportSha256,
      acceptedAt: now.toISOString(),
    };
    const text = JSON.stringify(request, null, 2) + "\n";
    let created = true;
    try {
      await writeImmutable(join(requests, evaluationId + ".json"), text);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      created = false;
    }
    const stored = await readTaskEvaluationRequest(this.directory, evaluationId);
    if (!stored) throw new Error("task evaluation request receipt is invalid");
    const parsed = JSON.parse(stored.text) as Record<string, unknown>;
    if (parsed.runId !== decision.runId || parsed.candidateId !== decision.candidateId
      || parsed.reportSha256 !== decision.reportSha256) throw new Error("task evaluation request conflict");
    const digest = sha256(stored.text);
    const hashPath = join(requests, evaluationId + ".sha256");
    let savedDigest: string | null = null;
    try { savedDigest = (await readFile(hashPath, "utf8")).trim(); } catch { /* recover incomplete reservation */ }
    if (savedDigest !== null && savedDigest !== digest) throw new Error("task evaluation request hash mismatch");
    if (savedDigest === null) await writeAtomic(hashPath, digest + "\n");
    const completePath = join(requests, evaluationId + ".complete.json");
    let markerValid = false;
    try {
      const marker = JSON.parse(await readFile(completePath, "utf8")) as { schema?: unknown; evaluationId?: unknown; requestSha256?: unknown };
      markerValid = marker.schema === "SKALD_AI_TASK_EVALUATION_REQUEST_COMPLETE_V1"
        && marker.evaluationId === evaluationId
        && marker.requestSha256 === digest;
      if (!markerValid) throw new Error("task evaluation request marker mismatch");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!markerValid) await writeAtomic(completePath, JSON.stringify({
      schema: "SKALD_AI_TASK_EVALUATION_REQUEST_COMPLETE_V1",
      evaluationId,
      requestSha256: digest,
      acceptedAt: parsed.acceptedAt,
    }, null, 2) + "\n");
    await fsyncDirectory(requests);

    let state: AITaskEvaluationRequestStatus | null = null;
    try {
      const value = JSON.parse(await readFile(join(requests, evaluationId + ".state.json"), "utf8")) as AITaskEvaluationRequestStatus;
      if (value.evaluationId === evaluationId && value.decisionId === evaluationId
        && ["accepted", "running", "complete", "partial", "blocked", "failed", "incomplete"].includes(value.status)) state = value;
    } catch { /* recover accepted reservation */ }
    if (state?.status === "running" && state.runId) {
      const complete = await readCompletedTaskEvaluation(this.directory, evaluationId, state.runId);
      if (complete) {
        state = await this.setTaskEvaluationStatus(evaluationId, complete.report.status, complete.report.finishedAt, state.runId, complete.reportSha256);
      } else if (!await this.hasLiveRefreshLock()) {
        state = await this.setTaskEvaluationStatus(evaluationId, "incomplete", now.toISOString(), state.runId);
      }
    }
    if (state?.runId && ["complete", "partial", "blocked", "failed"].includes(state.status)
      && !await readCompletedTaskEvaluation(this.directory, evaluationId, state.runId)) {
      state = await this.setTaskEvaluationStatus(evaluationId, "incomplete", now.toISOString(), state.runId);
    }
    if (!state) {
      state = {
        evaluationId,
        decisionId: evaluationId,
        candidateId: decision.candidateId,
        acceptedAt: typeof parsed.acceptedAt === "string" ? parsed.acceptedAt : now.toISOString(),
        updatedAt: now.toISOString(),
        status: "accepted",
      };
      await writeAtomic(join(requests, evaluationId + ".state.json"), JSON.stringify(state, null, 2) + "\n");
    }
    await writeAtomic(join(directory, "latest.json"), JSON.stringify({ evaluationId }, null, 2) + "\n");
    return {
      created,
      evaluationId,
      shouldStart: state.status === "accepted" || state.status === "incomplete",
      status: state.status,
    };
  }

  /** Mark a reserved evaluation running under the shared provider-work lock. */
  async beginTaskEvaluation(evaluationId: string, runId: string, startedAt: string): Promise<AITaskEvaluationRequestStatus> {
    if (!SHA256_RE.test(evaluationId) || !RUN_ID_RE.test(runId)) throw new Error("invalid task evaluation id");
    const receipt = await readCompletedTaskEvaluationRequest(this.directory, evaluationId);
    if (!receipt) throw new Error("task evaluation request is missing");
    return this.setTaskEvaluationStatus(evaluationId, "running", startedAt, runId);
  }

  /** Complete one immutable task-evaluation report; the marker is written last. */
  async completeTaskEvaluation(
    evaluationId: string,
    runId: string,
    report: AITaskEvaluationReport,
  ): Promise<string> {
    if (!SHA256_RE.test(evaluationId) || !RUN_ID_RE.test(runId)
      || report.schema !== "SKALD_AI_TASK_EVALUATION_V1"
      || report.evidence.decisionId !== evaluationId) throw new Error("invalid task evaluation report");
    const request = await readCompletedTaskEvaluationRequest(this.directory, evaluationId);
    if (!request || request.value.runId !== report.evidence.discoveryRunId
      || request.value.reportSha256 !== report.evidence.discoveryReportSha256
      || request.value.candidateId !== report.evidence.candidateId) throw new Error("task evaluation report evidence mismatch");
    const runs = join(this.directory, "task-evaluations", "runs");
    await mkdir(runs, { recursive: true, mode: 0o700 });
    const text = JSON.stringify(report, null, 2) + "\n";
    const digest = sha256(text);
    await writeImmutable(join(runs, runId + ".json"), text);
    await writeAtomic(join(runs, runId + ".sha256"), digest + "\n");
    await writeAtomic(join(this.directory, "task-evaluations", "latest.json"), JSON.stringify({ evaluationId, runId, reportSha256: digest }, null, 2) + "\n");
    await writeAtomic(join(runs, runId + ".complete.json"), JSON.stringify({
      schema: "SKALD_AI_TASK_EVALUATION_COMPLETE_V1",
      evaluationId,
      runId,
      reportSha256: digest,
      completedAt: report.finishedAt,
    }, null, 2) + "\n");
    await fsyncDirectory(runs);
    await this.setTaskEvaluationStatus(evaluationId, report.status, report.finishedAt, runId, digest);
    return digest;
  }

  /** Read one evaluation only when its immutable report and final marker verify. */
  async getTaskEvaluation(evaluationId: string, now = new Date()): Promise<AITaskEvaluationSnapshot | null> {
    if (!SHA256_RE.test(evaluationId)) return null;
    const receipt = await readCompletedTaskEvaluationRequest(this.directory, evaluationId);
    if (!receipt) return null;
    let request = await this.readTaskEvaluationState(evaluationId);
    if (!request) {
      request = {
        evaluationId,
        decisionId: evaluationId,
        candidateId: receipt.value.candidateId,
        acceptedAt: receipt.value.acceptedAt,
        updatedAt: receipt.value.acceptedAt,
        status: "accepted",
      };
    }
    let completed = request.runId ? await readCompletedTaskEvaluation(this.directory, evaluationId, request.runId) : null;
    if (request.status === "running") {
      if (completed) {
        request = await this.setTaskEvaluationStatus(evaluationId, completed.report.status, completed.report.finishedAt, request.runId, completed.reportSha256);
      } else if (!await this.hasLiveRefreshLock()) {
        request = await this.setTaskEvaluationStatus(evaluationId, "incomplete", now.toISOString(), request.runId);
      }
    }
    if (!completed && request.runId
      && ["complete", "partial", "blocked", "failed"].includes(request.status)) {
      request = await this.setTaskEvaluationStatus(evaluationId, "incomplete", now.toISOString(), request.runId);
    }
    if (!completed && request.runId) completed = await readCompletedTaskEvaluation(this.directory, evaluationId, request.runId);
    return { request, report: completed?.report ?? null, reportSha256: completed?.reportSha256 ?? null };
  }

  /**
   * Record an operator decision for a screened candidate. Acceptance only
   * nominates the model for a separate task-corpus review; it never changes a
   * serving route or claims player-task validity.
   */
  async recordDecision(input: {
    readonly runId: string;
    readonly reportSha256: string;
    readonly candidateId: string;
    readonly decision: "nominate_for_task_evaluation" | "reject";
    readonly idempotencyKey: string;
    readonly now?: Date;
  }): Promise<AIDiscoveryDecisionReceipt> {
    if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 200 || /[\u0000-\u0020]/u.test(input.idempotencyKey)) {
      throw new Error("invalid idempotency key");
    }
    const requestId = sha256(input.idempotencyKey);
    const existing = await readCompletedDecision(this.directory, requestId);
    if (existing) {
      if (existing.runId !== input.runId
        || existing.reportSha256 !== input.reportSha256
        || existing.candidateId !== input.candidateId
        || existing.decision !== input.decision) throw new Error("decision idempotency conflict");
      return existing;
    }
    const now = input.now ?? new Date();
    const completed = await this.getRun(input.runId);
    if (!completed || completed.reportSha256 !== input.reportSha256) throw new Error("discovery evidence mismatch");
    const snapshot = await this.snapshot(now);
    if (snapshot.latestRun?.runId !== input.runId
      || now.getTime() - Date.parse(completed.receipt.finishedAt) > this.staleAfterMs
      || Date.parse(completed.receipt.finishedAt) > now.getTime() + 60_000) {
      throw new Error("discovery evidence is stale");
    }
    const report = completed.receipt.report as { candidates?: readonly { id?: unknown; screening?: unknown }[] };
    const candidate = report.candidates?.find((item) => item.id === input.candidateId);
    if (!candidate) throw new Error("candidate not found in completed report");
    if (input.decision === "nominate_for_task_evaluation" && candidate.screening !== "pass") {
      throw new Error("candidate screening did not pass");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,159}$/u.test(input.candidateId)) throw new Error("invalid candidate id");
    const decisionId = requestId;
    const receipt: AIDiscoveryDecisionReceipt = {
      schema: "SKALD_AI_DISCOVERY_DECISION_V1",
      decisionId,
      requestId,
      runId: input.runId,
      reportSha256: input.reportSha256,
      candidateId: input.candidateId,
      decision: input.decision,
      decidedAt: now.toISOString(),
    };
    const directory = join(this.directory, "decisions");
    const text = JSON.stringify(receipt, null, 2) + "\n";
    const digest = sha256(text);
    try {
      await writeImmutable(join(directory, decisionId + ".json"), text);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("decision request already in progress");
      throw error;
    }
    await writeAtomic(join(directory, decisionId + ".sha256"), digest + "\n");
    await writeAtomic(join(this.directory, "latest-decision.json"), JSON.stringify({ decisionId, decisionSha256: digest }, null, 2) + "\n");
    await writeAtomic(join(directory, decisionId + ".complete.json"), JSON.stringify({
      schema: "SKALD_AI_DISCOVERY_DECISION_COMPLETE_V1",
      decisionId,
      reportSha256: digest,
      completedAt: receipt.decidedAt,
    }, null, 2) + "\n");
    await fsyncDirectory(directory);
    return receipt;
  }

  async fail(attempt: DiscoveryLastAttempt): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeAtomic(join(this.directory, "last-attempt.json"), JSON.stringify(attempt, null, 2) + "\n");
    if (attempt.trigger === "manual" && attempt.requestId) {
      const status = attempt.status === "incomplete" || attempt.reason === "write_failed" ? "incomplete" : "failed";
      await this.setManualRequestStatus(attempt.requestId, status, attempt.finishedAt ?? attempt.startedAt, attempt.runId).catch(() => undefined);
    }
  }

  /** Persist the latest known status for a manual request; never stores its idempotency key. */
  async setManualRequestStatus(
    requestId: string,
    status: ManualDiscoveryRequestStatus["status"],
    updatedAt: string,
    runId?: string,
    sharedExecution = false,
  ): Promise<ManualDiscoveryRequestStatus> {
    const receipt = await readManualRequestReceipt(this.directory, requestId);
    if (!receipt) throw new Error("manual discovery request receipt is missing");
    const value: ManualDiscoveryRequestStatus = {
      requestId,
      acceptedAt: receipt.acceptedAt,
      updatedAt,
      status,
      ...(runId ? { runId } : {}),
      ...(sharedExecution ? { sharedExecution: true } : {}),
    };
    await writeAtomic(join(this.directory, "manual-requests", requestId + ".state.json"), JSON.stringify(value, null, 2) + "\n");
    return value;
  }

  async snapshot(now = new Date()): Promise<DiscoveryStoreSnapshot> {
    let lastAttempt: DiscoveryLastAttempt | null = null;
    try { lastAttempt = JSON.parse(await readFile(join(this.directory, "last-attempt.json"), "utf8")) as DiscoveryLastAttempt; } catch { /* no attempt yet */ }
    let files: string[] = [];
    try { files = await readdir(join(this.directory, "runs")); } catch { /* no reports yet */ }
    const runIds = [...new Set(files.filter((name) => name.endsWith(".complete.json")).map((name) => name.slice(0, -".complete.json".length)).filter((id) => RUN_ID_RE.test(id)))].sort().reverse();
    const completed: DiscoveryRunReceipt[] = [];
    for (const runId of runIds) {
      const run = await readCompletedRun(this.directory, runId);
      if (run) completed.push(run);
    }
    completed.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
    const latestRun = completed[0] ?? null;
    const latestSuccessfulRun = completed.find((run) => (run.report as { status?: unknown }).status === "complete") ?? null;
    const latestFailedRun = completed.find((run) => (run.report as { status?: unknown }).status !== "complete") ?? null;
    const successAgeMs = latestSuccessfulRun ? Math.max(0, now.getTime() - Date.parse(latestSuccessfulRun.finishedAt)) : null;
    const freshness = successAgeMs === null ? "missing" : successAgeMs <= this.staleAfterMs ? "fresh" : "stale";
    const latestRunSha256 = latestRun
      ? await readFile(join(this.directory, "runs", latestRun.runId + ".sha256"), "utf8").then((value) => value.trim()).catch(() => null)
      : null;
    let latestDecision: AIDiscoveryDecisionReceipt | null = null;
    try {
      const pointer = JSON.parse(await readFile(join(this.directory, "latest-decision.json"), "utf8")) as { decisionId?: unknown };
      if (typeof pointer.decisionId === "string") latestDecision = await readCompletedDecision(this.directory, pointer.decisionId);
    } catch { /* no complete operator decision yet */ }
    let latestManualRequest: ManualDiscoveryRequestStatus | null = null;
    try {
      const pointer = JSON.parse(await readFile(join(this.directory, "manual-requests", "latest.json"), "utf8")) as { requestId?: unknown };
      if (typeof pointer.requestId === "string") {
        const receipt = await readCompletedManualRequest(this.directory, pointer.requestId);
        if (receipt) {
          latestManualRequest = await readManualRequestState(this.directory, pointer.requestId)
            ?? { requestId: pointer.requestId, acceptedAt: receipt.acceptedAt, updatedAt: receipt.acceptedAt, status: "accepted" };
          if (latestManualRequest.status === "running") {
            const completedRun = await this.findCompletedManualRun(pointer.requestId);
            if (completedRun) {
              latestManualRequest = {
                requestId: pointer.requestId,
                acceptedAt: receipt.acceptedAt,
                updatedAt: completedRun.finishedAt,
                status: reportStatus(completedRun.report),
                runId: completedRun.runId,
              };
            } else if (!await this.hasLiveRefreshLock()) {
              latestManualRequest = {
                ...latestManualRequest,
                status: "incomplete",
                updatedAt: now.toISOString(),
              };
            }
          }
        }
      }
    } catch { /* no manual request yet */ }
    if (lastAttempt?.status === "running") {
      let liveOwner = false;
      try {
        const owner = JSON.parse(await readFile(join(this.directory, "refresh.lock"), "utf8")) as LockOwner;
        liveOwner = typeof owner.pid === "number"
          && typeof owner.host === "string"
          && (owner.host !== hostname() || isAlive(owner.pid));
      } catch {
        liveOwner = false;
      }
      if (!liveOwner) lastAttempt = { ...lastAttempt, status: "incomplete", reason: "write_failed" };
    } else if (lastAttempt && lastAttempt.status !== "incomplete" && !completed.some((run) => run.runId === lastAttempt?.runId)) {
      lastAttempt = { ...lastAttempt, status: "incomplete", reason: "write_failed" };
    }
    const latestTaskEvaluation = await this.readLatestTaskEvaluation(now);
    return {
      lastAttempt,
      latestManualRequest,
      latestRun,
      latestSuccessfulRun,
      latestFailedRun,
      latestRunSha256,
      latestDecision,
      latestTaskEvaluation,
      freshness,
      successAgeMs,
      schedule: {
        owner: "systemd_timer",
        localTime: "04:00",
        timezone: "Europe/Moscow",
        installationState: "externally_managed_unverified",
      },
      nextRunAt: nextAiDiscoveryRunAt(now),
    };
  }

  private async pruneHistory(): Promise<void> {
    const directory = join(this.directory, "runs");
    let names: string[];
    try { names = await readdir(directory); } catch { return; }
    const completedIds = [...new Set(names.filter((name) => name.endsWith(".complete.json")).map((name) => name.slice(0, -".complete.json".length)).filter((id) => RUN_ID_RE.test(id)))].sort().reverse();
    for (const runId of completedIds.slice(this.historyLimit)) {
      for (const suffix of [".json", ".sha256", ".complete.json"]) {
        await unlink(join(directory, runId + suffix)).catch(() => undefined);
      }
    }
  }

  async setTaskEvaluationStatus(
    evaluationId: string,
    status: AITaskEvaluationRequestStatus["status"],
    updatedAt: string,
    runId?: string,
    reportSha256?: string,
  ): Promise<AITaskEvaluationRequestStatus> {
    const receipt = await readCompletedTaskEvaluationRequest(this.directory, evaluationId);
    if (!receipt) throw new Error("task evaluation request receipt is missing");
    const value: AITaskEvaluationRequestStatus = {
      evaluationId,
      decisionId: evaluationId,
      candidateId: receipt.value.candidateId,
      acceptedAt: receipt.value.acceptedAt,
      updatedAt,
      status,
      ...(runId ? { runId } : {}),
      ...(reportSha256 ? { reportSha256 } : {}),
    };
    await writeAtomic(join(this.directory, "task-evaluations", "requests", evaluationId + ".state.json"), JSON.stringify(value, null, 2) + "\n");
    return value;
  }

  private async readTaskEvaluationState(evaluationId: string): Promise<AITaskEvaluationRequestStatus | null> {
    try {
      const value = JSON.parse(await readFile(join(this.directory, "task-evaluations", "requests", evaluationId + ".state.json"), "utf8")) as AITaskEvaluationRequestStatus;
      if (value.evaluationId !== evaluationId || value.decisionId !== evaluationId
        || typeof value.candidateId !== "string" || typeof value.acceptedAt !== "string"
        || typeof value.updatedAt !== "string"
        || !["accepted", "running", "complete", "partial", "blocked", "failed", "incomplete"].includes(value.status)) return null;
      return value;
    } catch {
      return null;
    }
  }

  private async readLatestTaskEvaluation(now: Date): Promise<AITaskEvaluationSnapshot | null> {
    try {
      const pointer = JSON.parse(await readFile(join(this.directory, "task-evaluations", "latest.json"), "utf8")) as { evaluationId?: unknown };
      return typeof pointer.evaluationId === "string" ? this.getTaskEvaluation(pointer.evaluationId, now) : null;
    } catch {
      return null;
    }
  }

  private async findCompletedManualRun(requestId: string): Promise<DiscoveryRunReceipt | null> {
    let files: string[];
    try { files = await readdir(join(this.directory, "runs")); } catch { return null; }
    const runIds = files
      .filter((name) => name.endsWith(".complete.json"))
      .map((name) => name.slice(0, -".complete.json".length))
      .filter((id) => RUN_ID_RE.test(id));
    for (const runId of runIds) {
      const run = await readCompletedRun(this.directory, runId);
      if (run?.trigger === "manual" && run.requestId === requestId) return run;
    }
    return null;
  }

  private async hasLiveRefreshLock(): Promise<boolean> {
    try {
      const owner = JSON.parse(await readFile(join(this.directory, "refresh.lock"), "utf8")) as LockOwner;
      if (!Number.isSafeInteger(owner.pid) || typeof owner.host !== "string") return true;
      return owner.host !== hostname() || isAlive(owner.pid);
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ENOENT";
    }
  }
}

function isAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

/**
 * Cross-process lock shared by scheduled and manual refreshes. A stale lock
 * is reclaimed only when its owner PID is provably dead on the same host;
 * ambiguous or live owners fail closed and are never removed by TTL.
 */
export async function acquireAIDiscoveryLock(directory: string): Promise<{ readonly acquired: false; readonly owner?: LockOwner } | { readonly acquired: true; release(): Promise<void> }> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, "refresh.lock");
  const reclaimPath = join(directory, "refresh.lock.reclaim");
  const nonce = randomUUID();
  const own: LockOwner = { pid: process.pid, host: hostname(), nonce, startedAt: new Date().toISOString() };
  const writeOwner = async (): Promise<void> => {
    const handle = await open(lockPath, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(own) + "\n", "utf8"); await handle.sync(); } finally { await handle.close(); }
  };
  const lease = () => ({ acquired: true as const, release: async (): Promise<void> => {
    try {
      const current = JSON.parse(await readFile(lockPath, "utf8")) as LockOwner;
      if (current.nonce === nonce) await unlink(lockPath);
    } catch { /* lock already removed or unreadable */ }
  } });
  try { await writeOwner(); return lease(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  let owner: LockOwner | undefined;
  try { owner = JSON.parse(await readFile(lockPath, "utf8")) as LockOwner; } catch { return { acquired: false }; }
  if (!owner || owner.host !== hostname() || isAlive(owner.pid)) return { acquired: false, owner };
  let reclaimHandle;
  try { reclaimHandle = await open(reclaimPath, "wx", 0o600); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { acquired: false, owner };
    throw error;
  }
  try {
    let current: LockOwner;
    try { current = JSON.parse(await readFile(lockPath, "utf8")) as LockOwner; } catch { current = owner; }
    if (current.nonce === owner.nonce && current.host === hostname() && !isAlive(current.pid)) await unlink(lockPath).catch(() => undefined);
  } finally {
    await reclaimHandle.close();
    await unlink(reclaimPath).catch(() => undefined);
  }
  try { await writeOwner(); return lease(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { acquired: false, owner };
    throw error;
  }
}

/** Secret-free credential generation proxy based on env-file metadata only. */
export async function credentialGeneration(envFilePath: string | undefined, env: NodeJS.ProcessEnv): Promise<string> {
  const configured = ["OPENCODE_API_KEY", "SKALD_OPENCODE_ZEN_API_KEY"].some((key) => Boolean(env[key]));
  if (!envFilePath) return "process-env:" + (configured ? "configured" : "missing");
  try {
    const info = await stat(envFilePath);
    return "env-file:" + info.mtimeMs + ":" + info.size + ":opencode-" + (configured ? "configured" : "missing");
  } catch {
    return "env-file:unreadable:opencode-" + (configured ? "configured" : "missing");
  }
}

/** Exposed for tests that assert a report digest is the exact persisted bytes. */
export function discoveryStoreSha256(text: string): string {
  return sha256(text);
}
