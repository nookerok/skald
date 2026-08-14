import type { DomainEvent } from "@skald/event-bus";
import type {
  ActionCapabilityReadView,
  Affordance,
  EpistemicClaim,
  ItemDefinition,
  ItemPlacement,
  ProficiencyEvidence,
  SubjectCondition,
} from "./types.js";

type State = {
  itemDefinitions: Map<string, ItemDefinition>;
  placements: Map<string, ItemPlacement>;
  owners: Map<string, string>;
  conditions: Map<string, SubjectCondition>;
  knowledge: Map<string, Set<string>>;
  proficiencyEvidence: ProficiencyEvidence[];
  claims: Map<string, EpistemicClaim>;
};

function initialState(): State {
  return {
    itemDefinitions: new Map(),
    placements: new Map(),
    owners: new Map(),
    conditions: new Map(),
    knowledge: new Map(),
    proficiencyEvidence: [],
    claims: new Map(),
  };
}

function cloneValue<T>(value: T): T {
  if (value instanceof Set) return frozenSet(value) as T;
  if (value instanceof Map) return frozenMap(value as unknown as ReadonlyMap<string, unknown>) as T;
  if (Array.isArray(value)) return Object.freeze(value.map(cloneValue)) as T;
  if (value !== null && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) copy[key] = cloneValue(nested);
    return Object.freeze(copy) as T;
  }
  return value;
}

