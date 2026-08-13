import type { DomainEvent } from "@skald/event-bus";
import type { ResourceAmount, ResourceHoldingState, ResourceNodeDefinition, ResourceNodeState, ResourceDemandDefinition, ResourceDemandState, ResourceProcessDefinition, ResourceProcessState, ResourceQualityBand, ResourceReadView } from "./types.js";

function freezeState(state: ResourceNodeState): ResourceNodeState { return Object.freeze({ ...state }); }
function cloneMap<V>(source: ReadonlyMap<string, V>): ReadonlyMap<string, V> {
  const copy = new Map(source);
  return new Proxy(copy, { get(target, property: string | symbol) { if (property === "set" || property === "delete" || property === "clear") return () => { throw new TypeError("immutable"); }; const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; } }) as ReadonlyMap<string, V>;
}
function frozenAmounts(amounts: readonly ResourceAmount[]): readonly ResourceAmount[] { return Object.freeze(amounts.map((amount) => Object.freeze({ ...amount }))); }

/** Event-sourced projection for definitions, stock, holdings and production processes. */
export class ResourceProjector {
  private readonly definitions = new Map<string, ResourceNodeDefinition>();
  private readonly states = new Map<string, ResourceNodeState>();
  private readonly holdings = new Map<string, ResourceHoldingState>();
  private readonly processDefinitions = new Map<string, ResourceProcessDefinition>();
  private readonly processes = new Map<string, ResourceProcessState>();
  private readonly demandDefinitions = new Map<string, ResourceDemandDefinition>();
  private readonly demandStates = new Map<string, ResourceDemandState>();

  private static holdingKey(ownerId: string, resourceKind: string, quality: ResourceQualityBand): string { return `${ownerId}|${resourceKind}|${quality}`; }

  private changeHolding(ownerId: string, resourceKind: string, quality: ResourceQualityBand, delta: number, timestamp: number): void {
    const key = ResourceProjector.holdingKey(ownerId, resourceKind, quality);
    const previous = this.holdings.get(key);
    const amountUnits = Math.max(0, (previous?.amountUnits ?? 0) + delta);
    if (amountUnits === 0) { this.holdings.delete(key); return; }
    this.holdings.set(key, Object.freeze({ ownerId, resourceKind, quality, amountUnits, lastChangedWorldTime: timestamp }));
  }

  private hasHolding(ownerId: string, amount: ResourceAmount): boolean {
    return (this.holdings.get(ResourceProjector.holdingKey(ownerId, amount.resourceKind, amount.quality))?.amountUnits ?? 0) >= amount.amountUnits;
  }

