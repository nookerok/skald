import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../projection.js";
import type {
  GameShellSnapshot, ShellDelta, WorldContextView, CausalStep,
  PlayerTurnView, PlayerFacingEntry, WorldActivityItem, PlayerFacingScope, ActivityOrigin,
} from "./types.js";
import { buildTurnJournal } from "../journal/builder.js";
import { deepFreeze } from "../discovery/builder.js";
import { buildPlayerGuidance } from "../guidance/selector.js";
import { buildCharacterView } from "./character-view.js";
import { buildSituationView } from "./situation-view.js";
import { buildAttentionView } from "./attention-view.js";
import { buildKnowledgeSummary } from "./knowledge-view.js";
import { buildBeliefModel, serializeBeliefModel } from "../observation/builder.js";
import { blockedReasonLabel, operationLabel, sanitizePlayerFacingText } from "./player-facing.js";

interface CharacterProfileRecord {
  display_name: string;
  wound: string;
  promise: string;
  principle: string;
}

const ACTIVITY_ORIGIN: Record<string, ActivityOrigin> = {
  TickPassed: "world_tick",
  ConsequenceCreated: "consequence",
  ConsequenceFired: "consequence",
};

const ACTIVITY_SCOPE: Record<string, PlayerFacingScope> = {
  TickPassed: "known",
  ConsequenceCreated: "visible",
  ConsequenceFired: "visible",
};

function classifyScopeFromEvent(type: string): PlayerFacingScope | null {
  return ACTIVITY_SCOPE[type] ?? null;
}

function classifyOriginFromEvent(type: string): ActivityOrigin | null {
  return ACTIVITY_ORIGIN[type] ?? null;
}

export function buildCausalChain(events: readonly DomainEvent[], turnWorldTime: number): CausalStep[] {
  const root = events.find((e) => e.timestamp === turnWorldTime &&
    (e.type === "MoveRequested" || e.type === "GiveRequested" || e.type === "ActionAttempted" || e.type === "TickPassed"));
  if (!root) return [];
  const turnEvents = events.filter((e) => e.correlationId === root.correlationId && e.timestamp === turnWorldTime);
  const visited = new Set<string>();
  const ordered: DomainEvent[] = [];
  function walk(eventId: string): void {
    if (visited.has(eventId)) return;
    visited.add(eventId);
    const event = turnEvents.find((item) => item.eventId === eventId);
    if (event) ordered.push(event);
    for (const child of turnEvents) if (child.causationId === eventId) walk(child.eventId);
  }
  walk(root.eventId);
  const steps: CausalStep[] = [];
  for (const event of ordered) {
    const p = event.payload as Record<string, unknown>;
    let text: string;
    switch (event.type) {
      case "MoveRequested": text = "Ты пытаешься сделать шаг."; break;
      case "GiveRequested": text = "Ты пытаешься повлиять на отношения."; break;
      case "ActionAttempted": text = "Ты пытаешься: " + operationLabel(p.operation) + "."; break;
      case "ActionValidated": case "GiveValidated": text = "Действие принято."; break;
      case "ActionResolved": text = typeof p.description === "string" ? p.description : "Действие получило результат."; break;
      case "ActionBlocked": text = "Действие заблокировано: " + blockedReasonLabel(p.reason) + "."; break;
      case "ObjectObserved": text = typeof p.description === "string" ? p.description : "Ты заметил изменение."; break;
      case "ObjectTemperatureChanged": text = "Предмет рядом нагревается."; break;
      case "SoundProduced": text = "Раздался звук поблизости."; break;
      case "SoundObserved": text = typeof p.description === "string" ? p.description : "Ты прислушиваешься."; break;
      case "ActionHadNoObservableEffect": text = "Ты не замечаешь ничего особенного."; break;
      case "CriticalCheckRequested": { const modifiers = Array.isArray(p.modifiers) ? (p.modifiers as Array<{ label?: unknown; delta?: unknown }>).map((item) => (typeof item.label === "string" ? item.label : "Модификатор") + " " + (typeof item.delta === "number" && item.delta >= 0 ? "+" : "") + (typeof item.delta === "number" ? item.delta : 0)).join(", ") : "нет"; text = "Критический момент. Сложность: " + (typeof p.difficulty === "number" ? p.difficulty : "—") + ". Модификаторы: " + modifiers; break; }
      case "CriticalCheckRolled": text = "Бросок: " + (typeof p.naturalRoll === "number" ? p.naturalRoll : "—") + "."; break;
      case "CriticalCheckResolved": text = "Итого " + (typeof p.total === "number" ? p.total : "—") + " против " + (typeof p.difficulty === "number" ? p.difficulty : "—") + ": " + (p.outcome === "success" || p.outcome === "critical_success" ? "Успех!" : "Неудача."); break;
      case "MovementSucceeded": text = "Путь оказался свободен."; break;
      case "MovementBlocked": text = "Путь преграждён."; break;
      case "PlayerLocationChanged": text = "Ты переместился в новое место."; break;
      case "ObservationUpdated": text = "Мир заметил твой поступок."; break;
      case "ConsequenceCreated": text = "Зародилось последствие."; break;
      case "ConsequenceFired": case "AudacityTriggered": text = "Последствие проявило себя."; break;
      case "TickPassed": text = "Время идёт."; break;
      case "RelationChanged": text = "Отношения изменились."; break;
      default: continue;
    }
    const step: CausalStep = {
      kind: event.type === "MoveRequested" || event.type === "GiveRequested" || event.type === "ActionAttempted" ? "intention"
        : event.type === "ObservationUpdated" ? "observation"
        : event.type === "ConsequenceCreated" || event.type === "ConsequenceFired" || event.type === "AudacityTriggered" ? "consequence" : "outcome",
      text,
    };
    if (event.type === "CriticalCheckRequested") {
      const modifiers = Array.isArray(p.modifiers) ? p.modifiers as Array<{ label?: unknown; delta?: unknown }> : [];
      const stakes = p.stakes as { success?: unknown; failure?: unknown } | undefined;
      step.critical = {
        success: typeof stakes?.success === "string" ? stakes.success : "Успех меняет ситуацию.",
        failure: typeof stakes?.failure === "string" ? stakes.failure : "Неудача меняет ситуацию.",
        ...(typeof p.difficulty === "number" ? { difficulty: p.difficulty } : {}),
        modifiers: modifiers.map((modifier) => ({ label: typeof modifier.label === "string" ? modifier.label : "Модификатор", delta: typeof modifier.delta === "number" ? modifier.delta : 0 })),
      };
    }
    steps.push(step);
  }
  return steps;
}

