import type { DomainEvent } from "@skald/event-bus";
import type { ProjectionStore } from "@skald/rule-engine";
import { START_POSITION, wallKey } from "./map.js";

export interface Consequence {
  readonly id: string;
  readonly type: string;
  readonly severity: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface FiredConsequence {
  readonly consequenceId: string;
  readonly consequenceType: string;
  readonly firedAt: number;
}

export interface ActiveSituation {
  readonly situationId: string;
  readonly type: string;
  readonly startedAt: number;
  readonly duration: number;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface RelationEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly value: number;
}

export interface StrategyEntry {
  readonly condition: string;
  readonly action: string;
}

export interface HeatSource {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly intensity: number;
  readonly placedAt: number;
}

export function relationKey(from: string, to: string, kind: string): string {
  return `${from}>${to}:${kind}`;
}

export interface ReadonlyWorld {
  readonly player: { readonly x: number; readonly y: number };
  readonly walls: ReadonlySet<string>;
  readonly observations: ReadonlyMap<string, number>;
  readonly consequences: ReadonlyMap<string, Consequence>;
  readonly firedConsequences: ReadonlyMap<string, FiredConsequence>;
  readonly activeSituations: ReadonlyMap<string, ActiveSituation>;
  readonly burnedTrees: number;
  readonly relations: ReadonlyMap<string, RelationEdge>;
  readonly heatSources: ReadonlyMap<string, HeatSource>;
  readonly heatMap: ReadonlyMap<string, number>;
  readonly lastActionTick: number;
  readonly strategy: readonly StrategyEntry[];
  readonly eventNumber: number;
  readonly time: number;
}

export interface WorldState {
  player: { x: number; y: number };
  walls: Set<string>;
  observations: Map<string, number>;
  consequences: Map<string, Consequence>;
  firedConsequences: Map<string, FiredConsequence>;
  activeSituations: Map<string, ActiveSituation>;
  burnedTrees: number;
  relations: Map<string, RelationEdge>;
  heatSources: Map<string, HeatSource>;
  heatMap: Map<string, number>;
  lastActionTick: number;
  strategy: StrategyEntry[];
  eventNumber: number;
  time: number;
}

function freeze(state: WorldState): ReadonlyWorld {
  return Object.freeze({
    player: Object.freeze({ ...state.player }),
    walls: state.walls,
    observations: state.observations,
    consequences: state.consequences,
    firedConsequences: state.firedConsequences,
    activeSituations: state.activeSituations,
    burnedTrees: state.burnedTrees,
    relations: state.relations,
    heatSources: state.heatSources,
    heatMap: state.heatMap,
    lastActionTick: state.lastActionTick,
    strategy: state.strategy,
    eventNumber: state.eventNumber,
    time: state.time,
  }) as ReadonlyWorld;
}

export class WorldProjector implements ProjectionStore<ReadonlyWorld> {
  private state: WorldState;

  constructor() {
    this.state = {
      player: { ...START_POSITION },
      walls: new Set<string>(),
      observations: new Map<string, number>(),
      consequences: new Map<string, Consequence>(),
      firedConsequences: new Map<string, FiredConsequence>(),
      activeSituations: new Map<string, ActiveSituation>(),
      burnedTrees: 0,
      relations: new Map<string, RelationEdge>(),
      heatSources: new Map<string, HeatSource>(),
      heatMap: new Map<string, number>(),
      lastActionTick: 0,
      strategy: [],
      eventNumber: 0,
      time: 0,
    };
  }

  getSnapshot(): ReadonlyWorld {
    return freeze(this.state);
  }

  apply(event: DomainEvent): void {
    const s = this.state;
    s.eventNumber = s.eventNumber + 1;
    s.time = event.timestamp;

    switch (event.type) {
      case "PlayerSpawned": {
        const p = event.payload as { x: number; y: number };
        s.player = { x: p.x, y: p.y };
        break;
      }
      case "WallPlaced": {
        const p = event.payload as { x: number; y: number };
        s.walls.add(wallKey(p.x, p.y));
        break;
      }
      case "MovementSucceeded": {
        const p = event.payload as { x: number; y: number };
        s.player = { x: p.x, y: p.y };
        s.lastActionTick = event.timestamp;
        break;
      }
      case "MovementBlocked": {
        s.lastActionTick = event.timestamp;
        break;
      }
      case "ObservationUpdated": {
        const { key, delta } = event.payload as { key: string; delta: number };
        s.observations.set(key, (s.observations.get(key) ?? 0) + delta);
        break;
      }
      case "ConsequenceCreated": {
        const c = event.payload as Consequence;
        s.consequences.set(c.id, c);
        break;
      }
      case "ConsequenceExpired": {
        const { id } = event.payload as { id: string };
        s.consequences.delete(id);
        break;
      }
      case "ConsequenceFired": {
        const f = event.payload as FiredConsequence;
        s.firedConsequences.set(f.consequenceId, f);
        break;
      }
      case "SituationStarted": {
        const p = event.payload as ActiveSituation;
        s.activeSituations.set(p.situationId, p);
        break;
      }
      case "SituationEnded": {
        const { situationId } = event.payload as { situationId: string };
        s.activeSituations.delete(situationId);
        break;
      }
      case "TreeBurned": {
        s.burnedTrees++;
        break;
      }
      case "RelationChanged": {
        const p = event.payload as { from: string; to: string; kind: string; delta: number };
        s.lastActionTick = event.timestamp;
        const key = relationKey(p.from, p.to, p.kind);
        const existing = s.relations.get(key);
        const newValue = existing ? existing.value + p.delta : p.delta;
        if (newValue === 0) {
          s.relations.delete(key);
        } else {
          s.relations.set(key, { from: p.from, to: p.to, kind: p.kind, value: newValue });
        }
        break;
      }
      case "HeatSourcePlaced": {
        const p = event.payload as { x: number; y: number; intensity: number };
        const key = wallKey(p.x, p.y);
        s.heatSources.set(key, {
          id: event.eventId,
          x: p.x,
          y: p.y,
          intensity: p.intensity,
          placedAt: event.timestamp,
        });
        break;
      }
      case "HeatRadiated": {
        const p = event.payload as { x: number; y: number; delta: number };
        const key = wallKey(p.x, p.y);
        s.heatMap.set(key, (s.heatMap.get(key) ?? 0) + p.delta);
        break;
      }
      case "StrategySet": {
        s.strategy = (event.payload as { entries: StrategyEntry[] }).entries;
        break;
      }
      default:
        break;
    }
  }

  clone(): ProjectionStore<ReadonlyWorld> {
    const copy = new WorldProjector();
    copy.state = {
      player: { ...this.state.player },
      walls: new Set(this.state.walls),
      observations: new Map(this.state.observations),
      consequences: new Map(this.state.consequences),
      firedConsequences: new Map(this.state.firedConsequences),
      activeSituations: new Map(this.state.activeSituations),
      burnedTrees: this.state.burnedTrees,
      relations: new Map(this.state.relations),
      heatSources: new Map(this.state.heatSources),
      heatMap: new Map(this.state.heatMap),
      lastActionTick: this.state.lastActionTick,
      strategy: [...this.state.strategy],
      eventNumber: this.state.eventNumber,
      time: this.state.time,
    };
    return copy;
  }
}

export function rebuildProjection(events: readonly DomainEvent[]): WorldProjector {
  const p = new WorldProjector();
  for (const e of events) p.apply(e);
  return p;
}
