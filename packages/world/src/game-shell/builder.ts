import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../projection.js";
import type {
  GameShellSnapshot, ShellDelta, WorldContextView, CausalStep,
  PlayerTurnView, WorldActivityItem, PlayerFacingScope, ActivityOrigin,
} from "./types.js";
import { buildTurnJournal } from "../journal/builder.js";
import { buildDiscoveryJournal, deepFreeze } from "../discovery/builder.js";
import { buildPlayerGuidance } from "../guidance/selector.js";
import { buildCharacterView } from "./character-view.js";
import { buildSituationView } from "./situation-view.js";
import { buildAttentionView } from "./attention-view.js";
import { buildKnowledgeSummary } from "./knowledge-view.js";

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
  const root = events.find(
    (e) => e.timestamp === turnWorldTime &&
      (e.type === "MoveRequested" || e.type === "GiveRequested" || e.type === "TickPassed"),
  );
  if (!root) return [];

  const correlationId = root.correlationId;
  const turnEvents = events.filter((e) => e.correlationId === correlationId && e.timestamp === turnWorldTime);

  // DFS from root following causationId edges — strict causal descendants only
  const visited = new Set<string>();
  const ordered: DomainEvent[] = [];
  function walk(eventId: string) {
    if (visited.has(eventId)) return;
    visited.add(eventId);
    const ev = turnEvents.find((e) => e.eventId === eventId);
    if (ev) ordered.push(ev);
    for (const e of turnEvents) {
      if (e.causationId === eventId) walk(e.eventId);
    }
  }
  walk(root.eventId);

  const steps: CausalStep[] = [];
  for (const e of ordered) {
    let text = "";
    switch (e.type) {
      case "MoveRequested": case "GiveRequested": text = "Ты делаешь шаг."; break;
      case "MovementSucceeded": text = "Путь оказался свободен."; break;
      case "MovementBlocked": text = "Путь преграждён."; break;
      case "ActionValidated": case "GiveValidated": text = "Действие принято."; break;
      case "ObservationUpdated": text = "Мир заметил твой поступок."; break;
      case "ConsequenceCreated": text = "Зародилось последствие."; break;
      case "ConsequenceFired": case "AudacityTriggered": text = "Последствие проявило себя."; break;
      case "TickPassed": text = "Время идёт."; break;
      case "RelationChanged": text = "Отношения изменились."; break;
      default: continue;
    }
    steps.push({
      kind: e.type === "MoveRequested" || e.type === "GiveRequested" ? "intention"
        : e.type === "ObservationUpdated" ? "observation"
        : e.type === "ConsequenceCreated" || e.type === "ConsequenceFired" || e.type === "AudacityTriggered" ? "consequence"
        : "outcome",
      text,
      sourceEventIds: [e.eventId],
    });
  }
  return steps;
}

function buildWorldContextView(world: ReadonlyWorld): WorldContextView {
  const playerKey = `${world.player.x},${world.player.y}`;
  const heatLevel = world.heatMap.get(playerKey) ?? 0;
  return {
    position: { x: world.player.x, y: world.player.y },
    heatLevel,
    heatDescription: heatLevel > 0 ? "Тепло ощущается здесь." : null,
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

export function buildGameShellSnapshot(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  characterProfile: CharacterProfileRecord | null,
  worldId: string,
): GameShellSnapshot {
  const discovery = buildDiscoveryJournal(events);
  const journal = buildTurnJournal(events);
  const guidance = buildPlayerGuidance(events, world);

  // Event index for activity classification
  const eventIndex = new Map<string, DomainEvent>();
  for (const e of events) eventIndex.set(e.eventId, e);

  let lastTurn: PlayerTurnView | null = null;
  if (journal.turns.length > 0) {
    const latestTurn = journal.turns[journal.turns.length - 1]!;
    const chain = buildCausalChain(events, latestTurn.worldTime);
    const signals = discovery.cards
      .filter((c) => c.evidence.some((ev) => ev.worldTime === latestTurn.worldTime))
      .map((c) => ({
        stage: c.stage, title: c.title, text: c.summary, discoveryId: c.discoveryId,
      }));
    lastTurn = {
      turnId: latestTurn.turnId,
      worldTime: latestTurn.worldTime,
      primary: latestTurn.presentation.primary,
      notable: latestTurn.presentation.notable,
      background: latestTurn.presentation.background,
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
        text: entry.text,
        timestamp: turn.worldTime,
        scope: meta.scope,
        origin: meta.origin,
        sourceEventIds: entry.sourceEventIds,
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
    attention: buildAttentionView(world),
    lastTurn,
    recentActivity: activity,
    knowledge: buildKnowledgeSummary(discovery),
    suggestions: guidance.suggestions,
  });
}

export function buildShellDelta(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
): ShellDelta {
  const discovery = buildDiscoveryJournal(events);
  const guidance = buildPlayerGuidance(events, world);
  const journal = buildTurnJournal(events);

  const eventIndex = new Map<string, DomainEvent>();
  for (const e of events) eventIndex.set(e.eventId, e);

  let turn: PlayerTurnView | null = null;
  if (journal.turns.length > 0) {
    const latest = journal.turns[journal.turns.length - 1]!;
    const signals = discovery.cards
      .filter((c) => c.evidence.some((ev) => ev.worldTime === latest.worldTime))
      .map((c) => ({ stage: c.stage, title: c.title, text: c.summary, discoveryId: c.discoveryId }));
    turn = {
      turnId: latest.turnId,
      worldTime: latest.worldTime,
      primary: latest.presentation.primary,
      notable: latest.presentation.notable,
      background: latest.presentation.background,
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
        kind: entry.kind, text: entry.text, timestamp: t.worldTime,
        scope: meta.scope, origin: meta.origin, sourceEventIds: entry.sourceEventIds,
      });
      if (activity.length >= 3) break;
    }
    if (activity.length >= 3) break;
  }

  return deepFreeze({
    revision: { worldTime: world.time, eventNumber: world.eventNumber },
    turn,
    currentSituation: buildSituationView(world),
    attention: buildAttentionView(world),
    activity,
    knowledge: buildKnowledgeSummary(discovery),
    suggestions: guidance.suggestions,
  });
}
