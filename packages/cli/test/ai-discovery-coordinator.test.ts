import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIDiscoveryCoordinator } from "../src/admin/ai-discovery-coordinator.js";
import { acquireAIDiscoveryLock, type AIDiscoveryDecisionReceipt } from "../src/admin/ai-discovery-store.js";
import type { AITaskEvaluationReport } from "../src/admin/ai-task-evaluation.js";
import type { OpenCodeDiscoveryReport } from "../src/admin/ai-model-discovery.js";
import { scoreGmCorpus } from "../src/conversation/gm-scorecard.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "skald-ai-discovery-coordinator-"));
  roots.push(root);
  return root;
}

function report(status: OpenCodeDiscoveryReport["status"] = "complete"): OpenCodeDiscoveryReport {
  return {
    schema: "SKALD_AI_MODEL_DISCOVERY_V1",
    status,
    startedAt: "2026-11-11T01:00:00.000Z",
    finishedAt: "2026-11-11T01:01:00.000Z",
    source: { region: "RU", catalogModelCount: 1, freeChatCount: 1, catalogDigest: "a".repeat(64) },
    policy: { maxConcurrency: 2, maxCandidates: 24, maxCalls: 96, timeoutMs: 25_000, maxDurationMs: 12 * 60_000, transport: "opencode_cli" },
    providerCallCount: 2,
    candidates: [{
      id: "candidate",
      model: "opencode/candidate",
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
      id: "candidate",
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

function taskReport(input: {
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
    startedAt: "2026-11-11T01:02:00.000Z",
    finishedAt: "2026-11-11T01:03:00.000Z",
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

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("AIDiscoveryCoordinator", () => {
  it("resolves durable storage from SKALD_ENV_FILE before opening the store", async () => {
    const root = makeRoot();
    const envFile = join(root, "service.env");
    const directory = join(root, "durable");
    writeFileSync(envFile, "SKALD_AI_DISCOVERY_DIR=" + directory + "\nSKALD_OPENCODE_REGION=RU\n");
    const env = { SKALD_ENV_FILE: envFile };
    const coordinator = new AIDiscoveryCoordinator({ env, cwd: root, screen: async () => report() });
    expect(coordinator.store.directory).toBe(directory);
    const result = await coordinator.refresh("manual");
    expect(result.state).toBe("complete");
    expect((await coordinator.store.snapshot()).latestRun?.runId).toBe(result.runId);
    expect(env).toEqual({ SKALD_ENV_FILE: envFile });
  });

  it("coalesces concurrent manual and scheduled requests into one durable scan", async () => {
    const root = makeRoot();
    let scans = 0;
    let unblock: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    const coordinator = new AIDiscoveryCoordinator({
      directory: root,
      env: { OPENCODE_API_KEY: "secret", SKALD_OPENCODE_RUN: "1" },
      cwd: root,
      screen: async () => { scans += 1; await gate; return report(); },
      now: () => new Date("2026-11-11T01:00:00.000Z"),
    });
    const daily = coordinator.refresh("daily");
    const manual = coordinator.refresh("manual");
    expect(manual).toBe(daily);
    unblock?.();
    const [first, second] = await Promise.all([daily, manual]);
    expect(scans).toBe(1);
    expect(first).toEqual(second);
    expect(first.state).toBe("complete");
    const snapshot = await coordinator.store.snapshot(new Date("2026-11-11T01:02:00.000Z"));
    expect(snapshot.lastAttempt?.trigger).toBe("daily");
    expect(snapshot.lastAttempt?.status).toBe("complete");
    expect(snapshot.latestRun?.report).toMatchObject(report());
    expect((snapshot.latestRun?.report as unknown as OpenCodeDiscoveryReport).changes).toMatchObject({
      comparison: "baseline",
      baselineRunId: null,
      observedModelIds: ["candidate"],
      testedModelIds: ["candidate"],
      rejectedModelIds: [],
      servingRouteChanged: false,
    });
  });

  it("persists a day-over-day catalogue, price, eligibility and screening delta without routing changes", async () => {
    const root = makeRoot();
    let scans = 0;
    const baseReport = report();
    const baseline: OpenCodeDiscoveryReport = {
      ...baseReport,
      source: { ...baseReport.source, catalogModelCount: 2 },
      catalogSnapshot: [
        ...baseReport.catalogSnapshot!,
        {
          id: "removed-model",
          type: "chat",
          inputModalities: ["text"],
          outputModalities: ["text"],
          apiFamilies: ["chat-completions"],
          textInputPrice: 0,
          textOutputPrice: 0,
          hasConditionalTextPricing: false,
          eligibility: "eligible",
          transport: "opencode_cli",
        },
      ],
    };
    const second: OpenCodeDiscoveryReport = {
      ...report(),
      source: { ...report().source, catalogModelCount: 2, freeChatCount: 1, catalogDigest: "b".repeat(64) },
      catalogSnapshot: [
        {
          id: "candidate",
          type: "chat",
          inputModalities: ["text"],
          outputModalities: ["text"],
          apiFamilies: ["chat-completions"],
          textInputPrice: 0.02,
          textOutputPrice: 0,
          hasConditionalTextPricing: false,
          eligibility: "excluded",
          exclusionReason: "not_free",
          transport: "opencode_cli",
        },
        {
          id: "new-model",
          type: "chat",
          inputModalities: ["text"],
          outputModalities: ["text"],
          apiFamilies: ["chat-completions"],
          textInputPrice: 0,
          textOutputPrice: 0,
          hasConditionalTextPricing: false,
          eligibility: "eligible",
          transport: "opencode_cli",
        },
      ],
      candidates: [
        { ...report().candidates[0]!, screening: "fail" },
        { ...report().candidates[0]!, id: "new-model", model: "opencode/new-model", screening: "pass" },
      ],
    };
    const coordinator = new AIDiscoveryCoordinator({
      directory: root,
      env: { OPENCODE_API_KEY: "secret", SKALD_OPENCODE_RUN: "1" },
      screen: async () => scans++ === 0 ? baseline : second,
      now: () => new Date("2026-11-11T01:00:00.000Z"),
    });
    await coordinator.refresh("daily");
    const result = await coordinator.refresh("daily");
    expect(result.report?.changes).toMatchObject({
      comparison: "compared",
      newModelIds: ["new-model"],
      removedModelIds: ["removed-model"],
      priceChanged: [{
        id: "candidate",
        previous: { input: 0, output: 0 },
        current: { input: 0.02, output: 0 },
      }],
      eligibilityChanged: [{ id: "candidate", previous: true, current: false }],
      screeningChanged: [{ id: "candidate", previous: "pass", current: "fail" }],
      testedModelIds: ["candidate", "new-model"],
      rejectedModelIds: ["candidate"],
      servingRouteChanged: false,
    });
  });

  it("persists failed scan evidence rather than leaving only an ephemeral error", async () => {
    const root = makeRoot();
    const coordinator = new AIDiscoveryCoordinator({
      directory: root,
      env: { OPENCODE_API_KEY: "secret", SKALD_OPENCODE_RUN: "1" },
      cwd: root,
      screen: async () => { throw new Error("upstream secret must not be written"); },
      now: () => new Date("2026-11-11T01:00:00.000Z"),
    });
    const result = await coordinator.refresh("daily");
    const snapshot = await coordinator.store.snapshot();
    expect(result.state).toBe("failed");
    expect(result.report?.failureReason).toBe("screening_failed");
    expect(snapshot.latestRun?.report).toEqual(result.report);
    expect(snapshot.latestFailedRun?.runId).toBe(result.runId);
    expect(snapshot.lastAttempt?.status).toBe("failed");
    expect(JSON.stringify(snapshot)).not.toContain("upstream secret");
  });

  it("uses rotated service env values for the next manual scan", async () => {
    const root = makeRoot();
    const envPath = join(root, "service.env");
    writeFileSync(envPath, "OPENCODE_API_KEY=rotated-secret\nSKALD_OPENCODE_RUN=1\n");
    let observedKey: string | undefined;
    const coordinator = new AIDiscoveryCoordinator({
      directory: join(root, "reports"),
      env: { SKALD_ENV_FILE: envPath, OPENCODE_API_KEY: "old-secret", SKALD_OPENCODE_RUN: "0" },
      cwd: root,
      screen: async (options) => {
        observedKey = options?.env?.OPENCODE_API_KEY;
        return report();
      },
    });
    await coordinator.refresh("manual");
    expect(observedKey).toBe("rotated-secret");
    const snapshotText = JSON.stringify(await coordinator.store.snapshot());
    expect(snapshotText).not.toContain("rotated-secret");
    expect(snapshotText).not.toContain("old-secret");
  });

  it("records the effective service-file region when screening fails", async () => {
    const root = makeRoot();
    const envPath = join(root, "service.env");
    writeFileSync(envPath, "SKALD_OPENCODE_REGION=US\n");
    const coordinator = new AIDiscoveryCoordinator({
      directory: join(root, "reports"),
      env: { SKALD_ENV_FILE: envPath },
      cwd: root,
      screen: async () => { throw new Error("upstream unavailable"); },
    });

    const result = await coordinator.refresh("manual");

    expect(result.report?.failureReason).toBe("screening_failed");
    expect(result.report?.source.region).toBe("US");
    expect((await coordinator.store.snapshot()).latestFailedRun?.report.source).toMatchObject({ region: "US" });
  });

  it("does not start a second process while another owner holds the lock", async () => {
    const root = makeRoot();
    const holder = await acquireAIDiscoveryLock(root);
    expect(holder.acquired).toBe(true);
    let scans = 0;
    const coordinator = new AIDiscoveryCoordinator({
      directory: root,
      env: { OPENCODE_API_KEY: "secret", SKALD_OPENCODE_RUN: "1" },
      screen: async () => { scans += 1; return report(); },
    });
    const result = await coordinator.refresh("manual");
    expect(result.state).toBe("already_running");
    expect(scans).toBe(0);
    if (holder.acquired) await holder.release();
  });

  it("automatically resumes a confirmed task evaluation after a discovery owner releases the shared lock", async () => {
    const root = makeRoot();
    let evaluations = 0;
    const fixedNow = () => new Date("2026-11-11T01:02:00.000Z");
    const coordinator = new AIDiscoveryCoordinator({
      directory: root,
      env: { OPENCODE_API_KEY: "secret", SKALD_OPENCODE_RUN: "1" },
      cwd: root,
      screen: async () => report(),
      evaluateTask: async (input) => { evaluations += 1; return taskReport(input); },
      now: fixedNow,
    });
    await coordinator.refresh("daily");
    const snapshot = await coordinator.store.snapshot(fixedNow());
    const decision: AIDiscoveryDecisionReceipt = await coordinator.store.recordDecision({
      runId: snapshot.latestRun!.runId,
      reportSha256: snapshot.latestRunSha256!,
      candidateId: "candidate",
      decision: "nominate_for_task_evaluation",
      idempotencyKey: "task-evaluation-lock-wait-0001",
      now: fixedNow(),
    });
    const holder = await acquireAIDiscoveryLock(root);
    expect(holder.acquired).toBe(true);
    if (!holder.acquired) throw new Error("test lock unavailable");

    const accepted = await coordinator.startTaskEvaluation(decision);
    expect(accepted.state).toBe("accepted");
    expect(evaluations).toBe(0);
    await holder.release();

    let evaluation = await coordinator.store.getTaskEvaluation(decision.decisionId, fixedNow());
    for (let attempt = 0; attempt < 100 && evaluation?.request.status !== "complete"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      evaluation = await coordinator.store.getTaskEvaluation(decision.decisionId, fixedNow());
    }
    expect(evaluations).toBe(1);
    expect(evaluation).toMatchObject({
      request: { status: "complete", candidateId: "candidate" },
      report: { machineVerdict: "pass", humanReview: "required" },
    });
  });
});
