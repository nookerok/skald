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
import type { ObserverThreadDelta, ObserverThreadJournalDTO, NarrativeAdapterContext, ReadonlyWorld } from "@skald/world";
import type { DomainEvent } from "@skald/event-bus";
import { createHash } from "node:crypto";
import { classifyPlayerInput, conflictingActions, isContinuingJourneyTo, isJourneyContinuation, parseIntent, unknownObservedTarget, validateActionProposal } from "@skald/intent-parser";
import type { ExecutableIntent, TurnConversationRelation } from "@skald/intent-parser";
import type { ResourceExtractionCommand, SpatialWorldProjection } from "@skald/world";
import { buildMasterTurnSceneContext } from "@skald/world";
import type { MasterTurnSceneSnapshot } from "@skald/world";
import { buildGameDirectorContext, buildContinuationHint } from "@skald/world";
import type { GameDirectorContext } from "@skald/world";
import { getMapDetailAsset } from "./map-detail-catalog.js";
import {
  buildActionConversationTurn,
  buildMixedConversationTurn,
  buildReadSideConversationTurn,
  buildSpeechConversationTurn,
  buildTurnMemoryMetadata,
  conversationRequestHash,
  isWorldChangingTurn,
  toConversationTurnDTO,
} from "../conversation/builder.js";
import type { ConversationMemoryClarificationOption, ConversationMemoryMetadataV1, ConversationResponseKind, FramedClarification } from "../conversation/types.js";
import { buildMasterTurn, masterTurnKindOf } from "../conversation/master-turn.js";
import type { MasterTurnDTO } from "../conversation/master-turn.js";
import { buildMasterConversationContext, EMPTY_MASTER_CONVERSATION } from "../conversation/context-builder.js";
import { answerMetaRequest } from "../conversation/meta-answer.js";
import { interpretMasterTurn } from "../runtime/master-turn-gateway.js";
import type { PendingClarificationLink } from "../runtime/master-turn-gateway.js";
import { splitTargetCompound } from "../runtime/master-turn-validator.js";
import { bindSceneSurface } from "../runtime/master-turn-validator.js";
import type { ValidatedConversationReferent } from "../runtime/master-turn-validator.js";
import { emitMasterTurnDiagnostic } from "../runtime/master-turn-diagnostics.js";
import { executeMasterTurnPlan } from "../runtime/master-turn-executor.js";
import type { ValidatedMasterTurnPlan } from "../runtime/master-turn-validator.js";
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
  inputClass: "inquiry" | "meta" | "clarification",
  responseKind: "inquiry_answer" | "meta_answer" | "clarification",
  responseText: string,
  contextMetadata?: ConversationMemoryMetadataV1 | null,
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
    ...(contextMetadata ? { contextMetadata } : {}),
  })));
}

/**
 * Unified idempotent replay (plan_9 §5): one service for every world-scoped
 * mutating handler. A saved envelope short-circuits before the gateway,
 * rules, and narration scheduling; a reused key with a different request
 * hash is a conflict. Keys recorded before envelopes existed (no row) fall
 * through to the legacy per-path guards, whose answers are then recorded.
 */
function checkCommandReplay(runtime: WorldRuntime, idempotencyKey: string, requestHash: string): JsonResponse | null {
  const row = runtime.store.getCommandReplay(runtime.worldId, idempotencyKey);
  if (!row) return recoverLostEnvelope(runtime, idempotencyKey, requestHash);
  if (row.requestHash !== requestHash) return error("idempotency_conflict", "duplicate idempotencyKey", 409);
  const payload = JSON.parse(row.responseBody) as Record<string, unknown>;
  return json({ ...payload, replayed: true }, row.statusCode);
}

/**
 * Lost-envelope recovery (recoverable finalize contract — deliberately not
 * an atomic commit: the envelope write stays separate from the world
 * transaction, so a failed save is diagnosed, the request fails open for
 * retry, and the retry converges): the world commit and
 * the conversation turn are durable, but the envelope write failed. The
 * retry must still answer 200 + replayed instead of 409, so rebuild the
 * turn-anchored envelope from committed rows only — never new execution,
 * never narration scheduling — pin it first-write-wins, and serve it
 * marked as recovered. Later retries serve the pinned bytes identically.
 * Read-only turns (inquiry/clarification/meta) need no recovery: their
 * legacy turn guard already answers replayed without an envelope row.
 */
function recoverLostEnvelope(runtime: WorldRuntime, idempotencyKey: string, requestHash: string): JsonResponse | null {
  if (!runtime.store.hasProcessedKey(runtime.worldId, idempotencyKey)) return null;
  const turn = runtime.store.getConversationTurn(runtime.worldId, idempotencyKey);
  if (!turn || turn.requestHash !== requestHash) return null;
  const conversationTurn = toConversationTurnDTO(turn);
  const masterTurn = masterTurnFromTurn(runtime, idempotencyKey, conversationTurn, {
    kind: masterTurnKindOf(conversationTurn.responseKind),
    deterministicText: conversationTurn.responseText,
  }, false);
  const status = turn.inputClass === "inquiry" || turn.inputClass === "clarification" || turn.inputClass === "meta"
    ? { status: turn.inputClass }
    : {};
  const recovered = json({ ok: true, replayed: true, recovered: true, ...status, conversationTurn, masterTurn });
  try {
    runtime.store.saveCommandReplay(runtime.worldId, idempotencyKey, requestHash, 200, recovered.body);
  } catch {
    // Diagnosed but not thrown: the recovery answer itself is correct, and
    // the next identical retry pins again with byte-identical content.
    emitReplayFinalizeDiagnostic(runtime, idempotencyKey, 200);
  }
  return recovered;
}

/** Dedicated finalize failure: the world committed but the envelope write failed. Never pinned, always retryable. */
class ReplayEnvelopeError extends Error {
  constructor(worldId: string, statusCode: number) {
    super(`replay envelope finalize failed for world ${worldId} with status ${statusCode}`);
    this.name = "ReplayEnvelopeError";
  }
}

/** Structured finalize diagnostic: operational metadata only, never player text or secrets. */
function emitReplayFinalizeDiagnostic(runtime: WorldRuntime, idempotencyKey: string, statusCode: number): void {
  try {
    const keyPrefix = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 12);
    runtime.diagnostics({
      kind: "scheduler",
      category: "persistence_error",
      outcome: "persistence_error",
      provider: "scheduler",
      durationMs: 0,
      attempt: 0,
      timeout: 0,
      retryOutcome: "none",
      turn: runtime.projection.getSnapshot().time,
      worldTime: runtime.projection.getSnapshot().time,
      priority: "interactive",
      detail: `command_replay_save_failed key=${keyPrefix} status=${statusCode}`,
      worldId: runtime.worldId,
      recordedAt: new Date().toISOString(),
    });
  } catch {
    // Telemetry never breaks the finalize path.
  }
}

