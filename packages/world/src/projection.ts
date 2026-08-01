import type { DomainEvent } from "@skald/event-bus";
import type { ProjectionStore } from "@skald/rule-engine";
import { START_POSITION, wallKey } from "./map.js";
import type { WorldObject, Location } from "./objects/types.js";
import { applyObjectEvent, cloneObjectState } from "./objects/projector.js";
import type { CriticalCheckState } from "./checks/types.js";
import type { Entity, EntityComponents } from "./entities/types.js";

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
  // Iteration 15 — Objects & Locations
  readonly objects: ReadonlyMap<string, WorldObject>;
  readonly locations: ReadonlyMap<string, Location>;
  readonly currentLocationId: string;
  // Iteration 15 — Pending critical checks (for crash recovery)
  readonly pendingChecks: ReadonlyMap<string, CriticalCheckState>;
  // World Interaction Model — additive generic entity read model
  readonly entities: ReadonlyMap<string, Entity>;
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
  // Iteration 15 — Objects & Locations
  objects: Map<string, WorldObject>;
  locations: Map<string, Location>;
  currentLocationId: string;
  // Iteration 15 — Pending critical checks (for crash recovery)
  pendingChecks: Map<string, CriticalCheckState>;
  // World Interaction Model — additive generic entity read model
  entities: Map<string, Entity>;
}

function deepCloneConsequence(c: Consequence): Consequence {
  return Object.freeze({ ...c, data: Object.freeze({ ...c.data }) });
}

function deepCloneFired(f: FiredConsequence): FiredConsequence {
  return Object.freeze({ ...f });
}

function deepCloneSituation(s: ActiveSituation): ActiveSituation {
  return Object.freeze({ ...s, data: Object.freeze({ ...s.data }) });
}

function deepCloneRelation(r: RelationEdge): RelationEdge {
  return Object.freeze({ ...r });
}

function deepCloneHeatSource(hs: HeatSource): HeatSource {
  return Object.freeze({ ...hs });
}

function deepCloneUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(deepCloneUnknown));
  if (value !== null && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = deepCloneUnknown(item);
    return Object.freeze(copy);
  }
  return value;
}

function deepCloneWorldObject(object: WorldObject): WorldObject {
  return Object.freeze({ ...object, state: deepCloneUnknown(object.state) as Readonly<Record<string, unknown>> });
}

function deepCloneLocation(location: Location): Location {
  return Object.freeze({
    ...location,
    objectIds: Object.freeze([...location.objectIds]),
    connections: deepCloneUnknown(location.connections) as Readonly<Record<string, string>>,
  });
}

function deepCloneCriticalCheck(check: CriticalCheckState): CriticalCheckState {
  return Object.freeze({
    ...check,
    modifiers: Object.freeze(check.modifiers.map((modifier) => Object.freeze({ ...modifier }))),
    stakes: Object.freeze({ ...check.stakes }),
  });
}

function deepCloneStrategyEntry(e: StrategyEntry): StrategyEntry {
  return Object.freeze({ ...e });
}

function deepCloneComponents(components: EntityComponents): EntityComponents {
  return Object.freeze({
    material: components.material ? Object.freeze({ ...components.material }) : undefined,
    thermal: components.thermal ? Object.freeze({ ...components.thermal }) : undefined,
    physical: components.physical ? Object.freeze({ ...components.physical }) : undefined,
    relation: components.relation
      ? Object.freeze({ ...components.relation, relationIds: Object.freeze([...components.relation.relationIds]) })
      : undefined,
    inventory: components.inventory
      ? Object.freeze({ ...components.inventory, itemIds: Object.freeze([...components.inventory.itemIds]) })
      : undefined,
  });
}

function deepCloneEntity(entity: Entity): Entity {
  return Object.freeze({
    ...entity,
    aliases: Object.freeze([...entity.aliases]),
    components: deepCloneComponents(entity.components),
  });
}

/** Frozen immutable Map. Mutating methods throw TypeError at runtime.
 *  Uses a regular Map as backing store for construction, then freeze + proxy
 *  to block mutations while preserving structural equality. */
function cloneMap<V>(src: Map<string, V>): ReadonlyMap<string, V> {
  const clone = new Map(src);
  return new Proxy(clone, {
    get(t, p: string | symbol) {
      if (p === "set" || p === "delete" || p === "clear") return () => { throw new TypeError("immutable"); };
      const v = Reflect.get(t, p);
      return typeof v === "function" ? v.bind(t) : v;
    },
  }) as ReadonlyMap<string, V>;
}

function cloneSet(src: Set<string>): ReadonlySet<string> {
  const clone = new Set(src);
  return new Proxy(clone, {
    get(t, p: string | symbol) {
      if (p === "add" || p === "delete" || p === "clear") return () => { throw new TypeError("immutable"); };
      const v = Reflect.get(t, p);
      return typeof v === "function" ? v.bind(t) : v;
    },
  }) as ReadonlySet<string>;
}

