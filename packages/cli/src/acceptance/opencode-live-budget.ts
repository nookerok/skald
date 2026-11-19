/**
 * Hard request and worst-case spend guard for one explicitly bounded live
 * OpenCode Server acceptance run. It recognizes the v2 transient session API,
 * requires a pinned session model with explicit catalogue pricing, and
 * reserves the maximum configured input/output cost before generation leaves
 * the process.
 */

export interface OpenCodeGenerationReservation {
  readonly generationRequest: number;
  readonly model: string;
  readonly reservedUsd: number;
  readonly inputPricePerMillionUsd: number;
  readonly outputPricePerMillionUsd: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
}

export interface OpenCodeGenerationBudgetSnapshot {
  readonly generationRequests: number;
  readonly successfulGenerationResponses: number;
  readonly failedGenerationResponses: number;
  readonly modelCatalogRequests: number;
  readonly modelCatalogFailures: number;
  readonly sessionCreateRequests: number;
  readonly sessionCreateFailures: number;
  readonly sessionDeleteRequests: number;
  readonly sessionDeleteFailures: number;
  readonly lastFailureEndpoint: "model_catalog" | "session_create" | "generation" | "session_delete" | null;
  readonly lastFailureHttpStatus: number | null;
  readonly blockedRequests: number;
  /** Counts budget rejections by a fixed safe category; never contains provider text. */
  readonly blockedReasonCounts: Readonly<Record<OpenCodeGenerationBudgetBlockedReason, number>>;
  readonly maxGenerationRequests: number;
  readonly maxReservedCostUsd: number;
  readonly reservedCostUsd: number;
  readonly reportedCostUsd: number;
  readonly remainingBudgetUsd: number;
  readonly unknownCostRequests: number;
  readonly reservationViolations: number;
}

type OpenCodeGenerationBudgetBlockedReason =
  | "unrecognized_generation_endpoint"
  | "generation_request_cap"
  | "invalid_session_identity"
  | "session_model_price_unverified"
  | "reservation_cap"
  | "reservation_persist_failed";

export interface OpenCodeGenerationBudget {
  readonly fetch: typeof fetch;
  snapshot(): OpenCodeGenerationBudgetSnapshot;
}

export interface OpenCodeGenerationBudgetOptions {
  readonly baseUrl: string;
  readonly maxGenerationRequests: number;
  readonly maxReservedCostUsd: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly fetchImpl?: typeof fetch;
  /** Observe only dispatched loopback requests, never bodies or credentials. */
  readonly observeHttp?: (observation: OpenCodeHttpObservation) => void;
  /** Persist the reservation before the model request is sent. */
  readonly onReserve?: (reservation: OpenCodeGenerationReservation) => void;
}

/** Closed endpoint classes; no URL, query, session identity or response body. */
export type OpenCodeHttpOperation = "server_info" | "model_catalog" | "session_create" | "generation" | "session_delete";

/** HTTP status from the loopback server (not necessarily the upstream provider). */
export interface OpenCodeHttpObservation {
  readonly operation: OpenCodeHttpOperation;
  readonly httpStatus: number | null;
  readonly elapsedMs: number;
  readonly retryAfterHeader: string | null;
}

/** Window deltas only; never inherit a failure/status from an earlier phase. */
export function openCodeRequestDelta(before: OpenCodeGenerationBudgetSnapshot, after: OpenCodeGenerationBudgetSnapshot) {
  return {
    modelCatalogRequests: after.modelCatalogRequests - before.modelCatalogRequests,
    modelCatalogFailures: after.modelCatalogFailures - before.modelCatalogFailures,
    sessionCreateRequests: after.sessionCreateRequests - before.sessionCreateRequests,
    sessionCreateFailures: after.sessionCreateFailures - before.sessionCreateFailures,
    generationRequests: after.generationRequests - before.generationRequests,
    successfulGenerationResponses: after.successfulGenerationResponses - before.successfulGenerationResponses,
    failedGenerationResponses: after.failedGenerationResponses - before.failedGenerationResponses,
    sessionDeleteRequests: after.sessionDeleteRequests - before.sessionDeleteRequests,
    sessionDeleteFailures: after.sessionDeleteFailures - before.sessionDeleteFailures,
    blockedReasonCounts: Object.fromEntries(
      (Object.keys(before.blockedReasonCounts) as OpenCodeGenerationBudgetBlockedReason[])
        .map((reason) => [reason, after.blockedReasonCounts[reason] - before.blockedReasonCounts[reason]]),
    ),
  };
}

