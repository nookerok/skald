/**
 * Presence reconstruction — UX-6 pure read-side builders.
 *
 * All outputs are deeply frozen, deterministic and derived only from
 * observer-scoped sources: the BeliefModel, the player-facing journal and the
 * explicitly allowed player context. Hidden world state and internal
 * identifiers never enter the player-facing DTOs; the diagnostics DTO is the
 * only surface that carries internal IDs.
 */

import type { DomainEvent } from "@skald/event-bus";
import type {
  BeliefModelDTO,
  PatternBelief,
  PatternId,
} from "../observation/types.js";
import { rebuildProjection, type ReadonlyWorld } from "../projection.js";
import { buildBeliefModel, serializeBeliefModel } from "../observation/builder.js";
import { buildTurnJournal, type PresentationThread } from "../journal/index.js";
import { buildObserverThreadJournal } from "../observer-threads/index.js";
import { computeBeliefDrift, computeBeliefRevision, STALE_FRESHNESS_THRESHOLD } from "./drift.js";
import type {
  BeliefDriftDTO,
  BeliefDriftLevel,
  FirstEntryDTO,
  CheckpointState,
  DiagnosticsBeliefReference,
  DiagnosticsDormantThread,
  DiagnosticsObservedChange,
  DiagnosticsStatement,
  ObserverCheckpoint,
  ObserverSessionDTO,
  PlayerContext,
  PresenceDiagnosticsDTO,
  PresenceFocus,
  PresenceSnapshot,
  PresenceStatement,
  ReobservationSubject,
  WorldPresenceSummary,
} from "./types.js";
import type { CharacterBackground, RegionEntrypoint } from "../setup/types.js";

/** Maximum number of newly observed changes in the presence DTO. */
export const MAX_NEARBY_CHANGES = 20;
/** Maximum number of suggested reobservations. */
export const MAX_REOBSERVATIONS = 5;
/** Maximum number of montage statements. */
export const MAX_STATEMENTS = 6;
const MAX_FIRST_ENTRY_TEXT = 420;

function deepFreeze<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (v && typeof v === "object") deepFreeze(v);
  }
  return obj;
}

function beliefByPattern(model: BeliefModelDTO, patternId: PatternId): PatternBelief | null {
  return model.beliefs.find((belief) => belief.patternId === patternId) ?? null;
}

// --- Internal ID-carrying structures (mapped to player or diagnostics DTOs) ---

interface InternalBeliefReference {
  readonly patternId: PatternId;
  readonly displayName: string;
  readonly interpretation: string;
  readonly lastObserved: number;
  readonly freshness: number;
}

interface InternalObservedChange {
  readonly targetId: PatternId;
  readonly description: string;
  readonly observedAt: number;
  readonly evidenceId: string;
}

interface InternalDormantThread {
  readonly threadKey: string;
  readonly label: string;
  readonly lastWorldTime: number;
  readonly entryCount: number;
}

interface InternalStatement {
  readonly text: string;
  readonly source: PresenceStatement["source"];
  readonly evidenceIds: readonly string[];
}

interface PresenceInternals {
  readonly revision: { worldTime: number; eventNumber: number };
  readonly checkpointState: CheckpointState;
  readonly checkpointModel: BeliefModelDTO | null;
  readonly currentModel: BeliefModelDTO;
  readonly drift: BeliefDriftDTO;
  readonly stale: readonly InternalBeliefReference[];
  readonly contradicted: readonly PatternId[];
  readonly nearbyChanges: readonly InternalObservedChange[];
  readonly dormantThreads: readonly InternalDormantThread[];
  readonly statements: readonly InternalStatement[];
  readonly focus: PresenceFocus;
  readonly firstEntry: FirstEntryDTO | null;
  readonly uncertainThreadCount: number;
  readonly changedThreadCount: number;
}

