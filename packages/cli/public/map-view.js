/**
 * Map View — SVG/DOM renderer for Player Map (ADR-0019 §4).
 *
 * Pure renderer: ObserverMapDTO → DOM nodes.
 * The artwork is non-authoritative; fog and marks use observer-scoped DTO only.
 */

import { projectPoint, computeBounds } from "./map-layout.js";
import { getPresentationMap, isPresentationDetailUnlocked } from "./presentation-map.js";
import { drawPresentationImage, buildMapControls, buildDetailGallery, readMapView, rememberMapAsset } from "./map-presentation-view.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const FOG_MASK_ID = "player-map-fog-mask";
const REVEAL_RADIUS = Object.freeze({
  observer: 62,
  traversed: 52,
  observed: 40,
  glimpsed: 24,
});

function seededUnit(seed, index) {
  let hash = 2166136261;
  const value = String(seed) + ":" + index;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0;
  return (hash % 10000) / 10000;
}

function closedOrganicPath(points) {
  if (points.length < 3) return "";
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const firstMid = midpoint(points.at(-1), points[0]);
  let data = "M" + firstMid.x + "," + firstMid.y;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const end = midpoint(current, next);
    data += " Q" + current.x + "," + current.y + " " + end.x + "," + end.y;
  }
  return data + " Z";
}

function buildOrganicBlob(zone, knownArea, viewport) {
  if (!zone.center || !Number.isFinite(zone.radiusMetres)) return null;
  const center = projectPoint(zone.center.xMetres, zone.center.yMetres, knownArea, viewport);
  if (!center) return null;
  const spanX = Math.max(1, Number(knownArea.maxXMetres) - Number(knownArea.minXMetres));
  const spanY = Math.max(1, Number(knownArea.maxYMetres) - Number(knownArea.minYMetres));
  const pixelsPerMetre = Math.min(viewport.width / spanX, viewport.height / spanY);
  const radius = Math.max(1, zone.radiusMetres * pixelsPerMetre);
  const variance = Math.max(0, Math.min(0.45, Number(zone.edgeVariance) || 0.18));
  const points = [];
  const count = 24;
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count;
    const jitter = 1 - variance + seededUnit(zone.seed || "organic", index) * variance * 2;
    points.push({ x: center.x + Math.cos(angle) * radius * jitter, y: center.y + Math.sin(angle) * radius * jitter });
  }
  return Object.freeze({ path: closedOrganicPath(points), strength: Number.isFinite(zone.strength) ? zone.strength : 1 });
}

function buildMemoryTrace(zone, knownArea, viewport) {
  if (!Array.isArray(zone.path) || zone.path.length < 2) return null;
  const points = zone.path.map((point) => projectPoint(point.xMetres, point.yMetres, knownArea, viewport)).filter(Boolean);
  if (points.length < 2) return null;
  const variance = Math.max(0, Math.min(0.45, Number(zone.edgeVariance) || 0.25));
  const width = Math.max(2, Number(zone.widthMetres || 0) * Math.min(viewport.width / Math.max(1, knownArea.maxXMetres - knownArea.minXMetres), viewport.height / Math.max(1, knownArea.maxYMetres - knownArea.minYMetres)));
  return Object.freeze({
    points: Object.freeze(points.map((point, index) => ({
      x: point.x + (seededUnit(zone.seed || "trace", index) - 0.5) * width * variance,
      y: point.y + (seededUnit(zone.seed || "trace", index + 31) - 0.5) * width * variance,
    }))),
    width,
    strength: Number.isFinite(zone.strength) ? zone.strength : 1,
  });
}

/**
 * Convert observer-scoped knowledge into fog reveal geometry.
 * Rumored subjects create no exact reveal and no hidden geometry is read.
 *
 * @param {object} mapDto - ObserverMapDTO
 * @param {object} knownArea - Bounds already exposed by ObserverMapDTO
 * @param {{ width: number; height: number }} viewport - SVG viewport
 */