function frozenMap<V>(source: ReadonlyMap<string, V>): ReadonlyMap<string, V> {
  const clone = new Map<string, V>([...source].map(([key, value]) => [key, cloneValue(value)]));
  return new Proxy(clone, {
    get(target, property: PropertyKey) {
      if (["set", "delete", "clear"].includes(String(property))) return () => { throw new TypeError("immutable"); };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ReadonlyMap<string, V>;
}

function frozenSet(source: ReadonlySet<string>): ReadonlySet<string> {
  const clone = new Set(source);
  return new Proxy(clone, {
    get(target, property: PropertyKey) {
      if (["add", "delete", "clear"].includes(String(property))) return () => { throw new TypeError("immutable"); };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ReadonlySet<string>;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function affordanceArray(value: unknown): readonly Affordance[] {
  return stringArray(value) as readonly Affordance[];
}

function placement(value: unknown): ItemPlacement | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as { kind?: unknown; locationId?: unknown; holderId?: unknown; containerId?: unknown };
  if (candidate.kind === "location" && typeof candidate.locationId === "string") return { kind: "location", locationId: candidate.locationId };
  if (candidate.kind === "carried" && typeof candidate.holderId === "string") return { kind: "carried", holderId: candidate.holderId };
  if (candidate.kind === "container" && typeof candidate.containerId === "string") return { kind: "container", containerId: candidate.containerId };
  return null;
}

export class ActionCapabilityProjector {
  private state = initialState();

  apply(event: DomainEvent): void {
    const p = event.payload as Record<string, unknown>;
    switch (event.type) {
      case "WorldObjectPlaced": {
        const authored = p.state !== null && typeof p.state === "object" ? p.state as Record<string, unknown> : {};
        const read = (key: string): unknown => p[key] ?? authored[key];
        const mass = typeof read("mass") === "number" ? read("mass") as number : 0;
        const portable = read("portable") === true || read("collectible") === true;
        const capacity = typeof read("containerCapacityMass") === "number"
          ? read("containerCapacityMass") as number
          : typeof read("containerCapacity") === "number"
            ? read("containerCapacity") as number
            : null;
        const itemId = String(p.id);
        this.state.itemDefinitions.set(itemId, {
          itemId,
          mass,
          portable,
          affordances: affordanceArray(read("affordances")),
          containerCapacityMass: capacity,
        });
        if (typeof p.locationId === "string") this.state.placements.set(itemId, { kind: "location", locationId: p.locationId });
        break;
      }
      case "ItemMoved": {
        const next = placement(p.to);
        if (next) this.state.placements.set(String(p.itemId), next);
        break;
      }
      case "ItemPossessionChanged": {
        const ownerId = p.ownerId;
        if (typeof ownerId === "string" && ownerId.length > 0) this.state.owners.set(String(p.itemId), ownerId);
        else this.state.owners.delete(String(p.itemId));
        break;
      }
      case "ConditionApplied":
        this.state.conditions.set(String(p.conditionId), {
          conditionId: String(p.conditionId),
          subjectId: String(p.subjectId),
          kind: String(p.kind),
          blockedAffordances: affordanceArray(p.blockedAffordances),
          unavailableTechniques: stringArray(p.unavailableTechniques),
        });
        break;
      case "ConditionRemoved":
        this.state.conditions.delete(String(p.conditionId));
        break;
      case "KnowledgeAcquired": {
        const subjectId = String(p.subjectId);
        const known = this.state.knowledge.get(subjectId) ?? new Set<string>();
        known.add(String(p.knowledgeId));
        this.state.knowledge.set(subjectId, known);
        break;
      }
      case "ProficiencyEvidenceRecorded":
        const evidence: ProficiencyEvidence = {
          evidenceId: String(p.evidenceId),
          subjectId: String(p.subjectId),
          affordance: p.affordance as ProficiencyEvidence["affordance"],
          techniqueId: typeof p.techniqueId === "string" ? p.techniqueId : null,
          contextTags: stringArray(p.contextTags),
          outcome: p.outcome === "not_achieved" ? "not_achieved" : "achieved",
        };
        if (typeof p.sourceEventId === "string") this.state.proficiencyEvidence.push({ ...evidence, sourceEventId: p.sourceEventId });
        else this.state.proficiencyEvidence.push(evidence);
        break;
      case "TestimonyReceived":
        this.state.claims.set(String(p.claimId), {
          claimId: String(p.claimId),
          observerId: String(p.observerId),
          sourceId: typeof p.sourceId === "string" ? p.sourceId : null,
          ...(typeof p.sourceEventId === "string" ? { sourceEventId: p.sourceEventId } : {}),
          proposition: String(p.proposition),
          status: "testimony_only",
          evidenceIds: [],
          receivedAt: typeof p.receivedAt === "number" ? p.receivedAt : event.timestamp,
        });
        break;
      case "EpistemicEvidenceRecorded": {
        const claimId = String(p.claimId);
        const status = p.relation === "contradicts" ? "contradicted" : "supported";
        const evidenceId = String(p.evidenceId);
        const claim = this.state.claims.get(claimId);
        if (!claim) {
          this.state.claims.set(claimId, {
            claimId,
            observerId: typeof p.observerId === "string" ? p.observerId : "player",
            sourceId: null,
            ...(typeof p.sourceObservationEventId === "string" ? { sourceEventId: p.sourceObservationEventId } : {}),
            proposition: typeof p.proposition === "string" ? p.proposition : claimId,
            status,
            evidenceIds: [evidenceId],
            receivedAt: event.timestamp,
          });
          break;
        }
        this.state.claims.set(claim.claimId, {
          ...claim,
          status,
          evidenceIds: [...claim.evidenceIds, evidenceId],
        });
        break;
      }
      default:
        break;
    }
  }

  getSnapshot(): ActionCapabilityReadView {
    return Object.freeze({
      itemDefinitions: frozenMap(this.state.itemDefinitions),
      placements: frozenMap(this.state.placements),
      owners: frozenMap(this.state.owners),
      conditions: frozenMap(this.state.conditions),
      knowledge: frozenMap(new Map([...this.state.knowledge].map(([id, values]) => [id, frozenSet(values)]))),
      proficiencyEvidence: Object.freeze(this.state.proficiencyEvidence.map((item) => cloneValue(item))),
      claims: frozenMap(this.state.claims),
    });
  }

  seed(snapshot: ActionCapabilityReadView | null): void {
    this.state = snapshot ? {
      itemDefinitions: new Map([...snapshot.itemDefinitions].map(([key, value]) => [key, cloneValue(value)])),
      placements: new Map([...snapshot.placements].map(([key, value]) => [key, cloneValue(value)])),
      owners: new Map(snapshot.owners),
      conditions: new Map([...snapshot.conditions].map(([key, value]) => [key, cloneValue(value)])),
      knowledge: new Map([...snapshot.knowledge].map(([key, values]) => [key, new Set(values)])),
      proficiencyEvidence: snapshot.proficiencyEvidence.map((item) => cloneValue(item)),
      claims: new Map([...snapshot.claims].map(([key, value]) => [key, cloneValue(value)])),
    } : initialState();
  }
}
