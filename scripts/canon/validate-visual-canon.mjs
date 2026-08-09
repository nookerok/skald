import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve("docs/worldbuilding/pilot-region/region-interpretation.json");
const data = JSON.parse(readFileSync(file, "utf8"));
const errors = [];
const allowedEvents = new Set([
  "SettlementCreated",
  "SpatialObservationRecorded",
  "TravelMetadataAttached",
  "RiverProcessDefined",
  "CrossingConditionInitialized",
  "WeatherProcessDefined",
  "HeatProcessDefined"
]);
const ids = (items, label) => {
  const seen = new Set();
  for (const item of items ?? []) {
    if (!item.id) errors.push(`${label}: missing id`);
    if (item.id && seen.has(item.id)) errors.push(`${label}: duplicate id ${item.id}`);
    if (item.id) seen.add(item.id);
  }
};
const inRange = (value, min, max, where) => {
  if (typeof value !== "number" || value < min || value > max) errors.push(`${where}: must be in [${min}, ${max}]`);
};

if (data.schemaVersion !== 1) errors.push("schemaVersion must be 1");
if (data.regionId !== "riverwatch-basin") errors.push("regionId must be riverwatch-basin");
if (data.source?.role !== "reference_artifact") errors.push("source.role must be reference_artifact");
if (data.source?.imageIsRuntimeData !== false) errors.push("source.imageIsRuntimeData must be false");
if (!data.authority?.runtime || !data.authority?.canon?.length) errors.push("authority must name runtime and Canon sources");

ids(data.terrainZones, "terrainZones");
for (const zone of data.terrainZones ?? []) {
  const bounds = zone.normalizedBounds;
  if (!bounds) errors.push(`terrainZones[${zone.id}]: normalizedBounds required`);
  else for (const axis of ["minX", "minY", "maxX", "maxY"]) inRange(bounds[axis], 0, 1, `terrainZones[${zone.id}].normalizedBounds.${axis}`);
  if (bounds && (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY)) errors.push(`terrainZones[${zone.id}]: bounds inverted`);
  if (!zone.evidence) errors.push(`terrainZones[${zone.id}]: visual evidence required`);
}
ids(data.biomes, "biomes");
for (const biome of data.biomes ?? []) {
  if (biome.resourceStatus !== "candidate") errors.push(`biomes[${biome.id}]: resources must remain candidate`);
  if (biome.dangerStatus !== "candidate") errors.push(`biomes[${biome.id}]: danger must remain candidate`);
}
ids(data.canonicalMappings?.locations, "canonicalMappings.locations");
for (const location of data.canonicalMappings?.locations ?? []) {
  if (location.status !== "canonical") errors.push(`location ${location.id}: status must be canonical`);
  inRange(location.positionMetres?.x, 0, 20000, `location ${location.id}.x`);
  inRange(location.positionMetres?.y, 0, 20000, `location ${location.id}.y`);
}
ids(data.canonicalMappings?.landmarks, "canonicalMappings.landmarks");
ids(data.resourceNodes, "resourceNodes");
for (const node of data.resourceNodes ?? []) {
  if (node.status === "proposal" && node.notRuntimeTruth !== true) errors.push("resourceNode " + node.id + ": proposal must remain non-runtime");
  if (node.status === "canonical" && node.notRuntimeTruth !== false) errors.push("resourceNode " + node.id + ": canonical node must be runtime-backed");
  if (!["proposal", "canonical"].includes(node.status)) errors.push("resourceNode " + node.id + ": invalid status");
}
ids(data.discoveryNodes, "discoveryNodes");
for (const node of data.discoveryNodes ?? []) {
  const observation = node.observation;
  if (!observation || !["location", "landmark", "relation"].includes(observation.subjectKind)) errors.push(`discoveryNode ${node.id}: invalid observation subjectKind`);
  inRange(observation?.confidence, 0, 1, `discoveryNode ${node.id}.confidence`);
  if (!node.hidden) errors.push(`discoveryNode ${node.id}: hidden truth boundary required`);
}
ids(data.simulationSeeds, "simulationSeeds");
for (const seed of data.simulationSeeds ?? []) {
  if (!allowedEvents.has(seed.eventType)) errors.push(`simulationSeed ${seed.id}: eventType is not an existing bootstrap event`);
  if (!["proposal", "already_compiled"].includes(seed.status)) errors.push(`simulationSeed ${seed.id}: invalid status`);
  const serialized = JSON.stringify(seed);
  if (/(Math\\.random|Date\\.now|timestamp|random)/i.test(serialized)) errors.push(`simulationSeed ${seed.id}: non-deterministic field`);
}
ids(data.hypotheses, "hypotheses");
for (const hypothesis of data.hypotheses ?? []) {
  if (hypothesis.notCanonTruth !== true) errors.push(`hypothesis ${hypothesis.id}: notCanonTruth must be true`);
  inRange(hypothesis.confidence, 0, 1, `hypothesis ${hypothesis.id}.confidence`);
  if (!hypothesis.mappedProcess) errors.push(`hypothesis ${hypothesis.id}: mappedProcess required`);
}
for (const toponym of data.toponyms ?? []) {
  if (!toponym.subjectId || !toponym.oldName || !toponym.etymology) errors.push("toponym requires subjectId, oldName and etymology");
}
if (data.policy?.hypothesesAndProposalsAreNotRuntimeFacts !== true) errors.push("policy must keep hypotheses/proposals out of runtime");

if (errors.length) {
  for (const error of errors) console.error(`[visual-canon:validate] error: ${error}`);
  console.error(`[visual-canon:validate] FAIL (${errors.length} error(s))`);
  process.exit(1);
}
console.log(`[visual-canon:validate] PASS (${data.terrainZones.length} terrain zones, ${data.biomes.length} biomes, ${data.discoveryNodes.length} discovery nodes, ${data.simulationSeeds.length} seed records)`);
