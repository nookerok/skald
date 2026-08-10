import type { DomainEvent } from "@skald/event-bus";
import type { RegionDefinition, RegionLandmark, RegionLocation, SpatialRelation, SpatialWorldProjection, SpatialReadView, TravelRelation, RiverProcessDefinition, HydrographyDefinition, ElevationDefinition, RegionToponymIndex, RiverState, RiverBand, CrossingDefinition, CrossingState, CrossingCondition } from "./types.js";

function classifyRiverBand(level: number, process: RiverProcessDefinition): RiverBand {
  const ratio = (level - process.minimumLevel) / (process.maximumLevel - process.minimumLevel);
  if (ratio <= 0.25) return "low";
  if (ratio <= 0.5) return "normal";
  if (ratio <= 0.75) return "high";
  return "flood";
}

function classifyCrossingCondition(level: number, def: CrossingDefinition): CrossingCondition {
  if (level > def.closedAbove) return "closed";
  if (level > def.openAtOrBelow) return "difficult";
  return "open";
}

function computeCrossingTravelTicks(condition: CrossingCondition, base: number): number {
  if (condition === "closed") return Infinity;
  if (condition === "difficult") return base + 2;
  return base;
}

export class SpatialProjector {
  private region: RegionDefinition | null = null;
  private readonly locations = new Map<string, RegionLocation>();
  private readonly landmarks = new Map<string, RegionLandmark>();
  private readonly relations = new Map<string, SpatialRelation>();
  private readonly travelRelations = new Map<string, TravelRelation>();
  private readonly riverProcesses = new Map<string, RiverProcessDefinition>();
  private readonly riverStates = new Map<string, RiverState>();
  private readonly crossingDefinitions = new Map<string, CrossingDefinition>();
  private readonly crossingStates = new Map<string, CrossingState>();
  private hydrography: HydrographyDefinition | null = null;
  private elevation: ElevationDefinition | null = null;
  private toponymIndex: RegionToponymIndex | null = null;

  apply(event: DomainEvent): void {
    if (event.type === "RegionDefined") {
      this.region = (event.payload as { region: RegionDefinition }).region;
      this.hydrography = this.region.hydrography ?? null;
      this.elevation = this.region.elevation ?? null;
      this.toponymIndex = this.region.toponymIndex ?? null;
      this.locations.clear();
      this.landmarks.clear();
      this.relations.clear();
      this.travelRelations.clear();
      for (const location of this.region.locations) this.locations.set(location.id, location);
      for (const landmark of this.region.landmarks) this.landmarks.set(landmark.id, landmark);
      for (const relation of this.region.relations) this.relations.set(relation.id, relation);
    }
    if (event.type === "TravelMetadataAttached") {
      const p = event.payload as {
        relationId: string;
        kind: "road" | "crossing" | "river" | "visibility";
        fromId: string;
        toId: string;
        distanceMetres: number;
        baseTravelTicks: number;
        terrainCost: number;
        passability: "open" | "blocked";
      };
      this.travelRelations.set(p.relationId, {
        id: p.relationId,
        kind: p.kind,
        fromId: p.fromId,
        toId: p.toId,
        distanceMetres: p.distanceMetres,
        baseTravelTicks: p.baseTravelTicks,
        terrainCost: p.terrainCost,
        passability: p.passability,
      });
    }
    if (event.type === "RiverProcessDefined") {
      const p = event.payload as RiverProcessDefinition;
      this.riverProcesses.set(p.processId, p);
      // Initialize river state at baseline
      if (!this.riverStates.has(p.watercourseId)) {
        const band = classifyRiverBand(p.baselineLevel, p);
        this.riverStates.set(p.watercourseId, {
          watercourseId: p.watercourseId,
          level: p.baselineLevel,
          band,
          updatedAt: event.timestamp,
        });
      }
    }
    if (event.type === "RiverLevelChanged") {
      const p = event.payload as { watercourseId: string; level: number; band: RiverBand; changedAt: number };
      this.riverStates.set(p.watercourseId, {
        watercourseId: p.watercourseId,
        level: p.level,
        band: p.band,
        updatedAt: p.changedAt,
      });
      // Crossing states are updated by CrossingConditionChanged events
      // emitted by the crossingCondition rule — not here.
    }
    if (event.type === "CrossingConditionInitialized") {
      const p = event.payload as CrossingDefinition;
      this.crossingDefinitions.set(p.crossingId, p);
      // Initialize crossing state
      const riverState = this.riverStates.get(p.watercourseId);
      const level = riverState?.level ?? p.openAtOrBelow;
      const condition = classifyCrossingCondition(level, p);
      const travelTicks = computeCrossingTravelTicks(condition, p.baseTravelCostTicks);
      this.crossingStates.set(p.crossingId, {
        crossingId: p.crossingId,
        condition,
        travelCostTicks: travelTicks,
        updatedAt: event.timestamp,
      });
    }
    if (event.type === "CrossingConditionChanged") {
      const p = event.payload as { crossingId: string; condition: CrossingCondition; travelCostTicks: number; changedAt: number };
      this.crossingStates.set(p.crossingId, {
        crossingId: p.crossingId,
        condition: p.condition,
        travelCostTicks: p.travelCostTicks,
        updatedAt: p.changedAt,
      });
    }
  }