export function buildFogRevealModel(mapDto, knownArea, viewport) {
  if (!mapDto || !knownArea) {
    return Object.freeze({ circles: Object.freeze([]), corridors: Object.freeze([]), blobs: Object.freeze([]), memoryTraces: Object.freeze([]) });
  }
  const circles = [];
  const corridors = [];
  const blobs = [];
  const memoryTraces = [];
  const addCircle = (xMetres, yMetres, radius, strength) => {
    const point = projectPoint(xMetres, yMetres, knownArea, viewport);
    if (point) circles.push(Object.freeze({ x: point.x, y: point.y, radius, strength }));
  };

  // Server-owned reveal geometry is authoritative for schema v3+. The browser
  // only projects world metres into the current viewport; it does not infer
  // visibility from canonical locations or routes.
  if (Array.isArray(mapDto.revealZones)) {
    const spanX = Math.max(1, Number(knownArea.maxXMetres) - Number(knownArea.minXMetres));
    const spanY = Math.max(1, Number(knownArea.maxYMetres) - Number(knownArea.minYMetres));
    const pixelsPerMetre = Math.min(viewport.width / spanX, viewport.height / spanY);
    for (const zone of mapDto.revealZones) {
      if (zone?.profile === "organic") {
        const blob = buildOrganicBlob(zone, knownArea, viewport);
        if (blob) blobs.push(blob);
        continue;
      }
      if (zone?.profile === "memory_trace") {
        const trace = buildMemoryTrace(zone, knownArea, viewport);
        if (trace) memoryTraces.push(trace);
        continue;
      }
      if (zone?.kind === "vicinity" && zone.center
        && Number.isFinite(zone.center.xMetres)
        && Number.isFinite(zone.center.yMetres)
        && Number.isFinite(zone.radiusMetres)) {
        addCircle(
          zone.center.xMetres,
          zone.center.yMetres,
          Math.max(0, zone.radiusMetres * pixelsPerMetre),
          Number.isFinite(zone.strength) ? zone.strength : 1,
        );
      } else if (zone?.kind === "route" && Array.isArray(zone.path)) {
        const points = zone.path
          .map((point) => projectPoint(point.xMetres, point.yMetres, knownArea, viewport))
          .filter(Boolean);
        if (points.length < 2) continue;
        corridors.push(Object.freeze({
          points: Object.freeze(points),
          width: Math.max(0, Number(zone.widthMetres || 0) * pixelsPerMetre),
          strength: Number.isFinite(zone.strength) ? zone.strength : 1,
        }));
      }
    }
  } else {
    // Compatibility for legacy DTO fixtures. This fallback is deliberately
    // unreachable for the production schema v3 server response.
    if (mapDto.observer?.xMetres != null && mapDto.observer?.yMetres != null) {
      addCircle(mapDto.observer.xMetres, mapDto.observer.yMetres, REVEAL_RADIUS.observer, 1);
    }
    for (const location of mapDto.locations || []) {
      if (location.knowledge === "rumored") continue;
      if (location.xMetres == null || location.yMetres == null) continue;
      const radius = REVEAL_RADIUS[location.knowledge] || REVEAL_RADIUS.glimpsed;
      addCircle(location.xMetres, location.yMetres, radius, location.knowledge === "glimpsed" ? 0.48 : 1);
    }
    for (const route of mapDto.routes || []) {
      if (route.geometry?.kind !== "observed_path") continue;
      const points = route.geometry.points
        .map((point) => projectPoint(point.xMetres, point.yMetres, knownArea, viewport))
        .filter(Boolean);
      if (points.length < 2) continue;
      corridors.push(Object.freeze({
        points: Object.freeze(points),
        width: route.knowledge === "traversed" ? 34 : 24,
        strength: route.knowledge === "glimpsed" ? 0.48 : 1,
      }));
    }
  }
  return Object.freeze({
    circles: Object.freeze(circles),
    corridors: Object.freeze(corridors),
    blobs: Object.freeze(blobs),
    memoryTraces: Object.freeze(memoryTraces),
  });
}

/**
 * Render the observer map into a container.
 *
 * @param {HTMLElement} container - Target container
 * @param {object} mapDto - ObserverMapDTO
 */