  apply(event: DomainEvent): void {
    switch (event.type) {
      case "ResourceNodeDefined": {
        const definition = event.payload as ResourceNodeDefinition;
        if (this.definitions.has(definition.id)) return;
        this.definitions.set(definition.id, Object.freeze({
          ...definition,
          extractionMethods: Object.freeze(definition.extractionMethods.map((method) => Object.freeze({ ...method, ...(method.requiredInstruments ? { requiredInstruments: Object.freeze([...method.requiredInstruments]) } : {}) }))),
          regeneration: definition.regeneration ? Object.freeze({ ...definition.regeneration, blockedBy: Object.freeze([...definition.regeneration.blockedBy]) }) : null,
          canonicalRefs: Object.freeze([...definition.canonicalRefs]),
        }));
        this.states.set(definition.id, freezeState({ nodeId: definition.id, stockUnits: definition.initialStockUnits, depleted: definition.initialStockUnits <= 0, lastChangedWorldTime: event.timestamp }));
        break;
      }
      case "ResourceDemandDefined": {
        const definition = event.payload as ResourceDemandDefinition;
        if (this.demandDefinitions.has(definition.id)) return;
        this.demandDefinitions.set(definition.id, Object.freeze({ ...definition, canonicalRefs: Object.freeze([...definition.canonicalRefs]) }));
        this.demandStates.set(definition.id, Object.freeze({ demandId: definition.id, lastEvaluatedWorldTime: event.timestamp, shortageActive: false }));
        break;
      }
      case "ResourceShortageStarted": {
        const payload = event.payload as { demandId: string };
        const previous = this.demandStates.get(payload.demandId);
        if (previous) this.demandStates.set(payload.demandId, Object.freeze({ ...previous, shortageActive: true, lastEvaluatedWorldTime: event.timestamp }));
        break;
      }
      case "ResourceShortageEnded": {
        const payload = event.payload as { demandId: string };
        const previous = this.demandStates.get(payload.demandId);
        if (previous) this.demandStates.set(payload.demandId, Object.freeze({ ...previous, shortageActive: false, lastEvaluatedWorldTime: event.timestamp }));
        break;
      }
      case "ResourceProcessDefined": {
        const definition = event.payload as ResourceProcessDefinition;
        if (this.processDefinitions.has(definition.id)) return;
        this.processDefinitions.set(definition.id, Object.freeze({ ...definition, inputs: frozenAmounts(definition.inputs), outputs: frozenAmounts(definition.outputs), canonicalRefs: Object.freeze([...definition.canonicalRefs]) }));
        break;
      }
      case "ResourceExtracted": {
        const payload = event.payload as { nodeId: string; amountUnits: number; actorId?: string };
        const definition = this.definitions.get(payload.nodeId);
        const previous = this.states.get(payload.nodeId);
        if (!definition || !previous) return;
        const amount = Math.max(0, Math.min(payload.amountUnits, previous.stockUnits));
        this.states.set(payload.nodeId, freezeState({ nodeId: payload.nodeId, stockUnits: previous.stockUnits - amount, depleted: previous.stockUnits - amount <= 0, lastChangedWorldTime: event.timestamp }));
        if (payload.actorId && amount > 0) this.changeHolding(payload.actorId, definition.resourceKind, definition.quality, amount, event.timestamp);
        break;
      }
      case "ResourceTransferred": {
        const payload = event.payload as { fromOwnerId: string; toOwnerId: string; resourceKind: string; quality: ResourceQualityBand; amountUnits: number };
        if (payload.amountUnits <= 0 || payload.fromOwnerId === payload.toOwnerId) return;
        const sourceKey = ResourceProjector.holdingKey(payload.fromOwnerId, payload.resourceKind, payload.quality);
        const source = this.holdings.get(sourceKey);
        const amount = Math.min(payload.amountUnits, source?.amountUnits ?? 0);
        if (amount <= 0) return;
        this.changeHolding(payload.fromOwnerId, payload.resourceKind, payload.quality, -amount, event.timestamp);
        this.changeHolding(payload.toOwnerId, payload.resourceKind, payload.quality, amount, event.timestamp);
        break;
      }
      case "ResourceConsumed": {
        const payload = event.payload as { ownerId: string; resourceKind: string; quality: ResourceQualityBand; amountUnits: number };
        if (payload.amountUnits <= 0) return;
        const source = this.holdings.get(ResourceProjector.holdingKey(payload.ownerId, payload.resourceKind, payload.quality));
        const amount = Math.min(payload.amountUnits, source?.amountUnits ?? 0);
        if (amount > 0) this.changeHolding(payload.ownerId, payload.resourceKind, payload.quality, -amount, event.timestamp);
        break;
      }
      case "ResourceProcessStarted": {
        const payload = event.payload as { processId: string; ownerId: string; completesAt: number };
        const definition = this.processDefinitions.get(payload.processId);
        if (!definition || this.processes.has(payload.processId) || definition.inputs.some((amount) => !this.hasHolding(payload.ownerId, amount))) return;
        for (const amount of definition.inputs) this.changeHolding(payload.ownerId, amount.resourceKind, amount.quality, -amount.amountUnits, event.timestamp);
        this.processes.set(payload.processId, Object.freeze({ processId: payload.processId, ownerId: payload.ownerId, startedAt: event.timestamp, completesAt: payload.completesAt, inputs: frozenAmounts(definition.inputs), status: "active" }));
        break;
      }
      case "ResourceProcessCompleted": {
        const payload = event.payload as { processId: string; ownerId: string };
        const definition = this.processDefinitions.get(payload.processId);
        const state = this.processes.get(payload.processId);
        if (!definition || !state || state.status !== "active" || state.ownerId !== payload.ownerId) return;
        for (const amount of definition.outputs) this.changeHolding(payload.ownerId, amount.resourceKind, amount.quality, amount.amountUnits, event.timestamp);
        this.processes.delete(payload.processId);
        break;
      }
      case "ResourceRegenerated": {
        const payload = event.payload as { nodeId: string; amountUnits: number };
        const definition = this.definitions.get(payload.nodeId);
        const previous = this.states.get(payload.nodeId);
        if (!definition || !previous) return;
        const amount = Math.max(0, Math.min(payload.amountUnits, definition.capacityUnits - previous.stockUnits));
        this.states.set(payload.nodeId, freezeState({ nodeId: payload.nodeId, stockUnits: previous.stockUnits + amount, depleted: previous.stockUnits + amount <= 0, lastChangedWorldTime: event.timestamp }));
        break;
      }
      case "ResourceRegenerationBlocked": {
        const payload = event.payload as { nodeId: string };
        const previous = this.states.get(payload.nodeId);
        if (previous) this.states.set(payload.nodeId, freezeState({ ...previous, lastChangedWorldTime: event.timestamp }));
        break;
      }
      default: break;
    }
  }

  getSnapshot(): ResourceReadView { return Object.freeze({ definitions: cloneMap(this.definitions), states: cloneMap(this.states), holdings: cloneMap(this.holdings), processDefinitions: cloneMap(this.processDefinitions), processes: cloneMap(this.processes), demandDefinitions: cloneMap(this.demandDefinitions), demandStates: cloneMap(this.demandStates) }); }

  seed(view: ResourceReadView | null): void {
    this.definitions.clear(); this.states.clear(); this.holdings.clear(); this.processDefinitions.clear(); this.processes.clear(); this.demandDefinitions.clear(); this.demandStates.clear();
    if (!view) return;
    for (const [id, definition] of view.definitions) this.definitions.set(id, definition);
    for (const [id, state] of view.states) this.states.set(id, state);
    for (const [id, holding] of view.holdings) this.holdings.set(id, holding);
    for (const [id, definition] of view.processDefinitions) this.processDefinitions.set(id, definition);
    for (const [id, process] of view.processes) this.processes.set(id, process);
    for (const [id, definition] of view.demandDefinitions) this.demandDefinitions.set(id, definition);
    for (const [id, state] of view.demandStates) this.demandStates.set(id, state);
  }
}