function evidenceAfter(model: BeliefModelDTO, time: number): InternalObservedChange[] {
  const changes: InternalObservedChange[] = [];
  for (const belief of model.beliefs) {
    for (const entry of belief.supportingEvidence) {
      if (entry.observedAt <= time) continue;
      changes.push({
        targetId: belief.patternId,
        description: entry.description,
        observedAt: entry.observedAt,
        evidenceId: entry.id,
      });
    }
  }
  changes.sort((a, b) => a.observedAt - b.observedAt || a.evidenceId.localeCompare(b.evidenceId));
  return changes;
}

/** Distinct patterns involved in the current contradictions. */
function contradictedPatterns(model: BeliefModelDTO): PatternId[] {
  const involved = new Set<PatternId>();
  for (const contradiction of model.contradictions) {
    for (const belief of model.beliefs) {
      const hypothesisHit = belief.openHypotheses.some(
        (hypothesis) => contradiction.involvedHypothesisIds.includes(hypothesis.id),
      );
      const evidenceHit = belief.supportingEvidence.some(
        (entry) => contradiction.involvedEvidenceIds.includes(entry.id),
      );
      if (hypothesisHit || evidenceHit) involved.add(belief.patternId);
    }
  }
  return [...involved].sort();
}

/**
 * Reconstructs the belief model as of the checkpoint event prefix. The prefix
 * is never clamped: an event number outside the log yields `null` instead of
 * silently replaying a different prefix.
 */
export function reconstructCheckpointModel(
  events: readonly DomainEvent[],
  checkpoint: ObserverCheckpoint,
): BeliefModelDTO | null {
  const { lastPresenceEventNumber } = checkpoint;
  if (
    !Number.isSafeInteger(lastPresenceEventNumber) || lastPresenceEventNumber < 0 ||
    lastPresenceEventNumber > events.length
  ) {
    return null;
  }
  const prefix = events.slice(0, lastPresenceEventNumber);
  if (prefix.length === 0) return null;
  const prefixWorld = rebuildProjection(prefix).getSnapshot();
  // The replayed projection must end exactly on the stored event number; a
  // prefix that somehow produced a different projection is not this memory.
  if (prefixWorld.eventNumber !== lastPresenceEventNumber) return null;
  return serializeBeliefModel(buildBeliefModel(prefix, prefixWorld, "player"));
}

/** Reconstructs the current observer-scoped belief model. */
export function reconstructCurrentModel(events: readonly DomainEvent[], world: ReadonlyWorld): BeliefModelDTO {
  return serializeBeliefModel(buildBeliefModel(events, world, "player"));
}

/**
 * Resolves the checkpoint validity against a deterministic replay. The stored
 * time and event number are part of the integrity check: both must be safe
 * non-negative integers, the event number must not exceed the log length (no
 * clamping), and the replayed prefix must end exactly at
 * `lastPresenceWorldTime`. Any mismatch (corruption, algorithm change,
 * tampering) yields `incompatible` with no model: the caller must then build
 * presence as if there were no checkpoint instead of silently trusting the
 * memory.
 */
export function resolveCheckpointState(
  events: readonly DomainEvent[],
  checkpoint: ObserverCheckpoint | null,
): { state: CheckpointState; model: BeliefModelDTO | null } {
  if (!checkpoint) return { state: "missing", model: null };
  const { lastPresenceWorldTime, lastPresenceEventNumber } = checkpoint;
  if (
    !Number.isSafeInteger(lastPresenceWorldTime) || lastPresenceWorldTime < 0 ||
    !Number.isSafeInteger(lastPresenceEventNumber) || lastPresenceEventNumber < 0 ||
    lastPresenceEventNumber > events.length
  ) {
    return { state: "incompatible", model: null };
  }
  const prefix = events.slice(0, lastPresenceEventNumber);
  if (prefix.length === 0 || prefix[prefix.length - 1]!.timestamp !== lastPresenceWorldTime) {
    return { state: "incompatible", model: null };
  }
  const model = reconstructCheckpointModel(events, checkpoint);
  if (!model) return { state: "incompatible", model: null };
  const digest = computeBeliefRevision(serializeBeliefModel(model));
  if (digest !== checkpoint.beliefRevision) return { state: "incompatible", model: null };
  return { state: "valid", model };
}

