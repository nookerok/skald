import type { App, IdempotencyReject } from "./index.js";
import { runCommandCycle, runOfflineTicks } from "./index.js";
import { buildNarrative, narrateLLM, selectTurnPresentation, buildTurnJournal } from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";
import { serializeWorldState } from "./state-view.js";

export interface JsonResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function json(data: unknown, statusCode = 200): JsonResponse {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

function safeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "DuplicateRequestError") return "duplicate request";
    if (err.name === "RuleProcessingError") return "rule processing error";
    if (err.name === "PostCommitConsistencyError") return "server in fatal state";
    if (err.name === "MaxIterationsExceededError") return "processing limit exceeded";
  }
  return "internal error";
}

function error(code: string, message: string, statusCode = 400): JsonResponse {
  return json({ ok: false, error: { code, message } }, statusCode);
}

export function handleState(app: App): JsonResponse {
  const state = serializeWorldState(app);
  return json({ ok: true, state });
}

function checkPoisoned(app: App): boolean {
  return (app.engine as any).isPoisoned?.() ?? false;
}

export async function handleCommand(app: App, body: unknown): Promise<JsonResponse> {
  if (checkPoisoned(app)) return error("internal_error", "server is in fatal state", 503);
  if (!body || typeof body !== "object") return error("invalid_request", "body must be object");
  const { input, idempotencyKey } = body as Record<string, unknown>;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128)
    return error("missing_idempotency_key", "idempotencyKey required (1-128 chars)", 400);
  if (typeof input !== "string" || input.length === 0)
    return error("invalid_request", "input required", 400);

  try {
    if (input === "wait") {
      const r = runOfflineTicks(app, 1, idempotencyKey);
      if ("type" in r && (r as IdempotencyReject).type === "IdempotencyReject")
        return error("duplicate_request", "duplicate idempotencyKey", 409);
      const tickResult = r as { tickEvents: DomainEvent[] };
      const pres = selectTurnPresentation(tickResult.tickEvents, app.projection.getSnapshot());
      return json({ ok: true, tickEvents: tickResult.tickEvents, state: serializeWorldState(app), presentation: pres });
    }
    if (input.startsWith("advance ")) {
      const raw = input.slice(8).trim();
      const n = Number(raw);
      if (!Number.isSafeInteger(n) || n < 1 || n > 100) return error("invalid_request", "advance N (1-100, integer)");
      const r = runOfflineTicks(app, n, idempotencyKey);
      if ("type" in r && (r as IdempotencyReject).type === "IdempotencyReject")
        return error("duplicate_request", "duplicate idempotencyKey", 409);
      const tickResult = r as { tickEvents: DomainEvent[] };
      const pres = selectTurnPresentation(tickResult.tickEvents, app.projection.getSnapshot());
      return json({ ok: true, tickEvents: tickResult.tickEvents, state: serializeWorldState(app), presentation: pres });
    }
    const r = runCommandCycle(app, input, idempotencyKey);
    if (!r || typeof r !== "object") return error("internal_error", "unexpected result", 500);
    if ("type" in r && (r as IdempotencyReject).type === "IdempotencyReject")
      return error("duplicate_request", "duplicate idempotencyKey", 409);
    if ("type" in r && (r as any).type === "ParseError")
      return error("parse_error", (r as any).reason ?? "parse error", 400);
    const cmdResult = r as { events: DomainEvent[]; tickEvents: DomainEvent[]; position: unknown };
    const allCycleEvents = [...cmdResult.events, ...cmdResult.tickEvents];
    const pres = selectTurnPresentation(allCycleEvents, app.projection.getSnapshot());
    return json({
      ok: true,
      events: cmdResult.events,
      tickEvents: cmdResult.tickEvents,
      position: cmdResult.position,
      state: serializeWorldState(app),
      presentation: pres,
    });
  } catch (err) {
    return error("internal_error", safeError(err), 500);
  }
}

export async function handleWait(app: App, body: unknown): Promise<JsonResponse> {
  if (!body || typeof body !== "object") return error("invalid_request", "body must be object");
  const { count, idempotencyKey } = body as Record<string, unknown>;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128)
    return error("missing_idempotency_key", "idempotencyKey required", 400);
  const n = typeof count === "number" ? count : 1;
  if (!Number.isSafeInteger(n) || n < 1 || n > 100) return error("invalid_request", "count must be integer 1-100");

  try {
    const result = runOfflineTicks(app, n, idempotencyKey);
    if ("type" in result && (result as IdempotencyReject).type === "IdempotencyReject")
      return error("duplicate_request", "duplicate idempotencyKey", 409);
    const r = result as { tickEvents: DomainEvent[] };
    const pres = selectTurnPresentation(r.tickEvents, app.projection.getSnapshot());
    return json({ ok: true, tickEvents: r.tickEvents, state: serializeWorldState(app), presentation: pres });
  } catch (err) {
    return error("internal_error", safeError(err), 500);
  }
}