export function renderObserverMap(container, mapDto, viewState = {}) {
  if (!container || !mapDto) return;

  container.replaceChildren();
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", "\u041d\u0430\u0431\u043b\u044e\u0434\u0430\u0435\u043c\u0430\u044f \u043a\u0430\u0440\u0442\u0430 \u0440\u0435\u0433\u0438\u043e\u043d\u0430");

  // Bounds use only exact observer-visible geometry. Rumored coordinates must
  // not shift the projection or open the fog.
  const allItems = [
    ...(mapDto.locations || [])
      .filter((location) => location.xMetres != null && location.yMetres != null)
      .map((location) => ({ xMetres: location.xMetres, yMetres: location.yMetres })),
    ...(mapDto.landmarks || [])
      .filter((landmark) => landmark.xMetres != null)
      .map((landmark) => ({ xMetres: landmark.xMetres, yMetres: landmark.yMetres })),
  ];
  const knownArea = mapDto.knownArea || computeBounds(allItems) || {
    minXMetres: 0,
    minYMetres: 0,
    maxXMetres: 1,
    maxYMetres: 1,
  };

  const viewport = { width: 400, height: 300 };
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + viewport.width + " " + viewport.height);
  svg.setAttribute("aria-label", "\u041d\u0430\u0431\u043b\u044e\u0434\u0430\u0435\u043c\u0430\u044f \u043a\u0430\u0440\u0442\u0430 \u0440\u0435\u0433\u0438\u043e\u043d\u0430");
  svg.classList.add("player-map-svg");

  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = mapDto.region?.name
    ? "\u041a\u0430\u0440\u0442\u0430: " + mapDto.region.name
    : "\u041d\u0430\u0431\u043b\u044e\u0434\u0430\u0435\u043c\u0430\u044f \u043a\u0430\u0440\u0442\u0430 \u0440\u0435\u0433\u0438\u043e\u043d\u0430";
  svg.appendChild(title);

  const desc = document.createElementNS(SVG_NS, "desc");
  desc.textContent = buildMapDescription(mapDto);
  svg.appendChild(desc);

  const presentationMap = getPresentationMap(mapDto);
  let artwork = null;
  if (presentationMap) {
    const savedView = readMapView(presentationMap.regionId);
    const availableAssets = [presentationMap.overview, ...presentationMap.details]
      .filter((asset) => asset.id === "overview" || isPresentationDetailUnlocked(asset, mapDto));
    const savedAsset = availableAssets.find((asset) => asset.id === savedView.assetId) || presentationMap.overview;
    artwork = drawPresentationImage(svg, presentationMap, viewport, savedAsset);
    svg.setAttribute("data-map-view", savedAsset.id);
  }
  const selectedAsset = presentationMap && artwork
    ? [presentationMap.overview, ...presentationMap.details].find((asset) => asset.id === svg.getAttribute("data-map-view"))
    : null;
  const serverCoverage = selectedAsset && Array.isArray(mapDto.availableDetails)
    ? mapDto.availableDetails.find((detail) => detail.id === selectedAsset.id)?.coverageBounds
    : null;
  const renderBounds = serverCoverage || selectedAsset?.coverageBounds || knownArea;
  const currentPoint = mapDto.observer?.xMetres != null && mapDto.observer?.yMetres != null
    ? projectPoint(mapDto.observer.xMetres, mapDto.observer.yMetres, renderBounds, viewport)
    : null;
  drawMapFoundation(svg, mapDto, renderBounds, viewport);

  for (const route of mapDto.routes || []) drawRoute(svg, route, renderBounds, viewport);
  for (const location of mapDto.locations || []) drawLocation(svg, location, renderBounds, viewport);
  for (const landmark of mapDto.landmarks || []) drawLandmark(svg, landmark, renderBounds, viewport);

  if (mapDto.observer?.xMetres != null && mapDto.observer?.yMetres != null) {
    const pos = projectPoint(mapDto.observer.xMetres, mapDto.observer.yMetres, renderBounds, viewport);
    if (pos) {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.classList.add("map-observer-marker");
      circle.setAttribute("cx", String(pos.x));
      circle.setAttribute("cy", String(pos.y));
      circle.setAttribute("r", "5");
      circle.setAttribute("aria-label", "\u0422\u0432\u043e\u0451 \u043f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435");
      svg.appendChild(circle);
    }
  }

  container.appendChild(svg);

  const fogStatus = document.createElement("p");
  fogStatus.className = "map-fog-status";
  const exactLocations = (mapDto.locations || []).filter((location) => (location.knowledge === "observed" || location.knowledge === "traversed") && location.xMetres != null && location.yMetres != null).length;
  fogStatus.textContent = exactLocations > 0
    ? "Ты запомнил мест: " + exactLocations + ". Остальной регион скрыт туманом."
    : "Пока виден только ближайший участок. Остальное скрыто туманом.";
  container.appendChild(fogStatus);
  container.appendChild(buildMapStatus(mapDto, viewState.journey));
  container.appendChild(buildMapControls(svg, {
    regionId: presentationMap?.regionId || mapDto.region?.ref || "region",
    currentPoint,
  }));
  if (presentationMap && artwork) {
    const gallery = buildDetailGallery(presentationMap, (asset) => {
      if (asset.id !== "overview" && !isPresentationDetailUnlocked(asset, mapDto)) return;
      rememberMapAsset(presentationMap.regionId, asset.id);
      renderObserverMap(container, mapDto, viewState);
    }, mapDto);
    if (gallery) container.appendChild(gallery);
  }
  container.appendChild(buildMapList(mapDto));
}

