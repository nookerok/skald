import type { DomainEvent } from "@skald/event-bus";
import type { ElevationDefinition, HydrographyDefinition, RegionDefinition, RegionToponymIndex, TerrainSurface } from "./types.js";
import type { CompiledRegionBundle } from "./bundle-loader.js";
import type { ResourceNodeDefinition, ResourceProcessDefinition, ResourceDemandDefinition } from "../resource/types.js";
import { loadCompiledRegionBundle } from "./bundle-loader.js";

interface TerrainRules {
  readonly river: { readonly centerMetres: number; readonly amplitudeMetres: number; readonly periodMetres: number; readonly halfWidthMetres: number };
  readonly marsh: { readonly maxYMetres: number; readonly minXMetres: number; readonly maxXMetres: number };
  readonly forest: { readonly maxXMetres: number; readonly minYMetres: number };
  readonly mountains: { readonly minYMetres: number; readonly eastMinXMetres: number; readonly eastMinYMetres: number };
  readonly crater: { readonly centerXMetres: number; readonly centerYMetres: number; readonly radiusMetres: number };
}

interface CompactRegion extends Omit<RegionDefinition, "tiles" | "cells"> {
  readonly terrainRules: TerrainRules;
  readonly cellGrid: { readonly columns: number; readonly rows: number; readonly cellSizeMetres: number };
}

function bounds(x: number, y: number, size: number) {
  return { minXMetres: x, minYMetres: y, maxXMetres: x + size, maxYMetres: y + size };
}

function materializeRegion(compact: CompactRegion): RegionDefinition {
  const { terrainRules, cellGrid, ...base } = compact;
  const surfaceFor = (x: number, y: number): { surface: TerrainSurface; elevationBand: number; slopeBand: number } => {
    const riverX = terrainRules.river.centerMetres + Math.round(Math.sin(y / terrainRules.river.periodMetres) * terrainRules.river.amplitudeMetres);
    const inRiver = Math.abs(x - riverX) <= terrainRules.river.halfWidthMetres;
    const inMarsh = y < terrainRules.marsh.maxYMetres && x > terrainRules.marsh.minXMetres && x < terrainRules.marsh.maxXMetres;
    const inForest = x < terrainRules.forest.maxXMetres && y > terrainRules.forest.minYMetres;
    const inMountains = y > terrainRules.mountains.minYMetres || (x > terrainRules.mountains.eastMinXMetres && y > terrainRules.mountains.eastMinYMetres);
    const inCrater = (x - terrainRules.crater.centerXMetres) ** 2 + (y - terrainRules.crater.centerYMetres) ** 2 < terrainRules.crater.radiusMetres ** 2;
    if (inRiver) return { surface: "water", elevationBand: 1, slopeBand: 1 };
    if (inMarsh) return { surface: "marsh", elevationBand: 2, slopeBand: 1 };
    if (inCrater || inMountains) return { surface: "rock", elevationBand: inMountains ? 5 : 3, slopeBand: inMountains ? 5 : 3 };
    if (inForest) return { surface: "forest", elevationBand: 3, slopeBand: 2 };
    return { surface: "soil", elevationBand: 2, slopeBand: 1 };
  };
  const tiles = [];
  const tileCount = base.bounds.maxXMetres / base.terrainTileSizeMetres;
  for (let y = 0; y < tileCount; y += 1) for (let x = 0; x < tileCount; x += 1) {
    const px = x * base.terrainTileSizeMetres;
    const py = y * base.terrainTileSizeMetres;
    tiles.push({ id: `tile-${x}-${y}`, bounds: bounds(px, py, base.terrainTileSizeMetres), ...surfaceFor(px + base.terrainTileSizeMetres / 2, py + base.terrainTileSizeMetres / 2) });
  }
  const cells = [];
  for (let y = 0; y < cellGrid.rows; y += 1) for (let x = 0; x < cellGrid.columns; x += 1) {
    const neighbourIds: string[] = [];
    if (x > 0) neighbourIds.push(`cell-${x - 1}-${y}`);
    if (x < cellGrid.columns - 1) neighbourIds.push(`cell-${x + 1}-${y}`);
    if (y > 0) neighbourIds.push(`cell-${x}-${y - 1}`);
    if (y < cellGrid.rows - 1) neighbourIds.push(`cell-${x}-${y + 1}`);
    cells.push({ id: `cell-${x}-${y}`, bounds: bounds(x * cellGrid.cellSizeMetres, y * cellGrid.cellSizeMetres, cellGrid.cellSizeMetres), neighbourIds });
  }
  return { ...base, tiles, cells } as RegionDefinition;
}

interface MaterializedBundle {
  readonly bundle: CompiledRegionBundle;
  readonly region: RegionDefinition;
  readonly events: readonly DomainEvent[];
}

