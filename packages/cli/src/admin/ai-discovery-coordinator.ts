/** Shared execution path for systemd polling and loopback manual refresh. */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  AIDiscoveryStore,
  acquireAIDiscoveryLock,
  credentialGeneration,
  type AIDiscoveryDecisionReceipt,
  type DiscoveryRunReceipt,
} from "./ai-discovery-store.js";
import {
  AI_TASK_EVALUATION_MAX_DURATION_MS,
  AI_TASK_EVALUATION_TIMEOUT_MS,
  evaluateOpenCodeTaskCandidate,
  type AITaskEvaluationReport,
} from "./ai-task-evaluation.js";
import {
  AI_DISCOVERY_DIR_ENV,
  AI_DISCOVERY_DEFAULT_REGION,
  AI_DISCOVERY_ENV_FILE_ENV,
  AI_DISCOVERY_MAX_CALLS,
  AI_DISCOVERY_MAX_CANDIDATES,
  AI_DISCOVERY_MAX_DURATION_MS,
  AI_DISCOVERY_PROBE_TIMEOUT_MS,
  AI_DISCOVERY_REGION_ENV,
  discoveryEvidenceDigest,
  loadDiscoveryServiceEnvironment,
  readDiscoveryCommit,
  screenOpenCodeFreeModels,
  withDiscoveryChanges,
  type OpenCodeDiscoveryOptions,
  type OpenCodeDiscoveryReport,
} from "./ai-model-discovery.js";

export const AI_DISCOVERY_DEFAULT_DIRECTORY = "/home/nooker/skald-data/ai-discovery";
export const AI_DISCOVERY_LOCAL_DIRECTORY = "eval-out/ai-discovery";

export interface AIDiscoveryExecution {
  readonly state: "complete" | "already_running" | "failed";
  readonly runId?: string;
  readonly report?: OpenCodeDiscoveryReport;
  readonly reportSha256?: string;
}

export interface AITaskEvaluationExecution {
  readonly state: "accepted" | "running" | "complete" | "partial" | "blocked" | "failed" | "incomplete";
  readonly evaluationId: string;
  readonly report?: AITaskEvaluationReport;
  readonly reportSha256?: string;
}

export interface AIDiscoveryCoordinatorOptions extends OpenCodeDiscoveryOptions {
  readonly directory?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
  readonly screen?: typeof screenOpenCodeFreeModels;
  readonly evaluateTask?: typeof evaluateOpenCodeTaskCandidate;
}

function makeRunId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/gu, "").replace(/\.\d{3}/u, "");
  return stamp + "-" + randomUUID();
}

function discoveryRegion(env: NodeJS.ProcessEnv): string {
  const configuredRegion = env[AI_DISCOVERY_REGION_ENV] ?? AI_DISCOVERY_DEFAULT_REGION;
  return /^[A-Za-z]{2}$/u.test(configuredRegion.trim())
    ? configuredRegion.trim().toUpperCase()
    : AI_DISCOVERY_DEFAULT_REGION;
}

function failureReport(
  now: () => Date,
  reason: "environment_invalid" | "screening_failed",
  region: string,
): OpenCodeDiscoveryReport {
  const instant = now().toISOString();
  return {
    schema: "SKALD_AI_MODEL_DISCOVERY_V1",
    status: "failed",
    startedAt: instant,
    finishedAt: instant,
    source: { region, catalogModelCount: 0, freeChatCount: 0 },
    policy: { maxConcurrency: 2, maxCandidates: AI_DISCOVERY_MAX_CANDIDATES, maxCalls: AI_DISCOVERY_MAX_CALLS, timeoutMs: AI_DISCOVERY_PROBE_TIMEOUT_MS, maxDurationMs: AI_DISCOVERY_MAX_DURATION_MS, transport: "opencode_cli" },
    providerCallCount: 0,
    candidates: [],
    exclusions: [],
    failureReason: reason,
  };
}

/** Coordinates one bounded model scan and persists its report before release. */
export class AIDiscoveryCoordinator {
  readonly store: AIDiscoveryStore;
  private inFlight: Promise<AIDiscoveryExecution> | null = null;
  private readonly options: AIDiscoveryCoordinatorOptions;
  private readonly taskStarts = new Map<string, Promise<AITaskEvaluationExecution>>();
  private readonly taskWaiters = new Map<string, Promise<void>>();

  constructor(options: AIDiscoveryCoordinatorOptions = {}) {
    this.options = options;
    const env = options.env ?? process.env;
    this.store = new AIDiscoveryStore(
      options.directory ?? env[AI_DISCOVERY_DIR_ENV] ?? (env.NODE_ENV === "production" ? AI_DISCOVERY_DEFAULT_DIRECTORY : join(process.cwd(), AI_DISCOVERY_LOCAL_DIRECTORY)),
    );
  }