function drawMapFoundation(svg, mapDto, knownArea, viewport) {
  const terrainRegions = Array.isArray(mapDto.terrainRegions) && mapDto.terrainRegions.length > 0
    ? mapDto.terrainRegions
    : mapDto.schemaVersion >= 4 ? [] : null;
  if (terrainRegions) {
    for (const region of terrainRegions) {
      const points = region.polygon.map((point) => projectPoint(point.xMetres, point.yMetres, knownArea, viewport)).filter(Boolean);
      if (points.length < 3) continue;
      const path = document.createElementNS(SVG_NS, "path");
      path.classList.add("player-map-terrain-region", "terrain-" + region.surface);
      path.setAttribute("d", points.map((point, index) => (index === 0 ? "M" : "L") + point.x + "," + point.y).join(" ") + " Z");
      path.setAttribute("aria-hidden", "true");
      svg.appendChild(path);
    }
  } else {
    for (const patch of mapDto.knownTerrain || []) {
      const topLeft = projectPoint(patch.bounds.minXMetres, patch.bounds.maxYMetres, knownArea, viewport);
      const bottomRight = projectPoint(patch.bounds.maxXMetres, patch.bounds.minYMetres, knownArea, viewport);
      if (!topLeft || !bottomRight) continue;
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.classList.add("player-map-terrain", "terrain-" + patch.surface);
      rect.setAttribute("x", String(Math.min(topLeft.x, bottomRight.x)));
      rect.setAttribute("y", String(Math.min(topLeft.y, bottomRight.y)));
      rect.setAttribute("width", String(Math.abs(bottomRight.x - topLeft.x)));
      rect.setAttribute("height", String(Math.abs(bottomRight.y - topLeft.y)));
      rect.setAttribute("aria-hidden", "true");
      svg.appendChild(rect);
    }
  }

  const tone = document.createElementNS(SVG_NS, "rect");
  tone.classList.add("player-map-tone");
  tone.setAttribute("width", String(viewport.width));
  tone.setAttribute("height", String(viewport.height));
  tone.setAttribute("aria-hidden", "true");
  svg.appendChild(tone);

  const defs = document.createElementNS(SVG_NS, "defs");
  const soften = document.createElementNS(SVG_NS, "filter");
  soften.setAttribute("id", "player-map-fog-soften");
  soften.setAttribute("x", "-40%");
  soften.setAttribute("y", "-40%");
  soften.setAttribute("width", "180%");
  soften.setAttribute("height", "180%");
  const blur = document.createElementNS(SVG_NS, "feGaussianBlur");
  blur.setAttribute("stdDeviation", "8");
  soften.appendChild(blur);
  defs.appendChild(soften);

  const mask = document.createElementNS(SVG_NS, "mask");
  mask.setAttribute("id", FOG_MASK_ID);
  mask.setAttribute("maskUnits", "userSpaceOnUse");
  const cover = document.createElementNS(SVG_NS, "rect");
  cover.setAttribute("width", String(viewport.width));
  cover.setAttribute("height", String(viewport.height));
  cover.setAttribute("fill", "white");
  mask.appendChild(cover);

  const reveal = buildFogRevealModel(mapDto, knownArea, viewport);
  for (const blob of reveal.blobs) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", blob.path);
    path.setAttribute("fill", "black");
    path.setAttribute("fill-opacity", String(blob.strength));
    path.setAttribute("filter", "url(#player-map-fog-soften)");
    mask.appendChild(path);
  }
  for (const trace of reveal.memoryTraces) {
    const path = document.createElementNS(SVG_NS, "path");
    const data = trace.points.map((point, index) => (index === 0 ? "M" : "L") + point.x + "," + point.y).join(" ");
    path.setAttribute("d", data);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "black");
    path.setAttribute("stroke-opacity", String(trace.strength));
    path.setAttribute("stroke-width", String(trace.width));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("filter", "url(#player-map-fog-soften)");
    mask.appendChild(path);
  }
  for (const area of reveal.circles) {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(area.x));
    circle.setAttribute("cy", String(area.y));
    circle.setAttribute("r", String(area.radius));
    circle.setAttribute("fill", "black");
    circle.setAttribute("fill-opacity", String(area.strength));
    circle.setAttribute("filter", "url(#player-map-fog-soften)");
    mask.appendChild(circle);
  }
  for (const corridor of reveal.corridors) {
    const path = document.createElementNS(SVG_NS, "path");
    const data = corridor.points
      .map((point, index) => (index === 0 ? "M" : "L") + point.x + "," + point.y)
      .join(" ");
    path.setAttribute("d", data);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "black");
    path.setAttribute("stroke-opacity", String(corridor.strength));
    path.setAttribute("stroke-width", String(corridor.width));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("filter", "url(#player-map-fog-soften)");
    mask.appendChild(path);
  }
  defs.appendChild(mask);
  svg.appendChild(defs);

  const fog = document.createElementNS(SVG_NS, "rect");
  fog.classList.add("player-map-fog");
  fog.setAttribute("width", String(viewport.width));
  fog.setAttribute("height", String(viewport.height));
  fog.setAttribute("mask", "url(#" + FOG_MASK_ID + ")");
  fog.setAttribute("aria-hidden", "true");
  svg.appendChild(fog);
}

