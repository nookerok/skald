import type { DomainEvent } from "@skald/event-bus";
import type { ReadonlyWorld } from "./projection.js";

export interface NarrativeEntry {
  readonly kind: "action" | "observation" | "consequence" | "situation" | "world" | "tick";
  readonly timestamp: number;
  readonly text: string;
  readonly sourceEventIds: readonly string[];
}

export interface NarrativeSnapshot {
  readonly entries: readonly NarrativeEntry[];
  readonly worldTime: number;
  readonly playerPosition: { readonly x: number; readonly y: number };
}

const OBSERVATION_KEYS = new Set(["risk_taken", "wall_caution", "edge_awareness", "impatience", "world_reaction_fear"]);

export function formatEvent(event: DomainEvent): NarrativeEntry | null {
  const base = { timestamp: event.timestamp, sourceEventIds: [event.eventId] as readonly string[] };

  switch (event.type) {
    case "MovementSucceeded": {
      const { x, y } = event.payload as { x: number; y: number };
      return { ...base, kind: "action", text: `Ты перемещаешься на позицию (${x}, ${y}).` };
    }
    case "MovementBlocked": {
      const { reason } = event.payload as { reason: string };
      if (reason === "wall") return { ...base, kind: "action", text: "Ты уткнулся в стену." };
      if (reason === "boundary") return { ...base, kind: "action", text: "Ты достиг края мира — дальше пути нет." };
      return { ...base, kind: "action", text: `Ты не можешь туда пойти (${reason}).` };
    }
    case "ActionRejected": {
      const { reason } = event.payload as { reason: string };
      if (reason === "insufficient_time") {
        return { ...base, kind: "action", text: "Ты уже действовал в этом мгновенье — нужно подождать." };
      }
      return { ...base, kind: "action", text: `Действие отклонено: ${reason}.` };
    }
    case "CommandRejected": {
      return { ...base, kind: "action", text: "Мир не понял твоего намерения." };
    }
    case "ObservationUpdated": {
      const { key, delta } = event.payload as { key: string; delta: number };
      let change: string;
      if (typeof delta === "number") {
        if (delta === 1) change = "возросло на 1";
        else if (delta === -1) change = "убыло на 1";
        else change = `изменилось на ${delta}`;
      } else {
        change = `изменилось на ${delta}`;
      }
      return { ...base, kind: "observation", text: `Мир заметил: ${key} ${change}.` };
    }
    case "ConsequenceCreated": {
      const p = event.payload as { type: string; expiresAt: number };
      return { ...base, kind: "consequence", text: `Твоё поведение породило последствие: ${p.type} (живёт до тика ${p.expiresAt}).` };
    }
    case "ConsequenceExpired": {
      return null;
    }
    case "ConsequenceFired": {
      const p = event.payload as { consequenceType: string };
      return { ...base, kind: "consequence", text: `Последствие ${p.consequenceType} сработало.` };
    }
    case "AudacityTriggered": {
      const p = event.payload as { severity: number };
      return { ...base, kind: "consequence", text: `Мир среагировал на твою дерзость — страх растёт (сила ${p.severity}).` };
    }
    case "SituationStarted": {
      const p = event.payload as { type: string; duration: number };
      return { ...base, kind: "situation", text: `Начинается ситуация: ${p.type} (продлится ${p.duration} тиков).` };
    }
    case "SituationEnded": {
      const p = event.payload as { situationId: string };
      return { ...base, kind: "situation", text: `Ситуация ${p.situationId} завершилась.` };
    }
    case "ForestFireStarted": {
      return { ...base, kind: "situation", text: "Лесной пожар начался." };
    }
    case "TreeBurned": {
      const p = event.payload as { treeIndex: number };
      return { ...base, kind: "situation", text: `Сгорело дерево #${p.treeIndex}.` };
    }
    case "RelationChanged": {
      const p = event.payload as { kind: string; to: string; delta: number };
      return { ...base, kind: "world", text: `Твоё отношение '${p.kind}' к '${p.to}' изменилось на ${p.delta}.` };
    }
    case "HeatRadiated": {
      const p = event.payload as { x: number; y: number; delta: number };
      return { ...base, kind: "world", text: `Тепло распространяется: клетка (${p.x}, ${p.y}) нагрелась на ${p.delta}.` };
    }
    case "TickPassed": {
      const p = event.payload as { playerOffline?: boolean };
      if (p.playerOffline) {
        return { ...base, kind: "tick", text: "Время идёт без тебя..." };
      }
      return null;
    }
    default:
      return null;
  }
}

export function formatWorldState(world: ReadonlyWorld): NarrativeEntry[] {
  const entries: NarrativeEntry[] = [];
  const timestamp = world.time;

  entries.push({
    kind: "world",
    timestamp,
    text: `Ты находишься на позиции (${world.player.x}, ${world.player.y}).`,
    sourceEventIds: [],
  });

  for (const [key, value] of world.observations) {
    if (OBSERVATION_KEYS.has(key) && value > 0) {
      entries.push({
        kind: "world",
        timestamp,
        text: `Мир замечает в тебе: ${key} = ${value}.`,
        sourceEventIds: [],
      });
    }
  }

  for (const c of world.consequences.values()) {
    entries.push({
      kind: "world",
      timestamp,
      text: `Тебя тяготит: ${c.type} (истекает в тике ${c.expiresAt}).`,
      sourceEventIds: [],
    });
  }

  for (const f of world.firedConsequences.values()) {
    entries.push({
      kind: "world",
      timestamp,
      text: `Мир помнит: ${f.consequenceType} уже сработало.`,
      sourceEventIds: [],
    });
  }

  for (const s of world.activeSituations.values()) {
    entries.push({
      kind: "world",
      timestamp,
      text: `В мире активна ситуация: ${s.type}.`,
      sourceEventIds: [],
    });
  }

  if (world.burnedTrees > 0) {
    entries.push({
      kind: "world",
      timestamp,
      text: `Сожжено деревьев: ${world.burnedTrees}.`,
      sourceEventIds: [],
    });
  }

  const sortedHeat = [...world.heatMap.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [key, value] of sortedHeat) {
    entries.push({
      kind: "world",
      timestamp,
      text: `Клетка (${key}) нагрета: ${value}.`,
      sourceEventIds: [],
    });
  }

  for (const r of world.relations.values()) {
    entries.push({
      kind: "world",
      timestamp,
      text: `Твоё отношение '${r.kind}' к '${r.to}': ${r.value}.`,
      sourceEventIds: [],
    });
  }

  return entries;
}

export function buildNarrative(
  events: readonly DomainEvent[],
  world: ReadonlyWorld,
  opts?: { sinceTick?: number },
): NarrativeSnapshot {
  const filtered = opts?.sinceTick !== undefined
    ? events.filter((e) => e.timestamp >= opts.sinceTick!)
    : events;

  const indexed: Array<{ entry: NarrativeEntry; order: number }> = [];
  let order = 0;

  for (const event of filtered) {
    const entry = formatEvent(event);
    if (entry !== null) {
      indexed.push({ entry, order: order++ });
    }
  }

  const worldOrder = order;
  const worldEntries = formatWorldState(world);
  for (const we of worldEntries) {
    indexed.push({ entry: we, order: worldOrder });
  }

  indexed.sort((a, b) => {
    const tsDiff = a.entry.timestamp - b.entry.timestamp;
    if (tsDiff !== 0) return tsDiff;
    return a.order - b.order;
  });

  const entries = indexed.map((i) => i.entry);

  return {
    entries,
    worldTime: world.time,
    playerPosition: { x: world.player.x, y: world.player.y },
  };
}
