import type { WorldRuntime } from "../runtime/index.js";
import {
  buildNarrative,
  buildTurnJournal,
  buildDiscoveryJournal,
  buildPlayerGuidance,
  buildGameShellSnapshot,
  buildShellDelta,
  selectTurnPresentation,
} from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";

export interface JsonResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function json(data: unknown, statusCode = 200): JsonResponse {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) };
}

function error(code: string, message: string, statusCode = 400): JsonResponse {
  return json({ ok: false, error: { code, message } }, statusCode);
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

export function serializeWorldStateFromRuntime(r: WorldRuntime) {
  const world = r.projection.getSnapshot();
  return {
    player: { x: world.player.x, y: world.player.y },
    worldTime: world.time,
    eventNumber: world.eventNumber,
    lastActionTick: world.lastActionTick,
    observations: Object.fromEntries(world.observations),
    consequences: [...world.consequences.values()].map((c) => ({
      id: c.id, type: c.type, severity: c.severity, expiresAt: c.expiresAt,
    })),
    activeSituations: [...world.activeSituations.values()].map((s) => ({
      situationId: s.situationId, type: s.type, startedAt: s.startedAt, duration: s.duration,
    })),
    burnedTrees: world.burnedTrees,
    relations: [...world.relations.values()].map((r) => ({
      from: r.from, to: r.to, kind: r.kind, value: r.value,
    })),
    heatSources: [...world.heatSources.values()].map((hs) => ({
      x: hs.x, y: hs.y, intensity: hs.intensity,
    })),
    heatMap: Object.fromEntries(world.heatMap),
    walls: [...world.walls],
    strategy: [...world.strategy],
    routerAvailable: r.router !== null && r.router.apiKey.length > 0,
  };
}

function buildGuidance(runtime: WorldRuntime) {
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  return buildPlayerGuidance(events, world);
}

function checkPoisoned(runtime: WorldRuntime): boolean {
  return (runtime.engine as any).isPoisoned?.() ?? false;
}

function parseStrictInt(raw: string | null, def: number, min: number, max: number): { value: number; ok: true } | { ok: false } {
  if (raw === null) return { value: def, ok: true };
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || String(n) !== raw) return { ok: false };
  if (n < min || n > max) return { ok: false };
  return { value: n, ok: true };
}

// --- State ---

export function handleWorldState(runtime: WorldRuntime): JsonResponse {
  const state = serializeWorldStateFromRuntime(runtime);
  return json({ ok: true, state });
}

// --- Command ---

export async function handleWorldCommand(runtime: WorldRuntime, body: unknown): Promise<JsonResponse> {
  if (checkPoisoned(runtime)) return error("internal_error", "server is in fatal state", 503);
  if (!body || typeof body !== "object") return error("invalid_request", "body must be object");
  const { input, idempotencyKey } = body as Record<string, unknown>;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128)
    return error("missing_idempotency_key", "idempotencyKey required (1-128 chars)", 400);
  if (typeof input !== "string" || input.length === 0)
    return error("invalid_request", "input required", 400);

  return runtime.queue.enqueue(async () => {
    try {
      if (input === "wait") {
        const r = await runOfflineTicksForRuntime(runtime, 1, idempotencyKey);
        if ("type" in r && (r as any).type === "IdempotencyReject")
          return error("duplicate_request", "duplicate idempotencyKey", 409);
        const tickResult = r as { tickEvents: DomainEvent[] };
      const pres = selectTurnPresentation(tickResult.tickEvents, runtime.projection.getSnapshot());
      const guidance = buildGuidance(runtime);
      const shellDelta = buildShellDelta(runtime.bus.query(), runtime.projection.getSnapshot());
      return json({ ok: true, tickEvents: tickResult.tickEvents, state: serializeWorldStateFromRuntime(runtime), presentation: pres, guidance, shellDelta });
    }
    if (input.startsWith("advance ")) {
        const raw = input.slice(8).trim();
        const n = Number(raw);
        if (!Number.isSafeInteger(n) || n < 1 || n > 100) return error("invalid_request", "advance N (1-100, integer)");
        const r = await runOfflineTicksForRuntime(runtime, n, idempotencyKey);
        if ("type" in r && (r as any).type === "IdempotencyReject")
          return error("duplicate_request", "duplicate idempotencyKey", 409);
        const tickResult = r as { tickEvents: DomainEvent[] };
        const pres = selectTurnPresentation(tickResult.tickEvents, runtime.projection.getSnapshot());
        const guidance = buildGuidance(runtime);
        const shellDelta = buildShellDelta(runtime.bus.query(), runtime.projection.getSnapshot());
        return json({ ok: true, tickEvents: tickResult.tickEvents, state: serializeWorldStateFromRuntime(runtime), presentation: pres, guidance, shellDelta });
      }

      const r = await runCommandCycleForRuntime(runtime, input, idempotencyKey);
      if (!r || typeof r !== "object") return error("internal_error", "unexpected result", 500);
      // runCommandCycleForRuntime returns a JsonResponse with 409 for duplicates
      if ("statusCode" in r && (r as JsonResponse).statusCode === 409)
        return r as JsonResponse;
      if ("statusCode" in r && (r as JsonResponse).statusCode !== 200)
        return r as JsonResponse;
      if ("type" in r && (r as any).type === "ParseError")
        return error("parse_error", (r as any).reason ?? "parse error", 400);
      const cmdResult = r as { events: DomainEvent[]; tickEvents: DomainEvent[]; position: unknown };
      const allCycleEvents = [...cmdResult.events, ...cmdResult.tickEvents];
      const pres = selectTurnPresentation(allCycleEvents, runtime.projection.getSnapshot());
      const guidance = buildGuidance(runtime);
      const shellDelta = buildShellDelta(runtime.bus.query(), runtime.projection.getSnapshot());
      return json({
        ok: true,
        events: cmdResult.events,
        tickEvents: cmdResult.tickEvents,
        position: cmdResult.position,
        state: serializeWorldStateFromRuntime(runtime),
        presentation: pres,
        guidance,
        shellDelta,
      });
    } catch (err) {
      return error("internal_error", safeError(err), 500);
    }
  });
}