function freeze(state: WorldState): ReadonlyWorld {
  return Object.freeze({
    player: Object.freeze({ ...state.player }),
    walls: cloneSet(state.walls),
    observations: cloneMap(state.observations),
    consequences: cloneMap(new Map([...state.consequences].map(([k, c]) => [k, deepCloneConsequence(c)]))),
    firedConsequences: cloneMap(new Map([...state.firedConsequences].map(([k, f]) => [k, deepCloneFired(f)]))),
    activeSituations: cloneMap(new Map([...state.activeSituations].map(([k, s]) => [k, deepCloneSituation(s)]))),
    burnedTrees: state.burnedTrees,
    relations: cloneMap(new Map([...state.relations].map(([k, r]) => [k, deepCloneRelation(r)]))),
    heatSources: cloneMap(new Map([...state.heatSources].map(([k, h]) => [k, deepCloneHeatSource(h)]))),
    heatMap: cloneMap(state.heatMap),
    lastActionTick: state.lastActionTick,
    strategy: Object.freeze([...state.strategy.map(deepCloneStrategyEntry)]),
    eventNumber: state.eventNumber,
    time: state.time,
    // Iteration 15 — Objects & Locations
    objects: cloneMap(new Map([...state.objects].map(([id, object]) => [id, deepCloneWorldObject(object)]))),
    locations: cloneMap(new Map([...state.locations].map(([id, location]) => [id, deepCloneLocation(location)]))),
    currentLocationId: state.currentLocationId,
    // Iteration 15 — Pending critical checks
    pendingChecks: cloneMap(new Map([...state.pendingChecks].map(([id, check]) => [id, deepCloneCriticalCheck(check)]))),
    entities: cloneMap(new Map([...state.entities].map(([id, entity]) => [id, deepCloneEntity(entity)]))),
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
      // Iteration 15 — Objects & Locations
      objects: new Map<string, WorldObject>(),
      locations: new Map<string, Location>(),
      currentLocationId: "",
      // Iteration 15 — Pending critical checks
      pendingChecks: new Map<string, CriticalCheckState>(),
      entities: new Map<string, Entity>(),
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
      case "EntityExamined": {
        // The factual outcome consumes the action budget; gate events do not.
        s.lastActionTick = event.timestamp;
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
      case "ObjectPlaced": {
        const p = event.payload as {
          entityId: string;
          x: number;
          y: number;
          name: string;
          aliases: string[];
          description: string;
          components: EntityComponents;
        };
        s.entities.set(p.entityId, {
          id: p.entityId,
          x: p.x,
          y: p.y,
          name: p.name,
          aliases: [...p.aliases],
          description: p.description,
          components: deepCloneComponents(p.components),
        });
        break;
      }
      // Iteration 15 — Object & Location events
      case "WorldObjectPlaced":
      case "LocationDefined":
      case "PlayerLocationChanged":
      case "ObjectTemperatureChanged":
      case "ObjectIntegrityChanged":
      case "PassageOpened": {
        applyObjectEvent(s as unknown as { objects: Map<string, WorldObject>; locations: Map<string, Location>; currentLocationId: string }, event);
        break;
      }
      // Iteration 15 — Critical check tracking for crash recovery
      case "CriticalCheckRequested": {
        const p = event.payload as {
          checkId: string;
          actionEventId: string;
          checkKind: string;
          die: string;
          difficulty: number;
          modifiers: Array<{ label: string; delta: number }>;
          stakes: { success: string; failure: string };
          targetObjectId: string;
          targetObjectName: string;
          locationId: string;
        };
        s.pendingChecks.set(p.checkId, {
          checkId: p.checkId,
          actionEventId: p.actionEventId,
          checkKind: p.checkKind as CriticalCheckState["checkKind"],
          die: p.die as CriticalCheckState["die"],
          difficulty: p.difficulty,
          modifiers: p.modifiers,
          stakes: p.stakes,
          targetObjectId: p.targetObjectId,
          targetObjectName: p.targetObjectName,
          locationId: p.locationId,
          rolled: false,
        });
        break;
      }
      case "CriticalCheckRolled":
      case "CriticalCheckResolved": {
        const p = event.payload as { checkId: string };
        s.pendingChecks.delete(p.checkId);
        break;
      }
      default:
        break;
    }
  }

  clone(): ProjectionStore<ReadonlyWorld> {
    const copy = new WorldProjector();
    const cloned = cloneObjectState({
      objects: new Map(this.state.objects),
      locations: new Map(this.state.locations),
      currentLocationId: this.state.currentLocationId,
    });
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
      objects: cloned.objects,
      locations: cloned.locations,
      currentLocationId: cloned.currentLocationId,
      pendingChecks: new Map(this.state.pendingChecks),
      entities: new Map([...this.state.entities].map(([id, entity]) => [id, deepCloneEntity(entity)])),
    };
    return copy;
  }
}

export function rebuildProjection(events: readonly DomainEvent[]): WorldProjector {
  const p = new WorldProjector();
  for (const e of events) p.apply(e);
  return p;
}
