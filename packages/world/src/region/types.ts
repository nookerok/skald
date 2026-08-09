/** Canonical spatial authoring and backend projection contracts for the pilot region. */

export type TerrainSurface = "water" | "soil" | "rock" | "marsh" | "forest";

export interface SpatialPoint {
  readonly xMetres: number;
  readonly yMetres: number;
}

export interface SpatialBounds {
  readonly minXMetres: number;
  readonly minYMetres: number;
  readonly maxXMetres: number;
  readonly maxYMetres: number;
}

export interface TerrainTile {
  readonly id: string;
  readonly bounds: SpatialBounds;
  readonly elevationBand: number;
  readonly surface: TerrainSurface;
  readonly slopeBand: number;
}

export interface SimulationCell {
  readonly id: string;
  readonly bounds: SpatialBounds;
  readonly neighbourIds: readonly string[];
}

export interface RegionLocation {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly anchor: SpatialPoint;
  readonly footprintTileIds: readonly string[];
}

export interface RegionLandmark {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly anchor: SpatialPoint;
  readonly elevationMetres: number;
  readonly silhouetteClass: "city" | "ruin" | "crater" | "monolith" | "mountain" | "waterfall";
}

export type SpatialRelationKind = "road" | "river" | "crossing" | "visibility";

export interface SpatialRelation {
  readonly id: string;
  readonly kind: SpatialRelationKind;
  readonly fromId: string;
  readonly toId: string;
  readonly label: string;
  readonly points: readonly SpatialPoint[];
}

export interface RegionDefinition {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly contentDigest: string;
  readonly bounds: SpatialBounds;
  readonly terrainTileSizeMetres: number;
  readonly simulationCellSizeMetres: number;
  readonly tiles: readonly TerrainTile[];
  readonly cells: readonly SimulationCell[];
  readonly locations: readonly RegionLocation[];
  readonly landmarks: readonly RegionLandmark[];
  readonly relations: readonly SpatialRelation[];
}

export interface RegionDefinedPayload {
  readonly region: RegionDefinition;
}

export type SpatialKnowledge = "rumored" | "glimpsed" | "observed" | "traversed";

export interface SpatialObservationPayload {
  readonly subjectKind: "location" | "landmark" | "relation";
  readonly subjectId: string;
  readonly knowledge: SpatialKnowledge;
  readonly observedAt: number;
  readonly confidence: number;
  readonly bearing?: string;
}

export interface TravelRelation {
  readonly id: string;
  readonly kind: "road" | "crossing" | "river" | "visibility";
  readonly fromId: string;
  readonly toId: string;
  readonly distanceMetres: number;
  readonly baseTravelTicks: number;
  readonly terrainCost: number;
  readonly passability: "open" | "blocked";
}

export type RiverBand = "low" | "normal" | "high" | "flood";

export type CrossingCondition = "open" | "difficult" | "closed";

export interface RiverProcessDefinition {
  readonly processId: string;
  readonly watercourseId: string;
  readonly baselineLevel: number;
  readonly minimumLevel: number;
  readonly maximumLevel: number;
  readonly cycleLengthTicks: number;
  readonly phaseOffset: number;
  readonly riseRate: number;
  readonly fallRate: number;
}

export interface RiverState {
  readonly watercourseId: string;
  readonly level: number;
  readonly band: RiverBand;
  readonly updatedAt: number;
}

export interface CrossingDefinition {
  readonly crossingId: string;
  readonly watercourseId: string;
  readonly openAtOrBelow: number;
  readonly difficultAtOrBelow: number;
  readonly closedAbove: number;
  readonly baseTravelCostTicks: number;
}

export interface CrossingState {
  readonly crossingId: string;
  readonly condition: CrossingCondition;
  readonly travelCostTicks: number;
  readonly updatedAt: number;
}

/**
 * Read-only view of spatial data exposed to Rules.
 * This is the public contract — Rules read through this interface,
 * never through SpatialWorldProjection directly.
 */
export interface SpatialReadView {
  readonly riverProcesses: ReadonlyMap<string, RiverProcessDefinition>;
  readonly riverStates: ReadonlyMap<string, RiverState>;
  readonly crossingDefinitions: ReadonlyMap<string, CrossingDefinition>;
  readonly crossingStates: ReadonlyMap<string, CrossingState>;
  readonly travelRelations: ReadonlyMap<string, TravelRelation>;
}

export interface SpatialWorldProjection extends SpatialReadView {
  readonly region: RegionDefinition | null;
  readonly locations: ReadonlyMap<string, RegionLocation>;
  readonly landmarks: ReadonlyMap<string, RegionLandmark>;
  readonly relations: ReadonlyMap<string, SpatialRelation>;
  readonly travelRelations: ReadonlyMap<string, TravelRelation>;
  readonly riverProcesses: ReadonlyMap<string, RiverProcessDefinition>;
  readonly riverStates: ReadonlyMap<string, RiverState>;
  readonly crossingDefinitions: ReadonlyMap<string, CrossingDefinition>;
  readonly crossingStates: ReadonlyMap<string, CrossingState>;
}

export interface ObserverMapDTO {
  readonly schemaVersion: 1;
  readonly revision: { readonly worldTime: number; readonly eventNumber: number };
  readonly region: { readonly ref: string; readonly name: string } | null;
  readonly observer: { readonly locationRef: string | null; readonly xMetres: number | null; readonly yMetres: number | null };
  readonly knownArea: SpatialBounds | null;
  readonly locations: readonly ObserverMapLocation[];
  readonly landmarks: readonly ObserverMapLandmark[];
  readonly routes: readonly ObserverMapRoute[];
}

export interface ObserverMapLocation {
  readonly ref: string;
  readonly name: string;
  readonly knowledge: SpatialKnowledge;
  readonly confidence: number;
  readonly freshness: number;
  readonly xMetres: number;
  readonly yMetres: number;
}

export interface ObserverMapLandmark {
  readonly ref: string;
  readonly name: string;
  readonly silhouette: RegionLandmark["silhouetteClass"];
  readonly knowledge: SpatialKnowledge;
  readonly confidence: number;
  readonly freshness: number;
  readonly xMetres: number | null;
  readonly yMetres: number | null;
  readonly bearing: string | null;
}

export interface ObserverMapPoint {
  readonly xMetres: number;
  readonly yMetres: number;
}

export type ObserverMapRouteGeometry =
  | { readonly kind: "observed_path"; readonly points: readonly ObserverMapPoint[] }
  | { readonly kind: "directional_stub"; readonly bearing: string }
  | null;

export interface ObserverMapRoute {
  readonly ref: string;
  readonly kind: SpatialRelationKind;
  readonly label: string;
  readonly fromLocationRef: string;
  readonly toLocationRef: string;
  readonly knowledge: SpatialKnowledge;
  readonly confidence: number;
  readonly freshness: number;
  readonly geometry: ObserverMapRouteGeometry;
}
