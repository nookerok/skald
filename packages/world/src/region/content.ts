import type { ObjectDefinition } from "../objects/definitions.js";

/**
 * Authored content for the pilot region. These are observable physical
 * witnesses, not a second world-state authority: the bootstrap compiler turns
 * them into deterministic WorldObjectPlaced events.
 */
export const PILOT_REGION_CONTENT_OBJECTS: readonly ObjectDefinition[] = [
  {
    id: "glass_crater_surface",
    name: "Стеклянная поверхность впадины",
    aliases: ["стеклянная поверхность", "блестящий камень"],
    description: "На дне чаши камень отражает свет после дождя. Причина блеска неясна.",
    material: "glass",
    initialState: { contentKind: "discovery_node", reflective: true, origin: "unknown" },
    locationId: "glass_crater",
    integrity: 100,
    temperature: 9,
  },
  {
    id: "western_cliff_waterfalls",
    name: "Водопады западных утёсов",
    aliases: ["водопад", "водопады"],
    description: "Несколько потоков падают с уступа и разбиваются о камни, питая реку.",
    material: "water",
    initialState: { contentKind: "landmark", supportsRelation: "river_basin" },
    locationId: "western_cliff_waterfalls",
    integrity: 100,
    temperature: 8,
  },
];
