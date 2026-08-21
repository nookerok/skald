/**
 * Presentation-only map artwork manifest.
 * The server owns observer-scoped detail descriptors; the browser renders DTO data.
 */
export const PRESENTATION_MAP_MANIFEST = Object.freeze({
  regionId: "riverwatch-basin",
  assetVersion: 1,
  presentationOnly: true,
  simulationAuthority: false,
  labelsInRaster: false,
  runtimeFacts: false,
  overview: Object.freeze({
    id: "overview",
    label: "\u041e\u0431\u0449\u0438\u0439 \u0432\u0438\u0434 \u0431\u0430\u0441\u0441\u0435\u0439\u043d\u0430",
    src: "/assets/maps/riverwatch-basin-overview.png",
    alt: "\u041e\u0431\u0449\u0438\u0439 \u0432\u0438\u0434 \u0431\u0430\u0441\u0441\u0435\u0439\u043d\u0430 \u0420\u0435\u0447\u043d\u043e\u0433\u043e \u0421\u0442\u0440\u0430\u0436\u0430",
    widthPx: 1448,
    heightPx: 1086,
    sha256: "7feb764999fb39cede4531265bc0da7447dd4e6f9dfe2c406fa8d26883c6a1fb",
    coverageBounds: { minXMetres: 0, minYMetres: 0, maxXMetres: 20000, maxYMetres: 20000 },
  }),
  details: Object.freeze([]),
});

const KNOWLEDGE_RANK = Object.freeze({ rumored: 1, glimpsed: 2, observed: 3, traversed: 4 });
const LEGACY_DETAIL_POLICIES = Object.freeze([
  { id: "central-valley", point: { xMetres: 8000, yMetres: 9500 }, minimumKnowledge: "traversed" },
  { id: "blackwood-crater", point: { xMetres: 6000, yMetres: 12000 }, minimumKnowledge: "observed" },
  { id: "northern-pass", point: { xMetres: 12000, yMetres: 18000 }, minimumKnowledge: "observed" },
  { id: "eastern-uplands", point: { xMetres: 16000, yMetres: 9000 }, minimumKnowledge: "observed" },
  { id: "southern-borough", point: { xMetres: 9500, yMetres: 5000 }, minimumKnowledge: "observed" },
]);

export function isPresentationDetailUnlocked(detail, mapDto) {
  if (!detail?.unlock) return true;
  if (Array.isArray(mapDto?.availableDetails)) {
    return mapDto.availableDetails.some((entry) => entry?.id === detail.id);
  }
  const point = detail.unlock.point;
  const minimum = KNOWLEDGE_RANK[detail.unlock.minimumKnowledge] || 3;
  return (mapDto?.locations || []).some((location) => {
    if (KNOWLEDGE_RANK[location.knowledge] < minimum) return false;
    if (!Number.isFinite(location.xMetres) || !Number.isFinite(location.yMetres)) return false;
    return Math.hypot(location.xMetres - point.xMetres, location.yMetres - point.yMetres) <= 800;
  });
}

export function getPresentationMap(mapDto) {
  const regionId = mapDto?.region?.ref || mapDto?.region?.id;
  if (!mapDto?.region) return Object.freeze({ ...PRESENTATION_MAP_MANIFEST, details: Object.freeze([]) });
  const isPilotRegion = regionId === PRESENTATION_MAP_MANIFEST.regionId
    || mapDto?.region?.name === "\u0411\u0430\u0441\u0441\u0435\u0439\u043d \u0420\u0435\u0447\u043d\u043e\u0433\u043e \u0421\u0442\u0440\u0430\u0436\u0430";
  if (!isPilotRegion) return null;

  // v3 is authoritative: only descriptors returned by the server are used.
  // v1/v2 compatibility keeps old fixtures renderable without a public asset catalog.
  const details = Array.isArray(mapDto?.availableDetails)
    ? mapDto.availableDetails
      .filter((detail) => detail?.id && detail.id !== "overview")
      .map((detail) => Object.freeze({
        id: detail.id,
        label: detail.label || "\u041e\u0442\u043a\u0440\u044b\u0442\u044b\u0439 \u0443\u0447\u0430\u0441\u0442\u043e\u043a",
        src: detail.src || "/api/map-details/" + detail.id,
        alt: detail.alt || "Region section",
        coverageBounds: detail.coverageBounds,
      }))
    : mapDto?.schemaVersion === 3
      ? []
      : LEGACY_DETAIL_POLICIES.map((detail) => Object.freeze({
        id: detail.id,
        label: "Region section",
        src: "/api/map-details/" + detail.id,
        alt: "Region section",
        unlock: { point: detail.point, minimumKnowledge: detail.minimumKnowledge },
      }));
  return Object.freeze({ ...PRESENTATION_MAP_MANIFEST, details: Object.freeze(details) });
}
