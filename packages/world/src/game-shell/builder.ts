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

function classifyOrigin(eventType: string): ActivityOrigin {
  switch (eventType) {
    case "TickPassed": return "world_tick";
    case "ConsequenceCreated":
    case "ConsequenceFired": return "consequence";
    default: return "player";
  }
}

function classifyScope(_eventType: string, importance: string): PlayerFacingScope {
  switch (importance) {
    case "primary": case "notable": return "visible";
    case "background": return "global";
    default: return "visible";
  }
}

export function buildCausalChain(events: readonly DomainEvent[], turnWorldTime: number): CausalStep[] {
  // Get the root intention for the current turn
  const root = events.find(
    (e) => e.timestamp === turnWorldTime &&
      (e.type === "MoveRequested" || e.type === "GiveRequested" || e.type === "TickPassed"),
  );
  if (!root) return [];

  if (!root) return [];
  const rootEventId = root.eventId;
  const correlationId = root.correlationId;
  const turnEvents = events.filter((e) => e.correlationId === correlationId && e.timestamp === turnWorldTime);

  // Build and order by causation: root → its children
  const visited = new Set<string>();
  const ordered: DomainEvent[] = [];
  function walk(eventId: string) {
    if (visited.has(eventId)) return;
    visited.add(eventId);
    const ev = turnEvents.find((e) => e.eventId === eventId);
    if (ev) ordered.push(ev);
    // Follow causation edges from this event
    for (const e of turnEvents) {
      if (e.causationId === eventId) walk(e.eventId);
    }
    // Also include events with same correlationId that have null causationId (siblings of root)
    for (const e of turnEvents) {
      if (e.causationId === null && e.eventId !== rootEventId && e.correlationId === correlationId && !visited.has(e.eventId)) {
        walk(e.eventId);
      }
    }
  }
  walk(rootEventId);

  const steps: CausalStep[] = [];
  for (const e of ordered) {
    let kind: CausalStep["kind"] = "action";
    let text = "";
    switch (e.type) {
      case "MoveRequested": kind = "intention"; text = "Намерение двигаться"; break;
      case "GiveRequested": kind = "intention"; text = "Намерение"; break;
      case "MovementSucceeded": kind = "action"; text = "Путь свободен"; break;
      case "MovementBlocked": kind = "action"; text = "Путь преграждён"; break;
      case "ActionValidated": case "GiveValidated": kind = "action"; text = "Действие"; break;
      case "ObservationUpdated": kind = "observation"; text = "Мир заметил твой поступок"; break;
      case "ConsequenceCreated": case "ConsequenceFired":
      case "AudacityTriggered": kind = "consequence"; text = "Последствие проявилось"; break;
      case "TickPassed": kind = "action"; text = "Время идёт"; break;
      case "RelationChanged": kind = "action"; text = "Отношения изменились"; break;
      default: continue;
    }
    steps.push({ kind, text, sourceEventIds: [e.eventId] });
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

export function buildGameShellSnapshot(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  characterProfile: CharacterProfileRecord | null,
  worldId: string,
): GameShellSnapshot {
  const discovery = buildDiscoveryJournal(events);
  const journal = buildTurnJournal(events);
  const guidance = buildPlayerGuidance(events, world);

  // Last turn
  let lastTurn: PlayerTurnView | null = null;
  if (journal.turns.length > 0) {
    const latestTurn = journal.turns[journal.turns.length - 1]!;
    const pres = latestTurn.presentation;
    const chain = buildCausalChain(events, latestTurn.worldTime);

    // Discovery signals: only those with evidence at this turn's worldTime
    const signals = discovery.cards
      .filter((c) => c.evidence.some((ev) => ev.worldTime === latestTurn.worldTime))
      .map((c) => ({
        stage: c.stage,
        title: c.title,
        text: c.summary,
        discoveryId: c.discoveryId,
      }));

    lastTurn = {
      turnId: latestTurn.turnId,
      worldTime: latestTurn.worldTime,
      primary: pres.primary,
      notable: pres.notable,
      background: pres.background,
      causalChain: chain,
      discoverySignals: signals,
    };
  }

  // Recent activity: last 5 entries, classify scope/origin from template kind
  const activity: WorldActivityItem[] = [];
  for (const turn of [...journal.turns].reverse()) {
    for (const entry of [...turn.presentation.background, ...turn.presentation.notable]) {
      activity.push({
        kind: entry.kind,
        text: entry.text,
        timestamp: turn.worldTime,
        scope: classifyScope(entry.kind, entry.importance),
        origin: classifyOrigin(entry.kind),
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

  // Activity for shell delta: last 3 background entries
  const activity: WorldActivityItem[] = [];
  for (const t of [...journal.turns].reverse()) {
    for (const entry of [...t.presentation.background, ...t.presentation.notable]) {
      activity.push({
        kind: entry.kind,
        text: entry.text,
        timestamp: t.worldTime,
        scope: classifyScope(entry.kind, entry.importance),
        origin: classifyOrigin(entry.kind),
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
