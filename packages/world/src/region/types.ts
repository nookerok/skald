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

export interface HydrographyWaterBody {
  readonly id: string;
  readonly kind: string;
  readonly classification: string;
  readonly inflows: readonly string[];
  readonly outflows: readonly string[];
}

export interface HydrographyWatercourse {
  readonly id: string;
  readonly kind: string;
  readonly sourceRef: string;
  readonly sinkRef: string;
  readonly flowDirection: string;
  readonly tributaryRefs: readonly string[];
  readonly seasonality: string;
}

export interface HydrographyCatchment {
  readonly id: string;
  readonly drainsTo: string;
  readonly terrainRefs: readonly string[];
}

export interface HydrographyWetland {
  readonly id: string;
  readonly kind: string;
  readonly waterBodyRef: string;
}

export interface HydrographyDefinition {
  readonly waterBodies: readonly HydrographyWaterBody[];
  readonly watercourses: readonly HydrographyWatercourse[];
  readonly catchments: readonly HydrographyCatchment[];
  readonly wetlands: readonly HydrographyWetland[];
}

export interface ElevationBandDefinition {
  readonly id: string;
  readonly rank: number;
  readonly label: string;
  readonly elevationBand: number;
  readonly slopeBand: number;
}

export interface ElevationControlArea {
  readonly id: string;
  readonly bandRef: string;
  readonly regionZone: string;
}

export interface ElevationConstraint {
  readonly id: string;
  readonly kind: string;
  readonly subject: string;
  readonly reference: string;
}

export interface ElevationDefinition {
  readonly bands: readonly ElevationBandDefinition[];
  readonly controlAreas: readonly ElevationControlArea[];
  readonly constraints: readonly ElevationConstraint[];
}

export interface RegionToponym {
  readonly id: string;
  readonly canonicalName: string;
  readonly aliases: readonly string[];
}

export interface RegionToponymIndex {
  readonly subjects: readonly RegionToponym[];
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
  readonly hydrography?: HydrographyDefinition;
  readonly elevation?: ElevationDefinition;
  readonly toponymIndex?: RegionToponymIndex;
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
  readonly hydrography?: HydrographyDefinition | null;
  readonly elevation?: ElevationDefinition | null;
  readonly toponymIndex?: RegionToponymIndex | null;
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
  readonly schemaVersion: 1 | 2;
  readonly revision: { readonly worldTime: number; readonly eventNumber: number };
  readonly region: { readonly ref: string; readonly name: string } | null;
  readonly observer: { readonly locationRef: string | null; readonly xMetres: number | null; readonly yMetres: number | null };
  readonly knownArea: SpatialBounds | null;
  /** Observer-scoped vector terrain; hidden tiles never cross this boundary. */
  readonly knownTerrain?: readonly ObserverMapTerrainPatch[];
  readonly locations: readonly ObserverMapLocation[];
  readonly landmarks: readonly ObserverMapLandmark[];
  readonly routes: readonly ObserverMapRoute[];
  /** Hydrography is observer-scoped evidence; unresolved/hidden water is omitted. */
  readonly knownWatercourses?: readonly ObserverMapWatercourse[];
  /** Only explicitly observed bodies cross the observer boundary. */
  readonly knownWaterBodies?: readonly ObserverMapWaterBody[];
}

export interface ObserverMapTerrainPatch {
  readonly bounds: SpatialBounds;
  readonly surface: TerrainSurface;
  readonly elevationBand: number;
  readonly slopeBand: number;
}

export interface ObserverMapLocation {
  readonly ref: string;
  readonly name: string;
  /** Reviewed aliases only; omitted when no Canon label exists. */
  readonly aliases?: readonly string[];
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

export interface ObserverMapWatercourse {
  readonly ref: string;
  readonly name: string | null;
  readonly kind: string;
  readonly knowledge: SpatialKnowledge;
  readonly confidence: number;
  readonly freshness: number;
  readonly geometry: ObserverMapRouteGeometry;
}

export interface ObserverMapWaterBody {
  readonly ref: string;
  readonly name: string | null;
  readonly classification: string;
  readonly classificationConfidence: number;
  readonly knowledge: SpatialKnowledge;
  readonly confidence: number;
  readonly freshness: number;
  /** Null until a bounded observed geometry exists; never canonical image bounds. */
  readonly geometry: ObserverMapRouteGeometry;
}
