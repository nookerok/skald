import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createOpenCodeGenerationBudget,
  type OpenCodeGenerationReservation,
} from "../src/acceptance/opencode-live-budget.js";
import {
  readOpenCodePaidBudgetLedger,
  reserveOpenCodePaidBudget,
} from "../src/acceptance/opencode-paid-budget-ledger.js";

const baseUrl = "http://127.0.0.1:43127";
const reservedTests: string[] = [];

function modelCatalog(inputPrice = 0, outputPrice = 0, withPrice = true): Response {
  return Response.json({ data: [{
    providerID: "test-provider",
    modelID: "test-model",
    limit: { context: 1_000, input: 900, output: 100 },
    ...(withPrice ? {
      cost: [{ input: inputPrice, output: outputPrice, cache: { read: inputPrice, write: inputPrice } }],
    } : {}),
  }] });
}

function makeFetch(options?: {
  inputPrice?: number;
  outputPrice?: number;
  actualCost?: number;
  withPrice?: boolean;
  modelListStatus?: number;
  generationStatus?: number;
}) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    calls.push({ url, method });
    const parsed = new URL(url);
    if (parsed.pathname === "/api/model") {
      if (options?.modelListStatus && options.modelListStatus !== 200) {
        return Response.json({ error: { code: "provider_unavailable" } }, { status: options.modelListStatus });
      }
      return modelCatalog(options?.inputPrice ?? 0, options?.outputPrice ?? 0, options?.withPrice ?? true);
    }
    if (parsed.pathname === "/api/session" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { id: string };
      return Response.json({ data: { id: body.id } }, { status: 200 });
    }
    if (/^\/api\/session\/[^/]+\/generate$/u.test(parsed.pathname) && method === "POST") {
      if (options?.generationStatus && options.generationStatus !== 200) {
        return Response.json({ error: { code: "provider_unavailable" } }, { status: options.generationStatus });
      }
      return Response.json({ data: { text: "OK", cost: options?.actualCost ?? 0, tokens: { input: 10, output: 2 } } });
    }
    if (/^\/api\/session\/[^/]+$/u.test(parsed.pathname) && method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return Response.json({ ok: true });
  });
  return { fetchImpl, calls };
}

function createBudget(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createOpenCodeGenerationBudget>[0]> = {},
) {
  return createOpenCodeGenerationBudget({
    baseUrl,
    maxGenerationRequests: 1,
    maxReservedCostUsd: 0.37,
    maxInputTokens: 900,
    maxOutputTokens: 100,
    fetchImpl,
    ...overrides,
  });
}

async function prepareSession(budget: ReturnType<typeof createBudget>, id: string): Promise<void> {
  await budget.fetch(baseUrl + "/api/model");
  await budget.fetch(baseUrl + "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id,
      model: { providerID: "test-provider", id: "test-model" },
    }),
  });
}