function parseStrictInt(raw: string | null, def: number, min: number, max: number): { value: number; ok: true } | { ok: false } {
  if (raw === null) return { value: def, ok: true };
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || String(n) !== raw) return { ok: false };
  if (n < min || n > max) return { ok: false };
  return { value: n, ok: true };
}

export function handleNarrative(app: App, url: URL): JsonResponse {
  const events = app.bus.query();
  const world = app.projection.getSnapshot();
  const sinceRaw = url.searchParams.get("since");
  const sinceP = parseStrictInt(sinceRaw, 0, 0, Number.MAX_SAFE_INTEGER);
  if (!sinceP.ok) return error("invalid_request", "since must be a non-negative integer", 400);
  const opts = sinceP.value > 0 ? { sinceTick: sinceP.value } : undefined;
  const snapshot = buildNarrative(events, world, opts);
  // Serialize safely — remove circular refs and non-serializable
  return json({ ok: true, entries: snapshot.entries, presentation: snapshot.presentation, worldTime: snapshot.worldTime, playerPosition: snapshot.playerPosition });
}

export async function handleNarrativeLLM(app: App, url: URL): Promise<JsonResponse> {
  const events = app.bus.query();
  const world = app.projection.getSnapshot();
  const sinceRaw = url.searchParams.get("since");
  const sinceP = parseStrictInt(sinceRaw, 0, 0, Number.MAX_SAFE_INTEGER);
  if (!sinceP.ok) return error("invalid_request", "since must be a non-negative integer", 400);
  const opts = sinceP.value > 0 ? { sinceTick: sinceP.value } : undefined;
  const snapshot = buildNarrative(events, world, opts);
  const result = await narrateLLM(snapshot, app.router);
  // Sanitize: never expose internal error details to client
  const sanitized = result.usedFallback
    ? { text: result.text, usedFallback: true, fallbackReason: result.fallbackReason, model: "", latencyMs: 0 }
    : { text: result.text, usedFallback: false, fallbackReason: null, model: result.model, latencyMs: result.latencyMs };
  return json({ ok: true, ...sanitized });
}

export function handleEvents(app: App, url: URL): JsonResponse {
  const limitP = parseStrictInt(url.searchParams.get("limit"), 50, 1, 200);
  if (!limitP.ok) return error("invalid_request", "limit must be integer 1-200", 400);
  const offsetP = parseStrictInt(url.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  if (!offsetP.ok) return error("invalid_request", "offset must be non-negative integer", 400);
  const all = app.bus.query();
  const slice = all.slice(offsetP.value, offsetP.value + limitP.value);
  return json({ ok: true, events: slice, count: all.length, limit: limitP.value, offset: offsetP.value });
}

export function handleJournal(app: App, url: URL): JsonResponse {
  const events = app.bus.query();
  const journal = buildTurnJournal(events);
  const limitRaw = url.searchParams.get("limit") ?? "20";
  const beforeRaw = url.searchParams.get("before");
  const limitP = parseStrictInt(limitRaw, 20, 1, 50);
  if (!limitP.ok) return error("invalid_request", "limit must be integer 1-50", 400);
  const limit = limitP.value;

  let beforeTick: number | undefined;
  if (beforeRaw !== null) {
    const beforeP = parseStrictInt(beforeRaw, 0, 1, Number.MAX_SAFE_INTEGER);
    if (!beforeP.ok) return error("invalid_request", "before must be a positive integer", 400);
    beforeTick = beforeP.value;
  }

  const filtered = beforeTick
    ? journal.turns.filter((t) => t.worldTime < beforeTick)
    : journal.turns;
  const page = [...filtered].sort((a, b) => b.worldTime - a.worldTime).slice(0, limit);
  const hasMore = filtered.length > page.length;
  const nextBefore = hasMore ? page[page.length - 1]!.worldTime : null;

  return json({
    ok: true,
    turns: page,
    threads: journal.threads,
    worldTime: journal.worldTime,
    nextBefore,
    hasMore,
  });
}

export function handleHealth(app: App, _startTime: number): JsonResponse {
  const world = app.projection.getSnapshot();
  const poisoned = (app.engine as any).isPoisoned?.() ?? false;
  const status = poisoned ? "poisoned" : "ok";
  return json({
    status,
    uptimeSeconds: Math.floor(process.uptime()),
    eventCount: world.eventNumber,
    worldTime: world.time,
    routerAvailable: app.router !== null && app.router.apiKey.length > 0,
    persistence: app.store ? "sqlite" : "memory",
  }, poisoned ? 503 : 200);
}