// --- Read endpoints ---

export function handleWorldJournal(runtime: WorldRuntime, url: URL): JsonResponse {
  const events = runtime.bus.query();
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

  const filtered = beforeTick ? journal.turns.filter((t) => t.worldTime < beforeTick) : journal.turns;
  const page = [...filtered].sort((a, b) => b.worldTime - a.worldTime).slice(0, limit);
  const hasMore = filtered.length > page.length;
  const nextBefore = hasMore ? page[page.length - 1]!.worldTime : null;

  return json({ ok: true, turns: page, threads: journal.threads, worldTime: journal.worldTime, nextBefore, hasMore });
}

export function handleWorldDiscoveries(runtime: WorldRuntime): JsonResponse {
  const events = runtime.bus.query();
  const journal = buildDiscoveryJournal(events);
  return json({ ok: true, cards: journal.cards, recentEvidence: journal.recentEvidence, worldTime: journal.worldTime });
}

export function handleWorldGuidance(runtime: WorldRuntime): JsonResponse {
  const guidance = buildGuidance(runtime);
  return json({ ok: true, guidance });
}

export function handleWorldGameShell(runtime: WorldRuntime, worldId: string): JsonResponse {
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  const record = runtime.store.getWorldRecord(worldId);
  const charProfile = record?.characterId ? runtime.store.getCharacterProfile(record.characterId) : null;
  const snapshot = buildGameShellSnapshot(events, world, charProfile, worldId);
  return json({ ok: true, snapshot });
}

export function handleWorldNarrative(runtime: WorldRuntime): JsonResponse {
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  const snapshot = buildNarrative(events, world);
  return json({ ok: true, entries: snapshot.entries, presentation: snapshot.presentation, worldTime: snapshot.worldTime, playerPosition: snapshot.playerPosition });
}

export async function handleWorldWait(runtime: WorldRuntime, body: unknown): Promise<JsonResponse> {
  if (!body || typeof body !== "object") return error("invalid_request", "body must be object");
  const { count, idempotencyKey } = body as Record<string, unknown>;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128)
    return error("missing_idempotency_key", "idempotencyKey required", 400);
  const n = typeof count === "number" ? count : 1;
  if (!Number.isSafeInteger(n) || n < 1 || n > 100) return error("invalid_request", "count must be integer 1-100");

  return runtime.queue.enqueue(async () => {
    try {
      const result = await runOfflineTicksForRuntime(runtime, n, idempotencyKey);
      if ("type" in result && (result as IdempotencyReject).type === "IdempotencyReject")
        return error("duplicate_request", "duplicate idempotencyKey", 409);
      const r = result as { tickEvents: DomainEvent[] };
      const pres = selectTurnPresentation(r.tickEvents, runtime.projection.getSnapshot());
      const guidance = buildGuidance(runtime);
      const shellDelta = buildShellDelta(runtime.bus.query(), runtime.projection.getSnapshot());
      return json({ ok: true, tickEvents: r.tickEvents, state: serializeWorldStateFromRuntime(runtime), presentation: pres, guidance, shellDelta });
    } catch (err) {
      return error("internal_error", safeError(err), 500);
    }
  });
}