/**
 * Records the final response envelope for future identical retries.
 * Transient 5xx failures stay retryable and are never pinned. The write
 * is verified by read-back: a lost envelope would leave a processed key
 * with no replayable answer, so the failure is diagnosed structurally
 * and thrown (the request fails 500; the retry recovers via
 * recoverLostEnvelope) instead of being swallowed.
 */
function recordCommandReplay(runtime: WorldRuntime, idempotencyKey: string, requestHash: string, response: JsonResponse): void {
  if (response.statusCode >= 500) return;
  const fail = (): never => {
    emitReplayFinalizeDiagnostic(runtime, idempotencyKey, response.statusCode);
    throw new ReplayEnvelopeError(runtime.worldId, response.statusCode);
  };
  try {
    runtime.store.saveCommandReplay(runtime.worldId, idempotencyKey, requestHash, response.statusCode, response.body);
  } catch {
    fail();
  }
  let saved: { requestHash: string } | null = null;
  try {
    saved = runtime.store.getCommandReplay(runtime.worldId, idempotencyKey);
  } catch {
    fail();
  }
  if (!saved || saved.requestHash !== requestHash) fail();
}

function duplicateConversationResponse(runtime: WorldRuntime, input: string, idempotencyKey: string): JsonResponse | null {  const existing = runtime.store.getConversationTurn(runtime.worldId, idempotencyKey);
  if (!existing) return null;
  if (existing.requestHash !== conversationRequestHash(input)) return error("idempotency_conflict", "duplicate idempotencyKey", 409);
  const conversationTurn = toConversationTurnDTO(existing);
  const masterTurn = masterTurnFromTurn(runtime, idempotencyKey, conversationTurn, { kind: "contextual_clarification", deterministicText: conversationTurn.responseText }, false);
  if (isWorldChangingTurn(existing.inputClass)) {
    return json({ ok: false, error: { code: "idempotency_conflict", message: "duplicate idempotencyKey" }, conversationTurn, masterTurn }, 409);
  }
  return json({ ok: true, replayed: true, status: existing.inputClass, conversationTurn, masterTurn });
}

function readClarificationOptions(payload: Record<string, unknown>): ConversationMemoryClarificationOption[] {
  const fallback = [{ optionId: "rephrase", label: "Уточнить намерение" }];
  if (!Array.isArray(payload.options)) return fallback;
  const options: ConversationMemoryClarificationOption[] = [];
  for (const entry of payload.options.slice(0, 6)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.optionId !== "string" || record.optionId.length === 0) continue;
    if (typeof record.label !== "string" || record.label.length === 0) continue;
    const option: {
      optionId: string;
      label: string;
      referentRefs?: readonly string[];
      intentPatch?: { readonly actionText: string };
    } = { optionId: record.optionId.slice(0, 40), label: record.label.slice(0, 80) };
    // Server-side resolution state travels to metadata, never to the wire:
    // withClarificationConversation strips these before serving.
    if (Array.isArray(record.referentRefs) && record.referentRefs.length > 0) {
      const refs = record.referentRefs
        .filter((ref): ref is string => typeof ref === "string" && ref.length > 0)
        .slice(0, 4)
        .map((ref) => ref.slice(0, 40));
      if (refs.length > 0) option.referentRefs = refs;
    }
    const patch = record.intentPatch as Record<string, unknown> | undefined;
    if (patch && typeof patch === "object" && !Array.isArray(patch) && typeof patch.actionText === "string" && patch.actionText.length > 0) {
      option.intentPatch = { actionText: patch.actionText.slice(0, 120) };
    }
    options.push(option);
  }
  return options.length > 0 ? options : fallback;
}