function drawLocation(svg, location, knownArea, viewport) {
  if (location.knowledge === "rumored") return;
  if (location.knowledge === "glimpsed" || location.xMetres == null || location.yMetres == null) {
    drawApproximation(svg, location.name, location.approximation, viewport);
    return;
  }
  const pos = projectPoint(location.xMetres, location.yMetres, knownArea, viewport);
  if (!pos) return;

  const g = document.createElementNS(SVG_NS, "g");
  g.classList.add("map-location", "knowledge-" + location.knowledge);
  g.setAttribute("role", "img");
  g.setAttribute("aria-label", location.name + (location.knowledge === "traversed" ? " — пройдено" : " — наблюдается"));

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", String(pos.x));
  circle.setAttribute("cy", String(pos.y));
  circle.setAttribute("r", location.knowledge === "traversed" ? "6" : "4");
  g.appendChild(circle);

  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", String(pos.x + 8));
  text.setAttribute("y", String(pos.y + 4));
  text.textContent = location.name;
  g.appendChild(text);
  svg.appendChild(g);
}

function drawLandmark(svg, landmark, knownArea, viewport) {
  if (landmark.knowledge === "rumored") return;
  if (landmark.knowledge === "glimpsed" || landmark.xMetres == null || landmark.yMetres == null) {
    drawApproximation(svg, landmark.name, landmark.approximation, viewport);
    return;
  }
  const pos = projectPoint(landmark.xMetres, landmark.yMetres, knownArea, viewport);
  if (!pos) return;

  const g = document.createElementNS(SVG_NS, "g");
  g.classList.add("map-landmark");
  g.setAttribute("role", "img");
  g.setAttribute("aria-label", landmark.name + " — наблюдаемый ориентир");

  const diamond = document.createElementNS(SVG_NS, "polygon");
  const size = landmark.silhouette === "monolith" ? 8 : 6;
  diamond.setAttribute("points", pos.x + "," + (pos.y - size) + " " + (pos.x + size) + "," + pos.y + " " + pos.x + "," + (pos.y + size) + " " + (pos.x - size) + "," + pos.y);
  g.appendChild(diamond);

  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", String(pos.x + size + 4));
  text.setAttribute("y", String(pos.y + 4));
  text.textContent = landmark.name;
  g.appendChild(text);
  svg.appendChild(g);
}