/** Computes the observer-scoped drift between checkpoint knowledge and now. */
export function computePresenceDrift(input: {
  checkpoint: ObserverCheckpoint | null;
  checkpointModel: BeliefModelDTO | null;
  currentModel: BeliefModelDTO;
  currentRevision: { worldTime: number; eventNumber: number };
  unresolvedThreadCount: number;
  newlyObservedChanges: readonly InternalObservedChange[];
}): BeliefDriftDTO {
  let staleBeliefCount = 0;
  let missingEvidenceCount = 0;
  if (input.checkpointModel) {
    for (const remembered of input.checkpointModel.beliefs) {
      const current = beliefByPattern(input.currentModel, remembered.patternId);
      if (!current) {
        missingEvidenceCount++;
        continue;
      }
      if (current.freshness <= STALE_FRESHNESS_THRESHOLD) staleBeliefCount++;
    }
  }
  const contradicted = contradictedPatterns(input.currentModel).length;
  return computeBeliefDrift({
    checkpoint: input.checkpoint,
    checkpointModel: input.checkpointModel,
    currentModel: input.currentModel,
    currentRevision: input.currentRevision,
    staleBeliefCount,
    contradictedBeliefCount: contradicted,
    unresolvedThreadCount: input.unresolvedThreadCount,
    newlyObservedChanges: input.newlyObservedChanges,
    missingEvidenceCount,
  });
}

/**
 * Threads known at the checkpoint with no entry after it. Dormancy is
 * informational and must not be treated as an unresolved thread: the journal
 * has no thread lifecycle (open/resolved) yet.
 */
export function findDormantThreads(
  checkpointThreads: readonly PresentationThread[],
  currentThreads: readonly PresentationThread[],
  checkpointTime: number,
): PresentationThread[] {
  const currentLast = new Map(currentThreads.map((thread) => [thread.threadKey, thread.lastWorldTime]));
  return checkpointThreads
    .filter((thread) => thread.lastWorldTime <= checkpointTime && (currentLast.get(thread.threadKey) ?? -Infinity) <= checkpointTime)
    .sort((a, b) => a.lastWorldTime - b.lastWorldTime || a.threadKey.localeCompare(b.threadKey));
}

/** Stale checkpoint beliefs with their current decay state. */
function staleBeliefs(checkpointModel: BeliefModelDTO | null, currentModel: BeliefModelDTO): InternalBeliefReference[] {
  const refs: InternalBeliefReference[] = [];
  if (!checkpointModel) return refs;
  for (const remembered of checkpointModel.beliefs) {
    const current = beliefByPattern(currentModel, remembered.patternId);
    if (!current || current.freshness > STALE_FRESHNESS_THRESHOLD) continue;
    refs.push({
      patternId: current.patternId,
      displayName: current.displayName,
      interpretation: current.currentInterpretation,
      lastObserved: current.lastObserved,
      freshness: current.freshness,
    });
  }
  refs.sort((a, b) => a.freshness - b.freshness || a.patternId.localeCompare(b.patternId));
  return refs;
}

function suggestedReobservations(
  stale: readonly InternalBeliefReference[],
  contradicted: readonly PatternId[],
  currentModel: BeliefModelDTO,
): ReobservationSubject[] {
  const subjects: ReobservationSubject[] = [];
  const added = new Set<PatternId>();
  for (const ref of stale) {
    added.add(ref.patternId);
    subjects.push({
      displayName: ref.displayName,
      reason: "Требуется повторное наблюдение.",
      lastObserved: ref.lastObserved,
    });
  }
  for (const patternId of contradicted) {
    if (added.has(patternId)) continue;
    added.add(patternId);
    const belief = beliefByPattern(currentModel, patternId);
    subjects.push({
      displayName: belief?.displayName ?? patternId,
      reason: "Прежняя трактовка оспаривается.",
      lastObserved: belief?.lastObserved ?? 0,
    });
  }
  return subjects.slice(0, MAX_REOBSERVATIONS);
}

