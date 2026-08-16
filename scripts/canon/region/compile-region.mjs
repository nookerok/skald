// Canon -> deterministic compiled region bundle.
// This compiler is intentionally boring: no image reads, clock, random values,
// network or LLM. The reference artifact is validated separately and neve
// enters this projection.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { listRegionIds, loadRegionCanon } from "./load-region-canon.mjs";
import { buildRegionIR } from "./build-region-ir.mjs";
import { canonicalJson } from "./canonical-json.mjs";
import { sha256 } from "./digest.mjs";
import { validateMapKnowledgeMatrix } from "../validate-map-knowledge-matrix.mjs";

const ROOT = resolve(process.cwd());
const COMPILED_DIR = resolve(ROOT, "packages/world/src/region/compiled");
const BUNDLE_SCHEMA_VERSION = 6;

function bounds(x, y, size) { return { minXMetres: x, minYMetres: y, maxXMetres: x + size, maxYMetres: y + size }; }
function point(xMetres, yMetres) { return { xMetres, yMetres }; }

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

function buildRegion(p) {
  const size = p.region.sizeMetres;
  const terrain = p.terrain;
  const surfaceFor = (x, y) => {
    const riverX = terrain.river.centerMetres + Math.round(Math.sin(y / terrain.river.periodMetres) * terrain.river.amplitudeMetres);
    const inRiver = Math.abs(x - riverX) <= terrain.river.halfWidthMetres;
    const inMarsh = y < terrain.marsh.maxYMetres && x > terrain.marsh.minXMetres && x < terrain.marsh.maxXMetres;
    const inForest = x < terrain.forest.maxXMetres && y > terrain.forest.minYMetres;
    const inMountains = y > terrain.mountains.minYMetres || (x > terrain.mountains.eastMinXMetres && y > terrain.mountains.eastMinYMetres);
    const inCrater = (x - terrain.crater.centerXMetres) ** 2 + (y - terrain.crater.centerYMetres) ** 2 < terrain.crater.radiusMetres ** 2;
    if (inRiver) return { surface: "water", elevationBand: 1, slopeBand: 1 };
    if (inMarsh) return { surface: "marsh", elevationBand: 2, slopeBand: 1 };
    if (inCrater || inMountains) return { surface: "rock", elevationBand: inMountains ? 5 : 3, slopeBand: inMountains ? 5 : 3 };
    if (inForest) return { surface: "forest", elevationBand: 3, slopeBand: 2 };
    return { surface: "soil", elevationBand: 2, slopeBand: 1 };
  };
  const tiles = [];
  const tileCount = size / p.region.tileSizeMetres;
  for (let y = 0; y < tileCount; y += 1) for (let x = 0; x < tileCount; x += 1) {
    const px = x * p.region.tileSizeMetres;
    const py = y * p.region.tileSizeMetres;
    tiles.push({ id: `tile-${x}-${y}`, bounds: bounds(px, py, p.region.tileSizeMetres), ...surfaceFor(px + p.region.tileSizeMetres / 2, py + p.region.tileSizeMetres / 2) });
  }
  const cells = [];
  const cellCount = size / p.region.cellSizeMetres;
  for (let y = 0; y < cellCount; y += 1) for (let x = 0; x < cellCount; x += 1) {
    const neighbourIds = [];
    if (x > 0) neighbourIds.push(`cell-${x - 1}-${y}`);
    if (x < cellCount - 1) neighbourIds.push(`cell-${x + 1}-${y}`);
    if (y > 0) neighbourIds.push(`cell-${x}-${y - 1}`);
    if (y < cellCount - 1) neighbourIds.push(`cell-${x}-${y + 1}`);
    cells.push({ id: `cell-${x}-${y}`, bounds: bounds(x * p.region.cellSizeMetres, y * p.region.cellSizeMetres, p.region.cellSizeMetres), neighbourIds });
  }
  const locations = p.locations.map((entry) => ({ id: entry.id, name: entry.name, description: entry.description, anchor: point(entry.xMetres, entry.yMetres), footprintTileIds: entry.footprintTileIds }));
  const landmarks = p.landmarks.map((entry) => ({ id: entry.id, name: entry.name, description: entry.description, anchor: point(entry.xMetres, entry.yMetres), elevationMetres: entry.elevationMetres, silhouetteClass: entry.silhouetteClass }));
  const relations = p.relations.map((entry) => ({ id: entry.id, kind: entry.kind, fromId: entry.fromId, toId: entry.toId, label: entry.label, points: entry.points.map((item) => point(item.xMetres, item.yMetres)) }));
  const hydrography = p.hydrography ? { ...p.hydrography, waterBodies: [...p.hydrography.waterBodies].sort((a, b) => a.id.localeCompare(b.id)), watercourses: [...p.hydrography.watercourses].sort((a, b) => a.id.localeCompare(b.id)), catchments: [...p.hydrography.catchments].sort((a, b) => a.id.localeCompare(b.id)), wetlands: [...p.hydrography.wetlands].sort((a, b) => a.id.localeCompare(b.id)) } : undefined;
  const elevation = p.elevation ? { ...p.elevation, bands: [...p.elevation.bands].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)), controlAreas: [...p.elevation.controlAreas].sort((a, b) => a.id.localeCompare(b.id)), constraints: [...p.elevation.constraints].sort((a, b) => a.id.localeCompare(b.id)) } : undefined;
  const toponymIndex = p.toponymIndex ? { ...p.toponymIndex, subjects: [...p.toponymIndex.subjects].sort((a, b) => a.id.localeCompare(b.id)) } : undefined;
  const base = { id: p.region.id, name: p.region.name, version: p.region.version, bounds: bounds(0, 0, size), terrainTileSizeMetres: p.region.tileSizeMetres, simulationCellSizeMetres: p.region.cellSizeMetres, tiles, cells, locations, landmarks, relations, hydrography, elevation, toponymIndex };
  return { ...base, contentDigest: fnv1a(JSON.stringify(base)) };
}

