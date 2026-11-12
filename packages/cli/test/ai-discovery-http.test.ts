import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIDiscoveryCoordinator } from "../src/admin/ai-discovery-coordinator.js";
import type { AITaskEvaluationReport } from "../src/admin/ai-task-evaluation.js";
import type { OpenCodeDiscoveryReport } from "../src/admin/ai-model-discovery.js";
import { scoreGmCorpus } from "../src/conversation/gm-scorecard.js";
import { startServer, type StartedServer } from "../src/http-server.js";

let server: StartedServer | undefined;
let root: string | undefined;

function makeReport(): OpenCodeDiscoveryReport {
  return {
    schema: "SKALD_AI_MODEL_DISCOVERY_V1",
    status: "complete",
    startedAt: "2026-11-11T01:00:00.000Z",
    finishedAt: "2026-11-11T01:01:00.000Z",
    source: { region: "RU", catalogModelCount: 1, freeChatCount: 1, catalogDigest: "c".repeat(64) },
    policy: { maxConcurrency: 2, maxCandidates: 24, maxCalls: 96, timeoutMs: 25_000, maxDurationMs: 12 * 60_000, transport: "opencode_cli" },
    providerCallCount: 2,
    candidates: [{
      id: "screened-model",
      model: "opencode/screened-model",
      preferred: false,
      textInputPrice: 0,
      textOutputPrice: 0,
      transport: "opencode_cli",
      interpret: { status: "ok", latencyMs: 10 },
      narrate: { status: "ok", latencyMs: 11 },
      screening: "pass",
      taskEvaluation: "not_run",
      activation: "not_approved",
    }],
    catalogSnapshot: [{
      id: "screened-model",
      type: "chat",
      inputModalities: ["text"],
      outputModalities: ["text"],
      apiFamilies: ["chat-completions"],
      textInputPrice: 0,
      textOutputPrice: 0,
      hasConditionalTextPricing: false,
      eligibility: "eligible",
      transport: "opencode_cli",
    }],
    exclusions: [],
  };
}