function buildFocus(currentModel: BeliefModelDTO, checkpointModel: BeliefModelDTO | null, worldTime: number): PresenceFocus {
  const heatEvidence = currentModel.beliefs
    .filter((belief) => belief.patternId.startsWith("heat:"))
    .flatMap((belief) => belief.supportingEvidence)
    .filter((entry) => entry.observedAt <= worldTime);
  const latestHeat = heatEvidence.sort((a, b) => b.observedAt - a.observedAt || a.id.localeCompare(b.id))[0];
  const sensory = currentModel.beliefs
    .flatMap((belief) => belief.supportingEvidence.map((entry) => ({ belief, entry })))
    .filter(({ belief }) => belief.patternId.startsWith("sound:") || belief.patternId.startsWith("heat:"))
    .map(({ entry }) => entry)
    .sort((a, b) => b.observedAt - a.observedAt || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((entry) => entry.description);
  const remembered = checkpointModel
    ? [...checkpointModel.beliefs]
      .sort((a, b) => b.freshness - a.freshness || b.lastObserved - a.lastObserved)
      .slice(0, 2)
      .map((belief) => belief.currentInterpretation)
    : [];
  return deepFreeze({
    // No World Clock law exists; time-of-day is never invented.
    timeDescription: null,
    ambientDescription: latestHeat ? "В воздухе чувствуется тепло." : null,
    sensoryCues: deepFreeze(sensory),
    rememberedContext: deepFreeze(remembered),
  });
}


/** Inputs required to compose an observer-safe first-entry scene. */
export interface FirstEntryContext {
  readonly characterName: string;
  readonly background: CharacterBackground;
  readonly entrypoint: RegionEntrypoint;
  readonly playerContext: PlayerContext;
  readonly currentModel?: BeliefModelDTO;
  readonly world?: ReadonlyWorld;
  readonly initialTestimony?: readonly string[];
  readonly initialKnowledge?: readonly string[];
  readonly accessibleItems?: readonly string[];
  /** Runtime callers set this after checking the observer-visible relation. */
  readonly knownContactVisible?: boolean;
}

function firstEntryText(values: readonly (string | null | undefined)[], limit = 3): string {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = typeof value === "string" ? value.trim() : "";
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= limit) break;
  }
  const joined = result.join(" ");
  return joined.length <= MAX_FIRST_ENTRY_TEXT
    ? joined
    : joined.slice(0, MAX_FIRST_ENTRY_TEXT - 1).trimEnd() + "…";
}

function safeAccessibleItemName(value: string | undefined): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || /^(item|object|entity|location|relation|pattern|event):/i.test(text)) return "";
  return text;
}

