import type { WorldRuntime } from "../runtime/index.js";
import { readSideHandle } from "../conversation/identity.js";
import { resolveNarrationState } from "../runtime/index.js";
import {
  buildNarrative,
  buildTurnJournal,
  attachTurnNarrations,
  narrationKey,
  buildDiscoveryJournalFromBeliefModel,
  buildDiscoveryJournal,
  buildPlayerGuidance,
  buildGameShellSnapshot,
  buildPlayerKnowledgePresentation,
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
  toPlayerDiscoveryJournal,
  resolveOfflineIntent,
  buildObserverMap,
  buildSpatialWorldProjection,
  narrateTurnLLM,
  buildBackgroundNarrativeContext,
  buildNarrativeAdapterContext,
  localizedPlayerText,
  WorldProjector,
  buildInquiryAnswer,
  getCharacterBackground,
  getRegionEntrypoint,
  resolveInteractionTarget,
  narrateLLM,
} from "@skald/world";
import type { ObserverThreadDelta, ObserverThreadJournalDTO, NarrativeAdapterContext } from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";
import { createHash } from "node:crypto";
import { interpretPlayerInput } from "../runtime/intent-gateway.js";
import { classifyPlayerInput, parseIntent, validateActionProposal } from "@skald/intent-parser";
import type { ExecutableIntent } from "@skald/intent-parser";
import type { ResourceExtractionCommand, SpatialWorldProjection } from "@skald/world";
import { getMapDetailAsset } from "./map-detail-catalog.js";
import {
  buildActionConversationTurn,
  buildReadSideConversationTurn,
  conversationRequestHash,
  toConversationTurnDTO,
} from "../conversation/builder.js";
import {
  toPlayerFacingJournalTurns,
  toPlayerFacingNarrativeEntries,
  toPlayerFacingPresentation,
  toPlayerFacingState,
  toPlayerFacingThreads,
  toPlayerFacingGameShellSnapshot,
  toPlayerFacingShellDelta,
} from "./player-facing.js";

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
  return toPlayerFacingShellDelta(delta);
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

function persistReadSideTurn(
  runtime: WorldRuntime,
  input: string,
  idempotencyKey: string,
  inputClass: "inquiry" | "clarification",
  responseKind: "inquiry_answer" | "clarification",
  responseText: string,
): ReturnType<typeof toConversationTurnDTO> {
  const worldTime = runtime.projection.getSnapshot().time;
  return toConversationTurnDTO(runtime.store.recordConversationTurn(buildReadSideConversationTurn({
    worldId: runtime.worldId,
    idempotencyKey,
    playerText: input,
    inputClass,
    responseKind,
    responseText,
    worldTime,
  })));
}

function duplicateConversationResponse(runtime: WorldRuntime, input: string, idempotencyKey: string): JsonResponse | null {
  const existing = runtime.store.getConversationTurn(runtime.worldId, idempotencyKey);
  if (!existing) return null;
  if (existing.requestHash !== conversationRequestHash(input)) return error("duplicate_request", "duplicate idempotencyKey", 409);
  const conversationTurn = toConversationTurnDTO(existing);
  if (existing.inputClass === "action") {
    return json({ ok: false, error: { code: "duplicate_request", message: "duplicate idempotencyKey" }, conversationTurn }, 409);
  }
  return json({ ok: true, replayed: true, status: existing.inputClass, conversationTurn });
}

function withClarificationConversation(
  runtime: WorldRuntime,
  input: string,
  idempotencyKey: string,
  response: JsonResponse,
): JsonResponse {
  const payload = JSON.parse(response.body) as Record<string, unknown>;
  const question = typeof payload.question === "string" ? payload.question : "Уточни намерение.";
  const conversationTurn = persistReadSideTurn(runtime, input, idempotencyKey, "clarification", "clarification", question);
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  const knowledge = buildPlayerKnowledgePresentation(events, world, buildBeliefModel(events, world), { startup: true, maxEntries: 3 });
  return json({ ...payload, conversationTurn, knowledge }, response.statusCode);
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
  return buildPlayerGuidance(events, world, buildGuidanceContext(runtime));
}

function buildGuidanceContext(runtime: WorldRuntime): NarrativeAdapterContext | undefined {
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  return buildNarrationContext(runtime, selectTurnPresentation(events, world), events, world);
}

function buildNarrationContext(
  runtime: WorldRuntime,
  presentation: ReturnType<typeof selectTurnPresentation>,
  events: readonly DomainEvent[] = runtime.bus.query(),
  world: ReturnType<WorldRuntime["projection"]["getSnapshot"]> = runtime.projection.getSnapshot(),
  openingWindow = false,
  correlationId?: string,
  priority: "interactive" | "batch" = "interactive",
): NarrativeAdapterContext | undefined {
  const startedAt = performance.now();
  try {
    const record = runtime.store.getWorldRecord(runtime.worldId);
    const profile = record?.characterId ? runtime.store.getCharacterProfile(record.characterId) : null;
    const entrypoint = record?.entrypointId ? getRegionEntrypoint(record.entrypointId) : null;
    const context = buildNarrativeAdapterContext(events, world, {
      profile,
      entrypoint,
      presentation,
      openingWindow,
      ...(record?.characterName !== undefined ? { characterName: record.characterName } : {}),
    });
    return context ?? undefined;
  } catch {
    // Context is an optional read-side decoration; it must never turn a
    // durable command commit into a failed player request.
    try {
      runtime.diagnostics({
        kind: "context",
        category: "context_error",
        outcome: "context_error",
        provider: "adapter",
        durationMs: Math.round(performance.now() - startedAt),
        attempt: 0,
        timeout: 0,
        retryOutcome: "none",
        turn: world.time,
        worldTime: world.time,
        priority,
        detail: "build_failed",
        worldId: runtime.worldId,
        recordedAt: new Date().toISOString(),
        ...(correlationId ? { correlationId } : {}),
      });
    } catch { /* diagnostics are best-effort */ }
    return undefined;
  }
}