  /** Replace the projection from an existing snapshot (used by WorldProjector.clone).
   *  Accepts a full SpatialWorldProjection or a Rule-facing SpatialReadView. */
  seed(snapshot: SpatialWorldProjection | SpatialReadView | null): void {
    this.region = null;
    this.locations.clear();
    this.landmarks.clear();
    this.relations.clear();
    this.travelRelations.clear();
    this.riverProcesses.clear();
    this.riverStates.clear();
    this.crossingDefinitions.clear();
    this.crossingStates.clear();
    this.hydrography = null;
    this.elevation = null;
    this.toponymIndex = null;
    if (!snapshot) return;
    const full = snapshot as SpatialWorldProjection;
    if (full.region) this.region = full.region;
    this.hydrography = full.hydrography ?? full.region?.hydrography ?? null;
    this.elevation = full.elevation ?? full.region?.elevation ?? null;
    this.toponymIndex = full.toponymIndex ?? full.region?.toponymIndex ?? null;
    for (const [id, value] of full.locations ?? []) this.locations.set(id, value);
    for (const [id, value] of full.landmarks ?? []) this.landmarks.set(id, value);
    for (const [id, value] of full.relations ?? []) this.relations.set(id, value);
    for (const [id, value] of snapshot.travelRelations) this.travelRelations.set(id, value);
    for (const [id, value] of snapshot.riverProcesses) this.riverProcesses.set(id, value);
    for (const [id, value] of snapshot.riverStates) this.riverStates.set(id, value);
    for (const [id, value] of snapshot.crossingDefinitions) this.crossingDefinitions.set(id, value);
    for (const [id, value] of snapshot.crossingStates) this.crossingStates.set(id, value);
  }

  getSnapshot(): SpatialWorldProjection {
    return Object.freeze({
      region: this.region,
      locations: new Map(this.locations),
      landmarks: new Map(this.landmarks),
      relations: new Map(this.relations),
      travelRelations: new Map(this.travelRelations),
      riverProcesses: new Map(this.riverProcesses),
      riverStates: new Map(this.riverStates),
      crossingDefinitions: new Map(this.crossingDefinitions),
      crossingStates: new Map(this.crossingStates),
      hydrography: this.hydrography,
      elevation: this.elevation,
      toponymIndex: this.toponymIndex,
    });
  }
}

/** Rebuilds spatial truth from the canonical Event Log only. */
export function buildSpatialWorldProjection(events: readonly DomainEvent[]): SpatialWorldProjection {
  const projector = new SpatialProjector();
  for (const event of events) projector.apply(event);
  return projector.getSnapshot();
}