/** Builds only from approved background/entrypoint content and observer-scoped evidence. */
export function buildFirstEntry(input: FirstEntryContext): FirstEntryDTO {
  const model = input.currentModel;
  const focus = model && input.world ? buildFocus(model, null, input.world.time) : null;
  const observed = model
    ? model.beliefs
      .filter((belief) => belief.patternId.startsWith("sound:") || belief.patternId.startsWith("heat:") || belief.patternId.startsWith("situation:"))
      .flatMap((belief) => belief.supportingEvidence)
      .sort((a, b) => b.observedAt - a.observedAt || a.id.localeCompare(b.id))
      .map((entry) => entry.description)
    : [];
  const bridge = input.entrypoint.backgroundConnections.find(
    (connection) => connection.backgroundId === input.background.id,
  )?.arrivalHook ?? input.entrypoint.backgroundBridges[input.background.id] ?? "";
  const itemName = safeAccessibleItemName(input.accessibleItems?.[0]);
  const itemCue = itemName
    ? "Среди вещей у тебя осталось: " + itemName + "."
    : "";
  const testimonyCue = input.initialTestimony?.[0] ?? "";
  const knowledgeCue = input.initialKnowledge?.[0] ?? "";
  const sensory = firstEntryText([
    input.entrypoint.arrivalScene,
    input.entrypoint.atmosphere,
    focus?.ambientDescription,
    ...(focus?.sensoryCues ?? []),
  ], 3);
  const visibleSituation = firstEntryText([
    input.entrypoint.openingSituation,
    input.entrypoint.openingProblem,
    ...observed,
  ], 3);
  const personalHook = firstEntryText([
    input.background.openingHook,
    input.background.obligation,
    testimonyCue,
    knowledgeCue,
    itemCue,
    bridge,
  ], 4);
  return deepFreeze({
    schemaVersion: 1 as const,
    character: { name: input.characterName.trim() },
    background: {
      title: input.background.title,
      summary: firstEntryText([input.background.formerRole, input.background.rupture, input.background.history], 3),
    },
    startingLocation: {
      title: input.playerContext.locationTitle || input.entrypoint.title,
      description: input.playerContext.locationDescription || input.entrypoint.description,
    },
    reasonForArrival: firstEntryText([input.background.reasonInRegion, bridge], 2),
    visibleSituation,
    sensoryContext: Object.freeze(sensory ? sensory.split(/(?<=[.!?])\s+/).filter(Boolean) : []),
    knownContact: input.knownContactVisible === true ? {
      name: input.entrypoint.localContact.name,
      description: input.entrypoint.localContact.description,
    } : null,
    personalHook,
  });
}

function buildPresenceSnapshot(input: {
  playerContext: PlayerContext;
  revision: { worldTime: number; eventNumber: number };
  focus: PresenceFocus;
  drift: BeliefDriftDTO;
  dormantThreads: readonly InternalDormantThread[];
  nearbyChanges: readonly InternalObservedChange[];
  stale: readonly InternalBeliefReference[];
  contradicted: readonly PatternId[];
  currentModel: BeliefModelDTO;
}): PresenceSnapshot {
  return deepFreeze({
    schemaVersion: 1 as const,
    observerId: "player" as const,
    revision: deepFreeze({ ...input.revision }),
    location: {
      title: input.playerContext.locationTitle,
      description: input.playerContext.locationDescription,
    },
    focus: input.focus,
    drift: input.drift,
    dormantThreads: deepFreeze(input.dormantThreads.map((thread) => ({
      label: thread.label,
      lastWorldTime: thread.lastWorldTime,
      entryCount: thread.entryCount,
    }))),
    nearbyChanges: deepFreeze(input.nearbyChanges.map((change) => ({
      description: change.description,
      observedAt: change.observedAt,
    }))),
    staleBeliefs: deepFreeze(input.stale.map((ref) => ({
      displayName: ref.displayName,
      interpretation: ref.interpretation,
      lastObserved: ref.lastObserved,
      freshness: ref.freshness,
    }))),
    suggestedReobservations: deepFreeze(suggestedReobservations(input.stale, input.contradicted, input.currentModel)),
  });
}

function buildStatements(input: {
  stale: readonly InternalBeliefReference[];
  contradictions: readonly { description: string; involvedEvidenceIds: readonly string[] }[];
  dormantThreads: readonly InternalDormantThread[];
  nearbyChanges: readonly InternalObservedChange[];
  currentModel: BeliefModelDTO;
}): InternalStatement[] {
  const statements: InternalStatement[] = [];
  for (const ref of input.stale.slice(0, 2)) {
    const belief = beliefByPattern(input.currentModel, ref.patternId);
    statements.push({
      text: `Ваша память о «${ref.displayName}» утратила ясность.`,
      source: "belief_freshness",
      evidenceIds: deepFreeze(belief?.supportingEvidence.map((entry) => entry.id) ?? []),
    });
  }
  for (const contradiction of input.contradictions.slice(0, 2)) {
    statements.push({
      text: contradiction.description,
      source: "belief_contradiction",
      evidenceIds: deepFreeze(contradiction.involvedEvidenceIds),
    });
  }
  for (const thread of input.dormantThreads.slice(0, 2)) {
    statements.push({
      text: `История о «${thread.label}» осталась без продолжения.`,
      source: "known_thread",
      evidenceIds: deepFreeze([]),
    });
  }
  for (const change of input.nearbyChanges.slice(0, 3)) {
    statements.push({
      text: change.description,
      source: "observation_delta",
      evidenceIds: deepFreeze([change.evidenceId]),
    });
  }
  return deepFreeze(statements.slice(0, MAX_STATEMENTS));
}