function withClarificationConversation(
  runtime: WorldRuntime,
  input: string,
  idempotencyKey: string,
  response: JsonResponse,
  memory?: {
    readonly relation?: TurnConversationRelation | null | undefined;
    readonly pendingClarificationSeq?: number | null | undefined;
    readonly link?: PendingClarificationLink | null | undefined;
    readonly framed?: FramedClarification | null | undefined;
  },
): JsonResponse {
  const payload = JSON.parse(response.body) as Record<string, unknown>;
  const question = typeof payload.question === "string" ? payload.question : "Уточни намерение.";
  const options = readClarificationOptions(payload);
  const metadata = buildTurnMemoryMetadata({
    clarification: { question, options, ...(memory?.framed ? { framed: memory.framed } : {}) },
    relation: memory?.relation ?? null,
    pendingClarificationSeq: memory?.pendingClarificationSeq ?? null,
    ...(memory?.link ? {
      continuationLink: {
        relation: memory.link.relation,
        clarificationTurnSeq: memory.link.clarificationTurnSeq,
      },
    } : {}),
  });
  const conversationTurn = persistReadSideTurn(runtime, input, idempotencyKey, "clarification", "clarification", question, metadata);
  const events = runtime.bus.query();
  const world = runtime.projection.getSnapshot();
  const knowledge = buildPlayerKnowledgePresentation(events, world, buildBeliefModel(events, world), { startup: true, maxEntries: 3 });
  // Option refs, action patches and framed candidates stay server-side:
  // the wire carries labels only.
  const wireOptions = options.map((option) => ({ optionId: option.optionId, label: option.label }));
  return json({ ...payload, question, options: wireOptions, conversationTurn, knowledge, masterTurn: masterTurnFromTurn(runtime, idempotencyKey, conversationTurn, { kind: "contextual_clarification", deterministicText: question }, false) }, response.statusCode);
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

/**
 * Observer-safe game director from one explicit log state (plan_9 §§9-11).
 * Best-effort read-side composition: the bounded scene and the bounded
 * conversation memory become one director. Any failure yields undefined —
 * callers keep their exact legacy behavior instead of failing the turn.
 * Never throws.
 */
function buildGameDirectorFromState(
  runtime: Pick<WorldRuntime, "store" | "worldId">,
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  input: { narrativeContext?: NarrativeAdapterContext | null | undefined; lastOutcome?: string | null | undefined } = {},
): GameDirectorContext | undefined {
  try {
    const scene = buildMasterTurnSceneContext(events, world).context;
    const turns = runtime.store.listRecentConversationTurns(runtime.worldId, { limit: 30 });
    const narrations = runtime.store.getTurnNarrations(runtime.worldId);
    const record = runtime.store.getWorldRecord(runtime.worldId);
    const profile = record?.characterId ? runtime.store.getCharacterProfile(record.characterId) : null;
    let conversation;
    try {
      conversation = buildMasterConversationContext(turns, runtime.worldId, {
        narrations,
        scene,
        personalHook: profile?.promise ?? null,
      });
    } catch {
      conversation = EMPTY_MASTER_CONVERSATION;
    }
    return buildGameDirectorContext(events, world, {
      scene,
      ...(input.narrativeContext ? { narrativeContext: input.narrativeContext } : {}),
      conversation: {
        lastTurns: conversation.lastTurns.map((turn) => ({ speaker: turn.speaker, text: turn.text })),
        ...(conversation.activePlayerGoal ? { activePlayerGoal: { summary: conversation.activePlayerGoal.summary } } : { activePlayerGoal: null }),
        ...(conversation.currentDramaticThread
          ? { currentDramaticThread: { source: conversation.currentDramaticThread.source, title: conversation.currentDramaticThread.title } }
          : { currentDramaticThread: null }),
        knownFacts: conversation.knownFacts.map((entry) => entry.text),
        knownUncertainties: conversation.knownUncertainties.map((entry) => entry.text),
        ...(conversation.pendingClarification
          ? {
            pendingClarification: {
              question: conversation.pendingClarification.question,
              options: conversation.pendingClarification.options.map((option) => ({ ...option })),
            },
          }
          : { pendingClarification: null }),
      },
      lastOutcome: input.lastOutcome ?? null,
    });
  } catch {
    return undefined;
  }
}

/**
 * Observer-safe game director for one narration job (plan_9 §§9,11,12).
 * Never throws: narration keeps its exact legacy prompt when the
 * read-side composition fails.
 */
function buildGameDirectorForNarration(
  runtime: WorldRuntime,
  presentation: ReturnType<typeof selectTurnPresentation>,
  narrativeContext: NarrativeAdapterContext | undefined,
): GameDirectorContext | undefined {
  return buildGameDirectorFromState(runtime, runtime.bus.query(), runtime.projection.getSnapshot(), {
    ...(narrativeContext ? { narrativeContext } : {}),
    lastOutcome: presentation.primary?.text ?? presentation.response?.text ?? null,
  });
}

/**
 * Continuation hint for deterministic master answers (plan_9 §10 fourth
 * part). Composed from the post-turn state so the answer may leave the
 * game moving without any LLM. A turn whose staged events already started
 * a journey is returned without a hint — its outcome text names the new
 * leg, and a second "you can set out" line would only repeat it.
 * Best-effort: any failure yields null and the answer keeps its exact
 * legacy text. Never throws.
 */
function deterministicContinuationHint(
  runtime: WorldRuntime,
  preEvents: readonly DomainEvent[],
  stagedEvents: readonly DomainEvent[],
  projectedWorld: ReadonlyWorld,
): string | null {
  if (stagedEvents.some((event) => event.type === "JourneyStarted")) return null;
  try {
    const director = buildGameDirectorFromState(runtime, [...preEvents, ...stagedEvents], projectedWorld);
    if (!director) return null;
    return buildContinuationHint(director);
  } catch {
    return null;
  }
}

function isOpeningNarrationWindow(runtime: WorldRuntime, currentIdempotencyKey?: string): boolean {  try {
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
      const gameDirector = buildGameDirectorForNarration(runtime, pres, narrativeContext);
      const narration = await narrateTurnLLM(input, pres, router, {
        diagnostics: runtime.diagnostics,
        priority: "interactive",
        timeoutMs: router.timeoutSeconds * 1000,
        worldId,
        ...(correlationId ? { correlationId } : {}),
        ...(narrativeContext ? { narrativeContext } : {}),
        ...(gameDirector ? { gameDirector } : {}),
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
        const gameDirector = buildGameDirectorForNarration(runtime, presentation, narrativeContext);
        const narration = await narrateTurnLLM(input, presentation, router, {
          diagnostics: runtime.diagnostics,
          priority: "batch",
          timeoutMs: router.timeoutSeconds * 1000,
          worldId,
          ...(correlationId ? { correlationId } : {}),
          ...(narrativeContext ? { narrativeContext } : {}),
          ...(gameDirector ? { gameDirector } : {}),
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

/**
 * One input, one MasterTurn (plan_9 §6): builds the unified envelope from
 * the persisted conversation turn when one exists, else from explicit
 * caller values (turn-less advance/offline resolutions). Narration status
 * is exact at response time: pending only when this response scheduled a
 * narration job, not_requested otherwise (later states arrive via journal).
 */
function masterTurnFromTurn(
  runtime: WorldRuntime,
  idempotencyKey: string,
  turn: {
    readonly responseKind: ConversationResponseKind;
    readonly responseText: string;
    readonly worldTimeBefore: number;
    readonly worldTimeAfter: number;
  } | null,
  fallback: {
    readonly kind: MasterTurnDTO["kind"];
    readonly deterministicText: string;
    readonly worldTimeBefore?: number | undefined;
    readonly worldTimeAfter?: number | undefined;
  },
  narrationPending: boolean,
): MasterTurnDTO {
  if (turn) {
    return buildMasterTurn({
      worldId: runtime.worldId,
      idempotencyKey,
      kind: masterTurnKindOf(turn.responseKind),
      worldTimeBefore: turn.worldTimeBefore,
      worldTimeAfter: turn.worldTimeAfter,
      deterministicText: turn.responseText,
      narrationPending,
    });
  }
  const time = runtime.projection.getSnapshot().time;
  return buildMasterTurn({
    worldId: runtime.worldId,
    idempotencyKey,
    kind: fallback.kind,
    worldTimeBefore: fallback.worldTimeBefore ?? time,
    worldTimeAfter: fallback.worldTimeAfter ?? time,
    deterministicText: fallback.deterministicText,
    narrationPending,
  });
}

/**
 * Shared response for one online player tick: explicit `wait` and journey
 * continuation phrases (plan_9 §4) both advance time — and an active journey
 * with it — through exactly one TickPassed, then render the same read-side
 * envelope (state, presentation, guidance, shell delta, threads, transcript
 * turn) and schedule narration identically.
 */
async function respondToOnlineTick(
  runtime: WorldRuntime,
  input: string,
  idempotencyKey: string,
  setNarration: (turn: NarrationTurn | null) => void,
): Promise<JsonResponse> {
  const r = await runTicksForRuntime(runtime, 1, idempotencyKey, { playerOffline: false }, { playerText: input });
  if ("type" in r && (r as any).type === "IdempotencyReject")
    return error("idempotency_conflict", "duplicate idempotencyKey", 409);
  const tickResult = r as { tickEvents: DomainEvent[] };
  const pres = selectTurnPresentation(tickResult.tickEvents, runtime.projection.getSnapshot());
  const guidance = buildGuidance(runtime);
  const shellDelta = buildShellDelta(runtime.bus.query(), runtime.projection.getSnapshot(), buildGuidanceContext(runtime));
  const { journal: observerThreads, delta: observerThreadDelta } = buildObserverThreadsForRuntime(runtime);
  const correlationId = tickResult.tickEvents[0]?.correlationId;
  const narrativeContext = buildNarrationContext(runtime, pres, runtime.bus.query(), runtime.projection.getSnapshot(), isOpeningNarrationWindow(runtime, idempotencyKey), correlationId);
  setNarration({ input, pres, narrativeContext, ...(correlationId ? { correlationId } : {}) });
  const conversationTurn = runtime.store.getConversationTurn(runtime.worldId, idempotencyKey);
  const playerPresentation = toPlayerFacingPresentation(pres);
  const masterTurn = masterTurnFromTurn(runtime, idempotencyKey,
    conversationTurn ? toConversationTurnDTO(conversationTurn) : null,
    { kind: "action_outcome", deterministicText: playerPresentation.primary?.text ?? "" },
    runtime.router !== null);
  return json({ ok: true, state: toPlayerFacingState(serializeWorldStateFromRuntime(runtime)), presentation: playerPresentation, guidance, shellDelta: serializeShellDelta(shellDelta), observerThreads, observerThreadDelta, masterTurn, ...(conversationTurn ? { conversationTurn: toConversationTurnDTO(conversationTurn) } : {}) });
}

export async function handleWorldCommand(runtime: WorldRuntime, body: unknown): Promise<JsonResponse> {
  if (checkPoisoned(runtime)) return error("internal_error", "server is in fatal state", 503);
  if (!body || typeof body !== "object") return error("invalid_request", "body must be object");
  const { input, idempotencyKey } = body as Record<string, unknown>;
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128)
    return error("missing_idempotency_key", "idempotencyKey required (1-128 chars)", 400);
  if (typeof input !== "string" || input.length === 0)
    return error("invalid_request", "input required", 400);

  const requestHash = conversationRequestHash(input);
  const replayed = checkCommandReplay(runtime, idempotencyKey, requestHash);
  if (replayed) return replayed;

  const response = await handleWorldCommandInner(runtime, input, idempotencyKey);
  try {
    recordCommandReplay(runtime, idempotencyKey, requestHash, response);
  } catch (err) {
    if (err instanceof ReplayEnvelopeError) return error("internal_error", "replay finalize error", 500);
    throw err;
  }
  return response;
}

async function handleWorldCommandInner(runtime: WorldRuntime, input: string, idempotencyKey: string): Promise<JsonResponse> {
  const replay = duplicateConversationResponse(runtime, input, idempotencyKey);
  if (replay) return replay;

  let narrationTurn: NarrationTurn | null = null;
  let advanceNarrationTicks: DomainEvent[] | null = null;
  let resolvedIntent: ExecutableIntent | undefined;
  let masterPlan: ValidatedMasterTurnPlan | undefined;
  let masterScene: MasterTurnSceneSnapshot | undefined;
  let pendingClarificationSeq: number | null = null;
  let pendingLink: PendingClarificationLink | null = null;
  let journeyContinue = false;

  if (input !== "wait" && !input.startsWith("advance ")) {
    // Short consistent snapshot inside the queue; the LLM call below runs
    // outside the queue so the world never blocks on the network.
    const snapshot = await runtime.queue.enqueue(async () => {
      const events = runtime.bus.query();
      const world = runtime.projection.getSnapshot();
      const turns = runtime.store.listRecentConversationTurns(runtime.worldId, { limit: 30 });
      const scene = buildMasterTurnSceneContext(events, world);
      const narrations = runtime.store.getTurnNarrations(runtime.worldId);
      const record = runtime.store.getWorldRecord(runtime.worldId);
      const profile = record?.characterId ? runtime.store.getCharacterProfile(record.characterId) : null;
      let conversation;
      try {
        conversation = buildMasterConversationContext(turns, runtime.worldId, {
          narrations,
          scene: scene.context,
          personalHook: profile?.promise ?? null,
        });
      } catch {
        // The world never changes on a context failure: diagnose and fall
        // back to an empty conversation. Simple commands still take the
        // deterministic path; contextual input becomes a natural
        // clarification downstream. Never a stack trace to the player.
        emitMasterTurnDiagnostic(runtime.diagnostics, {
          category: "conversation_context",
          outcome: "failed",
          phase: "snapshot",
          correlationId: `intent-${idempotencyKey}`,
          worldTime: world.time,
        });
        conversation = EMPTY_MASTER_CONVERSATION;
      }
      return { events, world, scene, conversation };
    });
    // Single production interpretation entry: deterministic fast path or
    // closed TurnProposalV2. The legacy V1 LLM path is not used here.
    //
    // Journey continuation (plan_9 §4) bypasses interpretation entirely:
    // while a journey is active, "продолжаю путь" and kin advance it by
    // exactly one online tick — deterministically, with no LLM call and no
    // new journey. Naming the already-active destination again (any
    // declension, manner tail tolerated) is the same progress signal.
    // Without an active journey the replica flows on normally.
    const activeJourney = snapshot.world.activeJourneyId
      ? snapshot.world.journeys.get(snapshot.world.activeJourneyId)
      : undefined;
    const activeDestination = activeJourney
      ? snapshot.world.locations.get(activeJourney.toLocationId)?.name ?? null
      : null;
    if (snapshot.world.activeJourneyId
      && (isJourneyContinuation(input) || isContinuingJourneyTo(input, activeDestination))) {
      journeyContinue = true;
    } else {
      const interpretation = await interpretMasterTurn(input, snapshot, runtime.router, {
        diagnostics: runtime.diagnostics,
        correlationId: `intent-${idempotencyKey}`,
        worldTime: snapshot.world.time,
      });
    if (interpretation.status === "inquiry") {
      const inquiryRequest = interpretation.inquiry;
      return runtime.queue.enqueue(async () => {
        const events = runtime.bus.query();
        const world = runtime.projection.getSnapshot();
        const record = runtime.store.getWorldRecord(runtime.worldId);
        const profile = record?.characterId ? runtime.store.getCharacterProfile(record.characterId) : null;
        const shell = buildGameShellSnapshot(events, world, profile, runtime.worldId, buildGuidanceContext(runtime));
        const background = buildBackgroundNarrativeContext(events, world, profile);
        const scene = buildMasterTurnSceneContext(events, world).context;
        const inquiry = buildInquiryAnswer(inquiryRequest, { shell, background, scene });
        const conversationTurn = persistReadSideTurn(runtime, input, idempotencyKey, "inquiry", "inquiry_answer", inquiry.answer,
          interpretation.pendingLink ? buildTurnMemoryMetadata({ continuationLink: interpretation.pendingLink }) : undefined);
        const knowledge = buildPlayerKnowledgePresentation(events, world, buildBeliefModel(events, world), { startup: true, maxEntries: 3 });
        return json({ ok: true, status: "inquiry", inquiry, conversationTurn, knowledge, masterTurn: masterTurnFromTurn(runtime, idempotencyKey, conversationTurn, { kind: "inquiry_answer", deterministicText: inquiry.answer }, false) });
      });
    }
    pendingClarificationSeq = snapshot.conversation.pendingClarification?.turnSeq ?? null;
    if (interpretation.status === "clarification") {
      const relation = interpretation.relation ?? null;
      return runtime.queue.enqueue(async () => withClarificationConversation(
        runtime,
        input,
        idempotencyKey,
        json({ ok: true, status: "clarification", question: interpretation.question, options: interpretation.options }),
        {
          relation,
          pendingClarificationSeq,
          ...(interpretation.pendingLink ? { link: interpretation.pendingLink } : {}),
          ...(interpretation.framed ? { framed: interpretation.framed } : {}),
        },
      ));
    }
    if (interpretation.status === "unsupported" || interpretation.status === "unavailable") {
      return runtime.queue.enqueue(async () => withClarificationConversation(runtime, input, idempotencyKey, json({ ok: true, status: "clarification", question: interpretation.message, options: [{ optionId: "rephrase", label: "Уточнить намерение" }] })));
    }
    if (interpretation.status === "deterministic") {
      resolvedIntent = interpretation.intent;
      pendingLink = interpretation.pendingLink ?? null;
    } else {
      masterPlan = interpretation.plan;
      masterScene = interpretation.scene;
      pendingLink = interpretation.pendingLink ?? null;
    }
    }
  }

  const response = await runtime.queue.enqueue(async () => {
    try {
      if (journeyContinue) {
        return respondToOnlineTick(runtime, input, idempotencyKey, (turn) => {
          narrationTurn = turn;
        });
      }
      if (input === "wait") {
        return respondToOnlineTick(runtime, input, idempotencyKey, (turn) => {
          narrationTurn = turn;
        });
      }
      if (input.startsWith("advance ")) {
        const raw = input.slice(8).trim();
        const n = Number(raw);
        if (!Number.isSafeInteger(n) || n < 1 || n > 100) return error("invalid_request", "advance N (1-100, integer)");
        const timeBeforeAdvance = runtime.projection.getSnapshot().time;
        const r = await runTicksForRuntime(runtime, n, idempotencyKey, { playerOffline: true });
        if ("type" in r && (r as any).type === "IdempotencyReject")
          return error("idempotency_conflict", "duplicate idempotencyKey", 409);
        const tickResult = r as { tickEvents: DomainEvent[] };
        const pres = selectTurnPresentation(tickResult.tickEvents, runtime.projection.getSnapshot());
        const guidance = buildGuidance(runtime);
        const shellDelta = buildShellDelta(runtime.bus.query(), runtime.projection.getSnapshot(), buildGuidanceContext(runtime));
        const { journal: observerThreads, delta: observerThreadDelta } = buildObserverThreadsForRuntime(runtime);
        advanceNarrationTicks = tickResult.tickEvents;
        const advancePresentation = toPlayerFacingPresentation(pres);
        return json({ ok: true, state: toPlayerFacingState(serializeWorldStateFromRuntime(runtime)), presentation: advancePresentation, guidance, shellDelta: serializeShellDelta(shellDelta), observerThreads, observerThreadDelta, masterTurn: masterTurnFromTurn(runtime, idempotencyKey, null, { kind: "action_outcome", deterministicText: advancePresentation.primary?.text ?? "", worldTimeBefore: timeBeforeAdvance, worldTimeAfter: runtime.projection.getSnapshot().time }, advanceNarrationTicks.length > 0 && runtime.router !== null) });
      }

      if (masterPlan && masterScene) {
        return await runValidatedMasterTurnResponse(runtime, input, idempotencyKey, masterPlan, masterScene, (turn) => {
          narrationTurn = turn;
        }, { pendingClarificationSeq, ...(pendingLink ? { pendingLink } : {}) });
      }

      const r = await runCommandCycleForRuntime(runtime, input, idempotencyKey, resolvedIntent,
        pendingLink ? { continuationLink: pendingLink } : undefined);
      if (!r || typeof r !== "object") return error("internal_error", "unexpected result", 500);
      if ("response" in r) {
        const { response, framed } = r;
        return response.statusCode === 200 && JSON.parse(response.body).status === "clarification"
          ? withClarificationConversation(runtime, input, idempotencyKey, response, framed ? { framed } : undefined)
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
      const storedTurn = runtime.store.getConversationTurn(runtime.worldId, idempotencyKey);
      const cycleTurn = storedTurn ? toConversationTurnDTO(storedTurn) : null;
      const correlationId = cmdResult.events[0]?.correlationId ?? cmdResult.tickEvents[0]?.correlationId;
      const narrativeContext = buildNarrationContext(runtime, pres, runtime.bus.query(), runtime.projection.getSnapshot(), isOpeningNarrationWindow(runtime, idempotencyKey), correlationId);
      narrationTurn = { input, pres, narrativeContext, ...(correlationId ? { correlationId } : {}) };
      const cyclePresentation = toPlayerFacingPresentation(pres);
      return json({
        ok: true,
        state: toPlayerFacingState(serializeWorldStateFromRuntime(runtime)),
        // Raw Domain Events are not exposed to normal UI; use /api/events for diagnostics.
        presentation: cyclePresentation,
        guidance,
        shellDelta: serializeShellDelta(shellDelta),
        observerThreads,
        observerThreadDelta,
        masterTurn: masterTurnFromTurn(runtime, idempotencyKey, cycleTurn,
          { kind: "action_outcome", deterministicText: cyclePresentation.primary?.text ?? "" },
          runtime.router !== null),
        ...(cycleTurn ? { conversationTurn: cycleTurn } : {}),
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

  // Offline keeps its bespoke durable contract (turn + processed-keys rows):
  // identical retries report already_processed so the browser reconciles
  // against authoritative read models instead of re-sending. The generic
  // command envelope is deliberately not applied here: replaying the
  // original "accepted" DTO would break that reconciliation vocabulary.
  // Durability across restarts comes from loadProcessedKeys + turns.
  const existingConversation = runtime.store.getConversationTurn(runtime.worldId, idempotencyKey);
  if (existingConversation) {
    if (existingConversation.requestHash !== conversationRequestHash(input)) return error("idempotency_conflict", "duplicate idempotencyKey", 409);
    const existingTurn = toConversationTurnDTO(existingConversation);
    return json({
      ok: true,
      resolution: isWorldChangingTurn(existingConversation.inputClass) ? "already_processed" : existingConversation.inputClass,
      message: isWorldChangingTurn(existingConversation.inputClass) ? "Это намерение уже было обработано." : null,
      reason: null,
      conversationTurn: existingTurn,
      masterTurn: masterTurnFromTurn(runtime, idempotencyKey, existingTurn, { kind: "contextual_clarification", deterministicText: existingTurn.responseText }, false),
    });
  }

  let narrationTurn: NarrationTurn | null = null;

  const response = await runtime.queue.enqueue(async () => {
    try {
      // Idempotency replay wins: a processed key is already_processed and the
      // browser reconciles authoritative read models instead of re-sending.
      if (runtime.processedKeys.has(idempotencyKey)) {
        return json({ ok: true, resolution: "already_processed", message: "Это намерение уже было обработано.", reason: null, masterTurn: masterTurnFromTurn(runtime, idempotencyKey, null, { kind: "contextual_clarification", deterministicText: "Это намерение уже было обработано." }, false) });
      }

      const classification = classifyPlayerInput(input, parseIntent);
      if (classification.kind === "inquiry") {
        const events = runtime.bus.query();
        const world = runtime.projection.getSnapshot();
        const record = runtime.store.getWorldRecord(runtime.worldId);
        const profile = record?.characterId ? runtime.store.getCharacterProfile(record.characterId) : null;
        const shell = buildGameShellSnapshot(events, world, profile, runtime.worldId, buildGuidanceContext(runtime));
        const background = buildBackgroundNarrativeContext(events, world, profile);
        const scene = buildMasterTurnSceneContext(events, world).context;
        const inquiry = buildInquiryAnswer(classification.inquiry, { shell, background, scene });
        const conversationTurn = persistReadSideTurn(runtime, input, idempotencyKey, "inquiry", "inquiry_answer", inquiry.answer);
        return json({ ok: true, resolution: "inquiry", message: null, reason: null, inquiry, conversationTurn, masterTurn: masterTurnFromTurn(runtime, idempotencyKey, conversationTurn, { kind: "inquiry_answer", deterministicText: inquiry.answer }, false) });
      }
      const parsed = classification.kind === "inquiry_candidate" ? parseIntent(input) : classification.intent;
      if (parsed.type !== "InteractionCommand") {
        const message = "Сейчас без связи можно отправить только «осмотреть <объект>».";
        const conversationTurn = persistReadSideTurn(runtime, input, idempotencyKey, "clarification", "clarification", message);
        return json({ ok: true, resolution: "rejected", message, reason: "unsupported_offline_intent", conversationTurn, masterTurn: masterTurnFromTurn(runtime, idempotencyKey, conversationTurn, { kind: "contextual_clarification", deterministicText: message }, false) });
      }

      const dto = resolveOfflineIntent(
        { input, idempotencyKey, baseRevision },
        { events: runtime.bus.query(), world: runtime.projection.getSnapshot(), parsed },
      );
      if (dto.resolution !== "accepted") {
        return json({ ok: true, resolution: dto.resolution, message: dto.message, reason: dto.reason, masterTurn: masterTurnFromTurn(runtime, idempotencyKey, null, { kind: "contextual_clarification", deterministicText: dto.message ?? dto.reason ?? "" }, false) });
      }

      // Accepted: execute the normal command cycle with the same envelope.
      // Classification and execution share one snapshot inside the queue, so
      // the accepted target still resolves and the time gate passes
      // (ts = time + 1 > lastActionTick by construction).
      const r = await runCommandCycleForRuntime(runtime, input, idempotencyKey);
      if (!r || typeof r !== "object") return error("internal_error", "unexpected result", 500);
      if ("response" in r) {
        const { response, framed } = r;
        return response.statusCode === 200 && JSON.parse(response.body).status === "clarification"
          ? withClarificationConversation(runtime, input, idempotencyKey, response, framed ? { framed } : undefined)
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
      const offlineTurn = runtime.store.getConversationTurn(runtime.worldId, idempotencyKey);
      const offlinePresentation = toPlayerFacingPresentation(pres);
      // A narration job is scheduled below exactly when a router exists.
      const offlineNarrationPending = runtime.router !== null;
      return json({
        ok: true,
        resolution: "accepted",
        message: null,
        reason: null,
        state: toPlayerFacingState(serializeWorldStateFromRuntime(runtime)),
        // Raw Domain Events are not exposed to normal UI; use /api/events for diagnostics.
        presentation: offlinePresentation,
        guidance,
        shellDelta: serializeShellDelta(shellDelta),
        observerThreads,
        observerThreadDelta,
        masterTurn: masterTurnFromTurn(runtime, idempotencyKey,
          offlineTurn ? toConversationTurnDTO(offlineTurn) : null,
          { kind: "action_outcome", deterministicText: offlinePresentation.primary?.text ?? "" },
          offlineNarrationPending),
        ...(offlineTurn
          ? { conversationTurn: toConversationTurnDTO(offlineTurn) }
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

  const requestHash = conversationRequestHash(`wait:${n}`);
  const replayed = checkCommandReplay(runtime, idempotencyKey, requestHash);
  if (replayed) return replayed;

  const response = await handleWorldWaitInner(runtime, n, idempotencyKey);
  try {
    recordCommandReplay(runtime, idempotencyKey, requestHash, response);
  } catch (err) {
    if (err instanceof ReplayEnvelopeError) return error("internal_error", "replay finalize error", 500);
    throw err;
  }
  return response;
}

async function handleWorldWaitInner(runtime: WorldRuntime, n: number, idempotencyKey: string): Promise<JsonResponse> {
  return runtime.queue.enqueue(async () => {
    try {
      const timeBeforeWait = runtime.projection.getSnapshot().time;
      const result = await runTicksForRuntime(runtime, n, idempotencyKey, { playerOffline: false });
      if ("type" in result && (result as IdempotencyReject).type === "IdempotencyReject")
        return error("idempotency_conflict", "duplicate idempotencyKey", 409);
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
      const waitPresentation = toPlayerFacingPresentation(pres);
      return json({ ok: true, state: toPlayerFacingState(serializeWorldStateFromRuntime(runtime)), presentation: waitPresentation, guidance, shellDelta: serializeShellDelta(shellDelta), observerThreads, observerThreadDelta, masterTurn: masterTurnFromTurn(runtime, idempotencyKey, null, { kind: "action_outcome", deterministicText: waitPresentation.primary?.text ?? "", worldTimeBefore: timeBeforeWait, worldTimeAfter: runtime.projection.getSnapshot().time }, runtime.router !== null) });
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

/**
 * Early command-cycle outcome: a clarification response plus the closed
 * structured candidate behind it (review P1), if any. The caller persists
 * both through the normal clarification conversation path — the wire
 * carries labels only.
 */
export interface CommandCycleClarification {
  readonly response: JsonResponse;
  readonly framed?: FramedClarification | undefined;
}

function preflightIntentTarget(runtime: WorldRuntime, intent: ExecutableIntent): CommandCycleClarification | null {
  if (intent.type === "JourneyIntent") return null;
  const verb = intent.type === "InteractionCommand" ? intent.verb : intent.operation;
  if (!PREFLIGHT_TARGET_OPERATIONS.has(verb)) return null;
  const target = intent.target?.raw?.trim() ?? "";
  // Optional ambient perception is resolved by the domain interaction rule.
  if (target.length === 0) return null;

  // A compound that survived parsing (verb forms the parser list misses)
  // never becomes one blob target: name both parts explicitly so nothing
  // understood is lost silently (review P1, QA turn-6 class).
  const split = splitTargetCompound(target);
  if (split) {
    const classified = conflictingActions([split.head, split.tail]);
    return {
      response: json({
        ok: true,
        status: "clarification",
        question: classified.question,
        options: classified.options,
      }),
    };
  }

  const snapshot = runtime.projection.getSnapshot();
  const resolution = resolveInteractionTarget(snapshot, verb, target);
  if (resolution.kind === "resolved" || resolution.kind === "environment") return null;
  if (resolution.kind === "ambiguous") {
    // Structured candidate: the parsed intent plus its fillable target
    // slot. An exact answer patches and revalidates with no second
    // model call instead of re-asking (review P1).
    return {
      response: json({
        ok: true,
        status: "clarification",
        question: "Уточни, какой объект ты имеешь в виду.",
        options: resolution.candidates.slice(0, 3).map((candidate, index) => ({
          optionId: "target-" + (index + 1),
          label: candidate.name,
        })),
      }),
      framed: {
        slot: "target",
        intent,
        revision: { worldTime: snapshot.time, eventNumber: snapshot.eventNumber },
      },
    };
  }
  return {
    response: json({
      ok: true,
      status: "clarification",
      question: unknownObservedTarget(target).question,
      options: [{ optionId: "rephrase", label: "Уточнить цель" }],
    }),
  };
}
/**
 * Stage 4 item 1: a confirmed mention for an accepted deterministic action.
 * The target surface is bound to the scene table, so the next replica can bind
 * a pronoun ("осмотрю её") to the same referent. No scene match means no
 * mention — never an invented one. Pure read-side.
 */
function deterministicActionFocus(
  intent: { readonly type: string; readonly target?: { readonly raw?: string } | undefined; readonly destination?: { readonly raw?: string } | undefined },
  events: readonly DomainEvent[],
  world: ReturnType<WorldRuntime["projection"]["getSnapshot"]>,
): readonly ValidatedConversationReferent[] {
  const raw = intent.type === "JourneyIntent"
    ? intent.destination?.raw?.trim()
    : intent.target?.raw?.trim();
  if (!raw) return [];
  const scene = buildMasterTurnSceneContext(events, world).context;
  const entries = [
    ...scene.visibleObjects.map((entry) => ({ observerRef: entry.observerRef, label: entry.label, knownAs: entry.knownAs })),
    ...scene.knownPeople.map((entry) => ({ observerRef: entry.observerRef, label: entry.label, knownAs: entry.knownAs })),
    ...scene.accessibleItems.map((entry) => ({ observerRef: entry.observerRef, label: entry.label, knownAs: entry.knownAs })),
    ...scene.knownRoutes.map((entry) => ({ observerRef: entry.observerRef, label: entry.label, knownAs: entry.knownAs })),
  ];
  const bound = bindSceneSurface(raw, entries);
  if (bound.status !== "unique") return [];
  return [Object.freeze({
    observerRef: bound.entry.observerRef,
    surface: bound.entry.label,
    kind: intent.type === "JourneyIntent" ? "destination" as const : "target" as const,
  })];
}

export async function runCommandCycleForRuntime(
  runtime: WorldRuntime,
  input: string,
  idempotencyKey: string,
  resolvedIntent?: ExecutableIntent,
  memory?: {
    readonly continuationLink?: PendingClarificationLink | null | undefined;
  },
): Promise<{ events: DomainEvent[]; tickEvents: DomainEvent[]; position: unknown } | CommandCycleClarification> {
  if (runtime.processedKeys.has(idempotencyKey)) {
    return { response: error("idempotency_conflict", "duplicate idempotencyKey", 409) };
  }

  const parsed = resolvedIntent ?? parseIntent(input);
  if (parsed.type !== "ActionIntentCommand" && parsed.type !== "InteractionCommand" && parsed.type !== "JourneyIntent") {
    return { response: error("parse_error", "Could not understand input", 400) };
  }
  const structural = validateActionProposal(parsed);
  if (!structural.ok) {
    return {
      response: json({
        ok: true,
        status: "clarification",
        question: structural.clarification,
        options: [{ optionId: "rephrase", label: "Переформулировать действие" }],
      }),
    };
  }
  const resourceIntent = resolveResourceExtractionIntent(runtime, parsed);
  if (!resourceIntent) {
    const preflight = preflightIntentTarget(runtime, parsed);
    if (preflight) return preflight;
  }
  const commandIntent = resourceIntent ?? parsed;

  const worldTimeBefore = runtime.projection.getSnapshot().time;
  const preEvents = runtime.bus.query();
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
    prepareCommitContext: (stagedEvents, projectedWorld) => {
      // Stage 4 item 1: persist a confirmed mention for an accepted
      // deterministic action (bound against the POST-command scene, so a
      // freshly observed target is mentionable) so the next replica can bind a
      // pronoun to the same referent.
      const actionFocus = deterministicActionFocus(commandIntent, [...preEvents, ...stagedEvents], projectedWorld);
      return {
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
          continuationHint: deterministicContinuationHint(runtime, preEvents, stagedEvents, projectedWorld),
          ...(memory?.continuationLink || actionFocus.length > 0 ? {
            contextMetadata: buildTurnMemoryMetadata({
              focus: actionFocus,
              ...(memory?.continuationLink ? { continuationLink: memory.continuationLink } : {}),
            }),
          } : {}),
        }),
      };
    },
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

/**
 * Executes a validated Master Turn plan inside the world queue.
 * LLM already ran outside; here only capture/revalidate/commit.
 * World-changing turns commit Events + ConversationTurn atomically via the
 * executor commit hook; read-only turns persist a single transcript row.
 */
async function runValidatedMasterTurnResponse(
  runtime: WorldRuntime,
  input: string,
  idempotencyKey: string,
  plan: ValidatedMasterTurnPlan,
  scene: MasterTurnSceneSnapshot,
  setNarration: (turn: NarrationTurn | null) => void,
  memory?: {
    readonly pendingClarificationSeq?: number | null | undefined;
    readonly pendingLink?: PendingClarificationLink | null | undefined;
  },
): Promise<JsonResponse> {
  if (runtime.processedKeys.has(idempotencyKey)) {
    return error("idempotency_conflict", "duplicate idempotencyKey", 409);
  }
  // A gateway-resolved frame overrides the proposal relation: the turn
  // answers the pending question no matter what the model reported.
  const planMemory = buildTurnMemoryMetadata({
    focus: plan.focus,
    goal: plan.goal ?? null,
    relation: plan.conversationRelation ?? null,
    pendingClarificationSeq: memory?.pendingClarificationSeq ?? null,
    ...(memory?.pendingLink ? { continuationLink: memory.pendingLink } : {}),
  });

  if (!plan.execution) {
    if (plan.kind === "meta" && plan.metaInquiry) {
      const turns = runtime.store.listRecentConversationTurns(runtime.worldId, { limit: 10 });
      const conversation = buildMasterConversationContext(turns, runtime.worldId);
      const answer = answerMetaRequest(plan.metaInquiry.operation, { recentTurns: conversation.recentTurns });
      const conversationTurn = persistReadSideTurn(runtime, input, idempotencyKey, "meta", "meta_answer", answer.text, planMemory);
      const events = runtime.bus.query();
      const world = runtime.projection.getSnapshot();
      const knowledge = buildPlayerKnowledgePresentation(events, world, buildBeliefModel(events, world), { startup: true, maxEntries: 3 });
      return json({ ok: true, status: "meta", meta: { operation: plan.metaInquiry.operation, answer: answer.text }, conversationTurn, knowledge, masterTurn: masterTurnFromTurn(runtime, idempotencyKey, conversationTurn, { kind: "meta_answer", deterministicText: answer.text }, false) });
    }
    const inquiryRequests = plan.postActionInquiries;
    if (inquiryRequests.length === 0) {
      return withClarificationConversation(runtime, input, idempotencyKey, json({ ok: true, status: "clarification", question: "Уточни, что именно ты хочешь узнать.", options: [{ optionId: "rephrase", label: "Уточнить вопрос" }] }));
    }
    const events = runtime.bus.query();
    const world = runtime.projection.getSnapshot();
    const record = runtime.store.getWorldRecord(runtime.worldId);
    const profile = record?.characterId ? runtime.store.getCharacterProfile(record.characterId) : null;
    const shell = buildGameShellSnapshot(events, world, profile, runtime.worldId, buildGuidanceContext(runtime));
    const background = buildBackgroundNarrativeContext(events, world, profile);
    const scene = buildMasterTurnSceneContext(events, world).context;
    const inquiries = inquiryRequests.map((inquiryRequest) => buildInquiryAnswer(inquiryRequest, { shell, background, scene }));
    const conversationTurn = persistReadSideTurn(runtime, input, idempotencyKey, "inquiry", "inquiry_answer", inquiries.map((entry) => entry.answer).join(" "), planMemory);
    const knowledge = buildPlayerKnowledgePresentation(events, world, buildBeliefModel(events, world), { startup: true, maxEntries: 3 });
    return json({ ok: true, status: "inquiry", inquiries, inquiry: inquiries[0], conversationTurn, knowledge, masterTurn: masterTurnFromTurn(runtime, idempotencyKey, conversationTurn, { kind: "inquiry_answer", deterministicText: conversationTurn.responseText }, false) });
  }

  const worldTimeBefore = runtime.projection.getSnapshot().time;
  const record = runtime.store.getWorldRecord(runtime.worldId);
  const profile = record?.characterId ? runtime.store.getCharacterProfile(record.characterId) : null;
  const characterProfile = profile
    ? { display_name: profile.display_name, wound: profile.wound, promise: profile.promise, principle: profile.principle, background_id: profile.background_id }
    : null;
  const profileRef = profile ? { background_id: profile.background_id } : null;
  const postInquiries = plan.postActionInquiries;
  const deferred = plan.deferredClauses;
  const kind = plan.kind;

  let result: ReturnType<typeof executeMasterTurnPlan>;
  try {
    result = executeMasterTurnPlan(plan, scene, {
      engine: runtime.engine,
      projection: runtime.projection,
      events: runtime.bus.query(),
      worldId: runtime.worldId,
      diagnostics: runtime.diagnostics,
      commit: {
        idempotencyKey,
        buildDraft: (staged, projectedWorld, preEvents) => {
          const draftCorrelation = staged.find((event) => event.correlationId.startsWith("cmd-"))?.correlationId
            ?? staged[staged.length - 1]?.correlationId
            ?? `cmd-${projectedWorld.time}`;
          const continuationHint = deterministicContinuationHint(runtime, preEvents, staged, projectedWorld);
          if (kind === "mixed") {
            return buildMixedConversationTurn({
              worldId: runtime.worldId,
              correlationId: draftCorrelation,
              idempotencyKey,
              playerText: input,
              worldTimeBefore,
              preEvents,
              stagedEvents: staged,
              projectedWorld,
              profile: profileRef,
              characterProfile,
              inquiries: postInquiries,
              deferred,
              continuationHint,
              contextMetadata: planMemory,
            });
          }
          if (kind === "speech") {
            return buildSpeechConversationTurn({
              worldId: runtime.worldId,
              correlationId: draftCorrelation,
              idempotencyKey,
              playerText: input,
              worldTimeBefore,
              stagedEvents: staged,
              projectedWorld,
              continuationHint,
              contextMetadata: planMemory,
            });
          }
          return buildActionConversationTurn({
            worldId: runtime.worldId,
            correlationId: draftCorrelation,
            idempotencyKey,
            playerText: input,
            worldTimeBefore,
            stagedEvents: staged,
            projectedWorld,
            continuationHint,
            contextMetadata: planMemory,
          });
        },
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "DuplicateRequestError") {
      return error("idempotency_conflict", "duplicate idempotencyKey", 409);
    }
    throw err;
  }

  if (result.status === "stale") {
    return withClarificationConversation(runtime, input, idempotencyKey, json({ ok: true, status: "clarification", question: result.question, options: result.options }));
  }

  runtime.processedKeys.add(idempotencyKey);
  const allEvents = [...result.commandEvents, ...result.tickEvents];
  const worldAfter = runtime.projection.getSnapshot();
  const pres = selectTurnPresentation(allEvents, worldAfter);
  const guidance = buildGuidance(runtime);
  const shellDelta = buildShellDelta(runtime.bus.query(), worldAfter, buildGuidanceContext(runtime));
  const { journal: observerThreads, delta: observerThreadDelta } = buildObserverThreadsForRuntime(runtime);
  const conversationTurn = runtime.store.getConversationTurn(runtime.worldId, idempotencyKey);
  const correlationId = result.commandEvents[0]?.correlationId ?? result.tickEvents[0]?.correlationId;
  const narrativeContext = buildNarrationContext(runtime, pres, runtime.bus.query(), worldAfter, isOpeningNarrationWindow(runtime, idempotencyKey), correlationId);
  setNarration({ input, pres, narrativeContext, ...(correlationId ? { correlationId } : {}) });

  const playerPresentation = toPlayerFacingPresentation(pres);
  const base = {
    ok: true as const,
    state: toPlayerFacingState(serializeWorldStateFromRuntime(runtime)),
    presentation: playerPresentation,
    guidance,
    shellDelta: serializeShellDelta(shellDelta),
    observerThreads,
    observerThreadDelta,
  };
  const baseWithTurn = {
    ...base,
    masterTurn: masterTurnFromTurn(runtime, idempotencyKey,
      conversationTurn ? toConversationTurnDTO(conversationTurn) : null,
      {
        kind: kind === "mixed" ? "mixed_outcome" : kind === "speech" ? "speech_reaction" : "action_outcome",
        deterministicText: playerPresentation.primary?.text ?? "",
      },
      runtime.router !== null),
    ...(conversationTurn ? { conversationTurn: toConversationTurnDTO(conversationTurn) } : {}),
  };
  if (kind === "mixed") {
    return json({
      ...baseWithTurn,
      ...(result.inquiryAnswers.length > 0
        ? {
          inquiryAnswers: result.inquiryAnswers.map((entry) => ({ queryId: entry.queryId, answer: entry.answer })),
          inquiryAnswer: { queryId: result.inquiryAnswers[0]!.queryId, answer: result.inquiryAnswers[0]!.answer },
        }
        : {}),
      ...(result.deferred.length > 0 ? { deferred: result.deferred } : {}),
    });
  }
  return json(baseWithTurn);
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
