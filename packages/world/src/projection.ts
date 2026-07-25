import type { DomainEvent } from "@skald/event-bus";
import type { ProjectionStore } from "@skald/rule-engine";
import { START_POSITION, wallKey } from "./map.js";

/**
 * ReadonlyWorld — the read-only view Rules receive.
 *
 * Enforced in dev/test via Object.freeze on the snapshot passed to Rules
 * (AGENTS invariant #3 / "Гарантия иммутабельности World"). A Rule must not
 * mutate this object; the freeze surfaces violations early in tests.
 */
export interface ReadonlyWorld {
  readonly player: { readonly x: number; readonly y: number };
  readonly walls: ReadonlySet<string>;
  readonly observations: ReadonlyMap<string, number>;
  readonly eventNumber: number;
  readonly time: number;
}

export interface WorldState {
  player: { x: number; y: number };
  walls: Set<string>;
  observations: Map<string, number>;
  eventNumber: number;
  time: number;
}

function freeze(state: WorldState): ReadonlyWorld {
  return Object.freeze({
    player: Object.freeze({ ...state.player }),
    walls: state.walls,
    observations: state.observations,
    eventNumber: state.eventNumber,
    time: state.time,
  }) as ReadonlyWorld;
}

/**
 * WorldProjector — the ONLY thing allowed to produce a new World state
 * (AGENTS invariant #2: Projection Purity). Every field here is fully
 * reproducible by replaying the canonical Event Log from scratch.
 *
 * For MVP-0 it handles: PlayerSpawned, WallPlaced, MovementSucceeded.
 * Everything else is a no-op (but still increments eventNumber/time so the
 * technical version tracks every committed event).
 *
 * NB: the constructor seeds `player` with START_POSITION as a default for
 * an EMPTY log; in real use `commitBootstrap` writes PlayerSpawned/WallPlaced
 * into the canonical log before any command, so this default is never visible
 * — the projection is always derived from events. Kept only so a fresh
 * projector is constructible without a log.
 */
export class WorldProjector implements ProjectionStore<ReadonlyWorld> {
  private state: WorldState;

  constructor() {
    this.state = {
      player: { ...START_POSITION },
      walls: new Set<string>(),
      observations: new Map<string, number>(),
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
      eventNumber: this.state.eventNumber,
      time: this.state.time,
    };
    return copy;
  }
}

/**
 * Helper used by callers that want to rebuild a projection from an arbitrary
 * Event Log (the Projection Purity CI test). Creates a fresh projector and
 * applies every event in order.
 */
export function rebuildProjection(events: readonly DomainEvent[]): WorldProjector {
  const p = new WorldProjector();
  for (const e of events) p.apply(e);
  return p;
}