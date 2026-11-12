import { describe, expect, it } from "vitest";
import type { OpenCodeCatalogModel, OpenCodeCatalogReport } from "@skald/world";
import {
  AI_TASK_EVALUATION_CORPUS_VERSION,
  AI_TASK_NARRATION_CORPUS,
  evaluateOpenCodeTaskCandidate,
} from "../src/admin/ai-task-evaluation.js";

const input = {
  decisionId: "a".repeat(64),
  discoveryRunId: "20261111T010000Z-00000000-0000-4000-8000-000000000001",
  discoveryReportSha256: "b".repeat(64),
  candidateId: "candidate-free",
  actualCommit: "c".repeat(40),
} as const;

function makeModel(overrides: Partial<OpenCodeCatalogModel> = {}): OpenCodeCatalogModel {
  return {
    id: input.candidateId,
    type: "chat",
    name: "Task evaluation test model",
    inputModalities: ["text"],
    outputModalities: ["text"],
    apiFamilies: ["chat-completions"],
    textInputPrice: 0,
    textOutputPrice: 0,
    hasConditionalTextPricing: false,
    zeroPriceTextChat: true,
    clientRestriction: "opencode_cli",
    ...overrides,
  };
}

function makeCatalog(model: OpenCodeCatalogModel): OpenCodeCatalogReport {
  return {
    provider: "opencode_zen",
    status: "ok",
    phase: "response_decode",
    modelIds: [model.id],
    models: [model],
    eligibleFreeChatIds: model.zeroPriceTextChat ? [model.id] : [],
    sourceUrl: "https://opencode.ai/inference/v1/models",
    catalogDigest: "d".repeat(64),
  };
}

describe("AI task-evaluation corpus", () => {
  it("is a fixed, non-empty Russian corpus with distinct case ids and mandatory facts", () => {
    expect(AI_TASK_EVALUATION_CORPUS_VERSION).toBe("ai-task-corpus-v1");
    expect(AI_TASK_NARRATION_CORPUS).toHaveLength(10);
    expect(new Set(AI_TASK_NARRATION_CORPUS.map((entry) => entry.id)).size).toBe(10);
    for (const entry of AI_TASK_NARRATION_CORPUS) {
      expect(entry.question).not.toHaveLength(0);
      expect(entry.mandatory.length).toBeGreaterThan(0);
      expect(entry.mandatory.every((mandatory) => entry.facts.some((fact) => fact.content === mandatory))).toBe(true);
    }
  });

  it("blocks before catalogue or inference work when native transport is disabled", async () => {
    let fetchCalls = 0;
    const report = await evaluateOpenCodeTaskCandidate(input, {
      env: { SKALD_OPENCODE_RUN: "0" },
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("must not fetch");
      },
    });

    expect(report).toMatchObject({
      status: "blocked",
      machineVerdict: "blocked",
      failureCode: "native_transport_disabled",
      humanReview: "required",
      evidence: { decisionId: input.decisionId, candidateId: input.candidateId },
    });
    expect(fetchCalls).toBe(0);
    expect(report.policy.providerCallCount).toBe(0);
    expect(report.evidence.corpusDigest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("rechecks the current exact zero-price and transport contract before any model call", async () => {
    const env = { SKALD_OPENCODE_RUN: "1", OPENCODE_API_KEY: "test-only" };
    const model = makeModel({ textOutputPrice: 0.0001, zeroPriceTextChat: false });
    const report = await evaluateOpenCodeTaskCandidate(input, { env, catalog: makeCatalog(model) });

    expect(report).toMatchObject({
      status: "blocked",
      failureCode: "candidate_not_free",
      evidence: { catalogDigest: "d".repeat(64) },
      policy: { providerCallCount: 0 },
    });
    expect(report.director.score?.corpusSize).toBe(0);
  });

  it("blocks a model documented as unavailable in the target region before inference", async () => {
    const model = makeModel({ id: "beam-free" });
    const report = await evaluateOpenCodeTaskCandidate({ ...input, candidateId: "beam-free" }, {
      env: { SKALD_OPENCODE_RUN: "1", OPENCODE_API_KEY: "test-only", SKALD_OPENCODE_REGION: "RU" },
      catalog: makeCatalog(model),
    });

    expect(report).toMatchObject({
      status: "blocked",
      failureCode: "region_restricted",
      evidence: { candidateId: "beam-free", region: "RU" },
      policy: { providerCallCount: 0 },
    });
  });

  it("fails closed when the provider credential is absent, even with a free catalogue row", async () => {
    const report = await evaluateOpenCodeTaskCandidate(input, {
      env: { SKALD_OPENCODE_RUN: "1" },
      catalog: makeCatalog(makeModel()),
    });

    expect(report).toMatchObject({ status: "blocked", failureCode: "credential_missing" });
    expect(report.policy.providerCallCount).toBe(0);
  });
});