function buildWorldContextView(world: ReadonlyWorld): WorldContextView {
  const playerKey = `${world.player.x},${world.player.y}`;
  const heatLevel = world.heatMap.get(playerKey) ?? 0;

  // Iteration 15 — Location info
  const locationId = world.currentLocationId;
  const location = locationId ? world.locations.get(locationId) : undefined;

  const connectedLocations: Array<{ id: string; label: string; detail?: string }> = [];
  if (location) {
    for (const [, connTarget] of Object.entries(location.connections)) {
      const connLoc = world.locations.get(connTarget);
      if (connLoc) {
        connectedLocations.push({ id: connLoc.id, label: connLoc.name, detail: connLoc.description });
      }
    }
  }

  return {
    position: { x: world.player.x, y: world.player.y },
    heatLevel,
    heatDescription: heatLevel > 0 ? "Тепло ощущается здесь." : null,
    locationId: locationId || undefined,
    locationName: location?.name,
    locationDescription: location?.description,
    connectedLocations: connectedLocations.length > 0 ? connectedLocations : undefined,
  };
}

function classifyActivity(
  entrySourceEventIds: readonly string[],
  eventIndex: Map<string, DomainEvent>,
): { scope: PlayerFacingScope; origin: ActivityOrigin } | null {
  // Check each source event for known classification
  for (const eid of entrySourceEventIds) {
    const ev = eventIndex.get(eid);
    if (!ev) continue;
    const scope = classifyScopeFromEvent(ev.type);
    const origin = classifyOriginFromEvent(ev.type);
    if (scope && origin) return { scope, origin };
  }
  return null;
}

function playerFacingEntry(entry: import("../presentation/types.js").PresentationEntry): PlayerFacingEntry {
  return {
    kind: entry.kind,
    importance: entry.importance,
    discoveryMark: entry.discoveryMark,
    text: sanitizePlayerFacingText(entry.text),
    timestamp: entry.timestamp,
  };
}

function buildDiscoverySignals(model: import("../observation/types.js").BeliefModel, worldTime: number): PlayerTurnView["discoverySignals"] {
  return [...model.beliefs.values()]
    .filter((belief) => belief.patternId.startsWith("discovery:") && belief.supportingEvidence.some((entry) => entry.observedAt === worldTime))
    .map((belief) => ({
      stage: belief.confidence >= 0.8 ? "discovered" as const : belief.confidence >= 0.6 ? "hypothesis" as const : "trace" as const,
      title: belief.displayName,
      text: belief.currentInterpretation,
    }));
}

