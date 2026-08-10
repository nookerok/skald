/**
 * Presentation-only map artwork manifest.
 *
 * The copied assets are visible player artwork, never simulation authority.
 * Facts, labels, routes, visibility and current location remain DTO-driven.
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
    label: "Общий вид бассейна",
    src: "/assets/maps/riverwatch-basin-overview.png",
    alt: "Общий вид бассейна Речного Стража с горами, лесами и южной водой",
    widthPx: 1448,
    heightPx: 1086,
    sha256: "7feb764999fb39cede4531265bc0da7447dd4e6f9dfe2c406fa8d26883c6a1fb",
  }),
  details: Object.freeze([
    Object.freeze({
      id: "central-valley",
      label: "Центральная долина",
      src: "/assets/maps/riverwatch-basin-central-valley.png",
      alt: "Укрупнённый вид центральной долины, переправы и русла",
      widthPx: 2048,
      heightPx: 1536,
      sha256: "ee169c30dce2f43988aadc9acd3d9c13c6264be3c2c0871f93b982cf30ea460d",
    }),
    Object.freeze({
      id: "blackwood-crater",
      label: "Западный край",
      src: "/assets/maps/riverwatch-basin-blackwood-crater.png",
      alt: "Укрупнённый вид Чёрного леса, Стеклянной впадины и западных утёсов",
      widthPx: 2048,
      heightPx: 1536,
      sha256: "3dd55b31098c328299dc8f7a33f566faef9b65876e5496197d8517af94a2eadb",
    }),
    Object.freeze({
      id: "northern-pass",
      label: "Северный край",
      src: "/assets/maps/riverwatch-basin-northern-pass.png",
      alt: "Укрупнённый вид снежного хребта, Северного перевала и водопадов",
      widthPx: 2048,
      heightPx: 1536,
      sha256: "65e4bea97fadb91b49c125165c68e1f5d924f5fbac87851b4d70d9672b95ea13",
    }),
    Object.freeze({
      id: "eastern-uplands",
      label: "Восточные возвышенности",
      src: "/assets/maps/riverwatch-basin-eastern-uplands.png",
      alt: "Укрупнённый вид восточных возвышенностей, руин и старой дороги",
      widthPx: 2048,
      heightPx: 1536,
      sha256: "e30ffa9899780a4233c05311a261d81d5867867d488fc5bd2e78f460f27d6000",
    }),
    Object.freeze({
      id: "southern-borough",
      label: "Южный край",
      src: "/assets/maps/riverwatch-basin-southern-borough.png",
      alt: "Укрупнённый вид Южного посада, нижнего русла и неуточнённой южной воды",
      widthPx: 2048,
      heightPx: 1536,
      sha256: "ba1e67de75c6a7926721e3cb9b60f8c4afc76886c3d3ccb32dfddfd77753f317",
    }),
  ]),
});

export function getPresentationMap(mapDto) {
  const regionId = mapDto?.region?.ref || mapDto?.region?.id;
  // Legacy worlds predate the compiled RegionDefined event.
  if (!mapDto?.region) return PRESENTATION_MAP_MANIFEST;
  // Only the pilot presentation bundle is registered. Unknown regions keep
  // their DTO-driven map without borrowing another region's artwork.
  const isPilotRegion = regionId === PRESENTATION_MAP_MANIFEST.regionId
    || mapDto?.region?.name === "\u0411\u0430\u0441\u0441\u0435\u0439\u043d \u0420\u0435\u0447\u043d\u043e\u0433\u043e \u0421\u0442\u0440\u0430\u0436\u0430";
  return isPilotRegion ? PRESENTATION_MAP_MANIFEST : null;
}
