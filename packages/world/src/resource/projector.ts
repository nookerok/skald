import type { DomainEvent } from "@skald/event-bus";
import type { ResourceNodeDefinition, ResourceNodeState, ResourceReadView } from "./types.js";

function freezeState(state: ResourceNodeState): ResourceNodeState {
  return Object.freeze({ ...state });
}

function cloneMap<V>(source: ReadonlyMap<string, V>): ReadonlyMap<string, V> {
  const copy = new Map(source);
  return new Proxy(copy, {
    get(target, property: string | symbol) {
      if (property === "set" || property === "delete" || property === "clear") return () => { throw new TypeError("immutable"); };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ReadonlyMap<string, V>;
}

/** Event-sourced projection for resource definitions and stock. */
export class ResourceProjector {
  private readonly definitions = new Map<string, ResourceNodeDefinition>();
  private readonly states = new Map<string, ResourceNodeState>();

  apply(event: DomainEvent): void {
    switch (event.type) {
      case "ResourceNodeDefined": {
        const definition = event.payload as ResourceNodeDefinition;
        if (this.definitions.has(definition.id)) return;
        this.definitions.set(definition.id, Object.freeze({
          ...definition,
          extractionMethods: Object.freeze(definition.extractionMethods.map((method) => Object.freeze({ ...method }))),
          regeneration: definition.regeneration ? Object.freeze({ ...definition.regeneration, blockedBy: Object.freeze([...definition.regeneration.blockedBy]) }) : null,
          canonicalRefs: Object.freeze([...definition.canonicalRefs]),
        }));
        this.states.set(definition.id, freezeState({
          nodeId: definition.id,
          stockUnits: definition.initialStockUnits,
          depleted: definition.initialStockUnits <= 0,
          lastChangedWorldTime: event.timestamp,
        }));
        break;
      }
      case "ResourceExtracted": {
        const payload = event.payload as { nodeId: string; amountUnits: number };
        const definition = this.definitions.get(payload.nodeId);
        const previous = this.states.get(payload.nodeId);
        if (!definition || !previous) return;
        const amount = Math.max(0, Math.min(payload.amountUnits, previous.stockUnits));
        this.states.set(payload.nodeId, freezeState({
          nodeId: payload.nodeId,
          stockUnits: previous.stockUnits - amount,
          depleted: previous.stockUnits - amount <= 0,
          lastChangedWorldTime: event.timestamp,
        }));
        break;
      }
      case "ResourceRegenerated": {
        const payload = event.payload as { nodeId: string; amountUnits: number };
        const definition = this.definitions.get(payload.nodeId);
        const previous = this.states.get(payload.nodeId);
        if (!definition || !previous) return;
        const amount = Math.max(0, Math.min(payload.amountUnits, definition.capacityUnits - previous.stockUnits));
        this.states.set(payload.nodeId, freezeState({
          nodeId: payload.nodeId,
          stockUnits: previous.stockUnits + amount,
          depleted: previous.stockUnits + amount <= 0,
          lastChangedWorldTime: event.timestamp,
        }));
        break;
      }
      default:
        break;
    }
  }

  getSnapshot(): ResourceReadView {
    return Object.freeze({ definitions: cloneMap(this.definitions), states: cloneMap(this.states) });
  }

  seed(view: ResourceReadView | null): void {
    this.definitions.clear();
    this.states.clear();
    if (!view) return;
    for (const [id, definition] of view.definitions) this.definitions.set(id, definition);
    for (const [id, state] of view.states) this.states.set(id, state);
  }
}
