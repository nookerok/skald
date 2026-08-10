/**
 * Map View — SVG/DOM renderer for Player Map (ADR-0019 §4).
 *
 * Pure renderer: ObserverMapDTO → DOM nodes.
 * The artwork is non-authoritative; fog and marks use observer-scoped DTO only.
 */

import { projectPoint, computeBounds } from "./map-layout.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const FOG_MASK_ID = "player-map-fog-mask";
const REVEAL_RADIUS = Object.freeze({
  observer: 62,
  traversed: 52,
  observed: 40,
  glimpsed: 24,
});

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
    return Object.freeze({ circles: Object.freeze([]), corridors: Object.freeze([]) });
  }
  const circles = [];
  const corridors = [];
  const addCircle = (xMetres, yMetres, radius, strength) => {
    const point = projectPoint(xMetres, yMetres, knownArea, viewport);
    if (point) circles.push(Object.freeze({ x: point.x, y: point.y, radius, strength }));
  };

  if (mapDto.observer?.xMetres != null && mapDto.observer?.yMetres != null) {
    addCircle(mapDto.observer.xMetres, mapDto.observer.yMetres, REVEAL_RADIUS.observer, 1);
  }
  for (const location of mapDto.locations || []) {
    if (location.knowledge === "rumored") continue;
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
  return Object.freeze({
    circles: Object.freeze(circles),
    corridors: Object.freeze(corridors),
  });
}

/**
 * Render the observer map into a container.
 *
 * @param {HTMLElement} container - Target container
 * @param {object} mapDto - ObserverMapDTO
 */
export function renderObserverMap(container, mapDto) {
  if (!container || !mapDto) return;

  container.replaceChildren();
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", "\u041d\u0430\u0431\u043b\u044e\u0434\u0430\u0435\u043c\u0430\u044f \u043a\u0430\u0440\u0442\u0430 \u0440\u0435\u0433\u0438\u043e\u043d\u0430");

  // Bounds use only exact observer-visible geometry. Rumored coordinates must
  // not shift the projection or open the fog.
  const allItems = [
    ...(mapDto.locations || [])
      .filter((location) => location.knowledge !== "rumored")
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

  drawMapFoundation(svg, mapDto, knownArea, viewport);

  for (const route of mapDto.routes || []) drawRoute(svg, route, knownArea, viewport);
  for (const location of mapDto.locations || []) drawLocation(svg, location, knownArea, viewport);
  for (const landmark of mapDto.landmarks || []) drawLandmark(svg, landmark, knownArea, viewport);

  if (mapDto.observer?.xMetres != null && mapDto.observer?.yMetres != null) {
    const pos = projectPoint(mapDto.observer.xMetres, mapDto.observer.yMetres, knownArea, viewport);
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
  const exactLocations = (mapDto.locations || []).filter((location) => location.knowledge !== "rumored").length;
  fogStatus.textContent = exactLocations > 0
    ? "\u041e\u0442\u043a\u0440\u044b\u0442\u043e \u043c\u0435\u0441\u0442: " + exactLocations + ". \u041e\u0441\u0442\u0430\u043b\u044c\u043d\u043e\u0439 \u0440\u0435\u0433\u0438\u043e\u043d \u0441\u043a\u0440\u044b\u0442 \u0442\u0443\u043c\u0430\u043d\u043e\u043c."
    : "\u0420\u0435\u0433\u0438\u043e\u043d \u0441\u043a\u0440\u044b\u0442 \u0442\u0443\u043c\u0430\u043d\u043e\u043c. \u0418\u0441\u0441\u043b\u0435\u0434\u0443\u0439 \u043c\u0438\u0440, \u0447\u0442\u043e\u0431\u044b \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u043a\u0430\u0440\u0442\u0443.";
  container.appendChild(fogStatus);
  container.appendChild(buildMapList(mapDto));
}

function drawMapFoundation(svg, mapDto, knownArea, viewport) {
  const terrain = mapDto.knownTerrain || [];
  for (const patch of terrain) {
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
  const pos = projectPoint(location.xMetres, location.yMetres, knownArea, viewport);
  if (!pos) return;

  const g = document.createElementNS(SVG_NS, "g");
  g.classList.add("map-location", "knowledge-" + location.knowledge);
  g.setAttribute("role", "img");
  g.setAttribute("aria-label", location.name + " (" + location.knowledge + ")");

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
  if (landmark.xMetres == null || landmark.yMetres == null) {
    if (landmark.bearing) {
      const text = document.createElementNS(SVG_NS, "text");
      text.classList.add("map-bearing");
      text.setAttribute("x", String(viewport.width / 2));
      text.setAttribute("y", "15");
      text.setAttribute("text-anchor", "middle");
      text.textContent = landmark.name + " — " + landmark.bearing;
      svg.appendChild(text);
    }
    return;
  }
  const pos = projectPoint(landmark.xMetres, landmark.yMetres, knownArea, viewport);
  if (!pos) return;

  const g = document.createElementNS(SVG_NS, "g");
  g.classList.add("map-landmark");
  g.setAttribute("role", "img");
  g.setAttribute("aria-label", landmark.name + " (" + landmark.silhouette + ")");

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

function buildMapList(mapDto) {
  const section = document.createElement("section");
  section.className = "player-map-list";
  section.setAttribute("aria-label", "\u0418\u0437\u0432\u0435\u0441\u0442\u043d\u044b\u0435 \u043c\u0435\u0441\u0442\u0430");

  const heading = document.createElement("h3");
  heading.textContent = "\u0418\u0437\u0432\u0435\u0441\u0442\u043d\u044b\u0435 \u043c\u0435\u0441\u0442\u0430";
  section.appendChild(heading);

  const list = document.createElement("ul");
  for (const location of mapDto.locations || []) {
    const item = document.createElement("li");
    const suffix = location.knowledge === "rumored" ? " — \u043f\u043e \u0441\u043b\u0443\u0445\u0430\u043c, \u043f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e" : "";
    item.textContent = location.name + suffix;
    list.appendChild(item);
  }
  for (const landmark of mapDto.landmarks || []) {
    const item = document.createElement("li");
    const bearing = landmark.bearing ? " — " + landmark.bearing : "";
    const unknown = landmark.xMetres == null ? " (\u0442\u043e\u0447\u043d\u0430\u044f \u043f\u043e\u0437\u0438\u0446\u0438\u044f \u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430)" : "";
    item.textContent = landmark.name + bearing + unknown;
    list.appendChild(item);
  }
  if (list.children.length === 0) {
    const item = document.createElement("li");
    item.textContent = "\u0418\u0437\u0432\u0435\u0441\u0442\u043d\u044b\u0445 \u043c\u0435\u0441\u0442 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442.";
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