function makeTaskReport(input: {
  readonly decisionId: string;
  readonly discoveryRunId: string;
  readonly discoveryReportSha256: string;
  readonly candidateId: string;
  readonly actualCommit: string | null;
}): AITaskEvaluationReport {
  return {
    schema: "SKALD_AI_TASK_EVALUATION_V1",
    status: "complete",
    machineVerdict: "pass",
    humanReview: "required",
    startedAt: "2026-11-11T02:01:00.000Z",
    finishedAt: "2026-11-11T02:02:00.000Z",
    actualCommit: input.actualCommit,
    evidence: {
      discoveryRunId: input.discoveryRunId,
      discoveryReportSha256: input.discoveryReportSha256,
      decisionId: input.decisionId,
      candidateId: input.candidateId,
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

async function setup(): Promise<{
  readonly base: string;
  readonly coordinator: AIDiscoveryCoordinator;
  readonly getScanCount: () => number;
  readonly getTaskEvaluationCount: () => number;
}> {
  root = mkdtempSync(join(tmpdir(), "skald-ai-discovery-http-"));
  let scans = 0;
  let taskEvaluations = 0;
  const coordinator = new AIDiscoveryCoordinator({
    directory: join(root, "discovery"),
    env: { OPENCODE_API_KEY: "test-secret", SKALD_OPENCODE_RUN: "1" },
    cwd: root,
    screen: async () => { scans += 1; return makeReport(); },
    evaluateTask: async (input) => { taskEvaluations += 1; return makeTaskReport(input); },
  });
  server = await startServer({
    host: "127.0.0.1",
    port: 0,
    dbPath: join(root, "events.sqlite"),
    router: null,
    discoverAI: false,
    aiDiscoveryCoordinator: coordinator,
  });
  return {
    base: server.url,
    coordinator,
    getScanCount: () => scans,
    getTaskEvaluationCount: () => taskEvaluations,
  };
}

afterEach(async () => {
  await server?.close();
  server = undefined;
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("loopback AI model discovery API", () => {
  it("returns persisted status, accepts manual refresh, and supports explicit task-evaluation nomination", async () => {
    const { base, coordinator, getScanCount, getTaskEvaluationCount } = await setup();
    const initialResponse = await fetch(base + "/api/ops/ai-discovery");
    expect(initialResponse.status).toBe(200);
    const initial = await initialResponse.json() as { discovery: { freshness: string }; report: unknown };
    expect(initial.discovery.freshness).toBe("missing");
    expect(initial.report).toBeNull();

    const refresh = await fetch(base + "/api/ops/ai-discovery/refresh", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "manual-discovery-key-0001" },
      body: "{}",
    });
    expect(refresh.status).toBe(202);
    const refreshBody = await refresh.json() as { state: string; requestId: string; statusUrl: string };
    expect(refreshBody.state).toBe("accepted");
    expect(refreshBody.statusUrl).toBe("/api/ops/ai-discovery");
    const replay = await fetch(base + "/api/ops/ai-discovery/refresh", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "manual-discovery-key-0001" },
      body: "{}",
    });
    expect(replay.status).toBe(202);
    expect(await replay.json()).toEqual({ ok: true, state: "already_requested", requestId: refreshBody.requestId, statusUrl: "/api/ops/ai-discovery" });

    let snapshot = await coordinator.store.snapshot();
    for (let attempt = 0; attempt < 50 && snapshot.latestRun === null; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      snapshot = await coordinator.store.snapshot();
    }
    expect(snapshot.latestRun?.report).toMatchObject(makeReport());
    expect(snapshot.latestRun?.report).toMatchObject({
      changes: { comparison: "baseline", observedModelIds: ["screened-model"], servingRouteChanged: false },
    });
    expect(snapshot.latestRunSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(snapshot.lastAttempt?.requestId).toBe(refreshBody.requestId);
    expect(getScanCount()).toBe(1);

    const response = await fetch(base + "/api/ops/ai-discovery/decision", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "decision-http-key-0001" },
      body: JSON.stringify({
        runId: snapshot.latestRun!.runId,
        reportSha256: snapshot.latestRunSha256,
        candidateId: "screened-model",
        decision: "nominate_for_task_evaluation",
      }),
    });
    expect(response.status).toBe(202);
    const decision = await response.json() as {
      servingRouteChanged: boolean;
      nextStep: string;
      taskEvaluation: { state: string; evaluationId: string };
    };
    expect(decision.servingRouteChanged).toBe(false);
    expect(decision.nextStep).toBe("poll_task_evaluation");
    expect(decision.taskEvaluation.state).toBe("running");
    expect((await coordinator.store.snapshot()).latestDecision?.candidateId).toBe("screened-model");

    let taskEvaluation = await coordinator.store.getTaskEvaluation(decision.taskEvaluation.evaluationId);
    for (let attempt = 0; attempt < 100 && taskEvaluation?.request.status !== "complete"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      taskEvaluation = await coordinator.store.getTaskEvaluation(decision.taskEvaluation.evaluationId);
    }
    expect(taskEvaluation).toMatchObject({
      request: { status: "complete", candidateId: "screened-model" },
      report: {
        status: "complete",
        machineVerdict: "pass",
        humanReview: "required",
        evidence: { candidateId: "screened-model" },
      },
    });

    const pollResponse = await fetch(base + "/api/ops/ai-discovery");
    expect(pollResponse.status).toBe(200);
    const pollBody = await pollResponse.json() as {
      taskEvaluation: { request: { status: string }; report: { humanReview: string } | null };
    };
    expect(pollBody.taskEvaluation).toMatchObject({
      request: { status: "complete" },
      report: { humanReview: "required" },
    });
    expect(getTaskEvaluationCount()).toBe(1);

    const decisionReplay = await fetch(base + "/api/ops/ai-discovery/decision", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "decision-http-key-0001" },
      body: JSON.stringify({
        runId: snapshot.latestRun!.runId,
        reportSha256: snapshot.latestRunSha256,
        candidateId: "screened-model",
        decision: "nominate_for_task_evaluation",
      }),
    });
    expect(decisionReplay.status).toBe(202);
    const replayBody = await decisionReplay.json() as { decision: unknown; taskEvaluation: { state: string } };
    expect(replayBody.decision).toEqual((await coordinator.store.snapshot()).latestDecision);
    expect(replayBody.taskEvaluation.state).toBe("complete");
    expect(getTaskEvaluationCount()).toBe(1);
    expect(server?.app.store.getPrimaryWorldId()).toBeNull();
  });

  it("resumes a durably reserved refresh when the prior process died before starting it", async () => {
    const { base, coordinator, getScanCount } = await setup();
    const key = "manual-discovery-crash-window-0001";
    const priorProcess = await coordinator.store.reserveManualRequest(key);
    expect(priorProcess).toMatchObject({ created: true, shouldStart: true });

    const resumed = await fetch(base + "/api/ops/ai-discovery/refresh", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: "{}",
    });
    expect(resumed.status).toBe(202);
    expect(await resumed.json()).toMatchObject({ ok: true, state: "already_requested", requestId: priorProcess.requestId });

    let snapshot = await coordinator.store.snapshot();
    for (let attempt = 0; attempt < 50 && snapshot.latestManualRequest?.status !== "complete"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      snapshot = await coordinator.store.snapshot();
    }
    expect(snapshot.latestManualRequest).toMatchObject({ requestId: priorProcess.requestId, status: "complete" });
    expect(getScanCount()).toBe(1);
    const poll = await fetch(base + "/api/ops/ai-discovery");
    expect(poll.status).toBe(200);
    const pollBody = await poll.json() as { discovery: { latestManualRequest: { requestId: string; status: string } } };
    expect(pollBody.discovery.latestManualRequest).toMatchObject({ requestId: priorProcess.requestId, status: "complete" });
  });

  it("rejects non-empty refresh input and stale or unsupported operator decisions", async () => {
    const { base } = await setup();
    const badRefresh = await fetch(base + "/api/ops/ai-discovery/refresh", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "manual-discovery-key-0003" },
      body: JSON.stringify({ playerInput: "ignored" }),
    });
    expect(badRefresh.status).toBe(400);

    const staleDecision = await fetch(base + "/api/ops/ai-discovery/decision", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "decision-http-key-0002" },
      body: JSON.stringify({
        runId: "20261111T010000Z-00000000-0000-4000-8000-000000000001",
        reportSha256: "0".repeat(64),
        candidateId: "candidate",
        decision: "nominate_for_task_evaluation",
      }),
    });
    expect(staleDecision.status).toBe(409);

    const invalidDecision = await fetch(base + "/api/ops/ai-discovery/decision", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "decision-http-key-0003" },
      body: JSON.stringify({ runId: "x", reportSha256: "x", candidateId: "x", decision: "activate_live" }),
    });
    expect(invalidDecision.status).toBe(400);
  });

  it("keeps model discovery separate from world creation and the Event Log", async () => {
    const { base } = await setup();
    const before = await (await fetch(base + "/api/worlds")).json();
    const refresh = await fetch(base + "/api/ops/ai-discovery/refresh", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "manual-discovery-key-0004" },
      body: "{}",
    });
    expect(refresh.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const after = await (await fetch(base + "/api/worlds")).json();
    expect(after).toEqual(before);
    expect(server?.app.store.getPrimaryWorldId()).toBeNull();
  });
});
