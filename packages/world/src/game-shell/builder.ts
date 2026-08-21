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
import { buildObservedResources } from "../resource/observer.js";
import { spatialKnowledgeRank } from "../region/observer-knowledge.js";

interface CharacterProfileRecord {
  display_name: string;
  wound: string;
  promise: string;
  principle: string;
  background_id?: string | null;
}

const ACTIVITY_ORIGIN: Record<string, ActivityOrigin> = {
  TickPassed: "world_tick",
  ConsequenceFired: "consequence",
};

const ACTIVITY_SCOPE: Record<string, PlayerFacingScope> = {
  TickPassed: "known",
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
    (e.type === "MoveRequested" || e.type === "GiveRequested" || e.type === "ActionAttempted" || e.type === "JourneyRequested" || e.type === "JourneyStarted" || e.type === "TickPassed"));
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
      case "ActionAttempted": text = "Ты формулируешь намерение: " + operationLabel(p.operation) + "."; break;
      case "JourneyRequested": text = "Ты выбираешь путь к «" + (typeof p.destination === "string" ? p.destination : "новому месту") + "».";
        break;
      case "JourneyStarted": text = "Путь начался. Мир потребует времени и нескольких тяжёлых этапов."; break;
      case "JourneyBlocked": text = typeof p.playerText === "string" ? p.playerText : "Путь пока не складывается."; break;
      case "JourneyCompleted": text = "Путешествие завершено."; break;
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
      kind: event.type === "MoveRequested" || event.type === "GiveRequested" || event.type === "ActionAttempted" || event.type === "JourneyRequested" || event.type === "JourneyStarted" ? "intention"
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

function buildJourneyView(world: ReadonlyWorld): import("./types.js").JourneyView {
  const journeys = [...world.journeys.values()].sort((a, b) => a.startedAt - b.startedAt);
  const journey = (world.activeJourneyId ? world.journeys.get(world.activeJourneyId) : undefined) ?? journeys.at(-1);
  if (!journey) {
    return {
      status: "idle",
      from: null,
      to: null,
      elapsedTicks: 0,
      totalTicks: 0,
      text: "\u041f\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u0435 \u043d\u0430\u0447\u043d\u0451\u0442\u0441\u044f, \u043a\u043e\u0433\u0434\u0430 \u0442\u044b \u0432\u044b\u0431\u0435\u0440\u0435\u0448\u044c \u043f\u0443\u0442\u044c.",
    };
  }
  const from = world.locations.get(journey.fromLocationId)?.name ?? null;
  const to = world.locations.get(journey.toLocationId)?.name ?? null;
  if (journey.status === "active") {
    return {
      status: "traveling",
      from,
      to,
      elapsedTicks: journey.elapsedTicks,
      totalTicks: journey.plannedTicks,
      text: to
        ? "\u0422\u044b \u0432 \u043f\u0443\u0442\u0438 \u043a \u00ab" + to + "\u00bb."
        : "\u0422\u044b \u0432 \u043f\u0443\u0442\u0438.",
    };
  }
  if (journey.status === "interrupted") {
    return {
      status: "interrupted",
      from,
      to,
      elapsedTicks: journey.elapsedTicks,
      totalTicks: journey.plannedTicks,
      text: "Путь прерван. Ты сохранил знание только о пройденном участке.",
    };
  }
  return {
    status: "completed",
    from,
    to,
    elapsedTicks: journey.plannedTicks,
    totalTicks: journey.plannedTicks,
    text: to
      ? "\u0422\u044b \u0434\u043e\u0431\u0440\u0430\u043b\u0441\u044f \u0434\u043e \u00ab" + to + "\u00bb."
      : "\u041f\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u043e.",
  };
}

