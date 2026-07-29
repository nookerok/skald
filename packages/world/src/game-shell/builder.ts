import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "../projection.js";
import type { GameShellSnapshot, ShellDelta, WorldContextView, CausalStep, PlayerTurnView, WorldActivityItem } from "./types.js";
import { buildTurnJournal } from "../journal/builder.js";
import { buildDiscoveryJournal, deepFreeze } from "../discovery/builder.js";
import { buildPlayerGuidance } from "../guidance/selector.js";
import { buildCharacterView } from "./character-view.js";
import { buildSituationView } from "./situation-view.js";
import { buildAttentionView } from "./attention-view.js";
import { buildKnowledgeSummary } from "./knowledge-view.js";

function buildCausalChain(events: readonly DomainEvent[], worldTime: number): CausalStep[] {
  const steps: CausalStep[] = [];
  for (const e of events) {
    if (e.timestamp !== worldTime) continue;
    switch (e.type) {
      case "MoveRequested": case "GiveRequested":
        steps.push({ kind: "intention", text: "Намерение", sourceEventIds: [e.eventId] }); break;
      case "MovementSucceeded": case "MovementBlocked": case "ActionValidated": case "GiveValidated":
        steps.push({ kind: "action", text: "Действие", sourceEventIds: [e.eventId] }); break;
      case "ObservationUpdated":
        steps.push({ kind: "observation", text: "Наблюдение", sourceEventIds: [e.eventId] }); break;
      case "ConsequenceCreated": case "ConsequenceFired": case "AudacityTriggered":
        steps.push({ kind: "consequence", text: "Последствие", sourceEventIds: [e.eventId] }); break;
    }
  }
  return steps;
}

function buildWorldContextView(world: ReadonlyWorld): WorldContextView {
  let heatLevel = 0;
  const playerKey = `${world.player.x},${world.player.y}`;
  heatLevel = world.heatMap.get(playerKey) ?? 0;
  return {
    position: { x: world.player.x, y: world.player.y },
    heatLevel,
    heatDescription: heatLevel > 0 ? "Тепло ощущается здесь." : null,
  };
}

export function buildGameShellSnapshot(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  characterProfile: { display_name: string; wound: string; promise: string; principle: string } | null,
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
    const signals = discovery.cards.map((c) => ({
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

  // Recent activity (last 5 background entries)
  const activity: WorldActivityItem[] = [];
  for (const turn of [...journal.turns].reverse()) {
    for (const entry of turn.presentation.background) {
      activity.push({
        kind: entry.kind,
        text: entry.text,
        timestamp: turn.worldTime,
        scope: "visible",
        origin: "world_tick",
      });
      if (activity.length >= 5) break;
    }
    if (activity.length >= 5) break;
  }

  return deepFreeze({
    schemaVersion: 1 as const,
    worldId,
    revision: { worldTime: world.time, eventNumber: world.eventNumber },
    character: buildCharacterView(characterProfile),
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
    turn = {
      turnId: latest.turnId,
      worldTime: latest.worldTime,
      primary: latest.presentation.primary,
      notable: latest.presentation.notable,
      background: latest.presentation.background,
      causalChain: buildCausalChain(events, latest.worldTime),
      discoverySignals: discovery.cards.map((c) => ({
        stage: c.stage, title: c.title, text: c.summary, discoveryId: c.discoveryId,
      })),
    };
  }

  return deepFreeze({
    revision: { worldTime: world.time, eventNumber: world.eventNumber },
    turn,
    currentSituation: buildSituationView(world),
    attention: buildAttentionView(world),
    activity: [],
    knowledgeChanges: buildKnowledgeSummary(discovery),
    suggestions: guidance.suggestions,
  });
}