function isOpeningNarrationWindow(runtime: WorldRuntime, currentIdempotencyKey?: string): boolean {
  try {
    const checkpoint = runtime.store.getObserverCheckpoint(runtime.worldId, "player");
    if (!checkpoint) return false;
    const turns = runtime.store.listConversationTurns(runtime.worldId, { limit: 500 });
    const priorTurns = turns.filter((turn) => turn.idempotencyKey !== currentIdempotencyKey).length;
    return priorTurns < 3;
  } catch {
    return false;
  }
}

function historicalWorldAt(events: readonly DomainEvent[], lastEventId: string): { events: readonly DomainEvent[]; world: ReturnType<WorldRuntime["projection"]["getSnapshot"]> } {
  const end = events.findIndex((event) => event.eventId === lastEventId);
  if (end < 0) throw new Error("Narration turn is absent from its captured Event Log");
  const prefix = events.slice(0, end + 1);
  const projector = new WorldProjector();
  for (const event of prefix) projector.apply(event);
  return { events: prefix, world: projector.getSnapshot() };
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
  const state = toPlayerFacingState(serializeWorldStateFromRuntime(runtime));
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  const knowledge = buildPlayerKnowledgePresentation(events, world, buildBeliefModel(events, world), { startup: world.time === 0, maxEntries: world.time === 0 ? 3 : 100 });
  return json({ ok: true, state, knowledge });
}

// --- Command ---

/**
 * Best-effort read-side narration (ADR-0024 "МАСТЕР" voice). Runs detached from
 * the world command queue so the LLM call can never delay the command response
 * (browser-side timeout is 15s, LLM can take tens of seconds). The narration
 * only persists prose keyed by worldTime; the deterministic primary text is
 * never withheld when narration loses the race.
 *
 * Fallback narrations (usedFallback) are deliberately NOT persisted: they are
 * just the deterministic template repeated, `attachTurnNarrations` never
 * surfaces them, and a persisted fallback row would block a later successful
 * generation for the same turn. A transient `chat_error` therefore never
 * permanently deprives a turn of its literary narration.
 */
type NarrationTurn = {
  input: string;
  pres: ReturnType<typeof selectTurnPresentation>;
  correlationId?: string | undefined;
  narrativeContext?: NarrativeAdapterContext | undefined;
};

/**
 * Whether a narration result earns a persisted row and the `ready` state.
 * `usedFallback` narrations and empty successful responses are both terminal
 * failures: nothing is persisted, so the journal must recompose the turn as
 * `unavailable` and the browser polling must keep its terminal state — not a
 * `not_requested` that looks like the prose was never asked for.
 */
export function shouldPersistNarration(narration: { usedFallback: boolean; text: string }): boolean {
  return !narration.usedFallback && narration.text.trim().length > 0;
}

function scheduleNarration(
  runtime: WorldRuntime,
  input: string,
  pres: ReturnType<typeof selectTurnPresentation>,
  correlationId?: string,
  narrativeContext?: NarrativeAdapterContext,
): void {
  const router = runtime.router;
  if (!router || input.trim().length === 0) return;
  const worldId = runtime.worldId;
  const worldTime = pres.worldTime;
  runtime.narration.schedule({
    priority: "interactive",
    worldTime,
    run: async () => {
      // 1. LLM call (with retry — diagnostics flow through the sink if provided)
      const narration = await narrateTurnLLM(input, pres, router, {
        diagnostics: runtime.diagnostics,
        priority: "interactive",
        timeoutMs: router.timeoutSeconds * 1000,
        worldId,
        ...(correlationId ? { correlationId } : {}),
        ...(narrativeContext ? { narrativeContext } : {}),
      });
      // 2. Classify LLM result
      if (!shouldPersistNarration(narration)) { runtime.narration.markUnavailable(worldTime, correlationId); return; }
      // 3. Persist (separate try/catch for persistence diagnostics)
      try {
        runtime.store.saveTurnNarration(worldId, worldTime, narration, correlationId);
      } catch {
        try { runtime.diagnostics({
            kind: "scheduler",
            category: "persistence_error",
            outcome: "persistence_error",
            provider: "scheduler",
            durationMs: 0,
            attempt: 0,
            timeout: 0,
            retryOutcome: "none",
            turn: worldTime,
            worldTime,
            priority: "interactive",
            detail: "save_failed",
            worldId,
            recordedAt: new Date().toISOString(),
            ...(correlationId ? { correlationId } : {}),
        }); } catch { /* diagnostics are best-effort */ }
        runtime.narration.markUnavailable(worldTime, correlationId);
        return;
      }
      runtime.narration.markReady(worldTime, correlationId);
    },
    ...(correlationId ? { correlationId } : {}),
    onDrop: () => runtime.narration.markUnavailable(worldTime, correlationId),
  });
}