export function handleWorldEvents(runtime: WorldRuntime, url: URL): JsonResponse {
  const limitP = parseStrictInt(url.searchParams.get("limit"), 50, 1, 200);
  if (!limitP.ok) return error("invalid_request", "limit must be integer 1-200", 400);
  const offsetP = parseStrictInt(url.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  if (!offsetP.ok) return error("invalid_request", "offset must be non-negative integer", 400);
  const all = runtime.bus.query();
  const slice = all.slice(offsetP.value, offsetP.value + limitP.value);
  return json({ ok: true, events: slice, count: all.length, limit: limitP.value, offset: offsetP.value });
}

// --- Command execution helpers ---

import { parseIntent } from "@skald/intent-parser";
import { handleCommand as worldHandleCommand, commandEventId } from "@skald/world";
import type { ProcessOptions, CommitContext } from "@skald/rule-engine";
import { rollCriticalCheck } from "../dice-roller.js";

export interface IdempotencyReject {
  type: "IdempotencyReject";
  reason: string;
  idempotencyKey: string;
}

async function runCommandCycleForRuntime(
  runtime: WorldRuntime,
  input: string,
  idempotencyKey: string,
): Promise<{ events: DomainEvent[]; tickEvents: DomainEvent[]; position: unknown } | JsonResponse> {
  if (runtime.processedKeys.has(idempotencyKey)) {
    return error("duplicate_request", "duplicate idempotencyKey", 409);
  }

  const parsed = parseIntent(input);
  if (parsed.type !== "ActionIntentCommand" && parsed.type !== "IntentCommand") return error("parse_error", "Could not understand input", 400);

  const ts = runtime.projection.getSnapshot().time + 1;
  const correlationId = `cmd-${ts}`;
  const firstEvent = worldHandleCommand(parsed, correlationId, ts);
  const tickEvent: DomainEvent = {
    eventId: commandEventId(`tick-${ts}`, "TickPassed"),
    type: "TickPassed",
    schemaVersion: 1,
    payload: { delta: 1 },
    timestamp: ts,
    correlationId: `tick-${ts}`,
    causationId: null,
  };

  const options: ProcessOptions = {
    commitContext: { idempotencyKey, requestKind: "command", correlationId } as CommitContext,
  };

  try {
    const { committed } = runtime.engine.processSequence([firstEvent, tickEvent], options);
    runtime.processedKeys.add(idempotencyKey);

    // Process dice rolls for any CriticalCheckRequested events
    const commandEvents = committed.filter((e) => e.correlationId === correlationId);
    const allCommandEvents = [...commandEvents];

    const rollEvents: DomainEvent[] = [];
    for (const event of commandEvents) {
      if (event.type === "CriticalCheckRequested") {
        rollEvents.push(rollCriticalCheck(event));
      }
    }

    if (rollEvents.length > 0) {
      const { committed: rollCommitted } = runtime.engine.processSequence(rollEvents);
      allCommandEvents.push(...rollCommitted);
    }

    const tickEvents = committed.filter((e) => e.correlationId === `tick-${ts}`);
    return { events: allCommandEvents, tickEvents, position: { ...runtime.projection.getSnapshot().player } };
  } catch (err) {
    throw err;
  }
}

async function runOfflineTicksForRuntime(
  runtime: WorldRuntime,
  count: number,
  idempotencyKey: string,
): Promise<{ tickEvents: DomainEvent[] } | IdempotencyReject> {
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    throw new Error("count must be an integer between 1 and 100");
  }
  if (runtime.processedKeys.has(idempotencyKey)) {
    return { type: "IdempotencyReject", reason: "duplicate command", idempotencyKey };
  }

  const startTs = runtime.projection.getSnapshot().time;
  const rootEvents: DomainEvent[] = [];
  for (let i = 0; i < count; i++) {
    const ts = startTs + 1 + i;
    rootEvents.push({
      eventId: commandEventId(`tick-offline-${ts}`, "TickPassed"),
      type: "TickPassed",
      schemaVersion: 1,
      payload: { delta: 1, playerOffline: true },
      timestamp: ts,
      correlationId: `tick-offline-${ts}`,
      causationId: null,
    });
  }

  const options: ProcessOptions = {
    commitContext: { idempotencyKey, requestKind: "wait", correlationId: `wait-${startTs + 1}` } as CommitContext,
  };

  try {
    const { committed } = runtime.engine.processSequence(rootEvents, options);
    runtime.processedKeys.add(idempotencyKey);
    return { tickEvents: committed };
  } catch (err) {
    throw err;
  }
}