  /** Concurrent callers in one process join the same execution. */
  refresh(trigger: "daily" | "manual", requestId?: string): Promise<AIDiscoveryExecution> {
    if (this.inFlight) {
      const joined = this.inFlight;
      if (trigger !== "manual" || !requestId) return joined;
      return joined.then(async (execution) => {
        if (execution.runId && execution.state !== "already_running") {
          const reportStatus = execution.report?.status;
          const status = reportStatus === "complete" || reportStatus === "partial" || reportStatus === "blocked" || reportStatus === "failed"
            ? reportStatus : execution.state === "failed" ? "failed" : "complete";
          await this.store.setManualRequestStatus(requestId, status, execution.report?.finishedAt ?? new Date().toISOString(), execution.runId, true)
            .catch(() => undefined);
        }
        return execution;
      });
    }
    const execution = this.runOnce(trigger, requestId).finally(() => {
      if (this.inFlight === execution) this.inFlight = null;
    });
    this.inFlight = execution;
    return execution;
  }

  /** Start or resume one operator-nominated task evaluation; the serving route is never changed. */
  startTaskEvaluation(decision: AIDiscoveryDecisionReceipt): Promise<AITaskEvaluationExecution> {
    const existing = this.taskStarts.get(decision.decisionId);
    if (existing) return existing;
    const start = this.startTaskEvaluationOnce(decision).finally(() => {
      if (this.taskStarts.get(decision.decisionId) === start) this.taskStarts.delete(decision.decisionId);
    });
    this.taskStarts.set(decision.decisionId, start);
    return start;
  }

  private async startTaskEvaluationOnce(decision: AIDiscoveryDecisionReceipt): Promise<AITaskEvaluationExecution> {
    const now = this.options.now ?? (() => new Date());
    const reservation = await this.store.reserveTaskEvaluation(decision, now());
    if (!reservation.shouldStart) {
      const snapshot = await this.store.getTaskEvaluation(reservation.evaluationId, now());
      return {
        state: snapshot?.request.status ?? reservation.status,
        evaluationId: reservation.evaluationId,
        ...(snapshot?.report ? { report: snapshot.report } : {}),
        ...(snapshot?.reportSha256 ? { reportSha256: snapshot.reportSha256 } : {}),
      };
    }
    const lock = await acquireAIDiscoveryLock(this.store.directory);
    if (!lock.acquired) {
      this.queueTaskEvaluationStart(decision, reservation.evaluationId);
      return { state: reservation.status, evaluationId: reservation.evaluationId };
    }
    const startedAt = now();
    const runId = makeRunId(startedAt);
    try {
      await this.store.beginTaskEvaluation(reservation.evaluationId, runId, startedAt.toISOString());
    } catch (error) {
      await lock.release();
      throw error;
    }
    void this.runTaskEvaluation(decision, reservation.evaluationId, runId, lock);
    return { state: "running", evaluationId: reservation.evaluationId };
  }

  private queueTaskEvaluationStart(decision: AIDiscoveryDecisionReceipt, evaluationId: string): void {
    if (this.taskWaiters.has(evaluationId)) return;
    const waiter = this.waitForTaskEvaluationLock(decision, evaluationId).finally(() => {
      if (this.taskWaiters.get(evaluationId) === waiter) this.taskWaiters.delete(evaluationId);
    });
    this.taskWaiters.set(evaluationId, waiter);
  }

  /** Resume a confirmed evaluation after the shared daily/manual scan releases its provider lock. */
  private async waitForTaskEvaluationLock(decision: AIDiscoveryDecisionReceipt, evaluationId: string): Promise<void> {
    const deadline = performance.now() + AI_DISCOVERY_MAX_DURATION_MS + 60_000;
    while (performance.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      const current = await this.store.getTaskEvaluation(evaluationId, (this.options.now ?? (() => new Date()))());
      if (!current || current.report
        || ["complete", "partial", "blocked", "failed"].includes(current.request.status)) return;
      const lock = await acquireAIDiscoveryLock(this.store.directory);
      if (!lock.acquired) continue;
      const latest = await this.store.getTaskEvaluation(evaluationId, (this.options.now ?? (() => new Date()))());
      if (!latest || latest.report
        || ["complete", "partial", "blocked", "failed"].includes(latest.request.status)) {
        await lock.release();
        return;
      }
      const startedAt = (this.options.now ?? (() => new Date()))();
      const runId = makeRunId(startedAt);
      try {
        await this.store.beginTaskEvaluation(evaluationId, runId, startedAt.toISOString());
      } catch (error) {
        await lock.release();
        throw error;
      }
      void this.runTaskEvaluation(decision, evaluationId, runId, lock);
      return;
    }
    const current = await this.store.getTaskEvaluation(evaluationId, (this.options.now ?? (() => new Date()))());
    if (current && !current.report
      && (current.request.status === "accepted" || current.request.status === "incomplete")) {
      await this.store.setTaskEvaluationStatus(evaluationId, "incomplete", (this.options.now ?? (() => new Date()))().toISOString(), current.request.runId);
    }
  }