/**
 * Best-effort read-side narration for the multiple turns produced by
 * `advance N`. Each tick is its own chronicle turn with its own worldTime, so
 * a single presentation cannot cover them. Each target turn is scheduled as
 * its own detached `batch` job: a single job looping over every tick would run
 * the whole `advance N` inside one slot, exhausting the scheduler queue guard
 * and holding provider limits / serialized LLM time for tens of minutes while
 * later ordinary commands starve. Priority separation keeps the batch behind
 * interactive narrations, and the batch queue's own small cap evicts the
 * oldest pending batch turns via `onDrop` (turned `unavailable`) so a burst
 * can never monopolize the runner. Jobs derive the per-turn presentation from
 * the journal at execution time (the world already committed before any job
 * starts) and persist one narration per target worldTime. Runs detached,
 * bounded and failure-swallowing like {@link scheduleNarration}.
 */
function scheduleNarrationForTicks(runtime: WorldRuntime, input: string, tickEvents: readonly DomainEvent[]): void {
  const router = runtime.router;
  if (!router || input.trim().length === 0 || tickEvents.length === 0) return;
  const worldId = runtime.worldId;
  // The world command queue has already committed these ticks before this
  // helper runs, so the journal presentation per target worldTime is stable:
  // capture it once instead of replaying the log inside every job.
  const allEvents = runtime.bus.query();
  const journal = buildTurnJournal(allEvents);
  const requested = new Set(tickEvents.map((event) => narrationKey(event.timestamp, event.correlationId)));
  const targets = journal.turns
    .filter((turn) => requested.has(narrationKey(turn.worldTime, turn.correlationId)))
    .map((turn) => {
      const { worldTime, presentation, correlationId } = turn;
      const historical = historicalWorldAt(allEvents, turn.sourceEventIds[turn.sourceEventIds.length - 1]!);
      return {
        worldTime,
        presentation,
        narrativeContext: buildNarrationContext(runtime, presentation, historical.events, historical.world, false, correlationId, "batch"),
        ...(correlationId ? { correlationId } : {}),
      };
    });
  for (const target of targets) {
    const { worldTime, presentation, correlationId, narrativeContext } = target;
    if (!presentation) continue;
    runtime.narration.schedule({
      priority: "batch",
      worldTime,
      run: async () => {
        // 1. LLM call (with retry — diagnostics flow through the sink if provided)
        const narration = await narrateTurnLLM(input, presentation, router, {
          diagnostics: runtime.diagnostics,
          priority: "batch",
          timeoutMs: router.timeoutSeconds * 1000,
          worldId,
          ...(correlationId ? { correlationId } : {}),
          ...(narrativeContext ? { narrativeContext } : {}),
        });
        // 2. Classify LLM result
        if (!shouldPersistNarration(narration)) { runtime.narration.markUnavailable(worldTime, correlationId); return; }
        // 3. Persist (separate try/catch for persistence diagnostics)
        try {
          runtime.store.saveTurnNarration(worldId, worldTime, narration, correlationId);
        } catch {
          try { runtime.diagnostics({
            kind: "scheduler",
            category: "persistence_error",
            outcome: "persistence_error",
            provider: "scheduler",
            durationMs: 0,
            attempt: 0,
            timeout: 0,
            retryOutcome: "none",
            turn: worldTime,
            worldTime,
            priority: "batch",
            detail: "save_failed",
            worldId,
            recordedAt: new Date().toISOString(),
            ...(correlationId ? { correlationId } : {}),
          }); } catch { /* diagnostics are best-effort */ }
          runtime.narration.markUnavailable(worldTime, correlationId);
          return;
        }
        runtime.narration.markReady(worldTime, correlationId);
      },
      ...(correlationId ? { correlationId } : {}),
      onDrop: () => runtime.narration.markUnavailable(worldTime, correlationId),
    });
  }
}