function materializeBundle(regionId: string): MaterializedBundle {
  const bundle = loadCompiledRegionBundle(regionId);
  const compact = bundle.regionDefinition as CompactRegion;
  if (!compact || typeof compact !== "object") throw new Error("compiled region has no regionDefinition: " + regionId);
  const region = materializeRegion(compact);
  const events = Object.freeze(bundle.events.map((entry) => {
    if (entry.type !== "RegionDefined") return Object.freeze({ ...entry });
    const payload = entry.payload as { region: CompactRegion; provenance?: unknown };
    return Object.freeze({ ...entry, payload: { ...payload, region } });
  }));
  return { bundle, region, events };
}

const DEFAULT_REGION_ID = "riverwatch-basin";

function materializeSelectedEvents(events: readonly DomainEvent[], region: RegionDefinition): readonly DomainEvent[] {
  return Object.freeze(events.map((entry) => {
    if (entry.type !== "RegionDefined") return Object.freeze({ ...entry });
    const payload = entry.payload as { region: CompactRegion; provenance?: unknown };
    return Object.freeze({ ...entry, payload: { ...payload, region } });
  }));
}

/** Generic compiled bootstrap for a selected region or authored entrypoint. */
export function buildRegionBootstrapEvents(regionId = DEFAULT_REGION_ID, entrypointId?: string): readonly DomainEvent[] {
  const materialized = materializeBundle(regionId);
  if (!entrypointId) return materialized.events;
  const entrypoint = materialized.bundle.entrypoints?.find((candidate) => candidate.id === entrypointId);
  // Older compiled bundles do not carry authored entrypoint metadata. Their legacy start remains valid.
  if (!entrypoint) {
    if (!materialized.bundle.entrypoints?.length) return materialized.events;
    throw new Error("compiled region entrypoint not found: " + entrypointId);
  }
  return materializeSelectedEvents(entrypoint.bootstrapEvents, materialized.region);
}

/** Generic runtime region definition. */
export function buildRegionDefinition(regionId = DEFAULT_REGION_ID): RegionDefinition {
  return materializeBundle(regionId).region;
}

export function buildRegionHydrographyDefinition(regionId = DEFAULT_REGION_ID): HydrographyDefinition {
  return materializeBundle(regionId).bundle.hydrographyDefinition;
}

export function buildRegionElevationDefinition(regionId = DEFAULT_REGION_ID): ElevationDefinition {
  return materializeBundle(regionId).bundle.elevationDefinition;
}

export function buildRegionToponymIndex(regionId = DEFAULT_REGION_ID): RegionToponymIndex {
  return materializeBundle(regionId).bundle.toponymIndex;
}

export function buildRegionSimulationDefinitions(regionId = DEFAULT_REGION_ID): readonly unknown[] {
  return materializeBundle(regionId).bundle.simulationDefinitions;
}

export function buildRegionContentDefinitions(regionId = DEFAULT_REGION_ID): readonly unknown[] {
  return materializeBundle(regionId).bundle.contentDefinitions;
}

export function buildRegionResourceDefinitions(regionId = DEFAULT_REGION_ID): readonly ResourceNodeDefinition[] {
  return materializeBundle(regionId).bundle.resourceDefinitions ?? [];
}

/** Compatibility wrappers for existing living-region callers. */
export function buildPilotRegionBootstrapEvents(): readonly DomainEvent[] {
  return buildRegionBootstrapEvents(DEFAULT_REGION_ID);
}

export function buildPilotRegionDefinition(): RegionDefinition {
  return buildRegionDefinition(DEFAULT_REGION_ID);
}

export function buildPilotRegionHydrographyDefinition(): HydrographyDefinition {
  return buildRegionHydrographyDefinition(DEFAULT_REGION_ID);
}

export function buildPilotRegionElevationDefinition(): ElevationDefinition {
  return buildRegionElevationDefinition(DEFAULT_REGION_ID);
}

export function buildPilotRegionToponymIndex(): RegionToponymIndex {
  return buildRegionToponymIndex(DEFAULT_REGION_ID);
}

export function buildPilotRegionSimulationDefinitions(): readonly unknown[] {
  return buildRegionSimulationDefinitions(DEFAULT_REGION_ID);
}

export function buildPilotRegionContentDefinitions(): readonly unknown[] {
  return buildRegionContentDefinitions(DEFAULT_REGION_ID);
}

export const PILOT_REGION_ID = DEFAULT_REGION_ID;
export const PILOT_REGION_SIZE_METRES = buildPilotRegionDefinition().bounds.maxXMetres;
export const PILOT_TILE_SIZE_METRES = buildPilotRegionDefinition().terrainTileSizeMetres;
export const PILOT_CELL_SIZE_METRES = buildPilotRegionDefinition().simulationCellSizeMetres;


export function buildRegionResourceProcessDefinitions(regionId = DEFAULT_REGION_ID): readonly ResourceProcessDefinition[] {
  return materializeBundle(regionId).bundle.resourceProcessDefinitions ?? [];
}
export function buildRegionResourceDemandDefinitions(regionId = DEFAULT_REGION_ID): readonly ResourceDemandDefinition[] { return materializeBundle(regionId).bundle.resourceDemandDefinitions ?? []; }