describe("OpenCode live generation budget", () => {
  it("counts the v2 transient generate endpoint and blocks excess requests before fetch", async () => {
    const { fetchImpl, calls } = makeFetch();
    const onReserve = vi.fn<(reservation: OpenCodeGenerationReservation) => void>();
    const budget = createBudget(fetchImpl, { onReserve });

    await budget.fetch(baseUrl + "/api/info");
    await expect(budget.fetch(baseUrl + "/api/experimental/generate/text", { method: "POST" }))
      .rejects.toThrow("unrecognized generation endpoint");
    await budget.fetch("http://127.0.0.1:43128/api/session/sess-foreign/generate", { method: "POST" });
    await prepareSession(budget, "sess-1");
    await budget.fetch(baseUrl + "/api/session/sess-1/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "test" }),
    });
    await budget.fetch(baseUrl + "/api/session/sess-1", { method: "DELETE" });
    await prepareSession(budget, "sess-2");
    await expect(budget.fetch(baseUrl + "/api/session/sess-2/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "second" }),
    })).rejects.toThrow("generation request budget exhausted");

    expect(calls.filter((call) => call.url.startsWith(baseUrl) && call.url.endsWith("/generate"))).toHaveLength(1);
    expect(onReserve).toHaveBeenCalledTimes(1);
    expect(budget.snapshot()).toMatchObject({
      generationRequests: 1,
      successfulGenerationResponses: 1,
      failedGenerationResponses: 0,
      modelCatalogRequests: 2,
      modelCatalogFailures: 0,
      blockedRequests: 2,
      blockedReasonCounts: {
        unrecognized_generation_endpoint: 1,
        generation_request_cap: 1,
        invalid_session_identity: 0,
        session_model_price_unverified: 0,
        reservation_cap: 0,
        reservation_persist_failed: 0,
      },
      maxGenerationRequests: 1,
      reservedCostUsd: 0,
      reportedCostUsd: 0,
      unknownCostRequests: 0,
      reservationViolations: 0,
    });
  });

  it("reports a model-catalog failure without claiming a generation occurred", async () => {
    const { fetchImpl } = makeFetch({ modelListStatus: 503 });
    const budget = createBudget(fetchImpl);

    const response = await budget.fetch(baseUrl + "/api/model");

    expect(response.status).toBe(503);
    expect(budget.snapshot()).toMatchObject({
      generationRequests: 0,
      successfulGenerationResponses: 0,
      failedGenerationResponses: 0,
      modelCatalogRequests: 1,
      modelCatalogFailures: 1,
      lastFailureEndpoint: "model_catalog",
      lastFailureHttpStatus: 503,
    });
  });

  it("records a failed generation response separately from successful model output", async () => {
    const { fetchImpl } = makeFetch({ inputPrice: 1, outputPrice: 1, generationStatus: 503 });
    const budget = createBudget(fetchImpl);
    await prepareSession(budget, "provider-error");

    const response = await budget.fetch(baseUrl + "/api/session/provider-error/generate", {
      method: "POST",
      body: JSON.stringify({ prompt: "test" }),
    });

    expect(response.status).toBe(503);
    expect(budget.snapshot()).toMatchObject({
      generationRequests: 1,
      successfulGenerationResponses: 0,
      failedGenerationResponses: 1,
      lastFailureEndpoint: "generation",
      lastFailureHttpStatus: 503,
      unknownCostRequests: 1,
    });
  });

  it("reserves worst-case priced tokens and blocks before an over-budget generation", async () => {
    const { fetchImpl, calls } = makeFetch({ inputPrice: 10, outputPrice: 20 });
    const onReserve = vi.fn<(reservation: OpenCodeGenerationReservation) => void>();
    const budget = createBudget(fetchImpl, { maxReservedCostUsd: 0.01, onReserve });
    await prepareSession(budget, "paid-session");

    await expect(budget.fetch(baseUrl + "/api/session/paid-session/generate", {
      method: "POST", body: JSON.stringify({ prompt: "bounded prompt" }),
    })).rejects.toThrow("USD reservation budget exhausted");

    expect(calls.some((call) => call.url.endsWith("/generate"))).toBe(false);
    expect(onReserve).not.toHaveBeenCalled();
    expect(budget.snapshot()).toMatchObject({
      generationRequests: 0,
      blockedRequests: 1,
      blockedReasonCounts: { reservation_cap: 1 },
      reservedCostUsd: 0,
      remainingBudgetUsd: 0.01,
    });
  });

  it("records an up-front reservation and the model-reported cost without exceeding the cap", async () => {
    const { fetchImpl } = makeFetch({ inputPrice: 10, outputPrice: 20, actualCost: 0.005 });
    const onReserve = vi.fn<(reservation: OpenCodeGenerationReservation) => void>();
    const budget = createBudget(fetchImpl, { maxReservedCostUsd: 0.02, onReserve });
    await prepareSession(budget, "paid-session");
    await budget.fetch(baseUrl + "/api/session/paid-session/generate", {
      method: "POST", body: JSON.stringify({ prompt: "bounded prompt" }),
    });

    expect(onReserve).toHaveBeenCalledWith(expect.objectContaining({
      model: "test-provider/test-model",
      reservedUsd: 0.011,
      inputPricePerMillionUsd: 10,
      outputPricePerMillionUsd: 20,
      maxInputTokens: 900,
      maxOutputTokens: 100,
    }));
    expect(budget.snapshot()).toMatchObject({
      generationRequests: 1,
      successfulGenerationResponses: 1,
      failedGenerationResponses: 0,
      reservedCostUsd: 0.011,
      reportedCostUsd: 0.005,
      unknownCostRequests: 0,
      reservationViolations: 0,
    });
    expect(budget.snapshot().remainingBudgetUsd).toBeCloseTo(0.009, 8);
  });

  it("fails closed before generation if model pricing is absent or a reservation cannot be persisted", async () => {
    const missing = makeFetch({ withPrice: false });
    const missingBudget = createBudget(missing.fetchImpl);
    await prepareSession(missingBudget, "missing-price");
    await expect(missingBudget.fetch(baseUrl + "/api/session/missing-price/generate", {
      method: "POST", body: JSON.stringify({ prompt: "test" }),
    })).rejects.toThrow("cannot verify the session model price");
    expect(missing.calls.some((call) => call.url.endsWith("/generate"))).toBe(false);

    const persisted = makeFetch({ inputPrice: 10, outputPrice: 20 });
    const failedBudget = createBudget(persisted.fetchImpl, {
      maxReservedCostUsd: 0.02,
      onReserve: () => { throw new Error("ledger unavailable"); },
    });
    await prepareSession(failedBudget, "reservation-failure");
    await expect(failedBudget.fetch(baseUrl + "/api/session/reservation-failure/generate", {
      method: "POST", body: JSON.stringify({ prompt: "test" }),
    })).rejects.toThrow("could not persist the spend reservation");
    expect(persisted.calls.some((call) => call.url.endsWith("/generate"))).toBe(false);
    expect(missingBudget.snapshot().blockedReasonCounts.session_model_price_unverified).toBe(1);
    expect(failedBudget.snapshot().blockedReasonCounts.reservation_persist_failed).toBe(1);
  });

  it("requires a loopback endpoint and explicit positive request/token limits", () => {
    expect(() => createBudget(fetch, { baseUrl: "https://opencode.example" })).toThrow("127.0.0.1");
    expect(() => createBudget(fetch, { maxGenerationRequests: 0 })).toThrow("positive safe integer");
    expect(() => createBudget(fetch, { maxReservedCostUsd: -0.01 })).toThrow("non-negative USD");
    expect(() => createBudget(fetch, { maxInputTokens: 0 })).toThrow("positive token limits");
  });
});