export async function handleWorldCommand(runtime: WorldRuntime, body: unknown): Promise<JsonResponse> {
  if (checkPoisoned(runtime)) return error("internal_error", "server is in fatal state", 503);
  if (!body || typeof body !== "object") return error("invalid_request", "body must be object");
  const { input, idempotencyKey } = body as Record<string, unknown>;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128)
    return error("missing_idempotency_key", "idempotencyKey required (1-128 chars)", 400);
  if (typeof input !== "string" || input.length === 0)
    return error("invalid_request", "input required", 400);

  const replay = duplicateConversationResponse(runtime, input, idempotencyKey);
  if (replay) return replay;

  let narrationTurn: NarrationTurn | null = null;
  let advanceNarrationTicks: DomainEvent[] | null = null;
  let resolvedIntent: ExecutableIntent | undefined;

  if (input !== "wait" && !input.startsWith("advance ")) {
    const interpretation = await interpretPlayerInput(input, runtime.router, {
      diagnostics: runtime.diagnostics,
      correlationId: `intent-${idempotencyKey}`,
      worldTime: runtime.projection.getSnapshot().time,
    });
    if (interpretation.status === "inquiry") {
      return runtime.queue.enqueue(async () => {
        const events = runtime.bus.query();
        const world = runtime.projection.getSnapshot();
        const record = runtime.store.getWorldRecord(runtime.worldId);
        const profile = record?.characterId ? runtime.store.getCharacterProfile(record.characterId) : null;
        const shell = buildGameShellSnapshot(events, world, profile, runtime.worldId, buildGuidanceContext(runtime));
        const background = buildBackgroundNarrativeContext(events, world, profile);
        const inquiry = buildInquiryAnswer(interpretation.inquiry, { shell, background });
        const conversationTurn = persistReadSideTurn(runtime, input, idempotencyKey, "inquiry", "inquiry_answer", inquiry.answer);
        const knowledge = buildPlayerKnowledgePresentation(events, world, buildBeliefModel(events, world), { startup: true, maxEntries: 3 });
        return json({ ok: true, status: "inquiry", inquiry, conversationTurn, knowledge });
      });
    }
    if (interpretation.status === "clarification") {
      return runtime.queue.enqueue(async () => withClarificationConversation(runtime, input, idempotencyKey, json({ ok: true, status: "clarification", question: interpretation.question, options: interpretation.options })));
    }
    if (interpretation.status === "unsupported" || interpretation.status === "unavailable") {
      return runtime.queue.enqueue(async () => withClarificationConversation(runtime, input, idempotencyKey, json({ ok: true, status: "clarification", question: interpretation.message, options: [{ optionId: "rephrase", label: "Уточнить намерение" }] })));
    }
    resolvedIntent = interpretation.intent;
  }

  const response = await runtime.queue.enqueue(async () => {
    try {
      if (input === "wait") {
        const r = await runTicksForRuntime(runtime, 1, idempotencyKey, { playerOffline: false }, { playerText: input });
        if ("type" in r && (r as any).type === "IdempotencyReject")
          return error("duplicate_request", "duplicate idempotencyKey", 409);
        const tickResult = r as { tickEvents: DomainEvent[] };
        const pres = selectTurnPresentation(tickResult.tickEvents, runtime.projection.getSnapshot());
        const guidance = buildGuidance(runtime);
        const shellDelta = buildShellDelta(runtime.bus.query(), runtime.projection.getSnapshot(), buildGuidanceContext(runtime));
        const { journal: observerThreads, delta: observerThreadDelta } = buildObserverThreadsForRuntime(runtime);
        const correlationId = tickResult.tickEvents[0]?.correlationId;
        const narrativeContext = buildNarrationContext(runtime, pres, runtime.bus.query(), runtime.projection.getSnapshot(), isOpeningNarrationWindow(runtime, idempotencyKey), correlationId);
        narrationTurn = { input, pres, narrativeContext, ...(correlationId ? { correlationId } : {}) };
        const conversationTurn = runtime.store.getConversationTurn(runtime.worldId, idempotencyKey);
        return json({ ok: true, state: toPlayerFacingState(serializeWorldStateFromRuntime(runtime)), presentation: toPlayerFacingPresentation(pres), guidance, shellDelta: serializeShellDelta(shellDelta), observerThreads, observerThreadDelta, ...(conversationTurn ? { conversationTurn: toConversationTurnDTO(conversationTurn) } : {}) });
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
        const shellDelta = buildShellDelta(runtime.bus.query(), runtime.projection.getSnapshot(), buildGuidanceContext(runtime));
        const { journal: observerThreads, delta: observerThreadDelta } = buildObserverThreadsForRuntime(runtime);
        advanceNarrationTicks = tickResult.tickEvents;
        return json({ ok: true, state: toPlayerFacingState(serializeWorldStateFromRuntime(runtime)), presentation: toPlayerFacingPresentation(pres), guidance, shellDelta: serializeShellDelta(shellDelta), observerThreads, observerThreadDelta });
      }

      const r = await runCommandCycleForRuntime(runtime, input, idempotencyKey, resolvedIntent);
      if (!r || typeof r !== "object") return error("internal_error", "unexpected result", 500);
      if ("statusCode" in r) {
        const response = r as JsonResponse;
        return response.statusCode === 200 && JSON.parse(response.body).status === "clarification"
          ? withClarificationConversation(runtime, input, idempotencyKey, response)
          : response;
      }
      if ("type" in r && (r as any).type === "ParseError")
        return error("parse_error", (r as any).reason ?? "parse error", 400);
      const cmdResult = r as { events: DomainEvent[]; tickEvents: DomainEvent[]; position: unknown };
      const allCycleEvents = [...cmdResult.events, ...cmdResult.tickEvents];
      const pres = selectTurnPresentation(allCycleEvents, runtime.projection.getSnapshot());
      const guidance = buildGuidance(runtime);
      const shellDelta = buildShellDelta(runtime.bus.query(), runtime.projection.getSnapshot(), buildGuidanceContext(runtime));
      const { journal: observerThreads, delta: observerThreadDelta } = buildObserverThreadsForRuntime(runtime);
      const conversationTurn = runtime.store.getConversationTurn(runtime.worldId, idempotencyKey);
      const correlationId = cmdResult.events[0]?.correlationId ?? cmdResult.tickEvents[0]?.correlationId;
      const narrativeContext = buildNarrationContext(runtime, pres, runtime.bus.query(), runtime.projection.getSnapshot(), isOpeningNarrationWindow(runtime, idempotencyKey), correlationId);
      narrationTurn = { input, pres, narrativeContext, ...(correlationId ? { correlationId } : {}) };
      return json({
        ok: true,
        state: toPlayerFacingState(serializeWorldStateFromRuntime(runtime)),
        // Raw Domain Events are not exposed to normal UI; use /api/events for diagnostics.
        presentation: toPlayerFacingPresentation(pres),
        guidance,
        shellDelta: serializeShellDelta(shellDelta),
        observerThreads,
        observerThreadDelta,
        ...(conversationTurn ? { conversationTurn: toConversationTurnDTO(conversationTurn) } : {}),
      });
    } catch (err) {
      return error("internal_error", safeError(err), 500);
    }
  });

  const pendingNarration = narrationTurn as NarrationTurn | null;
  if (pendingNarration) scheduleNarration(runtime, pendingNarration.input, pendingNarration.pres, pendingNarration.correlationId, pendingNarration.narrativeContext);
  const pendingTicks = advanceNarrationTicks as DomainEvent[] | null;
  if (pendingTicks && pendingTicks.length > 0) scheduleNarrationForTicks(runtime, input, pendingTicks);
  return response;
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

  const existingConversation = runtime.store.getConversationTurn(runtime.worldId, idempotencyKey);
  if (existingConversation) {
    if (existingConversation.requestHash !== conversationRequestHash(input)) return error("duplicate_request", "duplicate idempotencyKey", 409);
    return json({
      ok: true,
      resolution: existingConversation.inputClass === "action" ? "already_processed" : existingConversation.inputClass,
      message: existingConversation.inputClass === "action" ? "Это намерение уже было обработано." : null,
      reason: null,
      conversationTurn: toConversationTurnDTO(existingConversation),
    });
  }

  let narrationTurn: NarrationTurn | null = null;

  const response = await runtime.queue.enqueue(async () => {
    try {
      // Idempotency replay wins: a processed key is already_processed and the
      // browser reconciles authoritative read models instead of re-sending.
      if (runtime.processedKeys.has(idempotencyKey)) {
        return json({ ok: true, resolution: "already_processed", message: "Это намерение уже было обработано.", reason: null });
      }

      const classification = classifyPlayerInput(input, parseIntent);
      if (classification.kind === "inquiry") {
        const events = runtime.bus.query();
        const world = runtime.projection.getSnapshot();
        const record = runtime.store.getWorldRecord(runtime.worldId);
        const profile = record?.characterId ? runtime.store.getCharacterProfile(record.characterId) : null;
        const shell = buildGameShellSnapshot(events, world, profile, runtime.worldId, buildGuidanceContext(runtime));
        const background = buildBackgroundNarrativeContext(events, world, profile);
        const inquiry = buildInquiryAnswer(classification.inquiry, { shell, background });
        const conversationTurn = persistReadSideTurn(runtime, input, idempotencyKey, "inquiry", "inquiry_answer", inquiry.answer);
        return json({ ok: true, resolution: "inquiry", message: null, reason: null, inquiry, conversationTurn });
      }
      const parsed = classification.kind === "inquiry_candidate" ? parseIntent(input) : classification.intent;
      if (parsed.type !== "InteractionCommand") {
        const message = "Сейчас без связи можно отправить только «осмотреть <объект>».";
        const conversationTurn = persistReadSideTurn(runtime, input, idempotencyKey, "clarification", "clarification", message);
        return json({ ok: true, resolution: "rejected", message, reason: "unsupported_offline_intent", conversationTurn });
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
      if ("statusCode" in r) {
        const response = r as JsonResponse;
        return response.statusCode === 200 && JSON.parse(response.body).status === "clarification"
          ? withClarificationConversation(runtime, input, idempotencyKey, response)
          : response;
      }
      const cmdResult = r as { events: DomainEvent[]; tickEvents: DomainEvent[]; position: unknown };
      const allCycleEvents = [...cmdResult.events, ...cmdResult.tickEvents];
      const pres = selectTurnPresentation(allCycleEvents, runtime.projection.getSnapshot());
      const guidance = buildGuidance(runtime);
      const shellDelta = buildShellDelta(runtime.bus.query(), runtime.projection.getSnapshot(), buildGuidanceContext(runtime));
      const { journal: observerThreads, delta: observerThreadDelta } = buildObserverThreadsForRuntime(runtime);
      const correlationId = cmdResult.events[0]?.correlationId ?? cmdResult.tickEvents[0]?.correlationId;
      const narrativeContext = buildNarrationContext(runtime, pres, runtime.bus.query(), runtime.projection.getSnapshot(), isOpeningNarrationWindow(runtime, idempotencyKey), correlationId);
      narrationTurn = { input, pres, narrativeContext, ...(correlationId ? { correlationId } : {}) };
      return json({
        ok: true,
        resolution: "accepted",
        message: null,
        reason: null,
        state: toPlayerFacingState(serializeWorldStateFromRuntime(runtime)),
        // Raw Domain Events are not exposed to normal UI; use /api/events for diagnostics.
        presentation: toPlayerFacingPresentation(pres),
        guidance,
        shellDelta: serializeShellDelta(shellDelta),
        observerThreads,
        observerThreadDelta,
        ...(runtime.store.getConversationTurn(runtime.worldId, idempotencyKey)
          ? { conversationTurn: toConversationTurnDTO(runtime.store.getConversationTurn(runtime.worldId, idempotencyKey)!) }
          : {}),
      });
    } catch (err) {
      return error("internal_error", safeError(err), 500);
    }
  });

  const pendingNarration = narrationTurn as NarrationTurn | null;
  if (pendingNarration) scheduleNarration(runtime, pendingNarration.input, pendingNarration.pres, pendingNarration.correlationId, pendingNarration.narrativeContext);
  return response;
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
  // Reverse append order, not timestamps: distinct turns can share world time.
  const page = [...eligible].reverse().slice(0, limit);
  const hasMore = eligible.length > page.length;
  const nextBefore = hasMore ? page[page.length - 1]!.worldTime : null;
  const nextBeforeTurn = hasMore ? readSideHandle("turn", page[page.length - 1]!.turnId) : null;

  // Merge non-authoritative literary narrations (ADR-0024 "МАСТЕР" voice) from the
  // read-side table so the chronicle shows the D&D-style narration for each turn,
  // and expose the per-turn narration lifecycle so the browser knows whether to
  // keep polling instead of guessing by elapsed time. `ready` derives from the
  // persisted row; `pending`/`unavailable` come from the in-memory scheduler.
  const narrations = runtime.store.getTurnNarrations(runtime.worldId);
  const turnsWithNarrations = attachTurnNarrations(page, narrations, journal.turns);
  const turns = turnsWithNarrations.map((turn) => {
    const row = turn.narrativeLLM;
    return {
      ...turn,
      narrationState: resolveNarrationState(
        { hasNonFallback: Boolean(row && !row.usedFallback) },
        runtime.narration.statusOf(turn.worldTime, turn.correlationId),
      ),
    };
  });
  const conversationLimitRaw = url.searchParams.get("conversationLimit") ?? "500";
  const conversationLimitP = parseStrictInt(conversationLimitRaw, 500, 1, 500);
  if (!conversationLimitP.ok) return error("invalid_request", "conversationLimit must be integer 1-500", 400);
  const conversationBeforeRaw = url.searchParams.get("conversationBefore");
  let conversationBefore: number | undefined;
  if (conversationBeforeRaw !== null) {
    const beforeP = parseStrictInt(conversationBeforeRaw, 0, 1, Number.MAX_SAFE_INTEGER);
    if (!beforeP.ok) return error("invalid_request", "conversationBefore must be a positive integer", 400);
    conversationBefore = beforeP.value;
  }
  const conversationRows = runtime.store.listConversationTurns(runtime.worldId, {
    limit: conversationLimitP.value,
    ...(conversationBefore !== undefined ? { beforeTurnSeq: conversationBefore } : {}),
  });
  const conversationTurns = conversationRows.map(toConversationTurnDTO);
  const conversationHasMore = conversationRows.length === conversationLimitP.value;
  const conversationNextBefore = conversationHasMore ? conversationRows[0]?.turnSeq ?? null : null;

  return json({ ok: true, turns: toPlayerFacingJournalTurns(turns), conversationTurns, conversationNextBefore, conversationHasMore, threads: toPlayerFacingThreads(journal.threads), worldTime: journal.worldTime, nextBefore, nextBeforeTurn, hasMore });
}