function safeRetryAfterHeader(value: string | null): string | null {
  if (!value || value.length > 80) return null;
  return /^(?:\d+(?:\.\d+)?|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT)$/u.test(value)
    ? value : null;
}

type FetchInput = Parameters<typeof fetch>[0];

interface PricedModel {
  readonly model: string;
  readonly contextTokens: number;
  readonly inputTokens?: number;
  readonly outputTokens: number;
  readonly inputPricePerMillionUsd: number;
  readonly outputPricePerMillionUsd: number;
}

interface SessionModel {
  readonly model: string;
}

function requestUrl(input: FetchInput | URL): URL | null {
  const value = input instanceof URL ? input.toString()
    : typeof input === "string" ? input
      : input.url;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function requestMethod(input: FetchInput | URL, init?: RequestInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return method.toUpperCase();
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeNonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function safePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function requestJson(input: FetchInput | URL, init?: RequestInit): Promise<unknown> {
  const body = init?.body;
  let text: string | null = typeof body === "string" ? body : null;
  if (text === null && input instanceof Request) {
    try {
      text = await input.clone().text();
    } catch {
      return null;
    }
  }
  if (text === null || Buffer.byteLength(text, "utf8") > 64 * 1024) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function responseJson(response: Response): Promise<unknown> {
  try {
    const text = await response.clone().text();
    if (Buffer.byteLength(text, "utf8") > 4 * 1024 * 1024) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function parsePricedModels(body: unknown): readonly PricedModel[] {
  const root = record(body);
  const data = Array.isArray(body) ? body : root && Array.isArray(root["data"]) ? root["data"] : [];
  const models: PricedModel[] = [];
  for (const item of data) {
    const model = record(item);
    const limit = record(model?.["limit"]);
    const providerID = model?.["providerID"];
    const modelID = model?.["modelID"];
    const contextTokens = safePositiveInteger(limit?.["context"]);
    const outputTokens = safePositiveInteger(limit?.["output"]);
    const costEntries = model?.["cost"];
    if (typeof providerID !== "string" || typeof modelID !== "string"
      || !contextTokens || !outputTokens || !Array.isArray(costEntries) || costEntries.length === 0) continue;

    let maxInputPrice = 0;
    let maxOutputPrice = 0;
    let validPrices = true;
    for (const costValue of costEntries) {
      const cost = record(costValue);
      const cache = record(cost?.["cache"]);
      const input = safeNonNegativeNumber(cost?.["input"]);
      const output = safeNonNegativeNumber(cost?.["output"]);
      const cacheRead = safeNonNegativeNumber(cache?.["read"]);
      const cacheWrite = safeNonNegativeNumber(cache?.["write"]);
      if (input === null || output === null || cacheRead === null || cacheWrite === null) {
        validPrices = false;
        break;
      }
      maxInputPrice = Math.max(maxInputPrice, input, cacheRead, cacheWrite);
      maxOutputPrice = Math.max(maxOutputPrice, output);
    }
    if (!validPrices) continue;
    const inputTokens = safePositiveInteger(limit?.["input"]) ?? undefined;
    models.push(Object.freeze({
      model: providerID + "/" + modelID,
      contextTokens,
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      outputTokens,
      inputPricePerMillionUsd: maxInputPrice,
      outputPricePerMillionUsd: maxOutputPrice,
    }));
  }
  return models;
}

function endpointBase(value: string): URL {
  let base: URL;
  try {
    base = new URL(value);
  } catch {
    throw new Error("OpenCode generation budget requires a valid loopback base URL");
  }
  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || !base.port || base.username || base.password) {
    throw new Error("OpenCode generation budget requires an explicit 127.0.0.1 endpoint");
  }
  return base;
}

function generationSessionId(pathname: string): string | null {
  const match = /^\/api\/session\/([^/]+)\/generate$/u.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function modelRefFromSessionRequest(body: unknown): { sessionId: string; model: string } | null {
  const value = record(body);
  const model = record(value?.["model"]);
  const sessionId = value?.["id"];
  const providerID = model?.["providerID"];
  const modelID = model?.["id"];
  if (typeof sessionId !== "string" || sessionId.length < 1 || sessionId.length > 200
    || typeof providerID !== "string" || typeof modelID !== "string") return null;
  return { sessionId, model: providerID + "/" + modelID };
}

function reportedGenerationCost(body: unknown): number | null {
  const root = record(body);
  const data = record(root?.["data"]);
  return safeNonNegativeNumber(data?.["cost"]);
}

function roundedUpUsd(value: number): number {
  return Math.ceil(value * 100_000_000) / 100_000_000;
}

function priceReservation(model: PricedModel, options: OpenCodeGenerationBudgetOptions): OpenCodeGenerationReservation {
  const outputTokens = Math.min(options.maxOutputTokens, model.outputTokens);
  const contextInputTokens = model.contextTokens - outputTokens;
  const inputTokens = Math.min(options.maxInputTokens, contextInputTokens, model.inputTokens ?? Number.POSITIVE_INFINITY);
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 1 || outputTokens < 1) {
    throw new Error("OpenCode live acceptance model token limits are unavailable");
  }
  const reservedUsd = roundedUpUsd(
    (inputTokens * model.inputPricePerMillionUsd + outputTokens * model.outputPricePerMillionUsd) / 1_000_000,
  );
  return Object.freeze({
    generationRequest: 0,
    model: model.model,
    reservedUsd,
    inputPricePerMillionUsd: model.inputPricePerMillionUsd,
    outputPricePerMillionUsd: model.outputPricePerMillionUsd,
    maxInputTokens: inputTokens,
    maxOutputTokens: outputTokens,
  });
}

/**
 * Creates a hard cap around the official OpenCode v2 transient session API.
 * Unknown session models or missing catalogue prices fail closed before
 * generation. Each request reserves its full token-limit cost first.
 */
export function createOpenCodeGenerationBudget(options: OpenCodeGenerationBudgetOptions): OpenCodeGenerationBudget {
  const base = endpointBase(options.baseUrl);
  if (!Number.isSafeInteger(options.maxGenerationRequests) || options.maxGenerationRequests < 1) {
    throw new Error("OpenCode generation budget must be a positive safe integer");
  }
  if (!Number.isFinite(options.maxReservedCostUsd) || options.maxReservedCostUsd < 0) {
    throw new Error("OpenCode generation budget requires a non-negative USD reservation cap");
  }
  if (!Number.isSafeInteger(options.maxInputTokens) || options.maxInputTokens < 1
    || !Number.isSafeInteger(options.maxOutputTokens) || options.maxOutputTokens < 1) {
    throw new Error("OpenCode generation budget requires positive token limits");
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const pricedModels = new Map<string, PricedModel>();
  const sessionModels = new Map<string, SessionModel>();
  let generationRequests = 0;
  let successfulGenerationResponses = 0;
  let failedGenerationResponses = 0;
  let modelCatalogRequests = 0;
  let modelCatalogFailures = 0;
  let sessionCreateRequests = 0;
  let sessionCreateFailures = 0;
  let sessionDeleteRequests = 0;
  let sessionDeleteFailures = 0;
  let lastFailureEndpoint: OpenCodeGenerationBudgetSnapshot["lastFailureEndpoint"] = null;
  let lastFailureHttpStatus: number | null = null;
  let blockedRequests = 0;
  const blockedReasonCounts: Record<OpenCodeGenerationBudgetBlockedReason, number> = {
    unrecognized_generation_endpoint: 0,
    generation_request_cap: 0,
    invalid_session_identity: 0,
    session_model_price_unverified: 0,
    reservation_cap: 0,
    reservation_persist_failed: 0,
  };
  const block = (reason: OpenCodeGenerationBudgetBlockedReason): void => {
    blockedRequests += 1;
    blockedReasonCounts[reason] += 1;
  };
  let reservedCostUsd = 0;
  let reportedCostUsd = 0;
  let unknownCostRequests = 0;
  let reservationViolations = 0;

  const guardedFetch: typeof fetch = async (input, init) => {
    const url = requestUrl(input);
    const onBudgetOrigin = url?.origin === base.origin;
    const method = requestMethod(input, init);
    const isModelList = onBudgetOrigin && method === "GET" && url?.pathname === "/api/model";
    const isSessionCreate = onBudgetOrigin && method === "POST" && url?.pathname === "/api/session";
    const sessionId = onBudgetOrigin && method === "POST" && url ? generationSessionId(url.pathname) : null;
    const isUnrecognizedGeneration = onBudgetOrigin && method === "POST" && url
      && /\/generate(?:\/|$)/u.test(url.pathname) && sessionId === null;
    const isSessionDelete = onBudgetOrigin && method === "DELETE" && url
      ? /^\/api\/session\/[^/]+$/u.test(url.pathname)
      : false;
    const operation: OpenCodeHttpOperation | null = isModelList ? "model_catalog" : isSessionCreate ? "session_create"
      : sessionId ? "generation" : isSessionDelete ? "session_delete"
        : onBudgetOrigin && method === "GET" && url?.pathname === "/api/info" ? "server_info" : null;

    if (isModelList) modelCatalogRequests += 1;
    if (isSessionCreate) sessionCreateRequests += 1;
    if (isSessionDelete) sessionDeleteRequests += 1;

    if (isUnrecognizedGeneration) {
      block("unrecognized_generation_endpoint");
      throw new Error("OpenCode live acceptance blocked an unrecognized generation endpoint");
    }

    let reservation: OpenCodeGenerationReservation | null = null;
    let sessionIdForRequest: string | null = sessionId;
    if (sessionId) {
      if (generationRequests >= options.maxGenerationRequests) {
        block("generation_request_cap");
        throw new Error("OpenCode live acceptance generation request budget exhausted");
      }
      let decodedSessionId: string;
      try {
        decodedSessionId = decodeURIComponent(sessionId);
      } catch {
        block("invalid_session_identity");
        throw new Error("OpenCode live acceptance session identity is invalid");
      }
      sessionIdForRequest = decodedSessionId;
      const session = sessionModels.get(decodedSessionId);
      const model = session ? pricedModels.get(session.model) : undefined;
      if (!session || !model) {
        block("session_model_price_unverified");
        throw new Error("OpenCode live acceptance cannot verify the session model price");
      }
      const calculated = priceReservation(model, options);
      const nextRequest = generationRequests + 1;
      reservation = Object.freeze({ ...calculated, generationRequest: nextRequest });
      if (reservedCostUsd + reservation.reservedUsd > options.maxReservedCostUsd + 1e-10) {
        block("reservation_cap");
        throw new Error("OpenCode live acceptance USD reservation budget exhausted");
      }
      try {
        options.onReserve?.(reservation);
      } catch {
        block("reservation_persist_failed");
        throw new Error("OpenCode live acceptance could not persist the spend reservation");
      }
      generationRequests = nextRequest;
      reservedCostUsd = roundedUpUsd(reservedCostUsd + reservation.reservedUsd);
    }

    const requestModel = isSessionCreate ? modelRefFromSessionRequest(await requestJson(input, init)) : null;
    const observe = operation !== null ? options.observeHttp : undefined;
    const dispatchedAt = observe ? performance.now() : 0;
    const observeResponse = (response?: Response) => {
      if (!observe || operation === null) return;
      try {
        observe({
          operation,
          httpStatus: response?.status ?? null,
          elapsedMs: Math.round(performance.now() - dispatchedAt),
          retryAfterHeader: safeRetryAfterHeader(response?.headers.get("retry-after") ?? null),
        });
      } catch { /* Diagnostics must not affect the budget or provider. */ }
    };
    let response: Response;
    try {
      response = await fetchImpl(input, init);
    } catch (error) {
      observeResponse();
      if (isModelList) {
        modelCatalogFailures += 1;
        lastFailureEndpoint = "model_catalog";
        lastFailureHttpStatus = null;
      }
      if (isSessionCreate) {
        sessionCreateFailures += 1;
        lastFailureEndpoint = "session_create";
        lastFailureHttpStatus = null;
      }
      if (isSessionDelete) {
        sessionDeleteFailures += 1;
        lastFailureEndpoint = "session_delete";
        lastFailureHttpStatus = null;
      }
      if (reservation) {
        unknownCostRequests += 1;
        failedGenerationResponses += 1;
        lastFailureEndpoint = "generation";
        lastFailureHttpStatus = null;
      }
      throw error;
    }
    observeResponse(response);

    if (isModelList && !response.ok) {
      modelCatalogFailures += 1;
      lastFailureEndpoint = "model_catalog";
      lastFailureHttpStatus = response.status;
    }
    if (isSessionCreate && !response.ok) {
      sessionCreateFailures += 1;
      lastFailureEndpoint = "session_create";
      lastFailureHttpStatus = response.status;
    }
    if (isSessionDelete && !response.ok) {
      sessionDeleteFailures += 1;
      lastFailureEndpoint = "session_delete";
      lastFailureHttpStatus = response.status;
    }
    if (isModelList && response.ok) {
      for (const model of parsePricedModels(await responseJson(response))) pricedModels.set(model.model, model);
    }
    if (isSessionCreate && response.ok && requestModel) {
      const responseBody = record(await responseJson(response));
      const data = record(responseBody?.["data"]);
      if (data?.["id"] === requestModel.sessionId) {
        sessionModels.set(requestModel.sessionId, { model: requestModel.model });
      }
    }
    if (reservation) {
      if (!response.ok) {
        failedGenerationResponses += 1;
        lastFailureEndpoint = "generation";
        lastFailureHttpStatus = response.status;
        unknownCostRequests += 1;
      } else {
        successfulGenerationResponses += 1;
        const actual = reportedGenerationCost(await responseJson(response));
        if (actual === null) unknownCostRequests += 1;
        else {
          reportedCostUsd = roundedUpUsd(reportedCostUsd + actual);
          if (actual > reservation.reservedUsd + 1e-8) reservationViolations += 1;
        }
      }
    }
    if (isSessionDelete && url) {
      const match = /^\/api\/session\/([^/]+)$/u.exec(url.pathname);
      if (match?.[1]) {
        try { sessionModels.delete(decodeURIComponent(match[1])); } catch { /* malformed ID cannot map */ }
      }
    }
    if (sessionIdForRequest && reservation) sessionModels.delete(sessionIdForRequest);
    return response;
  };

  return Object.freeze({
    fetch: guardedFetch,
    snapshot: (): OpenCodeGenerationBudgetSnapshot => Object.freeze({
      generationRequests,
      successfulGenerationResponses,
      failedGenerationResponses,
      modelCatalogRequests,
      modelCatalogFailures,
      sessionCreateRequests,
      sessionCreateFailures,
      sessionDeleteRequests,
      sessionDeleteFailures,
      lastFailureEndpoint,
      lastFailureHttpStatus,
      blockedRequests,
      maxGenerationRequests: options.maxGenerationRequests,
      maxReservedCostUsd: options.maxReservedCostUsd,
      reservedCostUsd,
      reportedCostUsd,
      remainingBudgetUsd: Math.max(0, options.maxReservedCostUsd - reservedCostUsd),
      unknownCostRequests,
      reservationViolations,
      blockedReasonCounts: Object.freeze({ ...blockedReasonCounts }),
    }),
  });
}