function drawApproximation(svg, name, approximation, viewport) {
  if (!approximation?.bearing) return;
  const directions = {
    "север": [0, -1], "северо-восток": [0.7, -0.7], "восток": [1, 0],
    "юго-восток": [0.7, 0.7], "юг": [0, 1], "юго-запад": [-0.7, 0.7],
    "запад": [-1, 0], "северо-запад": [-0.7, -0.7],
  };
  const vector = directions[approximation.bearing] || [0, -1];
  const haze = document.createElementNS(SVG_NS, "ellipse");
  haze.classList.add("map-approximation-haze");
  haze.setAttribute("cx", String(viewport.width / 2 + vector[0] * viewport.width * 0.28));
  haze.setAttribute("cy", String(viewport.height / 2 + vector[1] * viewport.height * 0.28));
  haze.setAttribute("rx", String(22 + approximation.angularSpan / 2));
  haze.setAttribute("ry", String(13 + approximation.angularSpan / 3));
  haze.setAttribute("aria-hidden", "true");
  svg.appendChild(haze);

  const text = document.createElementNS(SVG_NS, "text");
  text.classList.add("map-approximation");
  text.setAttribute("x", String(viewport.width / 2));
  text.setAttribute("y", String(18 + Math.min(3, approximation.angularSpan / 10) * 8));
  text.setAttribute("text-anchor", "middle");
  text.textContent = (approximation.shape === "silhouette" ? "Силуэт: " : "Дальний взгляд: ") + name + " — " + approximation.bearing;
  svg.appendChild(text);
}

function drawRoute(svg, route, knownArea, viewport) {
  if (route.geometry?.kind === "observed_path") {
    const pathData = route.geometry.points.map((point, index) => {
      const pos = projectPoint(point.xMetres, point.yMetres, knownArea, viewport);
      return pos ? (index === 0 ? "M" : "L") + pos.x + "," + pos.y : null;
    }).filter(Boolean).join(" ");
    if (!pathData) return;

    const path = document.createElementNS(SVG_NS, "path");
    path.classList.add("map-route", "route-" + route.kind, "knowledge-" + route.knowledge);
    path.setAttribute("d", pathData);
    path.setAttribute("fill", "none");
    path.setAttribute("aria-label", route.label);
    svg.appendChild(path);
  } else if (route.geometry?.kind === "directional_stub") {
    const text = document.createElementNS(SVG_NS, "text");
    text.classList.add("map-bearing");
    text.setAttribute("x", String(viewport.width / 2));
    text.setAttribute("y", String(viewport.height - 10));
    text.setAttribute("text-anchor", "middle");
    text.textContent = route.label + " — " + route.geometry.bearing;
    svg.appendChild(text);
  }
}


