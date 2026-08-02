import type { WorldRuntime } from "../runtime/index.js";
import {
  buildNarrative,
  buildTurnJournal,
  buildDiscoveryJournalFromBeliefModel,
  buildPlayerGuidance,
  buildGameShellSnapshot,
  buildBeliefModel,
  buildObserverSessionAndSummary,
  buildObserverThreadJournal,
  buildObserverThreadDelta,
  resolveCheckpointState,
  computeBeliefRevision,
  parseBeliefModelDTO,
  serializeBeliefModel,
  buildShellDelta,
  selectTurnPresentation,
  resolveOfflineIntent,
} from "@skald/world";
import type { ObserverThreadDelta, ObserverThreadJournalDTO } from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";
import { createHash } from "node:crypto";

/** Deterministic canonical hash of the acknowledge request body. */
function acknowledgeRequestHash(worldTime: number, eventNumber: number): string {
  return createHash("sha256")
    .update(JSON.stringify({ kind: "acknowledge", worldTime, eventNumber }))
    .digest("hex");
}

export interface JsonResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function serializeShellDelta(delta: ReturnType<typeof buildShellDelta>) {
  return { ...delta, beliefModel: parseBeliefModelDTO(serializeBeliefModel(delta.beliefModel)) };
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

/**
 * Observer Thread Journal at the current world revision, plus the delta
 * against the checkpoint memory. Synchronous over one snapshot, so the
 * journal revision always equals the concurrent state revision. Only a
 * checkpoint that resolves valid provides thread memory; the resolved state
 * is passed down so the journal never trusts an unverifiable memory.
 */
function buildObserverThreadsForRuntime(runtime: WorldRuntime): { journal: ObserverThreadJournalDTO; delta: ObserverThreadDelta } {
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  const checkpoint = runtime.store.getObserverCheckpoint(runtime.worldId, "player");
  const beliefModel = serializeBeliefModel(buildBeliefModel(events, world, "player"));
  const checkpointState = resolveCheckpointState(events, checkpoint).state;
  const journal = buildObserverThreadJournal({
    events,
    beliefModel,
    checkpoint,
    checkpointState,
    revision: { worldTime: world.time, eventNumber: world.eventNumber },
  });
  const delta = buildObserverThreadDelta({ events, journal, checkpoint, checkpointState });
  return { journal, delta };
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
        const r = await runTicksForRuntime(runtime, 1, idempotencyKey, { playerOffline: false });
        if ("type" in r && (r as any).type === "IdempotencyReject")
          return error("duplicate_request", "duplicate idempotencyKey", 409);
        const tickResult = r as { tickEvents: DomainEvent[] };
        const pres = selectTurnPresentation(tickResult.tickEvents, runtime.projection.getSnapshot());
        const guidance = buildGuidance(runtime);
        const shellDelta = buildShellDelta(runtime.bus.query(), runtime.projection.getSnapshot());
        const { journal: observerThreads, delta: observerThreadDelta } = buildObserverThreadsForRuntime(runtime);
        return json({ ok: true, state: serializeWorldStateFromRuntime(runtime), presentation: pres, guidance, shellDelta: serializeShellDelta(shellDelta), observerThreads, observerThreadDelta });
      }
      if (input.startsWith("advance ")) {
        const raw = input.slice(8).trim();
        const n = Number(raw);
        if (!Number.isSafeInteger(n) || n < 1 || n > 100) return error("invalid_request", "advance N (1-100, integer)");
        const r = await runTicksForRuntime(runtime, n, idempotencyKey, { playerOffline: true });
        if ("type" in r && (r as any).type === "IdempotencyReject")
          return error("duplicate_request", "duplicate idempotencyKey", 409);
        const tickResult = r as { tickEvents: DomainEvent[] };
        const pres = selectTurnPresentation(tickResult.tickEvents, runtime.projection.getSnapshot());
        const guidance = buildGuidance(runtime);
        const shellDelta = buildShellDelta(runtime.bus.query(), runtime.projection.getSnapshot());
        const { journal: observerThreads, delta: observerThreadDelta } = buildObserverThreadsForRuntime(runtime);
        return json({ ok: true, state: serializeWorldStateFromRuntime(runtime), presentation: pres, guidance, shellDelta: serializeShellDelta(shellDelta), observerThreads, observerThreadDelta });
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
      const { journal: observerThreads, delta: observerThreadDelta } = buildObserverThreadsForRuntime(runtime);
      return json({
        ok: true,
        state: serializeWorldStateFromRuntime(runtime),
        position: cmdResult.position,
        // Raw Domain Events are not exposed to normal UI; use /api/events for diagnostics.
        presentation: pres,
        guidance,
        shellDelta: serializeShellDelta(shellDelta),
        observerThreads,
        observerThreadDelta,
      });
    } catch (err) {
      return error("internal_error", safeError(err), 500);
    }
  });
}