function provenance(refs, inputDigest, canonDigest, regionVersion, compilerVersion = "pilot-region-compiler-v6") {
  return { canonicalRefs: Object.freeze([...(refs ?? [])]), compilerVersion, compilerInputDigest: inputDigest, canonDigest, regionVersion };
}

function buildEvents(p, region, inputDigest, canonDigest) {
  const events = [];
  const event = (eventId, type, payload, refs, causationId = "boot#region") => ({ eventId, type, schemaVersion: 1, payload: { ...payload, provenance: provenance(refs, inputDigest, canonDigest, p.region.version, p.compilerVersion) }, timestamp: 0, correlationId: "boot#region", causationId });
  const genesis = { regionId: p.regionId, regionVersion: p.region.version, canonDigest, compilerInputDigest: inputDigest, compilerVersion: p.compilerVersion, canonicalRefs: p.canonicalRefs, provenance: provenance(p.canonicalRefs, inputDigest, canonDigest, p.region.version, p.compilerVersion) };
  events.push({ eventId: "boot#canon-genesis", type: "CanonGenesisRecorded", schemaVersion: 1, payload: genesis, timestamp: 0, correlationId: "boot#region", causationId: null });
  events.push(event("boot#region", "RegionDefined", { region }, p.canonicalRefs, null));
  const startLocationId = p.bootstrap?.startLocationId ?? p.locations[0]?.id;
  const spawn = p.bootstrap?.playerSpawn ?? { x: 0, y: 0 };
  events.push(event("boot#region#PlayerSpawned", "PlayerSpawned", spawn, p.canonicalRefs));
  for (const location of p.locations) events.push(event(`boot#region#LocationDefined#${location.id}`, "LocationDefined", { id: location.id, name: location.name, description: location.description, objectIds: [], connections: {} }, location.canonicalRefs));
  for (const object of p.content) events.push(event(`boot#region#WorldObjectPlaced#${object.id}`, "WorldObjectPlaced", { id: object.id, name: object.name, aliases: object.aliases, description: object.description, material: object.material, locationId: object.locationId, integrity: object.integrity, temperature: object.temperature, state: object.initialState }, object.canonicalRefs));
  if (startLocationId) events.push(event("boot#region#PlayerLocationChanged", "PlayerLocationChanged", { locationId: startLocationId }, p.canonicalRefs));
  p.travel.forEach((travel, index) => events.push(event(`boot#region#Travel#${index}`, "TravelMetadataAttached", { ...travel }, p.relations.find((entry) => entry.id === travel.relationId)?.canonicalRefs ?? p.canonicalRefs)));
  const processEventTypes = { river: "RiverProcessDefined", crossing: "CrossingConditionInitialized", weather: "WeatherProcessDefined", heat: "HeatProcessDefined" };
  for (const [processId, processPayload] of Object.entries(p.processes ?? {})) {
    const processType = processEventTypes[processId];
    if (!processType || !processPayload) continue;
    const refs = processId === "heat" ? ["universal.laws.heat_dynamics"] : ["universal.laws.time_and_ticks"];
    events.push(event("boot#region#Process#" + processId, processType, processPayload, refs));
  }
  for (const settlement of p.settlements) events.push(event(`boot#region#Settlement#${settlement.settlementId}`, "SettlementCreated", { ...settlement, createdAt: 0, updatedAt: 0 }, settlement.canonicalRefs));
  p.observations.forEach((observation, index) => events.push(event(`boot#region#Observation#${index}`, "SpatialObservationRecorded", { ...observation }, observation.canonicalRefs)));
  for (const resource of (p.resourceDefinitions ?? []).filter((entry) => ["canon", "runtime_backed", "derived"].includes(entry.status))) events.push(event("boot#region#ResourceNodeDefined#" + resource.id, "ResourceNodeDefined", resource, resource.canonicalRefs));
  for (const process of (p.resourceProcessDefinitions ?? []).filter((entry) => ["canon", "runtime_backed", "derived"].includes(entry.status))) events.push(event("boot#region#ResourceProcessDefined#" + process.id, "ResourceProcessDefined", process, process.canonicalRefs));
  for (const demand of (p.resourceDemandDefinitions ?? []).filter((entry) => ["canon", "runtime_backed", "derived"].includes(entry.status))) events.push(event("boot#region#ResourceDemandDefined#" + demand.id, "ResourceDemandDefined", demand, demand.canonicalRefs));
  events.push(event("boot#region#StrategySet", "StrategySet", { entries: [{ condition: "always", action: "idle" }] }, ["universal.laws.time_and_ticks"]));
  return events;
}

