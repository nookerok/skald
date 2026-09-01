import type { App, IdempotencyReject } from "./index.js";
import { runCommandCycle, runOfflineTicks } from "./index.js";
import { readSideHandle } from "./conversation/identity.js";
import { buildNarrative, buildNarrativeAdapterContext, getRegionEntrypoint, narrateLLM, selectTurnPresentation, buildTurnJournal, buildDiscoveryJournal, buildPlayerGuidance, buildBeliefModel, buildPlayerKnowledgePresentation, serializeBeliefModel, parseBeliefModelDTO, buildObserverMap, buildSpatialWorldProjection } from "@skald/world";
import type { NarrativeAdapterContext, TurnPresentation } from "@skald/world";
import { buildDiscoveryJournalFromBeliefModel, toPlayerDiscoveryJournal } from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";
import { serializeWorldState } from "./state-view.js";
import { conversationRequestHash, toConversationTurnDTO } from "./conversation/builder.js";
import { toPlayerFacingJournalTurns, toPlayerFacingNarrativeEntries, toPlayerFacingPresentation, toPlayerFacingState, toPlayerFacingThreads } from "./http/player-facing.js";

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
  const state = toPlayerFacingState(serializeWorldState(app));
  return json({ ok: true, state, knowledge: buildLegacyKnowledge(app) });
}

function buildGuidance(app: App) {
  const events = app.bus.query();
  const world = app.projection.getSnapshot();
  const presentation = selectTurnPresentation(events, world);
  return buildPlayerGuidance(events, world, buildLegacyNarrativeContext(app, presentation));
}

function buildLegacyKnowledge(app: App) {
  const events = app.bus.query();
  const world = app.projection.getSnapshot();
  return buildPlayerKnowledgePresentation(events, world, buildBeliefModel(events, world), { startup: world.time === 0, maxEntries: world.time === 0 ? 3 : 100 });
}

function checkPoisoned(app: App): boolean {
  return (app.engine as any).isPoisoned?.() ?? false;
}

function buildLegacyNarrativeContext(app: App, presentation: TurnPresentation): NarrativeAdapterContext | undefined {
  try {
    const record = app.store?.getWorldRecord(app.worldId);
    const profile = record?.characterId ? app.store?.getCharacterProfile(record.characterId) ?? null : null;
    const entrypoint = record?.entrypointId ? getRegionEntrypoint(record.entrypointId) : null;
    return buildNarrativeAdapterContext(app.bus.query(), app.projection.getSnapshot(), {
      profile,
      entrypoint,
      presentation,
      ...(record?.characterName !== undefined ? { characterName: record.characterName } : {}),
    }) ?? undefined;
  } catch {
    try {
      const worldTime = app.projection.getSnapshot().time;
      app.diagnostics?.({
        kind: "context",
        category: "context_error",
        outcome: "context_error",
        provider: "adapter",
        durationMs: 0,
        attempt: 0,
        timeout: 0,
        retryOutcome: "none",
        turn: worldTime,
        worldTime,
        priority: "interactive",
        detail: "build_failed",
        worldId: app.worldId,
        recordedAt: new Date().toISOString(),
      });
    } catch { /* diagnostics are best-effort */ }
    return undefined;
  }
}