  private async runTaskEvaluation(
    decision: AIDiscoveryDecisionReceipt,
    evaluationId: string,
    runId: string,
    lock: { readonly acquired: true; release(): Promise<void> },
  ): Promise<void> {
    const now = this.options.now ?? (() => new Date());
    try {
      const report = await (this.options.evaluateTask ?? evaluateOpenCodeTaskCandidate)({
        decisionId: decision.decisionId,
        discoveryRunId: decision.runId,
        discoveryReportSha256: decision.reportSha256,
        candidateId: decision.candidateId,
        actualCommit: readDiscoveryCommit(this.options.cwd),
      }, {
        env: { ...(this.options.env ?? process.env) },
        ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
        ...(this.options.now ? { now: this.options.now } : {}),
        ...(this.options.monotonicNow ? { monotonicNow: this.options.monotonicNow } : {}),
        timeoutMs: this.options.timeoutMs ?? AI_TASK_EVALUATION_TIMEOUT_MS,
        maxDurationMs: this.options.maxDurationMs ?? AI_TASK_EVALUATION_MAX_DURATION_MS,
      });
      const reportSha256 = await this.store.completeTaskEvaluation(evaluationId, runId, report);
      if (report.status === "partial") {
        await this.store.setTaskEvaluationStatus(evaluationId, "partial", report.finishedAt, runId, reportSha256);
      }
    } catch {
      await this.store.setTaskEvaluationStatus(evaluationId, "failed", now().toISOString(), runId).catch(() => undefined);
    } finally {
      await lock.release();
    }
  }

  private async runOnce(trigger: "daily" | "manual", requestId?: string): Promise<AIDiscoveryExecution> {
    const lock = await acquireAIDiscoveryLock(this.store.directory);
    if (!lock.acquired) return { state: "already_running" };
    const now = this.options.now ?? (() => new Date());
    const startedAt = now();
    const runId = makeRunId(startedAt);
    const priorSnapshot = await this.store.snapshot(startedAt);
    const priorSuccessful = priorSnapshot.latestSuccessfulRun;
    const env = { ...(this.options.env ?? process.env) };
    const envFile = env[AI_DISCOVERY_ENV_FILE_ENV];
    let region = discoveryRegion(env);
    const baseAttempt = { runId, trigger, ...(requestId ? { requestId } : {}), startedAt: startedAt.toISOString() } as const;
    const persistReport = async (report: OpenCodeDiscoveryReport): Promise<string> => {
      const receipt: DiscoveryRunReceipt = {
        schema: "SKALD_AI_DISCOVERY_RUN_V1",
        runId,
        trigger,
        ...(requestId ? { requestId } : {}),
        startedAt: baseAttempt.startedAt,
        finishedAt: report.finishedAt,
        commit: readDiscoveryCommit(this.options.cwd),
        credentialGeneration: await credentialGeneration(envFile, env),
        evidenceDigest: discoveryEvidenceDigest(report),
        report: report as unknown as Readonly<Record<string, unknown>>,
      };
      return this.store.complete(receipt, report.status);
    };
    try {
      await this.store.begin({ ...baseAttempt, status: "running" });
      const loaded = loadDiscoveryServiceEnvironment(env);
      if (!loaded.ok) {
        const report = withDiscoveryChanges(
          failureReport(now, "environment_invalid", region),
          priorSuccessful ? { runId: priorSuccessful.runId, report: priorSuccessful.report } : undefined,
        );
        const reportSha256 = await persistReport(report);
        return { state: "failed", runId, report, reportSha256 };
      }
      // The service EnvironmentFile is loaded into this per-run environment.
      // Capture the effective region before any later failure report is built.
      region = discoveryRegion(env);
      const rawScan = await (this.options.screen ?? screenOpenCodeFreeModels)({
        ...this.options,
        env,
        ...(this.options.now ? { now: this.options.now } : {}),
      });
      const scan = withDiscoveryChanges(
        rawScan,
        priorSuccessful ? { runId: priorSuccessful.runId, report: priorSuccessful.report } : undefined,
      );
      const reportSha256 = await persistReport(scan);
      return { state: "complete", runId, report: scan, reportSha256 };
    } catch {
      const report = withDiscoveryChanges(
        failureReport(now, "screening_failed", region),
        priorSuccessful ? { runId: priorSuccessful.runId, report: priorSuccessful.report } : undefined,
      );
      let reportSha256: string | undefined;
      try {
        reportSha256 = await persistReport(report);
      } catch {
        await this.store.fail({
          ...baseAttempt,
          status: "failed",
          finishedAt: report.finishedAt,
          reason: "write_failed",
        }).catch(() => undefined);
      }
      return { state: "failed", runId, report, ...(reportSha256 ? { reportSha256 } : {}) };
    } finally {
      await lock.release();
    }
  }
}

/** Resolve storage path without revealing credentials or changing process state. */
export function resolveAIDiscoveryDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return env[AI_DISCOVERY_DIR_ENV] ?? (env.NODE_ENV === "production" ? AI_DISCOVERY_DEFAULT_DIRECTORY : join(process.cwd(), AI_DISCOVERY_LOCAL_DIRECTORY));
}