export function handleWorldDiscoveries(runtime: WorldRuntime): JsonResponse {
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  const beliefModel = buildBeliefModel(events, world, "player");
  const rumors = buildDiscoveryJournal(events).rumors.filter((rumor) => rumor.observerId === "player");
  const journal = buildDiscoveryJournalFromBeliefModel(beliefModel, rumors);
  return json({ ok: true, ...toPlayerDiscoveryJournal(journal) });
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
  const snapshot = buildGameShellSnapshot(events, world, charProfile, worldId, buildGuidanceContext(runtime));
  const { journal: observerThreads } = buildObserverThreadsForRuntime(runtime);
  return json({
    ok: true,
    snapshot: {
      ...toPlayerFacingGameShellSnapshot(snapshot),
      // One consistent revision: the thread journal derives synchronously
      // from the same events/world as the rest of the snapshot.
      observerThreads,
    },
  });
}

export function handleWorldNarrative(runtime: WorldRuntime): JsonResponse {
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  const record = runtime.store.getWorldRecord(runtime.worldId);
  const profile = record?.characterId ? runtime.store.getCharacterProfile(record.characterId) : null;
  const backgroundContext = buildBackgroundNarrativeContext(events, world, profile);
  const presentation = selectTurnPresentation(events, world);
  const narrativeContext = buildNarrationContext(runtime, presentation);
  const snapshot = buildNarrative(events, world, {
    ...(backgroundContext ? { backgroundContext } : {}),
    ...(narrativeContext ? { narrativeContext } : {}),
  });
  // Internal background context contains adapter ids and is not a public DTO.
  return json({ ok: true, entries: toPlayerFacingNarrativeEntries(snapshot.entries), presentation: toPlayerFacingPresentation(snapshot.presentation), worldTime: snapshot.worldTime });
}

