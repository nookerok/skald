import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AIDiscoveryStore,
  acquireAIDiscoveryLock,
  credentialGeneration,
  nextAiDiscoveryRunAt,
  type AIDiscoveryDecisionReceipt,
  type DiscoveryRunReceipt,
} from "../src/admin/ai-discovery-store.js";
import { scoreGmCorpus } from "../src/conversation/gm-scorecard.js";
import type { AITaskEvaluationReport } from "../src/admin/ai-task-evaluation.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "skald-ai-discovery-store-"));
  roots.push(root);
  return root;
}

function makeRun(runId = "20261111T010000Z-00000000-0000-4000-8000-000000000001"): DiscoveryRunReceipt {
  return {
    schema: "SKALD_AI_DISCOVERY_RUN_V1",
    runId,
    trigger: "daily",
    startedAt: "2026-11-11T01:00:00.000Z",
    finishedAt: "2026-11-11T01:01:00.000Z",
    commit: "a".repeat(40),
    credentialGeneration: "env-file:1:12:opencode-configured",
    evidenceDigest: "b".repeat(64),
    report: {
      status: "complete",
      candidates: [
        { id: "candidate-good", screening: "pass" },
        { id: "candidate-bad", screening: "fail" },
      ],
    },
  };
}

function makeTaskReport(decision: AIDiscoveryDecisionReceipt): AITaskEvaluationReport {
  return {
    schema: "SKALD_AI_TASK_EVALUATION_V1",
    status: "complete",
    machineVerdict: "pass",
    humanReview: "required",
    startedAt: "2026-11-11T02:01:00.000Z",
    finishedAt: "2026-11-11T02:02:00.000Z",
    actualCommit: "a".repeat(40),
    evidence: {
      discoveryRunId: decision.runId,
      discoveryReportSha256: decision.reportSha256,
      decisionId: decision.decisionId,
      candidateId: decision.candidateId,
      region: "RU",
      catalogDigest: "d".repeat(64),
      corpusVersion: "ai-task-corpus-v1",
      corpusDigest: "e".repeat(64),
      directorPromptSha256: "f".repeat(64),
      narrationPromptSha256: "1".repeat(64),
    },
    policy: { maxConcurrency: 1, maxProviderCalls: 48, providerCallCount: 24, timeoutMs: 15_000, maxDurationMs: 720_000, transport: "opencode_cli" },
    director: { corpusVersion: "gm-corpus-v8", corpusSize: 14, passed: true, score: scoreGmCorpus([]) },
    narration: { corpusVersion: "ai-task-corpus-v1", corpusSize: 10, passed: 10, cases: [] },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("AIDiscoveryStore", () => {
  it("publishes a report only after immutable hash and completion marker are durable", async () => {
    const root = makeRoot();
    const store = new AIDiscoveryStore(root);
    const run = makeRun();
    await store.begin({ runId: run.runId, trigger: run.trigger, status: "running", startedAt: run.startedAt });
    const digest = await store.complete(run, "complete");
    const snapshot = await store.snapshot(new Date("2026-11-11T02:00:00.000Z"));
    expect(snapshot.latestRun?.runId).toBe(run.runId);
    expect(snapshot.latestRunSha256).toBe(digest);
    expect(snapshot.freshness).toBe("fresh");
    expect(snapshot.lastAttempt?.status).toBe("complete");
    expect(snapshot.schedule).toEqual({
      owner: "systemd_timer",
      localTime: "04:00",
      timezone: "Europe/Moscow",
      installationState: "externally_managed_unverified",
    });
    expect(snapshot.nextRunAt).toBe("2026-11-12T01:00:00.000Z");
    expect(readFileSync(join(root, "runs", run.runId + ".complete.json"), "utf8")).toContain(digest);
  });

  it("never overwrites a completed report with the same run id", async () => {
    const root = makeRoot();
    const store = new AIDiscoveryStore(root);
    const run = makeRun();
    const firstDigest = await store.complete(run, "complete");
    await expect(store.complete({ ...run, evidenceDigest: "c".repeat(64) }, "complete")).rejects.toBeTruthy();
    expect((await store.getRun(run.runId))?.reportSha256).toBe(firstDigest);
  });

  it("ignores a report if its bytes no longer match the sidecar hash", async () => {
    const root = makeRoot();
    const store = new AIDiscoveryStore(root);
    const run = makeRun();
    await store.complete(run, "complete");
    writeFileSync(join(root, "runs", run.runId + ".json"), "{}\n");
    const snapshot = await store.snapshot();
    expect(snapshot.latestRun).toBeNull();
    expect(snapshot.freshness).toBe("missing");
  });

  it("records an explicit nomination only for a passing candidate and exact report digest", async () => {
    const root = makeRoot();
    const store = new AIDiscoveryStore(root);
    const run = makeRun();
    const digest = await store.complete(run, "complete");
    const decision = await store.recordDecision({
      runId: run.runId,
      reportSha256: digest,
      candidateId: "candidate-good",
      decision: "nominate_for_task_evaluation",
      idempotencyKey: "decision-request-key-0001",
      now: new Date("2026-11-11T02:00:00.000Z"),
    });
    expect(decision.decision).toBe("nominate_for_task_evaluation");
    expect((await store.snapshot()).latestDecision).toEqual(decision);
    expect(await store.recordDecision({
      runId: run.runId,
      reportSha256: digest,
      candidateId: "candidate-good",
      decision: "nominate_for_task_evaluation",
      idempotencyKey: "decision-request-key-0001",
    })).toEqual(decision);
    await expect(store.recordDecision({
      runId: run.runId,
      reportSha256: digest,
      candidateId: "candidate-good",
      decision: "reject",
      idempotencyKey: "decision-request-key-0001",
    })).rejects.toThrow("decision idempotency conflict");
    await expect(store.recordDecision({
      runId: run.runId,
      reportSha256: "0".repeat(64),
      candidateId: "candidate-good",
      decision: "nominate_for_task_evaluation",
      idempotencyKey: "decision-request-key-0002",
    })).rejects.toThrow("discovery evidence mismatch");
    await expect(store.recordDecision({
      runId: run.runId,
      reportSha256: digest,
      candidateId: "candidate-bad",
      decision: "nominate_for_task_evaluation",
      idempotencyKey: "decision-request-key-0003",
    })).rejects.toThrow("candidate screening did not pass");
  });

  it("reserves, recovers, persists, verifies, and idempotently replays a task-evaluation report", async () => {
    const root = makeRoot();
    const store = new AIDiscoveryStore(root);
    const run = makeRun();
    const reportSha256 = await store.complete(run, "complete");
    const decision = await store.recordDecision({
      runId: run.runId,
      reportSha256,
      candidateId: "candidate-good",
      decision: "nominate_for_task_evaluation",
      idempotencyKey: "task-evaluation-request-0001",
      now: new Date("2026-11-11T02:00:00.000Z"),
    });
    const reserved = await store.reserveTaskEvaluation(decision, new Date("2026-11-11T02:00:01.000Z"));
    expect(reserved).toMatchObject({ created: true, shouldStart: true, status: "accepted" });

    const restartedStore = new AIDiscoveryStore(root);
    const recovered = await restartedStore.reserveTaskEvaluation(decision, new Date("2026-11-11T02:00:02.000Z"));
    expect(recovered).toMatchObject({ created: false, shouldStart: true, status: "accepted" });

    const evaluationRunId = "20261111T020003Z-00000000-0000-4000-8000-000000000002";
    const lease = await acquireAIDiscoveryLock(root);
    expect(lease.acquired).toBe(true);
    if (!lease.acquired) throw new Error("test lock unavailable");
    await restartedStore.beginTaskEvaluation(decision.decisionId, evaluationRunId, "2026-11-11T02:00:03.000Z");
    const report = makeTaskReport(decision);
    const taskReportSha = await restartedStore.completeTaskEvaluation(decision.decisionId, evaluationRunId, report);
    await lease.release();

    const taskSnapshot = await restartedStore.getTaskEvaluation(decision.decisionId, new Date("2026-11-11T02:03:00.000Z"));
    expect(taskSnapshot).toMatchObject({
      request: { status: "complete", runId: evaluationRunId, reportSha256: taskReportSha },
      report: { machineVerdict: "pass", humanReview: "required" },
      reportSha256: taskReportSha,
    });
    const replay = await restartedStore.reserveTaskEvaluation(decision, new Date("2026-11-11T02:03:00.000Z"));
    expect(replay).toMatchObject({ created: false, shouldStart: false, status: "complete" });
    expect((await restartedStore.snapshot(new Date("2026-11-11T02:03:00.000Z"))).latestTaskEvaluation?.reportSha256).toBe(taskReportSha);

    writeFileSync(join(root, "task-evaluations", "runs", evaluationRunId + ".json"), "{}\n");
    expect(await restartedStore.getTaskEvaluation(decision.decisionId)).toMatchObject({
      request: { status: "incomplete" },
      report: null,
      reportSha256: null,
    });

    const requestPath = join(root, "task-evaluations", "requests", decision.decisionId + ".json");
    const requestReceipt = JSON.parse(readFileSync(requestPath, "utf8")) as Record<string, unknown>;
    writeFileSync(requestPath, JSON.stringify({ ...requestReceipt, candidateId: "tampered-candidate" }) + "\n");
    expect(await restartedStore.getTaskEvaluation(decision.decisionId)).toBeNull();
  });

  it("reports stale success rather than treating an old report as fresh", async () => {
    const root = makeRoot();
    const store = new AIDiscoveryStore(root, { staleAfterMs: 60_000 });
    await store.complete(makeRun(), "complete");
    const snapshot = await store.snapshot(new Date("2026-11-11T01:03:00.000Z"));
    expect(snapshot.freshness).toBe("stale");
    expect(snapshot.successAgeMs).toBe(120_000);
  });

  it("marks a running attempt incomplete when its lock owner is gone", async () => {
    const root = makeRoot();
    const store = new AIDiscoveryStore(root);
    const run = makeRun();
    await store.begin({ runId: run.runId, trigger: run.trigger, status: "running", startedAt: run.startedAt });
    const snapshot = await store.snapshot();
    expect(snapshot.lastAttempt?.status).toBe("incomplete");
    expect(snapshot.lastAttempt?.reason).toBe("write_failed");
  });

  it("refuses confirmation of a stale report even when its hash is valid", async () => {
    const root = makeRoot();
    const store = new AIDiscoveryStore(root, { staleAfterMs: 60_000 });
    const run = makeRun();
    const digest = await store.complete(run, "complete");
    await expect(store.recordDecision({
      runId: run.runId,
      reportSha256: digest,
      candidateId: "candidate-good",
      decision: "nominate_for_task_evaluation",
      idempotencyKey: "stale-decision-request-0001",
      now: new Date("2026-11-11T01:03:00.000Z"),
    })).rejects.toThrow("discovery evidence is stale");
  });

  it("shares a process-safe lock and releases only its own nonce", async () => {
    const root = makeRoot();
    const first = await acquireAIDiscoveryLock(root);
    expect(first.acquired).toBe(true);
    const second = await acquireAIDiscoveryLock(root);
    expect(second.acquired).toBe(false);
    if (first.acquired) await first.release();
    const third = await acquireAIDiscoveryLock(root);
    expect(third.acquired).toBe(true);
    if (third.acquired) await third.release();
  });

  it("calculates the next daily run in Europe/Moscow time", () => {
    expect(nextAiDiscoveryRunAt(new Date("2026-11-11T00:00:00.000Z"))).toBe("2026-11-11T01:00:00.000Z");
    expect(nextAiDiscoveryRunAt(new Date("2026-11-11T01:01:00.000Z"))).toBe("2026-11-12T01:00:00.000Z");
  });

  it("records credential state without serializing the credential value", async () => {
    const root = makeRoot();
    const envPath = join(root, "service.env");
    const secret = "test-only-secret-value";
    writeFileSync(envPath, "OPENCODE_API_KEY=" + secret + "\n");
    const generation = await credentialGeneration(envPath, { OPENCODE_API_KEY: secret });
    expect(generation).toContain("configured");
    expect(generation).not.toContain(secret);
  });

  it("restarts an accepted manual request after a process restart, then keeps its terminal result idempotent", async () => {
    const root = makeRoot();
    const key = "manual-recovery-request-0001";
    const firstStore = new AIDiscoveryStore(root);
    const first = await firstStore.reserveManualRequest(key, new Date("2026-11-11T02:00:00.000Z"));
    expect(first).toMatchObject({ created: true, shouldStart: true });

    // Simulate a new process after the reservation was durable but before the
    // coordinator started. The same key must resume rather than strand it.
    const restartedStore = new AIDiscoveryStore(root);
    const recovered = await restartedStore.reserveManualRequest(key, new Date("2026-11-11T02:01:00.000Z"));
    expect(recovered).toMatchObject({ created: false, requestId: first.requestId, shouldStart: true });

    const run: DiscoveryRunReceipt = {
      ...makeRun(),
      trigger: "manual",
      requestId: first.requestId,
    };
    await restartedStore.complete(run, "complete");
    const replay = await restartedStore.reserveManualRequest(key);
    expect(replay).toMatchObject({ created: false, requestId: first.requestId, shouldStart: false });
    expect((await restartedStore.snapshot()).latestManualRequest).toMatchObject({
      requestId: first.requestId,
      status: "complete",
      runId: run.runId,
    });
  });

  it("repairs a partial manual-request receipt without losing its resumable state", async () => {
    const root = makeRoot();
    const store = new AIDiscoveryStore(root);
    const key = "manual-partial-receipt-0001";
    const reservation = await store.reserveManualRequest(key);
    unlinkSync(join(root, "manual-requests", reservation.requestId + ".sha256"));
    unlinkSync(join(root, "manual-requests", reservation.requestId + ".complete.json"));

    const recovered = await new AIDiscoveryStore(root).reserveManualRequest(key);
    expect(recovered).toMatchObject({ created: false, requestId: reservation.requestId, shouldStart: true });
    expect(readFileSync(join(root, "manual-requests", reservation.requestId + ".complete.json"), "utf8")).toContain("requestSha256");
  });

  it("does not expose a manual-request status when its receipt hash is invalid", async () => {
    const root = makeRoot();
    const store = new AIDiscoveryStore(root);
    const reservation = await store.reserveManualRequest("manual-invalid-hash-0001");
    writeFileSync(join(root, "manual-requests", reservation.requestId + ".sha256"), "f".repeat(64) + "\n");
    expect((await store.snapshot()).latestManualRequest).toBeNull();
  });

  it("keeps a manual request resumable when durable run writing fails", async () => {
    const root = makeRoot();
    const store = new AIDiscoveryStore(root);
    const reservation = await store.reserveManualRequest("manual-write-failure-0001");
    await store.begin({
      runId: "20261111T010000Z-00000000-0000-4000-8000-000000000002",
      trigger: "manual",
      requestId: reservation.requestId,
      status: "running",
      startedAt: "2026-11-11T01:00:00.000Z",
    });
    await store.fail({
      runId: "20261111T010000Z-00000000-0000-4000-8000-000000000002",
      trigger: "manual",
      requestId: reservation.requestId,
      status: "failed",
      startedAt: "2026-11-11T01:00:00.000Z",
      finishedAt: "2026-11-11T01:00:01.000Z",
      reason: "write_failed",
    });
    expect(await store.reserveManualRequest("manual-write-failure-0001")).toMatchObject({ shouldStart: true });
    expect((await store.snapshot()).lastAttempt?.reason).toBe("write_failed");
  });

  it("does not start a second scan while the request is running, but makes a dead run resumable", async () => {
    const root = makeRoot();
    const store = new AIDiscoveryStore(root);
    const key = "manual-running-request-0001";
    const reservation = await store.reserveManualRequest(key);
    const lock = await acquireAIDiscoveryLock(root);
    expect(lock.acquired).toBe(true);
    await store.begin({
      runId: "20261111T010000Z-00000000-0000-4000-8000-000000000001",
      trigger: "manual",
      requestId: reservation.requestId,
      status: "running",
      startedAt: "2026-11-11T01:00:00.000Z",
    });
    expect((await store.reserveManualRequest(key)).shouldStart).toBe(false);
    if (lock.acquired) await lock.release();
    expect(await store.reserveManualRequest(key)).toMatchObject({ shouldStart: true });
    expect((await store.snapshot()).latestManualRequest?.status).toBe("incomplete");
  });
});