function buildPresenceInternals(input: {
  events: readonly DomainEvent[];
  world: ReadonlyWorld;
  playerContext: PlayerContext;
  checkpoint: ObserverCheckpoint | null;
  firstEntryContext?: FirstEntryContext | undefined;
}): PresenceInternals {
  const currentModel = reconstructCurrentModel(input.events, input.world);
  const resolved = resolveCheckpointState(input.events, input.checkpoint);
  const checkpointModel = resolved.model;
  const firstEntry = resolved.state === "missing" && input.firstEntryContext
    ? buildFirstEntry({ ...input.firstEntryContext, currentModel, world: input.world })
    : null;
  // An incompatible checkpoint must not silently build presence: fall back to
  // "no memory" while keeping the raw checkpoint visible in the DTO.
  const effectiveCheckpoint = resolved.state === "valid" ? input.checkpoint : null;
  const effectiveTime = effectiveCheckpoint?.lastPresenceWorldTime ?? 0;

  // Threads are collected under the observer scope: turns whose TickPassed is
  // marked playerOffline produce no presentation, so a hidden continuation of
  // a known thread keeps it dormant instead of leaking hidden world activity.
  const checkpointThreads = effectiveCheckpoint
    ? buildTurnJournal(
      input.events.slice(0, effectiveCheckpoint.lastPresenceEventNumber),
      { skipOfflineTurns: true },
    ).threads
    : [];
  const currentThreads = buildTurnJournal(input.events, { skipOfflineTurns: true }).threads;
  const dormant = findDormantThreads(checkpointThreads, currentThreads, effectiveTime);
  const dormantSummaries: InternalDormantThread[] = dormant.map((thread) => ({
    threadKey: thread.threadKey,
    label: thread.label,
    lastWorldTime: thread.lastWorldTime,
    entryCount: thread.entries.length,
  }));

  const nearbyChanges = effectiveCheckpoint
    ? evidenceAfter(currentModel, effectiveTime).slice(0, MAX_NEARBY_CHANGES)
    : [];

  const drift = computePresenceDrift({
    checkpoint: effectiveCheckpoint,
    checkpointModel,
    currentModel,
    currentRevision: { worldTime: input.world.time, eventNumber: input.world.eventNumber },
    // Dormant threads are informational; no thread lifecycle exists yet.
    unresolvedThreadCount: 0,
    newlyObservedChanges: nearbyChanges,
  });

  const stale = staleBeliefs(checkpointModel, currentModel);
  const contradicted = contradictedPatterns(currentModel);
  const statements = buildStatements({
    stale,
    contradictions: currentModel.contradictions,
    dormantThreads: dormantSummaries,
    nearbyChanges,
    currentModel,
  });
  const focus = buildFocus(currentModel, checkpointModel, input.world.time);

  // Observer Thread Journal counts for the Known Worlds card. Threads exist
  // without a checkpoint too, but a card without memory must not suggest
  // staleness of remembered knowledge, so the count reflects the checkpoint
  // memory: 0 when there is none.
  const threadJournal = effectiveCheckpoint
    ? buildObserverThreadJournal({
      events: input.events,
      beliefModel: currentModel,
      checkpoint: effectiveCheckpoint,
      checkpointState: "valid" as const,
      revision: { worldTime: input.world.time, eventNumber: input.world.eventNumber },
    })
    : null;

  return {
    revision: { worldTime: input.world.time, eventNumber: input.world.eventNumber },
    checkpointState: resolved.state,
    checkpointModel,
    currentModel,
    drift,
    stale,
    contradicted,
    nearbyChanges,
    dormantThreads: dormantSummaries,
    statements,
    focus,
    firstEntry,
    uncertainThreadCount: threadJournal?.counts.uncertain ?? 0,
    changedThreadCount: threadJournal?.counts.changedSincePresence ?? 0,
  };
}