export async function handleCommand(app: App, body: unknown): Promise<JsonResponse> {
  if (checkPoisoned(app)) return error("internal_error", "server is in fatal state", 503);
  if (!body || typeof body !== "object") return error("invalid_request", "body must be object");
  const { input, idempotencyKey } = body as Record<string, unknown>;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128)
    return error("missing_idempotency_key", "idempotencyKey required (1-128 chars)", 400);
  if (typeof input !== "string" || input.length === 0)
    return error("invalid_request", "input required", 400);

  const existing = app.store?.getConversationTurn(app.worldId, idempotencyKey);
  if (existing) {
    if (existing.requestHash !== conversationRequestHash(input)) return error("duplicate_request", "duplicate idempotencyKey", 409);
    const conversationTurn = toConversationTurnDTO(existing);
    return existing.inputClass === "action"
      ? json({ ok: false, error: { code: "duplicate_request", message: "duplicate idempotencyKey" }, conversationTurn }, 409)
      : json({ ok: true, replayed: true, status: existing.inputClass, conversationTurn });
  }

  try {
    if (input === "wait") {
      const r = runOfflineTicks(app, 1, idempotencyKey, input);
      if ("type" in r && (r as IdempotencyReject).type === "IdempotencyReject")
        return error("duplicate_request", "duplicate idempotencyKey", 409);
      const tickResult = r as { tickEvents: DomainEvent[] };
      const pres = selectTurnPresentation(tickResult.tickEvents, app.projection.getSnapshot());
      const guidance = buildGuidance(app);
      const conversationTurn = app.store?.getConversationTurn(app.worldId, idempotencyKey);
      return json({ ok: true, state: toPlayerFacingState(serializeWorldState(app)), presentation: toPlayerFacingPresentation(pres), guidance, knowledge: buildLegacyKnowledge(app), ...(conversationTurn ? { conversationTurn: toConversationTurnDTO(conversationTurn) } : {}) });
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
      const guidance = buildGuidance(app);
      return json({ ok: true, state: toPlayerFacingState(serializeWorldState(app)), presentation: toPlayerFacingPresentation(pres), guidance, knowledge: buildLegacyKnowledge(app) });
    }

    const r = runCommandCycle(app, input, idempotencyKey);
    if (!r || typeof r !== "object") return error("internal_error", "unexpected result", 500);
    if ("type" in r && (r as IdempotencyReject).type === "IdempotencyReject")
      return error("duplicate_request", "duplicate idempotencyKey", 409);

    // Handle ClarificationRequest and UnsupportedButUnderstood
    if ("type" in r && (r as any).type === "ClarificationRequired") {
      return json({
        ok: true,
        status: "clarification",
        clarificationId: (r as any).clarificationId,
        question: (r as any).question,
        interpretations: (r as any).interpretations,
        knowledge: buildLegacyKnowledge(app),
      });
    }
    if ("type" in r && (r as any).type === "UnsupportedButUnderstood") {
      return json({
        ok: true,
        status: "unsupported",
        message: (r as any).message,
        knowledge: buildLegacyKnowledge(app),
      });
    }

    const cmdResult = r as { events: DomainEvent[]; tickEvents: DomainEvent[]; position: unknown };
    const allCycleEvents = [...cmdResult.events, ...cmdResult.tickEvents];
    const pres = selectTurnPresentation(allCycleEvents, app.projection.getSnapshot());
    const guidance = buildGuidance(app);

    // Build observer map for the browser
    const allEvents = app.bus.query();
    const spatial = buildSpatialWorldProjection(allEvents);
    const observerMap = buildObserverMap(allEvents, spatial, true);
    const conversationTurn = app.store?.getConversationTurn(app.worldId, idempotencyKey);

    // Check for CriticalCheckRequested events
    const criticalCheck = cmdResult.events.find((e) => e.type === "CriticalCheckRequested");
    const criticalCheckPresentation = criticalCheck
      ? {
          stakes: (criticalCheck.payload as any).stakes,
        }
      : undefined;

    return json({
      ok: true,
      status: "resolved",
      state: toPlayerFacingState(serializeWorldState(app)),
      presentation: toPlayerFacingPresentation(pres),
      guidance,
      knowledge: buildLegacyKnowledge(app),
      criticalCheck: criticalCheckPresentation,
      observerMap,
      ...(conversationTurn ? { conversationTurn: toConversationTurnDTO(conversationTurn) } : {}),
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
    const guidance = buildGuidance(app);
    return json({ ok: true, state: toPlayerFacingState(serializeWorldState(app)), presentation: toPlayerFacingPresentation(pres), guidance, knowledge: buildLegacyKnowledge(app) });
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
  return json({ ok: true, entries: toPlayerFacingNarrativeEntries(snapshot.entries), presentation: toPlayerFacingPresentation(snapshot.presentation), worldTime: snapshot.worldTime });
}

export async function handleNarrativeLLM(app: App, url: URL): Promise<JsonResponse> {
  const events = app.bus.query();
  const world = app.projection.getSnapshot();
  const sinceRaw = url.searchParams.get("since");
  const sinceP = parseStrictInt(sinceRaw, 0, 0, Number.MAX_SAFE_INTEGER);
  if (!sinceP.ok) return error("invalid_request", "since must be a non-negative integer", 400);
  const opts = sinceP.value > 0 ? { sinceTick: sinceP.value } : undefined;
  const baseSnapshot = buildNarrative(events, world, opts);
  const narrativeContext = buildLegacyNarrativeContext(app, baseSnapshot.presentation);
  const snapshot = buildNarrative(events, world, {
    ...opts,
    ...(narrativeContext ? { narrativeContext } : {}),
  });
  const result = await narrateLLM(snapshot, app.router, {
    ...(app.diagnostics ? { diagnostics: app.diagnostics } : {}),
    worldId: app.worldId,
    ...(narrativeContext ? { narrativeContext } : {}),
  });
  // Sanitize: never expose internal error details or fallbackReason to client
  return json({ ok: true, text: result.text });
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

export function handleBeliefModel(app: App): JsonResponse {
  const beliefModel = parseBeliefModelDTO(serializeBeliefModel(buildBeliefModel(app.bus.query(), app.projection.getSnapshot())));
  return json({ ok: true, beliefModel });
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

  const beforeTurn = url.searchParams.get("beforeTurn");
  let eligible = beforeTick ? journal.turns.filter((turn) => turn.worldTime < beforeTick) : journal.turns;
  if (beforeTurn !== null) {
    if (beforeRaw !== null || !/^[a-f0-9]{64}$/.test(beforeTurn)) {
      return error("invalid_request", "beforeTurn must be an opaque journal cursor, without before", 400);
    }
    const boundary = journal.turns.findIndex((turn) => readSideHandle("turn", turn.turnId) === beforeTurn);
    if (boundary < 0) return error("invalid_request", "unknown journal cursor", 400);
    eligible = journal.turns.slice(0, boundary);
  }
  const page = [...eligible].reverse().slice(0, limit);
  const hasMore = eligible.length > page.length;
  const nextBefore = hasMore ? page[page.length - 1]!.worldTime : null;
  const nextBeforeTurn = hasMore ? readSideHandle("turn", page[page.length - 1]!.turnId) : null;

  return json({
    ok: true,
    turns: toPlayerFacingJournalTurns(page),
    conversationTurns: app.store
      ? app.store.listConversationTurns(app.worldId, { limit: 500 }).map(toConversationTurnDTO)
      : [],
    threads: toPlayerFacingThreads(journal.threads),
    worldTime: journal.worldTime,
    nextBefore,
    nextBeforeTurn,
    hasMore,
  });
}

export function handleDiscoveries(app: App): JsonResponse {
  const events = app.bus.query();
  const model = buildBeliefModel(events, app.projection.getSnapshot(), "player");
  const rumors = buildDiscoveryJournal(events).rumors.filter((rumor) => rumor.observerId === "player");
  return json({ ok: true, ...toPlayerDiscoveryJournal(buildDiscoveryJournalFromBeliefModel(model, rumors)) });
}

export function handleGuidance(app: App): JsonResponse {
  const guidance = buildGuidance(app);
  return json({ ok: true, guidance });
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