function buildWorldContextView(world: ReadonlyWorld): WorldContextView {
  const playerKey = `${world.player.x},${world.player.y}`;
  const heatLevel = world.heatMap.get(playerKey) ?? 0;

  // Iteration 15 — Location info
  const locationId = world.currentLocationId;
  const location = locationId ? world.locations.get(locationId) : undefined;

  const connectedLocations: Array<{ id: string; label: string; detail?: string }> = [];
  const knownRoutes: Array<{ label: string; detail?: string; status?: "open" | "difficult" | "blocked" }> = [];
  if (location && !world.spatial) {
    for (const [, connTarget] of Object.entries(location.connections)) {
      const connLoc = world.locations.get(connTarget);
      if (connLoc) {
        connectedLocations.push({ id: connLoc.id, label: connLoc.name, detail: connLoc.description });
      }
    }
  }
  // Travel destinations from the spatial read view (ADR-0015): roads,
  // crossings and rivers leaving the current location become real options the
  // player can act on, with the crossing condition surfaced honestly.
  if (world.spatial && locationId) {
    const seen = new Set(connectedLocations.map((c) => c.id));
    for (const relation of world.spatial.travelRelations.values()) {
      if (relation.passability === "blocked") continue;
      const targetId = relation.fromId === locationId ? relation.toId : relation.toId === locationId ? relation.fromId : null;
      if (!targetId || seen.has(targetId)) continue;
      const target = world.locations.get(targetId);
      if (!target) continue;
      const observation = world.spatialKnowledge?.relations.get(relation.id);
      if (!observation || spatialKnowledgeRank(observation.knowledge) < spatialKnowledgeRank("observed")) continue;
      const crossing = relation.kind === "crossing"
        ? world.spatial.crossingStates.get(relation.id) ?? [...world.spatial.crossingStates.values()].find((c) => c.crossingId === relation.id)
        : undefined;
      const status = crossing?.condition === "closed" ? "blocked" as const : crossing?.condition === "difficult" ? "difficult" as const : "open" as const;
      let detail = target.description;
      if (crossing?.condition === "closed") detail = "Переправа закрыта из-за высокой воды.";
      else if (crossing?.condition === "difficult") detail = "Переправа трудная — путь будет медленным.";
      // Only explicitly known relations are safe to expose as an available route.
      knownRoutes.push({ label: target.name, detail, status });
      connectedLocations.push({ id: targetId, label: target.name, detail });
      seen.add(targetId);
    }
  }
  if (knownRoutes.length === 0 && !world.spatial) {
    for (const connected of connectedLocations) knownRoutes.push({ label: connected.label, ...(connected.detail ? { detail: connected.detail } : {}), status: "open" });
  }

  return {
    position: { x: world.player.x, y: world.player.y },
    heatLevel,
    heatDescription: heatLevel > 0 ? "Тепло ощущается здесь." : null,
    locationId: locationId || undefined,
    locationName: location?.name,
    locationDescription: location?.description,
    connectedLocations: connectedLocations.length > 0 ? connectedLocations : undefined,
    knownRoutes: knownRoutes.length > 0 ? knownRoutes : undefined,
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

function buildRegionTitle(events: readonly DomainEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "RegionDefined") continue;
    const region = (event.payload as { region?: { name?: unknown } } | undefined)?.region;
    return typeof region?.name === "string" && region.name.trim().length > 0 ? region.name : undefined;
  }
  return undefined;
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

  const regionTitle = buildRegionTitle(events);
  return deepFreeze({
    schemaVersion: 1 as const,
    ...(regionTitle ? { regionTitle } : {}),
    worldId,
    revision: { worldTime: world.time, eventNumber: world.eventNumber },
    character: buildCharacterView(characterProfile, world),
    world: buildWorldContextView(world),
    currentSituation: buildSituationView(world),
    journey: buildJourneyView(world),
    attention: buildAttentionView(world, events),
    lastTurn,
    recentActivity: activity,
    knowledge: buildKnowledgeSummary(beliefModel),
    beliefModel: serializeBeliefModel(beliefModel),
    suggestions: guidance.suggestions,
    resources: buildObservedResources(world),
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
    journey: buildJourneyView(world),
    attention: buildAttentionView(world, events),
    activity,
    knowledge: buildKnowledgeSummary(beliefModel),
    beliefModel: serializeBeliefModel(beliefModel),
    suggestions: guidance.suggestions,
    resources: buildObservedResources(world),
  });
}