function buildMapStatus(mapDto, journey) {
  const section = document.createElement("section");
  section.className = "map-current-status";
  section.setAttribute("aria-label", "\u0422\u0435\u043a\u0443\u0449\u0435\u0435 \u043f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0438 \u043f\u0443\u0442\u044c");

  const current = (mapDto.locations || []).find(
    (location) => location.ref === mapDto.observer?.locationRef && location.knowledge !== "rumored",
  );
  const area = document.createElement("p");
  area.className = "map-current-area";
  area.textContent = current
    ? "\u0422\u044b \u0441\u0435\u0439\u0447\u0430\u0441: " + current.name
    : "\u0422\u0435\u043a\u0443\u0449\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c \u043f\u043e\u043a\u0430 \u043d\u0435 \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0435\u043d\u0430.";
  section.appendChild(area);

  if (journey?.status === "traveling") {
    const travel = document.createElement("p");
    travel.className = "map-travel-status";
    const elapsed = Number.isFinite(journey.elapsedTicks) ? journey.elapsedTicks : 0;
    const total = Number.isFinite(journey.totalTicks) ? journey.totalTicks : 0;
    travel.textContent = journey.to
      ? "\u0412 \u043f\u0443\u0442\u0438 \u043a " + journey.to + " \u00b7 \u044d\u0442\u0430\u043f " + Math.min(elapsed + 1, Math.max(total, 1)) + " \u0438\u0437 " + Math.max(total, 1)
      : "\u0422\u044b \u0432 \u043f\u0443\u0442\u0438. \u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0438\u0439 \u0432\u0430\u0436\u043d\u044b\u0439 \u043c\u043e\u043c\u0435\u043d\u0442 \u043f\u0440\u0435\u0440\u0432\u0435\u0442 \u0434\u043e\u0440\u043e\u0433\u0443.";
    section.appendChild(travel);
  } else if (journey?.status === "interrupted") {
    const stopped = document.createElement("p");
    stopped.className = "map-travel-status map-travel-status--interrupted";
    stopped.textContent = journey.to
      ? "\u041f\u0443\u0442\u044c \u043f\u0440\u0435\u0440\u0432\u0430\u043d \u043d\u0430 \u043f\u0443\u0442\u0438 \u043a " + journey.to + ". \u041e\u0442\u043a\u0440\u044b\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u043f\u0440\u043e\u0439\u0434\u0435\u043d\u043d\u044b\u0439 \u0443\u0447\u0430\u0441\u0442\u043e\u043a."
      : "\u041f\u0443\u0442\u044c \u043f\u0440\u0435\u0440\u0432\u0430\u043d. \u041a\u0430\u0440\u0442\u0430 \u0445\u0440\u0430\u043d\u0438\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u043f\u0440\u043e\u0439\u0434\u0435\u043d\u043d\u044b\u0439 \u0443\u0447\u0430\u0441\u0442\u043e\u043a.";
    section.appendChild(stopped);
  } else if (journey?.status === "completed" && journey.to) {
    const arrival = document.createElement("p");
    arrival.className = "map-travel-status map-travel-status--arrived";
    arrival.textContent = "\u041f\u0443\u0442\u044c \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043d: " + journey.to;
    section.appendChild(arrival);
  }

  const hazards = Array.isArray(mapDto.knownHazards) ? mapDto.knownHazards : [];
  for (const hazard of hazards) {
    if (!hazard || typeof hazard.label !== "string") continue;
    const item = document.createElement("p");
    item.className = "map-known-hazard";
    item.textContent = "\u041e\u043f\u0430\u0441\u043d\u043e\u0441\u0442\u044c: " + hazard.label;
    section.appendChild(item);
  }
  return section;
}

function buildMapList(mapDto) {
  const section = document.createElement("section");
  section.className = "player-map-list";
  section.setAttribute("aria-label", "Что осталось в памяти");

  const heading = document.createElement("h3");
  heading.textContent = "Что осталось в памяти";
  section.appendChild(heading);

  const list = document.createElement("ul");
  for (const location of mapDto.locations || []) {
    const item = document.createElement("li");
    if (location.knowledge === "rumored") {
      item.textContent = "Слух: " + location.name + (location.bearing ? " — к " + location.bearing : "");
    } else if (location.knowledge === "glimpsed") {
      item.textContent = "Дальний взгляд: " + location.name + (location.bearing ? " — " + location.bearing : "");
    } else {
      item.textContent = location.name;
    }
    list.appendChild(item);
  }
  for (const landmark of mapDto.landmarks || []) {
    const item = document.createElement("li");
    if (landmark.knowledge === "rumored") {
      item.textContent = "Слух: " + landmark.name + (landmark.bearing ? " — к " + landmark.bearing : "");
    } else if (landmark.knowledge === "glimpsed") {
      item.textContent = "Силуэт: " + landmark.name + (landmark.bearing ? " — " + landmark.bearing : "");
    } else {
      item.textContent = landmark.name;
    }
    list.appendChild(item);
  }
  if (list.children.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Пока рядом нечего отметить.";
    list.appendChild(item);
  }
  section.appendChild(list);
  return section;
}

function buildMapDescription(mapDto) {
  const parts = [];
  if (mapDto.locations?.length) parts.push(mapDto.locations.length + " \u0438\u0437\u0432\u0435\u0441\u0442\u043d\u044b\u0445 \u043c\u0435\u0441\u0442");
  if (mapDto.landmarks?.length) parts.push(mapDto.landmarks.length + " \u043e\u0440\u0438\u0435\u043d\u0442\u0438\u0440\u043e\u0432");
  if (mapDto.routes?.length) parts.push(mapDto.routes.length + " \u043c\u0430\u0440\u0448\u0440\u0443\u0442\u043e\u0432");
  return parts.length > 0 ? parts.join(", ") : "\u041d\u0435\u0442 \u043e\u0442\u043a\u0440\u044b\u0442\u044b\u0445 \u0434\u0430\u043d\u043d\u044b\u0445";
}