function budgetFixture(authorizedUsd = 1) {
  const root = mkdtempSync(join(tmpdir(), "opencode-paid-budget-test-"));
  reservedTests.push(root);
  const path = join(root, "budget.json");
  writeFileSync(path, JSON.stringify({
    schema: "SKALD_OPERATOR_PAID_BUDGET_V1",
    authorizedUsd,
    reservedTotalUsd: 0,
    remainingUnreservedUsd: authorizedUsd,
    entries: [],
  }), { mode: 0o600 });
  return { root, path };
}

afterEach(() => {
  for (const root of reservedTests.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("OpenCode paid-budget ledger", () => {
  it("validates totals and persists a worst-case reservation before generation", () => {
    const { path } = budgetFixture();
    expect(readOpenCodePaidBudgetLedger(path)).toEqual({
      authorizedUsd: 1, reservedUsd: 0, remainingUsd: 1,
    });
    const reservation: OpenCodeGenerationReservation = {
      generationRequest: 1,
      model: "opencode-go/glm-5.3-flash",
      reservedUsd: 0.125,
      inputPricePerMillionUsd: 0.15,
      outputPricePerMillionUsd: 0.5,
      maxInputTokens: 32_256,
      maxOutputTokens: 512,
    };
    expect(reserveOpenCodePaidBudget(path, "run-one", reservation)).toEqual({
      authorizedUsd: 1, reservedUsd: 0.125, remainingUsd: 0.875,
    });
    const written = JSON.parse(readFileSync(path, "utf8")) as {
      entries: Array<Record<string, unknown>>;
    };
    expect(written.entries).toHaveLength(1);
    expect(written.entries[0]).toMatchObject({
      id: "run-one-generation-1",
      status: "reserved_before_generation",
      model: reservation.model,
      reservedUsd: reservation.reservedUsd,
      actualChargedUsd: null,
    });
  });

  it("keeps repeated decimal reservations exactly reconcilable", () => {
    const { path } = budgetFixture();
    const reservation: OpenCodeGenerationReservation = {
      generationRequest: 1,
      model: "opencode-go/glm-5.3-flash",
      reservedUsd: 0.0050944,
      inputPricePerMillionUsd: 0.15,
      outputPricePerMillionUsd: 0.5,
      maxInputTokens: 32_256,
      maxOutputTokens: 512,
    };
    for (let generationRequest = 1; generationRequest <= 7; generationRequest += 1) {
      reserveOpenCodePaidBudget(path, "decimal-run", { ...reservation, generationRequest });
      expect(readOpenCodePaidBudgetLedger(path)).toEqual({
        authorizedUsd: 1,
        reservedUsd: Number((generationRequest * reservation.reservedUsd).toFixed(8)),
        remainingUsd: Number((1 - generationRequest * reservation.reservedUsd).toFixed(8)),
      });
    }
    const written = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(written["reservedTotalUsd"]).toBe(0.0356608);
    expect(written["remainingUnreservedUsd"]).toBe(0.9643392);
  });

  it("fails closed on exhausted, inconsistent, or concurrently locked ledgers", () => {
    const { path } = budgetFixture(0.01);
    const reservation: OpenCodeGenerationReservation = {
      generationRequest: 1,
      model: "opencode-go/glm-5.3-flash",
      reservedUsd: 0.02,
      inputPricePerMillionUsd: 1,
      outputPricePerMillionUsd: 1,
      maxInputTokens: 100,
      maxOutputTokens: 20,
    };
    expect(() => reserveOpenCodePaidBudget(path, "run-one", reservation)).toThrow("budget is exhausted");
    writeFileSync(path + ".lock", "held", { flag: "wx" });
    expect(() => reserveOpenCodePaidBudget(path, "run-two", { ...reservation, reservedUsd: 0 }))
      .toThrow("locked or unavailable");
    rmSync(path + ".lock");

    writeFileSync(path, JSON.stringify({
      schema: "SKALD_OPERATOR_PAID_BUDGET_V1",
      authorizedUsd: 1, reservedTotalUsd: 0.5, remainingUnreservedUsd: 0.5, entries: [],
    }));
    expect(() => readOpenCodePaidBudgetLedger(path)).toThrow("totals do not match");
  });
});