/** Builds the full consistent observer session for the entry path. */
export function buildObserverSession(input: {
  events: readonly DomainEvent[];
  world: ReadonlyWorld;
  playerContext: PlayerContext;
  checkpoint: ObserverCheckpoint | null;
  firstEntryContext?: FirstEntryContext | undefined;
}): ObserverSessionDTO {
  return assembleObserverSession(buildPresenceInternals(input), input);
}

function assembleObserverSession(internals: PresenceInternals, input: {
  events: readonly DomainEvent[];
  world: ReadonlyWorld;
  playerContext: PlayerContext;
  checkpoint: ObserverCheckpoint | null;
  firstEntryContext?: FirstEntryContext | undefined;
}): ObserverSessionDTO {
  const presence = buildPresenceSnapshot({
    playerContext: input.playerContext,
    revision: internals.revision,
    focus: internals.focus,
    drift: internals.drift,
    dormantThreads: internals.dormantThreads,
    nearbyChanges: internals.nearbyChanges,
    stale: internals.stale,
    contradicted: internals.contradicted,
    currentModel: internals.currentModel,
  });

  return deepFreeze({
    schemaVersion: 2 as const,
    revision: deepFreeze({ ...internals.revision }),
    checkpointState: internals.checkpointState,
    checkpoint: input.checkpoint ? deepFreeze({ ...input.checkpoint }) : null,
    beliefModel: internals.currentModel,
    drift: internals.drift,
    presence,
    firstEntry: internals.firstEntry,
    statements: deepFreeze(internals.statements.map((statement) => ({
      text: statement.text,
      source: statement.source,
    }))),
  });
}

/**
 * Builds the entry session and the known-worlds summary in a single
 * derivation pass over one Event Log snapshot and one ReadonlyWorld. The two
 * DTOs therefore always agree on revision and checkpointState by
 * construction: `session.revision.worldTime === summary.currentWorldTime`
 * and `session.checkpointState === summary.checkpointState` are invariants,
 * not coincidences.
 */
export function buildObserverSessionAndSummary(input: {
  worldId: string;
  events: readonly DomainEvent[];
  world: ReadonlyWorld;
  playerContext: PlayerContext;
  checkpoint: ObserverCheckpoint | null;
  firstEntryContext?: FirstEntryContext | undefined;
}): { session: ObserverSessionDTO; summary: WorldPresenceSummary } {
  const internals = buildPresenceInternals(input);
  return {
    session: assembleObserverSession(internals, input),
    summary: assembleWorldPresenceSummary(internals, input.worldId, input.checkpoint?.lastPresenceWorldTime ?? null),
  };
}

/** Diagnostics-only reconstruction with internal identifiers. */
export function buildPresenceDiagnostics(input: {
  events: readonly DomainEvent[];
  world: ReadonlyWorld;
  playerContext: PlayerContext;
  checkpoint: ObserverCheckpoint | null;
}): PresenceDiagnosticsDTO {
  const internals = buildPresenceInternals(input);
  return deepFreeze({
    schemaVersion: 1 as const,
    revision: deepFreeze({ ...internals.revision }),
    checkpointState: internals.checkpointState,
    staleBeliefs: deepFreeze(internals.stale.map((ref): DiagnosticsBeliefReference => ({
      patternId: ref.patternId,
      displayName: ref.displayName,
      interpretation: ref.interpretation,
      lastObserved: ref.lastObserved,
      freshness: ref.freshness,
    }))),
    contradictedPatterns: deepFreeze([...internals.contradicted]),
    nearbyChanges: deepFreeze(internals.nearbyChanges.map((change): DiagnosticsObservedChange => ({
      targetId: change.targetId,
      description: change.description,
      observedAt: change.observedAt,
      evidenceId: change.evidenceId,
    }))),
    dormantThreads: deepFreeze(internals.dormantThreads.map((thread): DiagnosticsDormantThread => ({
      threadKey: thread.threadKey,
      label: thread.label,
      lastWorldTime: thread.lastWorldTime,
      entryCount: thread.entryCount,
    }))),
    statements: deepFreeze(internals.statements.map((statement): DiagnosticsStatement => ({
      text: statement.text,
      source: statement.source,
      evidenceIds: deepFreeze([...statement.evidenceIds]),
    }))),
  });
}