export function buildGameShellSnapshot(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  characterProfile: CharacterProfileRecord | null,
  worldId: string,
): GameShellSnapshot {
  const journal = buildTurnJournal(events);
  const guidance = buildPlayerGuidance(events, world);
  const beliefModel = buildBeliefModel(events, world);

  // Event index for activity classification
  const eventIndex = new Map<string, DomainEvent>();
  for (const e of events) eventIndex.set(e.eventId, e);

  let lastTurn: PlayerTurnView | null = null;
  if (journal.turns.length > 0) {
    const latestTurn = journal.turns[journal.turns.length - 1]!;
    const chain = buildCausalChain(events, latestTurn.worldTime);
    const signals = buildDiscoverySignals(beliefModel, latestTurn.worldTime);
    lastTurn = {
      turnId: latestTurn.turnId,
      worldTime: latestTurn.worldTime,
      primary: latestTurn.presentation.primary ? playerFacingEntry(latestTurn.presentation.primary) : null,
      notable: latestTurn.presentation.notable.map(playerFacingEntry),
      background: latestTurn.presentation.background.map(playerFacingEntry),
      causalChain: chain,
      discoverySignals: signals,
    };
  }

  // Activity: only entries classifiable from source events
  const activity: WorldActivityItem[] = [];
  for (const turn of [...journal.turns].reverse()) {
    for (const entry of [...turn.presentation.background, ...turn.presentation.notable]) {
      const meta = classifyActivity(entry.sourceEventIds, eventIndex);
      if (!meta) continue; // skip unclassifiable
      activity.push({
        kind: entry.kind,
        text: sanitizePlayerFacingText(entry.text),
        timestamp: turn.worldTime,
        scope: meta.scope,
        origin: meta.origin,
      });
      if (activity.length >= 5) break;
    }
    if (activity.length >= 5) break;
  }

  return deepFreeze({
    schemaVersion: 1 as const,
    worldId,
    revision: { worldTime: world.time, eventNumber: world.eventNumber },
    character: buildCharacterView(characterProfile, world),
    world: buildWorldContextView(world),
    currentSituation: buildSituationView(world),
    attention: buildAttentionView(world, events),
    lastTurn,
    recentActivity: activity,
    knowledge: buildKnowledgeSummary(beliefModel),
    beliefModel: serializeBeliefModel(beliefModel),
    suggestions: guidance.suggestions,
  });
}

export function buildShellDelta(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
): ShellDelta {
  const guidance = buildPlayerGuidance(events, world);
  const beliefModel = buildBeliefModel(events, world);
  const journal = buildTurnJournal(events);

  const eventIndex = new Map<string, DomainEvent>();
  for (const e of events) eventIndex.set(e.eventId, e);

  let turn: PlayerTurnView | null = null;
  if (journal.turns.length > 0) {
    const latest = journal.turns[journal.turns.length - 1]!;
    const signals = buildDiscoverySignals(beliefModel, latest.worldTime);
    turn = {
      turnId: latest.turnId,
      worldTime: latest.worldTime,
      primary: latest.presentation.primary ? playerFacingEntry(latest.presentation.primary) : null,
      notable: latest.presentation.notable.map(playerFacingEntry),
      background: latest.presentation.background.map(playerFacingEntry),
      causalChain: buildCausalChain(events, latest.worldTime),
      discoverySignals: signals,
    };
  }

  const activity: WorldActivityItem[] = [];
  for (const t of [...journal.turns].reverse()) {
    for (const entry of [...t.presentation.background, ...t.presentation.notable]) {
      const meta = classifyActivity(entry.sourceEventIds, eventIndex);
      if (!meta) continue;
      activity.push({
        kind: entry.kind, text: sanitizePlayerFacingText(entry.text), timestamp: t.worldTime,
        scope: meta.scope, origin: meta.origin,
      });
      if (activity.length >= 3) break;
    }
    if (activity.length >= 3) break;
  }

  return deepFreeze({
    revision: { worldTime: world.time, eventNumber: world.eventNumber },
    turn,
    currentSituation: buildSituationView(world),
    attention: buildAttentionView(world, events),
    activity,
    knowledge: buildKnowledgeSummary(beliefModel),
    beliefModel: serializeBeliefModel(beliefModel),
    suggestions: guidance.suggestions,
  });
}