function buildBackgroundBindings(p, inputDigest, canonDigest) {
  const bindings = [];
  for (const background of p.backgroundBindings ?? []) {
    if (background.status !== "approved") continue;
    const refs = [...(background.canonicalRefs ?? [])].sort();
    const events = [];
    const event = (suffix, type, payload, causationId = "boot#region") => ({
      eventId: "boot#background#" + background.id + "#" + suffix,
      type,
      schemaVersion: 1,
      payload: {
        ...payload,
        provenance: provenance(refs, inputDigest, canonDigest, p.region.version, p.compilerVersion),
      },
      timestamp: 0,
      correlationId: "boot#background#" + background.id,
      causationId,
    });
    const testimony = background.testimony;
    events.push(event("TestimonyReceived", "TestimonyReceived", {
      claimId: testimony.claimId,
      observerId: testimony.observerId ?? "player",
      sourceId: testimony.sourceId ?? null,
      proposition: testimony.proposition,
      subjectId: testimony.subjectId ?? null,
      receivedAt: 0,
      sourceEventId: "boot#background#" + background.id + "#TestimonyReceived",
    }));
    const contact = background.contact;
    const contactLocation = p.locations.find((location) => location.id === contact.locationId);
    events.push(event("ContactPlaced", "ObjectPlaced", {
      entityId: contact.id,
      x: contactLocation?.xMetres ?? 0,
      y: contactLocation?.yMetres ?? 0,
      name: contact.name,
      aliases: [],
      description: contact.description,
      components: { contact: { locationId: contact.locationId, backgroundId: background.id } },
    }, events.at(-1).eventId));
    const relation = background.relation;
    events.push(event("RelationChanged", "RelationChanged", {
      from: relation.from,
      to: relation.to,
      kind: relation.kind,
      delta: relation.delta ?? 1,
    }, events.at(-1).eventId));
    const item = background.item;
    const itemPlaced = event("ItemPlaced", "WorldObjectPlaced", {
      id: item.id,
      name: item.name,
      aliases: item.aliases ?? [],
      description: item.description,
      material: item.material,
      locationId: item.locationId,
      integrity: item.integrity ?? 100,
      temperature: item.temperature ?? 20,
      mass: item.mass ?? 0,
      portable: item.portable === true,
      affordances: item.affordances ?? [],
      containerCapacity: item.containerCapacity ?? null,
      state: item.state ?? {},
    }, events.at(-1).eventId);
    events.push(itemPlaced);
    events.push(event("ItemMoved", "ItemMoved", {
      itemId: item.id,
      from: { kind: "location", locationId: item.locationId },
      to: { kind: "carried", holderId: "player" },
    }, itemPlaced.eventId));
    events.push(event("ItemPossessionChanged", "ItemPossessionChanged", {
      itemId: item.id,
      ownerId: "player",
      reason: "character_background",
    }, events.at(-1).eventId));
    for (const [index, observation] of (background.observations ?? []).entries()) {
      events.push(event("SpatialObservationRecorded#" + index, "SpatialObservationRecorded", {
        ...observation,
        observerId: observation.observerId ?? "player",
        observedAt: observation.observedAt ?? 0,
      }, events.at(-1).eventId));
    }
    for (const [index, knowledge] of (background.knowledge ?? []).entries()) {
      events.push(event("KnowledgeAcquired#" + index, "KnowledgeAcquired", {
        subjectId: "player",
        knowledgeId: knowledge.knowledgeId,
        proposition: knowledge.proposition,
        sourceObservationRef: knowledge.sourceObservationRef,
      }, events.at(-1).eventId));
    }
    bindings.push({
      id: background.id,
      status: "approved",
      canonicalRefs: refs,
      bootstrapEvents: events,
      narrative: {
        startingTestimonyRefs: [testimony.claimId],
        contactRefs: [relation.to],
        startingItemRefs: [item.id],
        familiarSpatialRefs: (background.observations ?? []).map((observation) => observation.subjectKind + ":" + observation.subjectId).sort(),
        procedureKnowledgeRefs: (background.knowledge ?? []).map((knowledge) => knowledge.knowledgeId).sort(),
        openingHookRef: background.openingHookRef,
      },
    });
  }
  return bindings.sort((a, b) => a.id.localeCompare(b.id));
}

