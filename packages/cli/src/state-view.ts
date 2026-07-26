import type { App } from "./index.js";

export interface JsonWorldState {
  player: { x: number; y: number };
  worldTime: number;
  eventNumber: number;
  lastActionTick: number;
  observations: Record<string, number>;
  consequences: Array<{ id: string; type: string; severity: number; expiresAt: number }>;
  activeSituations: Array<{ situationId: string; type: string; startedAt: number; duration: number }>;
  burnedTrees: number;
  relations: Array<{ from: string; to: string; kind: string; value: number }>;
  heatSources: Array<{ x: number; y: number; intensity: number }>;
  heatMap: Record<string, number>;
  walls: string[];
  strategy: Array<{ condition: string; action: string }>;
  routerAvailable: boolean;
}

export function serializeWorldState(app: App): JsonWorldState {
  const world = app.projection.getSnapshot();
  const routerAvail = app.router !== null && app.router.apiKey.length > 0;
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
    routerAvailable: routerAvail,
  };
}
