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

export interface ReadonlyWorld {
  readonly player: { readonly x: number; readonly y: number };
  readonly walls: ReadonlySet<string>;
  readonly observations: ReadonlyMap<string, number>;
  readonly consequences: ReadonlyMap<string, Consequence>;
  readonly eventNumber: number;
  readonly time: number;
}

export interface WorldState {
  player: { x: number; y: number };
  walls: Set<string>;
  observations: Map<string, number>;
  consequences: Map<string, Consequence>;
  eventNumber: number;
  time: number;
}

function freeze(state: WorldState): ReadonlyWorld {
  return Object.freeze({
    player: Object.freeze({ ...state.player }),
    walls: state.walls,
    observations: state.observations,
    consequences: state.consequences,
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