/** Ready player-facing presence status; classification stays on the backend. */
function presenceStatusText(state: CheckpointState, driftLevel: BeliefDriftLevel): string {
  if (state === "missing") return "Ты ещё не входил в этот мир.";
  if (state === "incompatible") return "Твои прежние воспоминания нельзя надёжно восстановить. Мир приходится воспринимать заново.";
  switch (driftLevel) {
    case "none": return "Мир кажется таким, каким ты его помнишь.";
    case "low": return "В мире появились едва заметные расхождения.";
    case "medium": return "Некоторые знания требуют повторной проверки.";
    case "high": return "Многое изменилось. Доверься новым наблюдениям.";
  }
}

function nitiCountText(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} нить`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} нити`;
  return `${count} нитей`;
}

/** Ready player-facing knowledge doubts, or null when nothing needs attention. */
function knowledgeStatusText(staleBeliefCount: number, dormantThreadCount: number, uncertainThreadCount: number): string | null {
  const parts: string[] = [];
  if (staleBeliefCount > 0) parts.push("Некоторые знания требуют проверки.");
  if (dormantThreadCount === 1) parts.push("Одна нить давно не отзывалась.");
  if (dormantThreadCount > 1) parts.push(`${nitiCountText(dormantThreadCount)} давно не отзывались.`);
  if (uncertainThreadCount > 0) parts.push("Некоторые из твоих сведений могли устареть.");
  return parts.length > 0 ? parts.join(" ") : null;
}

/** Lightweight per-world card for the Known Worlds screen. */
export function buildWorldPresenceSummary(input: {
  worldId: string;
  events: readonly DomainEvent[];
  world: ReadonlyWorld;
  checkpoint: ObserverCheckpoint | null;
}): WorldPresenceSummary {
  const internals = buildPresenceInternals({ ...input, playerContext: { locationTitle: "", locationDescription: "" } });
  const checkpointTime = input.checkpoint?.lastPresenceWorldTime ?? null;
  return assembleWorldPresenceSummary(internals, input.worldId, checkpointTime);
}

function assembleWorldPresenceSummary(internals: PresenceInternals, worldId: string, checkpointTime: number | null): WorldPresenceSummary {
  const valid = internals.checkpointState === "valid";
  return deepFreeze({
    schemaVersion: 1 as const,
    worldId,
    // A missing or unverifiable checkpoint has no trustworthy presence time.
    lastPresenceWorldTime: valid ? checkpointTime : null,
    currentWorldTime: internals.revision.worldTime,
    worldTimeDelta: internals.drift.worldTimeDelta,
    checkpointState: internals.checkpointState,
    driftLevel: internals.drift.level,
    staleBeliefCount: internals.drift.staleBeliefCount,
    dormantThreadCount: internals.dormantThreads.length,
    uncertainThreadCount: internals.uncertainThreadCount,
    changedThreadCount: internals.changedThreadCount,
    presenceStatus: presenceStatusText(internals.checkpointState, internals.drift.level),
    knowledgeStatus: knowledgeStatusText(internals.drift.staleBeliefCount, internals.dormantThreads.length, internals.uncertainThreadCount),
  });
}

export { computeBeliefRevision };
