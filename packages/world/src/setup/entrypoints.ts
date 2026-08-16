import type { CompiledEntrypoint, CompiledRegionBundle } from "../region/bundle-loader.js";
import { loadCompiledRegionBundle } from "../region/bundle-loader.js";
import type { RegionEntrypoint } from "./types.js";

const REGION_ID = "riverwatch-basin";
const DEFAULT_ENTRYPOINT_ID = "river_waystation_arrival";

/** Public starts are authored entrypoints, not the complete location catalog. */
function fallbackEntrypoint(bundle: CompiledRegionBundle): RegionEntrypoint {
  const definition = bundle.regionDefinition as { locations?: readonly { id: string; name: string; description: string }[] };
  const location = definition.locations?.find((candidate) => candidate.id === "river_waystation");
  if (!location) throw new Error("compiled pilot region has no river_waystation start");
  return Object.freeze({
    id: DEFAULT_ENTRYPOINT_ID,
    regionId: REGION_ID,
    locationId: location.id,
    title: location.name,
    teaser: "Путь начинается у переправы, где лес подходит к воде.",
    description: "Небольшой путевой двор у реки и кромки Чёрного леса. Отсюда начинается дорога в Бассейне Речного Стража.",
    atmosphere: "Вода шумит за настилом, а за спиной темнеют первые ели.",
    openingSituation: "Переправа готовится к утру, но течение уже принесло новости, которым никто не рад.",
    initialObservationRefs: [
      "location:river_waystation",
      "relation:road_waystation_city",
      "relation:river_crossing",
      "landmark:suspended_monolith",
      "location:blackwood_edge",
      "location:glass_crater",
      "landmark:glass_crater",
      "relation:road_waystation_forest",
    ],
    initialKnowledgeRefs: ["location:river_waystation", "relation:road_waystation_city"],
    initialRevealRefs: ["location:river_waystation", "location:blackwood_edge", "relation:road_waystation_city", "relation:river_crossing"],
    availableBackgroundIds: ["wanderer", "keeper", "echo"],
    canonicalRefs: ["regions.pilot-region.geography.f5"],
  });
}


function toPublicEntrypoint(entry: CompiledEntrypoint): RegionEntrypoint {
  return Object.freeze({
    id: entry.id,
    regionId: entry.regionId,
    locationId: entry.locationId,
    title: entry.presentation.title,
    ...(entry.presentation.teaser ? { teaser: entry.presentation.teaser } : {}),
    description: entry.presentation.description,
    atmosphere: entry.presentation.atmosphere,
    openingSituation: entry.openingSituation,
    initialObservationRefs: Object.freeze([...entry.initialObservationRefs]),
    initialKnowledgeRefs: Object.freeze([...entry.initialKnowledgeRefs]),
    initialRevealRefs: Object.freeze([...entry.initialRevealRefs]),
    availableBackgroundIds: Object.freeze([...entry.availableBackgroundIds]),
    canonicalRefs: Object.freeze([...entry.canonicalRefs]),
  });
}

/** Internal compiled definition used by bootstrap construction. */
export function getCompiledRegionEntrypoint(id: string, regionId = REGION_ID): CompiledEntrypoint | null {
  const bundle = loadCompiledRegionBundle(regionId);
  return bundle.entrypoints?.find((entry) => entry.id === id) ?? null;
}

/** Returns only author-approved public starts from the compiled region. */
export function listRegionEntrypoints(regionId = REGION_ID): readonly RegionEntrypoint[] {
  const bundle = loadCompiledRegionBundle(regionId);
  const authored = bundle.entrypoints;
  if (authored && authored.length > 0) return Object.freeze(authored.map(toPublicEntrypoint));
  return Object.freeze([fallbackEntrypoint(bundle)]);
}

export function getRegionEntrypoint(id: string, regionId = REGION_ID): RegionEntrypoint | null {
  return listRegionEntrypoints(regionId).find((entry) => entry.id === id) ?? null;
}

export function getDefaultRegionEntrypoint(regionId = REGION_ID): RegionEntrypoint {
  const entries = listRegionEntrypoints(regionId);
  const bundle = loadCompiledRegionBundle(regionId) as CompiledRegionBundle & { defaultEntrypointId?: string };
  return entries.find((entry) => entry.id === (bundle.defaultEntrypointId ?? DEFAULT_ENTRYPOINT_ID)) ?? entries[0]!;
}