// --- Offline intent queue (UX-6.3) ---

export async function handleOfflineCommand(runtime: WorldRuntime, body: unknown): Promise<JsonResponse> {
  if (checkPoisoned(runtime)) return error("internal_error", "server is in fatal state", 503);
  if (!body || typeof body !== "object") return error("invalid_request", "body must be object");
  const { input, idempotencyKey, baseRevision } = body as Record<string, unknown>;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128)
    return error("missing_idempotency_key", "idempotencyKey required (1-128 chars)", 400);
  if (typeof input !== "string" || input.length === 0)
    return error("invalid_request", "input required", 400);
  if (typeof baseRevision !== "number" || !Number.isSafeInteger(baseRevision) || baseRevision < 0)
    return error("invalid_request", "baseRevision must be a non-negative integer", 400);

  return runtime.queue.enqueue(async () => {
    try {
      // Idempotency replay wins: a processed key is already_processed and the
      // browser reconciles authoritative read models instead of re-sending.
      if (runtime.processedKeys.has(idempotencyKey)) {
        return json({ ok: true, resolution: "already_processed", message: "Это намерение уже было обработано.", reason: null });
      }

      // parseIntent's typed contract today never yields ParseError, but the
      // offline endpoint must survive parser evolution without silently
      // reclassifying unparsable text; the union cast keeps the guard live.
      const parsed = parseIntent(input) as
        | ReturnType<typeof parseIntent>
        | { type: "ParseError"; reason: string; input: string };
      if (parsed.type === "ParseError") {
        return json({ ok: true, resolution: "rejected", message: "Не удалось понять намерение. Сейчас без связи можно отправить только «осмотреть <объект>».", reason: "unparsable" });
      }
      if (parsed.type !== "InteractionCommand") {
        return json({ ok: true, resolution: "rejected", message: "Сейчас без связи можно отправить только «осмотреть <объект>».", reason: "unsupported_offline_intent" });
      }

      const dto = resolveOfflineIntent(
        { input, idempotencyKey, baseRevision },
        { events: runtime.bus.query(), world: runtime.projection.getSnapshot(), parsed },
      );
      if (dto.resolution !== "accepted") {
        return json({ ok: true, resolution: dto.resolution, message: dto.message, reason: dto.reason });
      }

      // Accepted: execute the normal command cycle with the same envelope.
      // Classification and execution share one snapshot inside the queue, so
      // the accepted target still resolves and the time gate passes
      // (ts = time + 1 > lastActionTick by construction).
      const r = await runCommandCycleForRuntime(runtime, input, idempotencyKey);
      if (!r || typeof r !== "object") return error("internal_error", "unexpected result", 500);
      if ("statusCode" in r) return r as JsonResponse;
      const cmdResult = r as { events: DomainEvent[]; tickEvents: DomainEvent[]; position: unknown };
      const allCycleEvents = [...cmdResult.events, ...cmdResult.tickEvents];
      const pres = selectTurnPresentation(allCycleEvents, runtime.projection.getSnapshot());
      const guidance = buildGuidance(runtime);
      const shellDelta = buildShellDelta(runtime.bus.query(), runtime.projection.getSnapshot());
      const { journal: observerThreads, delta: observerThreadDelta } = buildObserverThreadsForRuntime(runtime);
      return json({
        ok: true,
        resolution: "accepted",
        message: null,
        reason: null,
        state: serializeWorldStateFromRuntime(runtime),
        // Raw Domain Events are not exposed to normal UI; use /api/events for diagnostics.
        presentation: pres,
        guidance,
        shellDelta: serializeShellDelta(shellDelta),
        observerThreads,
        observerThreadDelta,
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
  const beliefModel = buildBeliefModel(runtime.bus.query(), runtime.projection.getSnapshot());
  const journal = buildDiscoveryJournalFromBeliefModel(beliefModel);
  return json({ ok: true, cards: journal.cards, recentEvidence: journal.recentEvidence, worldTime: journal.worldTime });
}

export function handleWorldGuidance(runtime: WorldRuntime): JsonResponse {
  const guidance = buildGuidance(runtime);
  return json({ ok: true, guidance });
}

export function handleWorldBeliefModel(runtime: WorldRuntime): JsonResponse {
  const beliefModel = parseBeliefModelDTO(serializeBeliefModel(buildBeliefModel(runtime.bus.query(), runtime.projection.getSnapshot())));
  return json({ ok: true, beliefModel });
}

export function handleWorldGameShell(runtime: WorldRuntime, worldId: string): JsonResponse {
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  const record = runtime.store.getWorldRecord(worldId);
  const charProfile = record?.characterId ? runtime.store.getCharacterProfile(record.characterId) : null;
  const snapshot = buildGameShellSnapshot(events, world, charProfile, worldId);
  const { journal: observerThreads } = buildObserverThreadsForRuntime(runtime);
  return json({
    ok: true,
    snapshot: {
      ...snapshot,
      beliefModel: parseBeliefModelDTO(serializeBeliefModel(snapshot.beliefModel)),
      // One consistent revision: the thread journal derives synchronously
      // from the same events/world as the rest of the snapshot.
      observerThreads,
    },
  });
}

export function handleWorldNarrative(runtime: WorldRuntime): JsonResponse {
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  const snapshot = buildNarrative(events, world);
  return json({ ok: true, entries: snapshot.entries, presentation: snapshot.presentation, worldTime: snapshot.worldTime, playerPosition: snapshot.playerPosition });
}

export async function handleWorldWait(runtime: WorldRuntime, body: unknown): Promise<JsonResponse> {
  if (checkPoisoned(runtime)) return error("internal_error", "server is in fatal state", 503);
  if (!body || typeof body !== "object") return error("invalid_request", "body must be object");
  const { count, idempotencyKey } = body as Record<string, unknown>;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128)
    return error("missing_idempotency_key", "idempotencyKey required", 400);
  const n = typeof count === "number" ? count : 1;
  if (!Number.isSafeInteger(n) || n < 1 || n > 100) return error("invalid_request", "count must be integer 1-100");

  return runtime.queue.enqueue(async () => {
    try {
      const result = await runTicksForRuntime(runtime, n, idempotencyKey, { playerOffline: false });
      if ("type" in result && (result as IdempotencyReject).type === "IdempotencyReject")
        return error("duplicate_request", "duplicate idempotencyKey", 409);
      const tickResult = result as { tickEvents: DomainEvent[] };
      const pres = selectTurnPresentation(tickResult.tickEvents, runtime.projection.getSnapshot());
      const guidance = buildGuidance(runtime);
      const shellDelta = buildShellDelta(runtime.bus.query(), runtime.projection.getSnapshot());
      const { journal: observerThreads, delta: observerThreadDelta } = buildObserverThreadsForRuntime(runtime);
      return json({ ok: true, state: serializeWorldStateFromRuntime(runtime), presentation: pres, guidance, shellDelta: serializeShellDelta(shellDelta), observerThreads, observerThreadDelta });
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

// --- Observer presence (UX-6) ---

function resolvePlayerContext(world: ReturnType<WorldRuntime["projection"]["getSnapshot"]>): {
  locationTitle: string;
  locationDescription: string;
} {
  const locationId = world.currentLocationId;
  const location = locationId ? world.locations.get(locationId) : undefined;
  return {
    locationTitle: location?.name ?? "",
    locationDescription: location?.description ?? "",
  };
}

export function handleObserverSession(runtime: WorldRuntime, worldId: string): JsonResponse {
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  const checkpoint = runtime.store.getObserverCheckpoint(worldId, "player");
  const { session, summary } = buildObserverSessionAndSummary({
    worldId, events, world, playerContext: resolvePlayerContext(world), checkpoint,
  });
  const beliefModel = serializeBeliefModel(buildBeliefModel(events, world, "player"));
  const threads = buildObserverThreadJournal({
    events,
    beliefModel,
    checkpoint,
    checkpointState: resolveCheckpointState(events, checkpoint).state,
    revision: { worldTime: world.time, eventNumber: world.eventNumber },
  });
  return json({
    ok: true,
    session: { ...session, beliefModel: parseBeliefModelDTO(session.beliefModel) },
    summary,
    // One consistent revision: session.revision === threads.revision by
    // construction — both derive synchronously from the same snapshot.
    threads,
  });
}

export function handleObserverThreads(runtime: WorldRuntime, _worldId: string): JsonResponse {
  if (checkPoisoned(runtime)) return error("internal_error", "server is in fatal state", 503);
  const { journal } = buildObserverThreadsForRuntime(runtime);
  return json({ ok: true, journal });
}

export function handleWorldPresence(runtime: WorldRuntime, worldId: string): JsonResponse {
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  const checkpoint = runtime.store.getObserverCheckpoint(worldId, "player");
  const { session, summary } = buildObserverSessionAndSummary({
    worldId, events, world, playerContext: resolvePlayerContext(world), checkpoint,
  });
  return json({ ok: true, checkpoint, presence: session.presence, summary });
}

function currentBeliefRevision(runtime: WorldRuntime): number {
  return computeBeliefRevision(
    serializeBeliefModel(buildBeliefModel(runtime.bus.query(), runtime.projection.getSnapshot())),
  );
}

export async function handlePresenceAcknowledge(
  runtime: WorldRuntime,
  worldId: string,
  body: unknown,
): Promise<JsonResponse> {
  if (checkPoisoned(runtime)) return error("internal_error", "server is in fatal state", 503);
  if (!body || typeof body !== "object") return error("invalid_request", "body must be object");
  const { idempotencyKey, worldTime, eventNumber } = body as Record<string, unknown>;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128)
    return error("missing_idempotency_key", "idempotencyKey required (1-128 chars)", 400);
  if (typeof worldTime !== "number" || !Number.isSafeInteger(worldTime) || worldTime < 0)
    return error("invalid_request", "worldTime must be a non-negative integer", 400);
  if (typeof eventNumber !== "number" || !Number.isSafeInteger(eventNumber) || eventNumber < 0)
    return error("invalid_request", "eventNumber must be a non-negative integer", 400);

  return runtime.queue.enqueue(async () => {
    try {
      const requestHash = acknowledgeRequestHash(worldTime, eventNumber);
      // Idempotency replay wins over staleness: a processed acknowledge with
      // the same body reproduces the original response even after the world
      // moved; a different body under the same key is a conflict.
      const replay = runtime.store.getAcknowledgeReplay(worldId, idempotencyKey);
      if (replay) {
        if (replay.requestHash !== requestHash) {
          return error("duplicate_request", "duplicate idempotencyKey", 409);
        }
        return json({ ok: true, changed: replay.result.changed, checkpoint: replay.result.checkpoint });
      }

      const world = runtime.projection.getSnapshot();
      if (world.time !== worldTime || world.eventNumber !== eventNumber) {
        return error("stale_revision", "acknowledged revision is out of date; re-fetch the observer session", 409);
      }
      const result = runtime.store.acknowledgeObserverCheckpoint({
        worldId,
        idempotencyKey,
        requestHash,
        correlationId: `ack-${idempotencyKey}`,
        observerId: "player",
        lastPresenceWorldTime: worldTime,
        lastPresenceEventNumber: eventNumber,
        beliefRevision: currentBeliefRevision(runtime),
      });
      return json({ ok: true, changed: result.changed, checkpoint: result.checkpoint });
    } catch (err) {
      if (err instanceof Error && err.name === "DuplicateRequestError") {
        return error("duplicate_request", "duplicate idempotencyKey", 409);
      }
      return error("internal_error", safeError(err), 500);
    }
  });
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

export async function runCommandCycleForRuntime(
  runtime: WorldRuntime,
  input: string,
  idempotencyKey: string,
): Promise<{ events: DomainEvent[]; tickEvents: DomainEvent[]; position: unknown } | JsonResponse> {
  if (runtime.processedKeys.has(idempotencyKey)) {
    return error("duplicate_request", "duplicate idempotencyKey", 409);
  }

  const parsed = parseIntent(input);
  if (parsed.type !== "ActionIntentCommand" && parsed.type !== "InteractionCommand") return error("parse_error", "Could not understand input", 400);

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

  const { committed } = runtime.engine.processSequence([firstEvent, tickEvent], {
    ...options,
    // Dice are derived after CriticalCheckRequested has been processed, but
    // remain in the same durable batch as the command and its TickPassed.
    deriveEvents: (staged) => staged
      .filter((event) => event.type === "CriticalCheckRequested" && event.correlationId === correlationId)
      .map((event) => rollCriticalCheck(event)),
  });
  runtime.processedKeys.add(idempotencyKey);

  const commandEvents = committed.filter((e) => e.correlationId === correlationId);
  const tickEvents = committed.filter((e) => e.correlationId === `tick-${ts}`);
  return { events: commandEvents, tickEvents, position: { ...runtime.projection.getSnapshot().player } };
}

async function runTicksForRuntime(
  runtime: WorldRuntime,
  count: number,
  idempotencyKey: string,
  options: { playerOffline: boolean },
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
      eventId: commandEventId(`tick-${ts}`, "TickPassed"),
      type: "TickPassed",
      schemaVersion: 1,
      payload: { delta: 1, ...(options.playerOffline ? { playerOffline: true } : {}) },
      timestamp: ts,
      correlationId: `tick-${ts}`,
      causationId: null,
    });
  }

  const options2: ProcessOptions = {
    commitContext: { idempotencyKey, requestKind: "wait", correlationId: `wait-${startTs + 1}` } as CommitContext,
  };

  try {
    const { committed } = runtime.engine.processSequence(rootEvents, options2);
    runtime.processedKeys.add(idempotencyKey);
    return { tickEvents: committed };
  } catch (err) {
    throw err;
  }
}