/**
 * Compatibility LLM narration route. It uses the same observer-safe adapter
 * context as the detached turn narration path; the route is read-side only
 * and never exposes internal provenance or fallback diagnostics.
 */
export async function handleWorldNarrativeLLM(runtime: WorldRuntime, url: URL): Promise<JsonResponse> {
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  const sinceRaw = url.searchParams.get("since");
  const sinceP = parseStrictInt(sinceRaw, 0, 0, Number.MAX_SAFE_INTEGER);
  if (!sinceP.ok) return error("invalid_request", "since must be a non-negative integer", 400);
  const since = sinceP.value;
  const base = buildNarrative(events, world, since > 0 ? { sinceTick: since } : undefined);
  const narrativeContext = buildNarrationContext(runtime, base.presentation);
  const snapshot = buildNarrative(events, world, {
    ...(since > 0 ? { sinceTick: since } : {}),
    ...(narrativeContext ? { narrativeContext } : {}),
  });
  const result = await narrateLLM(snapshot, runtime.router, {
    ...(runtime.diagnostics ? { diagnostics: runtime.diagnostics } : {}),
    worldId: runtime.worldId,
    ...(narrativeContext ? { narrativeContext } : {}),
  });
  return json({
    ok: true,
    text: localizedPlayerText(result.text, "МАСТЕР пока не смог связно продолжить эту сцену."),
  });
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
      const shellDelta = buildShellDelta(runtime.bus.query(), runtime.projection.getSnapshot(), buildGuidanceContext(runtime));
      const { journal: observerThreads, delta: observerThreadDelta } = buildObserverThreadsForRuntime(runtime);
      // The legacy /wait endpoint commits one or more player-visible ticks
      // directly. Keep its narration lifecycle identical to /command: the
      // durable tick commit is complete before detached read-side narration
      // is scheduled, and each tick retains its correlation metadata.
      scheduleNarrationForTicks(runtime, "wait", tickResult.tickEvents);
      return json({ ok: true, state: toPlayerFacingState(serializeWorldStateFromRuntime(runtime)), presentation: toPlayerFacingPresentation(pres), guidance, shellDelta: serializeShellDelta(shellDelta), observerThreads, observerThreadDelta });
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
  const playerContext = resolvePlayerContext(world);
  const firstEntryContext = buildFirstEntryContext(runtime, world, events, playerContext);
  const { session, summary } = buildObserverSessionAndSummary({
    worldId, events, world, playerContext, checkpoint,
    ...(firstEntryContext ? { firstEntryContext } : {}),
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
    session,
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

export function handleWorldMap(runtime: WorldRuntime): JsonResponse {
  if (checkPoisoned(runtime)) return error("internal_error", "server is in fatal state", 503);
  const events = runtime.bus.query();
  // The projection already owns the spatial read model. Rebuilding it from the
  // complete event log on every map poll made the endpoint needlessly linear.
  const projectedSpatial = runtime.projection.getSnapshot().spatial;
  const spatial = (projectedSpatial as SpatialWorldProjection | null) ?? buildSpatialWorldProjection(events);
  const map = buildObserverMap(events, spatial, true);
  const availableDetails = (map.availableDetails ?? []).map((detail) => {
    const asset = getMapDetailAsset(detail.id);
    return asset ? { ...detail, label: asset.label, src: "/api/worlds/" + runtime.worldId + "/map-details/" + asset.id, alt: asset.alt } : detail;
  });
  return json({ ok: true, map: { ...map, availableDetails } });
}

export function mapDetailIsAvailable(runtime: WorldRuntime, detailId: string): boolean {
  const body = JSON.parse(handleWorldMap(runtime).body) as { map?: { availableDetails?: readonly { id: string }[] } };
  return body.map?.availableDetails?.some((detail) => detail.id === detailId) ?? false;
}

export function handleWorldPresence(runtime: WorldRuntime, worldId: string): JsonResponse {
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  const checkpoint = runtime.store.getObserverCheckpoint(worldId, "player");
  const playerContext = resolvePlayerContext(world);
  const firstEntryContext = buildFirstEntryContext(runtime, world, events, playerContext);
  const { session, summary } = buildObserverSessionAndSummary({
    worldId, events, world, playerContext, checkpoint,
    ...(firstEntryContext ? { firstEntryContext } : {}),
  });
  return json({ ok: true, checkpoint, presence: session.presence, firstEntry: session.firstEntry, knowledge: session.knowledge, summary });
}


function buildFirstEntryContext(
  runtime: WorldRuntime,
  world: ReturnType<WorldRuntime["projection"]["getSnapshot"]>,
  events: readonly DomainEvent[],
  playerContext: { readonly locationTitle: string; readonly locationDescription: string },
) {
  const record = runtime.store.getWorldRecord(runtime.worldId);
  if (!record || record.templateId !== "living_region" || !record.entrypointId || !record.characterId || !record.characterName) return undefined;
  const profile = runtime.store.getCharacterProfile(record.characterId);
  const backgroundId = profile?.background_id;
  if (!backgroundId) return undefined;
  const background = getCharacterBackground(backgroundId);
  const entrypoint = getRegionEntrypoint(record.entrypointId);
  if (!background || !entrypoint || !entrypoint.availableBackgroundIds.includes(background.id)) return undefined;
  const narrativeContext = buildBackgroundNarrativeContext(events, world, profile);
  const knownContactVisible = [...world.relations.values()].some((relation) => {
    if (relation.from !== "player") return false;
    const entity = world.entities.get(relation.to);
    return entity?.name === entrypoint.localContact.name;
  });
  return {
    characterName: record.characterName,
    background,
    entrypoint,
    playerContext,
    initialTestimony: narrativeContext?.testimony ?? [],
    initialKnowledge: narrativeContext?.playerKnowledge ?? [],
    accessibleItems: narrativeContext?.accessibleItems ?? [],
    knownContactVisible,
  };
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

import { handleCommand as worldHandleCommand, commandEventId } from "@skald/world";
import type { ProcessOptions, CommitContext } from "@skald/rule-engine";
import { rollCriticalCheck } from "../dice-roller.js";

export interface IdempotencyReject {
  type: "IdempotencyReject";
  reason: string;
  idempotencyKey: string;
}

function resolveResourceExtractionIntent(runtime: WorldRuntime, intent: ExecutableIntent): ResourceExtractionCommand | null {
  if (intent.type !== "ActionIntentCommand" || intent.operation !== "take") return null;
  const target = intent.target?.raw?.trim().toLowerCase() ?? "";
  const resources = runtime.projection.getSnapshot().resources;
  const locationId = runtime.projection.getSnapshot().currentLocationId;
  if (!resources || !target) return null;
  for (const definition of resources.definitions.values()) {
    if (definition.locationId !== locationId) continue;
    const aliases: Record<string, readonly string[]> = { timber: ["\u0434\u0440\u0435\u0432\u0435\u0441", "\u0434\u0435\u0440\u0435\u0432", "wood", "timber"], herbs: ["\u0442\u0440\u0430\u0432", "herb"], ore: ["\u0440\u0443\u0434", "ore"] };
    const haystack = `${definition.id} ${definition.resourceKind}`.toLowerCase();
    const matchesAlias = (aliases[definition.resourceKind] ?? []).some((alias) => target.includes(alias));
    if (!haystack.includes(target) && !target.includes(definition.resourceKind.toLowerCase()) && !matchesAlias) continue;
    const method = definition.extractionMethods[0];
    if (!method) continue;
    return { type: "ResourceExtractionCommand", nodeId: definition.id, methodId: method.id, requestedUnits: 1, actorId: "player" };
  }
  return null;
}

const PREFLIGHT_TARGET_OPERATIONS = new Set([
  "observe",
  "inspect",
  "listen",
  "touch",
  "take",
  "open",
  "close",
  "apply_force",
  "give",
  "place",
  "use",
]);

function preflightIntentTarget(runtime: WorldRuntime, intent: ExecutableIntent): JsonResponse | null {
  if (intent.type === "JourneyIntent") return null;
  const verb = intent.type === "InteractionCommand" ? intent.verb : intent.operation;
  if (!PREFLIGHT_TARGET_OPERATIONS.has(verb)) return null;
  const target = intent.target?.raw?.trim() ?? "";
  // Optional ambient perception is resolved by the domain interaction rule.
  if (target.length === 0) return null;

  const resolution = resolveInteractionTarget(runtime.projection.getSnapshot(), verb, target);
  if (resolution.kind === "resolved" || resolution.kind === "environment") return null;
  if (resolution.kind === "ambiguous") {
    return json({
      ok: true,
      status: "clarification",
      question: "Уточни, какой объект ты имеешь в виду.",
      options: resolution.candidates.slice(0, 3).map((candidate, index) => ({
        optionId: "target-" + (index + 1),
        label: candidate.name,
      })),
    });
  }
  return json({
    ok: true,
    status: "clarification",
    question: "Я не нахожу «" + target + "» среди того, что тебе доступно сейчас. Что именно ты хочешь сделать?",
    options: [{ optionId: "rephrase", label: "Уточнить цель" }],
  });
}
export async function runCommandCycleForRuntime(
  runtime: WorldRuntime,
  input: string,
  idempotencyKey: string,
  resolvedIntent?: ExecutableIntent,
): Promise<{ events: DomainEvent[]; tickEvents: DomainEvent[]; position: unknown } | JsonResponse> {
  if (runtime.processedKeys.has(idempotencyKey)) {
    return error("duplicate_request", "duplicate idempotencyKey", 409);
  }

  const parsed = resolvedIntent ?? parseIntent(input);
  if (parsed.type !== "ActionIntentCommand" && parsed.type !== "InteractionCommand" && parsed.type !== "JourneyIntent") return error("parse_error", "Could not understand input", 400);
  const structural = validateActionProposal(parsed);
  if (!structural.ok) {
    return json({
      ok: true,
      status: "clarification",
      question: structural.clarification,
      options: [{ optionId: "rephrase", label: "Переформулировать действие" }],
    });
  }
  const resourceIntent = resolveResourceExtractionIntent(runtime, parsed);
  if (!resourceIntent) {
    const preflight = preflightIntentTarget(runtime, parsed);
    if (preflight) return preflight;
  }
  const commandIntent = resourceIntent ?? parsed;

  const worldTimeBefore = runtime.projection.getSnapshot().time;
  const ts = worldTimeBefore + 1;
  const correlationId = `cmd-${ts}`;
  const firstEvent = worldHandleCommand(commandIntent, correlationId, ts);
  const tickEvent: DomainEvent = {
    eventId: commandEventId(`tick-${ts}`, "TickPassed"),
    type: "TickPassed",
    schemaVersion: 1,
    payload: { delta: 1 },
    timestamp: ts,
    correlationId: `tick-${ts}`,
    causationId: null,
  };

  const options: ProcessOptions<ReturnType<WorldRuntime["projection"]["getSnapshot"]>> = {
    prepareCommitContext: (stagedEvents, projectedWorld) => ({
      idempotencyKey,
      requestKind: "command",
      correlationId,
      conversationTurn: buildActionConversationTurn({
        worldId: runtime.worldId,
        correlationId,
        idempotencyKey,
        playerText: input,
        worldTimeBefore,
        stagedEvents,
        projectedWorld,
      }),
    }),
  };

  const activeJourney = runtime.projection.getSnapshot().activeJourneyId;
  const interrupt = commandIntent.type === "ActionIntentCommand" && commandIntent.operation === "interrupt";
  const wait = commandIntent.type === "ActionIntentCommand" && commandIntent.operation === "wait";
  // A journey starts with one internally scheduled travel step. A stop is
  // immediate. While traveling, rejected commands do not consume a tick;
  // explicit wait remains the way to advance the journey.
  const suppressTick = parsed.type === "JourneyIntent" || interrupt || (!!activeJourney && !wait);
  const rootEvents = suppressTick ? [firstEvent] : [firstEvent, tickEvent];
  const { committed } = runtime.engine.processSequence(rootEvents, {
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
  conversation?: { playerText: string },
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

  const correlationId = `wait-${startTs + 1}`;
  const options2: ProcessOptions<ReturnType<WorldRuntime["projection"]["getSnapshot"]>> = conversation
    ? {
        prepareCommitContext: (stagedEvents, projectedWorld) => ({
          idempotencyKey,
          requestKind: "wait",
          correlationId,
          conversationTurn: buildActionConversationTurn({
            worldId: runtime.worldId,
            correlationId,
            idempotencyKey,
            playerText: conversation.playerText,
            worldTimeBefore: startTs,
            stagedEvents,
            projectedWorld,
          }),
        }),
      }
    : { commitContext: { idempotencyKey, requestKind: "wait", correlationId } as CommitContext };

  try {
    const { committed } = runtime.engine.processSequence(rootEvents, options2);
    runtime.processedKeys.add(idempotencyKey);
    return { tickEvents: committed };
  } catch (err) {
    throw err;
  }
}
