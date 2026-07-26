import type { App, IdempotencyReject } from "./index.js";
import { runCommandCycle, runOfflineTicks } from "./index.js";
import { buildNarrative, narrateLLM } from "@skald/world";
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

function error(code: string, message: string, statusCode = 400): JsonResponse {
  return json({ ok: false, error: { code, message } }, statusCode);
}

export function handleState(app: App): JsonResponse {
  const state = serializeWorldState(app);
  return json({ ok: true, state });
}

export async function handleCommand(app: App, body: unknown): Promise<JsonResponse> {
  if (!body || typeof body !== "object") return error("invalid_request", "body must be object");
  const { input, idempotencyKey } = body as Record<string, unknown>;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128)
    return error("missing_idempotency_key", "idempotencyKey required (1-128 chars)", 400);
  if (typeof input !== "string" || input.length === 0)
    return error("invalid_request", "input required", 400);

  try {
    const result = await (async () => {
      if (input === "wait") {
        const r = runOfflineTicks(app, 1, idempotencyKey);
        if ("type" in r && r.type === "IdempotencyReject") return { duplicate: true };
        return { wait: true, ...r };
      }
      if (input.startsWith("advance ")) {
        const n = parseInt(input.slice(8).trim(), 10);
        if (isNaN(n) || n < 1 || n > 100) return error("invalid_request", "advance N (1-100)");
        const r = runOfflineTicks(app, n, idempotencyKey);
        if ("type" in r && r.type === "IdempotencyReject") return { duplicate: true };
        return { wait: true, ...r };
      }
      const r = runCommandCycle(app, input, idempotencyKey);
      if (!r || typeof r !== "object") return error("internal_error", "unexpected result", 500);
      if ("type" in r && (r as IdempotencyReject).type === "IdempotencyReject") return { duplicate: true };
      if ("type" in r && (r as any).type === "ParseError") {
        const pe = r as any;
        return error("parse_error", pe.reason ?? "parse error", 400);
      }
      const cmdResult = r as { events: unknown[]; tickEvents: unknown[]; position: unknown };
      return {
        ok: true,
        events: cmdResult.events,
        tickEvents: cmdResult.tickEvents,
        position: cmdResult.position,
        state: serializeWorldState(app),
      };
    })();

    if (result && typeof result === "object" && "duplicate" in result) {
      const r = result as { duplicate: boolean };
      if (r.duplicate) return error("duplicate_request", "duplicate idempotencyKey", 409);
    }
    if (result && typeof result === "object" && "statusCode" in result) {
      return result as JsonResponse;
    }
    if (result && typeof result === "object" && "ok" in result) {
      return json(result);
    }
    return json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return error("internal_error", msg, 500);
  }
}

export async function handleWait(app: App, body: unknown): Promise<JsonResponse> {
  if (!body || typeof body !== "object") return error("invalid_request", "body must be object");
  const { count, idempotencyKey } = body as Record<string, unknown>;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128)
    return error("missing_idempotency_key", "idempotencyKey required", 400);
  const n = typeof count === "number" ? count : 1;
  if (n < 1 || n > 100) return error("invalid_request", "count must be 1-100");

  try {
    const result = runOfflineTicks(app, n, idempotencyKey);
    if ("type" in result && result.type === "IdempotencyReject") {
      return error("duplicate_request", "duplicate idempotencyKey", 409);
    }
    const r = result as { tickEvents: unknown[] };
    return json({ ok: true, tickEvents: r.tickEvents, state: serializeWorldState(app) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return error("internal_error", msg, 500);
  }
}

export function handleNarrative(app: App, url: URL): JsonResponse {
  const events = app.bus.query();
  const world = app.projection.getSnapshot();
  const sinceRaw = url.searchParams.get("since");
  const sinceTick = sinceRaw !== null ? parseInt(sinceRaw, 10) : undefined;
  const opts = sinceTick !== undefined && !isNaN(sinceTick) ? { sinceTick } : undefined;
  const snapshot = buildNarrative(events, world, opts);
  return json({ ok: true, ...snapshot });
}

export async function handleNarrativeLLM(app: App, url: URL): Promise<JsonResponse> {
  const events = app.bus.query();
  const world = app.projection.getSnapshot();
  const sinceRaw = url.searchParams.get("since");
  const sinceTick = sinceRaw !== null ? parseInt(sinceRaw, 10) : undefined;
  const opts = sinceTick !== undefined && !isNaN(sinceTick) ? { sinceTick } : undefined;
  const snapshot = buildNarrative(events, world, opts);
  const result = await narrateLLM(snapshot, app.router);
  return json({ ok: true, ...result });
}

export function handleEvents(app: App, url: URL): JsonResponse {
  const limitRaw = url.searchParams.get("limit") ?? "50";
  const offsetRaw = url.searchParams.get("offset") ?? "0";
  const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(offsetRaw, 10) || 0, 0);

  const all = app.bus.query();
  const slice = all.slice(offset, offset + limit);
  return json({ ok: true, events: slice, count: all.length, limit, offset });
}

export function handleHealth(app: App, _startTime: number): JsonResponse {
  const world = app.projection.getSnapshot();
  return json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    eventCount: world.eventNumber,
    worldTime: world.time,
    routerAvailable: app.router !== null && app.router.apiKey.length > 0,
    persistence: app.store ? "sqlite" : "memory",
  });
}
