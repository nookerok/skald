import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DomainEvent } from "@skald/event-bus";
import type { RegionEntrypoint } from "../setup/types.js";
import type { ElevationDefinition, HydrographyDefinition, RegionToponymIndex } from "./types.js";
import type { ResourceNodeDefinition, ResourceProcessDefinition, ResourceDemandDefinition } from "../resource/types.js";

export interface CompiledEntrypoint extends Omit<RegionEntrypoint, "title" | "description" | "atmosphere"> {
  readonly presentation: {
    readonly title: string;
    readonly teaser?: string;
    readonly description: string;
    readonly atmosphere: string;
  };
  readonly bootstrapEvents: readonly DomainEvent[];
}

export interface CompiledRegionBundle {
  readonly entrypoints?: readonly CompiledEntrypoint[];
  readonly defaultEntrypointId?: string;
  readonly schemaVersion: number;
  readonly regionVersion: number;
  readonly regionDefinition: unknown;
  readonly hydrographyDefinition: HydrographyDefinition;
  readonly elevationDefinition: ElevationDefinition;
  readonly toponymIndex: RegionToponymIndex;
  readonly contentDefinitions: readonly unknown[];
  readonly discoveryDefinitions: readonly unknown[];
  readonly simulationDefinitions: readonly unknown[];
  readonly resourceDefinitions?: readonly ResourceNodeDefinition[];
  readonly resourceProcessDefinitions?: readonly ResourceProcessDefinition[];
  readonly resourceDemandDefinitions?: readonly ResourceDemandDefinition[];
  readonly objectProvenance: Readonly<Record<string, { readonly canonicalRefs: readonly string[] }>>;
  readonly regionId: string;
  readonly compilerVersion: string;
  readonly provenance: {
    readonly canonDigest: string;
    readonly compilerInputDigest: string;
    readonly bootstrapDigest: string;
    readonly canonicalRefs: readonly string[];
    readonly referenceArtifactRuntimeAllowed: false;
  };
  readonly events: readonly DomainEvent[];
}

interface RegionCatalogEntry {
  readonly regionId: string;
  readonly bundlePath: string;
}

interface RegionCatalog {
  readonly schemaVersion: number;
  readonly regions: readonly RegionCatalogEntry[];
}

const catalogPath = fileURLToPath(new URL("./compiled/region-catalog.json", import.meta.url));
const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as RegionCatalog;
if (catalog.schemaVersion !== 1) throw new Error("compiled region catalog schema mismatch");

/** Loads only a generated bundle; Canon, proposals and images are never read here. */
export function loadCompiledRegionBundle(regionId: string): CompiledRegionBundle {
  const entry = catalog.regions.find((candidate) => candidate.regionId === regionId);
  if (!entry) throw new Error("compiled region is not registered: " + regionId);
  const path = fileURLToPath(new URL(entry.bundlePath, import.meta.url));
  const bundle = JSON.parse(readFileSync(path, "utf8")) as CompiledRegionBundle;
  if (bundle.regionId !== regionId) throw new Error("compiled region id mismatch: " + regionId);
  if (bundle.provenance.referenceArtifactRuntimeAllowed !== false) throw new Error("reference artifact is forbidden in runtime bundle");
  return bundle;
}

export function listCompiledRegionIds(): readonly string[] {
  return Object.freeze(catalog.regions.map((entry) => entry.regionId));
}