function observationKey(payload) { return `${payload.subjectKind}:${payload.subjectId}`; }

function buildEntrypointBackgroundBindings(projection) {
  const bindings = [];
  for (const entrypoint of projection.bootstrap?.entrypoints ?? []) {
    if ((entrypoint.status ?? "approved") !== "approved") continue;
    const connections = entrypoint.backgroundConnections ?? Object.entries(entrypoint.backgroundBridges ?? {}).map(([backgroundId, arrivalHook]) => ({ backgroundId, arrivalHook }));
    for (const connection of connections) {
      bindings.push({
        id: entrypoint.id + "#" + connection.backgroundId,
        status: "approved",
        entrypointId: entrypoint.id,
        backgroundId: connection.backgroundId,
        arrivalHook: connection.arrivalHook,
        canonicalRefs: [...(entrypoint.canonicalRefs ?? [])].sort(),
      });
    }
  }
  return bindings.sort((a, b) => a.id.localeCompare(b.id));
}

function buildEntrypointDefinitions(projection, events, inputDigest, canonDigest) {
  const authored = projection.bootstrap?.entrypoints ?? [];
  const relationById = new Map((projection.relations ?? []).map((relation) => [relation.id, relation]));
  return authored.filter((entrypoint) => (entrypoint.status ?? "approved") === "approved").map((entrypoint) => {
    const observationRefs = new Set(entrypoint.initialObservationRefs ?? []);
    const selected = events.filter((event) => {
      if (event.type === 'PlayerLocationChanged') return false;
      if (event.type === 'SpatialObservationRecorded') return observationRefs.has(observationKey(event.payload));
      return true;
    });
    const authoredLocationEvent = events.find((event) => event.type === 'PlayerLocationChanged' && event.payload?.locationId === entrypoint.locationId);
    const locationEvent = authoredLocationEvent ?? {
      eventId: 'boot#entrypoint#' + entrypoint.id + '#PlayerLocationChanged',
      type: 'PlayerLocationChanged',
      schemaVersion: 1,
      payload: {
        locationId: entrypoint.locationId,
        provenance: provenance(entrypoint.canonicalRefs ?? [], inputDigest, canonDigest, projection.region.version, projection.compilerVersion),
      },
      timestamp: 0,
      correlationId: 'boot#entrypoint#' + entrypoint.id,
      causationId: 'boot#region',
    };
    selected.push(locationEvent);
    const locationEvents = [locationEvent];
    const location = (projection.locations ?? []).find((candidate) => candidate.id === entrypoint.locationId);
    const contact = entrypoint.localContact;
    const contactEvents = contact ? [
      {
        eventId: 'boot#entrypoint#' + entrypoint.id + '#ContactPlaced',
        type: 'ObjectPlaced',
        schemaVersion: 1,
        payload: {
          entityId: contact.id,
          x: location?.xMetres ?? 0,
          y: location?.yMetres ?? 0,
          name: contact.name,
          aliases: [],
          description: contact.description,
          components: { contact: { locationId: entrypoint.locationId, entrypointId: entrypoint.id } },
          provenance: provenance(entrypoint.canonicalRefs ?? [], inputDigest, canonDigest, projection.region.version, projection.compilerVersion),
        },
        timestamp: 0,
        correlationId: 'boot#entrypoint#' + entrypoint.id,
        causationId: locationEvents[0].eventId,
      },
      {
        eventId: 'boot#entrypoint#' + entrypoint.id + '#RelationChanged',
        type: 'RelationChanged',
        schemaVersion: 1,
        payload: { from: 'player', to: contact.id, kind: contact.relationKind, delta: contact.relationDelta ?? 1, provenance: provenance(entrypoint.canonicalRefs ?? [], inputDigest, canonDigest, projection.region.version, projection.compilerVersion) },
        timestamp: 0,
        correlationId: 'boot#entrypoint#' + entrypoint.id,
        causationId: 'boot#entrypoint#' + entrypoint.id + '#ContactPlaced',
      },
    ] : [];
    const routeRefs = entrypoint.initialRouteRefs ?? entrypoint.availableRouteRefs ?? [];
    const backgroundConnections = entrypoint.backgroundConnections ?? Object.entries(entrypoint.backgroundBridges ?? {}).map(([backgroundId, arrivalHook]) => ({ backgroundId, arrivalHook }));
    const backgroundBridges = Object.fromEntries(backgroundConnections.map((connection) => [connection.backgroundId, connection.arrivalHook]));
    const routes = routeRefs.map((id) => relationById.get(id)).filter(Boolean).map((relation) => ({ id: relation.id, label: relation.label, kind: relation.kind }));
    return {
      id: entrypoint.id,
      regionId: projection.regionId,
      locationId: entrypoint.locationId,
      presentation: { title: entrypoint.title, teaser: entrypoint.teaser ?? entrypoint.description, description: entrypoint.description, atmosphere: entrypoint.atmosphere },
      openingSituation: entrypoint.openingSituation,
      arrivalScene: entrypoint.arrivalScene,
      localContact: { name: contact.name, description: contact.description },
      openingProblem: entrypoint.openingProblem,
      openingProblemRef: entrypoint.openingProblemRef,
      openingProblemMode: entrypoint.openingProblemMode ?? 'presentation_only',
      localContactRef: entrypoint.localContactRef ?? contact.id,
      initialRouteRefs: [...routeRefs].sort(),
      availableRoutes: routes,
      backgroundBridges,
      backgroundConnections: backgroundConnections.map((connection) => ({ backgroundId: connection.backgroundId, arrivalHook: connection.arrivalHook })).sort((a, b) => a.backgroundId.localeCompare(b.backgroundId)),
      initialObservationRefs: [...entrypoint.initialObservationRefs].sort(),
      initialKnowledgeRefs: [...entrypoint.initialKnowledgeRefs].sort(),
      initialRevealRefs: [...entrypoint.initialRevealRefs].sort(),
      availableBackgroundIds: [...entrypoint.availableBackgroundIds].sort(),
      canonicalRefs: [...(entrypoint.canonicalRefs ?? [])].sort(),
      bootstrapEvents: [...selected, ...contactEvents],
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

function compactRegion(region, terrainRules) {
  return { ...region, tiles: undefined, cells: undefined, terrainRules, cellGrid: { columns: Math.round(region.bounds.maxXMetres / region.simulationCellSizeMetres), rows: Math.round(region.bounds.maxYMetres / region.simulationCellSizeMetres), cellSizeMetres: region.simulationCellSizeMetres } };
}

export function compileRegion(regionId = null) {
  const loaded = loadRegionCanon(ROOT, regionId);
  const projection = buildRegionIR(loaded.projection, loaded.canonIds);
  const inputDigest = sha256(projection);
  const region = buildRegion(projection);
  const canonDigest = sha256({ projection, region });
  const events = buildEvents(projection, region, inputDigest, canonDigest);
  const compact = compactRegion(region, projection.terrain);
  const compactEvents = events.map((entry) => entry.type === "RegionDefined" ? { ...entry, payload: { ...entry.payload, region: compact } } : entry);
  const acceptedDiscovery = (projection.discoveryDefinitions ?? []).filter((entry) => ["canon", "runtime"].includes(entry.status));
  const acceptedSimulation = (projection.simulationMetadata ?? []).filter((entry) => ["canon", "runtime_backed", "derived"].includes(entry.status));
  const acceptedHydrography = region.hydrography ?? { waterBodies: [], watercourses: [], catchments: [], wetlands: [] };
  const acceptedElevation = region.elevation ?? { bands: [], controlAreas: [], constraints: [] };
  const acceptedToponymIndex = region.toponymIndex ?? { subjects: [] };
  const acceptedResources = (projection.resourceDefinitions ?? []).filter((entry) => ["canon", "runtime_backed", "derived"].includes(entry.status));
  const acceptedResourceProcesses = (projection.resourceProcessDefinitions ?? []).filter((entry) => ["canon", "runtime_backed", "derived"].includes(entry.status));
  const acceptedResourceDemands = (projection.resourceDemandDefinitions ?? []).filter((entry) => ["canon", "runtime_backed", "derived"].includes(entry.status));
  const objectProvenance = Object.fromEntries([...projection.locations, ...projection.landmarks, ...projection.relations, ...projection.content, ...acceptedResources, ...acceptedResourceProcesses, ...acceptedResourceDemands, ...(acceptedHydrography.waterBodies ?? []), ...(acceptedHydrography.watercourses ?? []), ...(acceptedHydrography.catchments ?? []), ...(acceptedElevation.controlAreas ?? []), ...(acceptedElevation.constraints ?? []), ...(acceptedToponymIndex.subjects ?? [])].map((entry) => [entry.id, { canonicalRefs: entry.canonicalRefs ?? [] }]));
  const allEvents = compactEvents;
  const entrypoints = buildEntrypointDefinitions(projection, allEvents, inputDigest, canonDigest);
  const entrypointBackgroundBindings = buildEntrypointBackgroundBindings(projection);
  const backgroundBindings = buildBackgroundBindings(projection, inputDigest, canonDigest);
  const finalBootstrapDigest = sha256({ regionEvents: allEvents, entrypoints, entrypointBackgroundBindings, backgroundBindings });
  return { schemaVersion: BUNDLE_SCHEMA_VERSION, regionId: projection.regionId, regionVersion: region.version, defaultEntrypointId: projection.bootstrap?.defaultEntrypointId ?? projection.bootstrap?.entrypoints?.[0]?.id ?? projection.bootstrap?.startLocationId, entrypoints, backgroundBindings, entrypointBackgroundBindings, compilerVersion: projection.compilerVersion, provenance: { canonDigest, compilerInputDigest: inputDigest, bootstrapDigest: finalBootstrapDigest, canonicalRefs: projection.canonicalRefs, referenceArtifactRuntimeAllowed: false }, regionDefinition: compact, hydrographyDefinition: acceptedHydrography, elevationDefinition: acceptedElevation, toponymIndex: acceptedToponymIndex, contentDefinitions: projection.content ?? [], discoveryDefinitions: acceptedDiscovery, simulationDefinitions: acceptedSimulation, resourceDefinitions: acceptedResources, resourceProcessDefinitions: acceptedResourceProcesses, resourceDemandDefinitions: acceptedResourceDemands, objectProvenance, events: allEvents };

}

const mode = process.argv.includes("--check") ? "check" : "write";
const regionArgIndex = process.argv.indexOf("--region");
const requestedRegion = regionArgIndex >= 0 ? process.argv[regionArgIndex + 1] : null;
const regionIds = process.argv.includes("--all") ? listRegionIds(ROOT) : [requestedRegion ?? listRegionIds(ROOT)[0]];
const catalogEntries = [];
for (const regionId of regionIds) {
  const loadedForPath = loadRegionCanon(ROOT, regionId);
  const bundle = compileRegion(regionId);
  const matrixCheck = validateMapKnowledgeMatrix(ROOT, bundle);
  if (matrixCheck.errors.length) throw new Error("map knowledge matrix invalid: " + matrixCheck.errors.join("; "));
  const fileStem = basename(dirname(loadedForPath.sourceFile));
  const outputPath = resolve(COMPILED_DIR, fileStem + ".v" + BUNDLE_SCHEMA_VERSION + ".json");
  const serialized = JSON.stringify(bundle, null, 2) + "\n";
  catalogEntries.push({ regionId: bundle.regionId, bundlePath: "./compiled/" + fileStem + ".v" + BUNDLE_SCHEMA_VERSION + ".json" });
  if (mode === "check") {
    if (!existsSync(outputPath)) throw new Error("compiled bundle missing: " + outputPath);
    const current = readFileSync(outputPath, "utf8");
    if (current !== serialized) throw new Error("compiled bundle is stale: run npm run canon:region:compile");
    console.log("[canon:region:compile] PASS " + regionId + " (" + bundle.events.length + " events, digest " + bundle.provenance.bootstrapDigest.slice(0, 12) + ")");
  } else {
    mkdirSync(COMPILED_DIR, { recursive: true });
    writeFileSync(outputPath, serialized);
    console.log("[canon:region:compile] WROTE " + outputPath + " (" + bundle.events.length + " events, digest " + bundle.provenance.bootstrapDigest.slice(0, 12) + ")");
  }
}
const catalogPath = resolve(COMPILED_DIR, "region-catalog.json");
const catalogSerialized = JSON.stringify({ schemaVersion: 1, regions: catalogEntries.sort((a, b) => a.regionId.localeCompare(b.regionId)) }, null, 2) + "\n";
if (mode === "check") {
  if (!existsSync(catalogPath) || readFileSync(catalogPath, "utf8") !== catalogSerialized) throw new Error("compiled region catalog is stale: run npm run canon:region:compile");
} else {
  mkdirSync(COMPILED_DIR, { recursive: true });
  writeFileSync(catalogPath, catalogSerialized);
}
