/** Server-only map asset catalog. */
export interface MapDetailAsset { readonly id: string; readonly label: string; readonly src: string; readonly alt: string; readonly coverageBounds: { readonly minXMetres: number; readonly minYMetres: number; readonly maxXMetres: number; readonly maxYMetres: number }; }

const DETAILS = Object.freeze([
  { id: 'central-valley', label: 'Центральная долина', src: '/assets/maps/riverwatch-basin-central-valley.png', alt: 'Укрупнённый вид центральной долины, переправы и русла', coverageBounds: { minXMetres: 5000, minYMetres: 7000, maxXMetres: 12000, maxYMetres: 14000 } },
  { id: 'blackwood-crater', label: 'Западный край', src: '/assets/maps/riverwatch-basin-blackwood-crater.png', alt: 'Укрупнённый вид Чёрного леса, Стеклянной впадины и западных утёсов', coverageBounds: { minXMetres: 0, minYMetres: 0, maxXMetres: 8000, maxYMetres: 17000 } },
  { id: 'northern-pass', label: 'Северный край', src: '/assets/maps/riverwatch-basin-northern-pass.png', alt: 'Укрупнённый вид снежного хребта, Северного перевала и водопадов', coverageBounds: { minXMetres: 5000, minYMetres: 14000, maxXMetres: 15000, maxYMetres: 20000 } },
  { id: 'eastern-uplands', label: 'Восточные возвышенности', src: '/assets/maps/riverwatch-basin-eastern-uplands.png', alt: 'Укрупнённый вид восточных возвышенностей, руин и старой дороги', coverageBounds: { minXMetres: 12000, minYMetres: 10000, maxXMetres: 20000, maxYMetres: 18000 } },
  { id: 'southern-borough', label: 'Южный край', src: '/assets/maps/riverwatch-basin-southern-borough.png', alt: 'Укрупнённый вид Южного посада, нижнего русла и неуточнённой южной воды', coverageBounds: { minXMetres: 7000, minYMetres: 3000, maxXMetres: 17000, maxYMetres: 10000 } },
]);
export const MAP_DETAIL_SLOT_COUNT = DETAILS.length;
export function getMapDetailAsset(id: string): MapDetailAsset | null { return DETAILS.find((detail) => detail.id === id) ?? null; }
