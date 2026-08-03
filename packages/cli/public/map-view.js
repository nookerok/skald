/**
 * Map View — SVG/DOM renderer for Player Map (ADR-0019 §4).
 *
 * Pure function: ObserverMapDTO → DOM nodes.
 * No Event Log, no ReadonlyWorld, no fetch, no commands.
 */

import { projectPoint, computeBounds } from "./map-layout.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Render the observer map into a container.
 * @param {HTMLElement} container - Target container
 * @param {object} mapDto - ObserverMapDTO
 */
export function renderObserverMap(container, mapDto) {
  if (!container || !mapDto) return;

  container.replaceChildren();
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", "Наблюдаемая карта региона");

  if (!mapDto.locations?.length && !mapDto.landmarks?.length && !mapDto.routes?.length) {
    const empty = document.createElement("p");
    empty.className = "map-empty";
    empty.textContent = "Нет известных данных о пространстве.";
    container.appendChild(empty);
    return;
  }

  // Compute bounds from all visible items
  const allItems = [
    ...mapDto.locations.map((l) => ({ xMetres: l.xMetres, yMetres: l.yMetres })),
    ...mapDto.landmarks.filter((l) => l.xMetres != null).map((l) => ({ xMetres: l.xMetres, yMetres: l.yMetres })),
  ];
  const knownArea = mapDto.knownArea || computeBounds(allItems);

  if (!knownArea) {
    const empty = document.createElement("p");
    empty.className = "map-empty";
    empty.textContent = "Область наблюдения не определена.";
    container.appendChild(empty);
    return;
  }

  // Create SVG
  const viewport = { width: 400, height: 300 };
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
  svg.setAttribute("aria-label", "Наблюдаемая карта региона");
  svg.classList.add("player-map-svg");

  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = "Наблюдаемая карта региона";
  svg.appendChild(title);

  const desc = document.createElementNS(SVG_NS, "desc");
  desc.textContent = buildMapDescription(mapDto);
  svg.appendChild(desc);

  // Draw routes (behind locations)
  for (const route of mapDto.routes) {
    drawRoute(svg, route, knownArea, viewport, mapDto);
  }

  // Draw locations
  for (const location of mapDto.locations) {
    drawLocation(svg, location, knownArea, viewport);
  }

  // Draw landmarks
  for (const landmark of mapDto.landmarks) {
    drawLandmark(svg, landmark, knownArea, viewport);
  }

  // Draw observer position
  if (mapDto.observer?.xMetres != null && mapDto.observer?.yMetres != null) {
    const pos = projectPoint(mapDto.observer.xMetres, mapDto.observer.yMetres, knownArea, viewport);
    if (pos) {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", pos.x);
      circle.setAttribute("cy", pos.y);
      circle.setAttribute("r", "5");
      circle.setAttribute("fill", "#e74c3c");
      circle.setAttribute("stroke", "#fff");
      circle.setAttribute("stroke-width", "2");
      circle.setAttribute("aria-label", "Твоё положение");
      svg.appendChild(circle);
    }
  }

  container.appendChild(svg);

  // Add list fallback for accessibility
  const list = buildMapList(mapDto);
  container.appendChild(list);
}

function drawLocation(svg, location, knownArea, viewport) {
  const pos = projectPoint(location.xMetres, location.yMetres, knownArea, viewport);
  if (!pos) return;

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("role", "img");
  g.setAttribute("aria-label", `${location.name} (${location.knowledge})`);

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", pos.x);
  circle.setAttribute("cy", pos.y);
  circle.setAttribute("r", location.knowledge === "traversed" ? "6" : "4");

  if (location.knowledge === "traversed") {
    circle.setAttribute("fill", "#2ecc71");
    circle.setAttribute("stroke", "#27ae60");
  } else if (location.knowledge === "observed") {
    circle.setAttribute("fill", "#3498db");
    circle.setAttribute("stroke", "#2980b9");
  } else if (location.knowledge === "glimpsed") {
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "#95a5a6");
    circle.setAttribute("stroke-dasharray", "2,2");
  } else {
    circle.setAttribute("fill", "#bdc3c7");
    circle.setAttribute("stroke", "#95a5a6");
  }
  circle.setAttribute("stroke-width", "1.5");
  g.appendChild(circle);

  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", pos.x + 8);
  text.setAttribute("y", pos.y + 4);
  text.setAttribute("font-size", "10");
  text.setAttribute("fill", "#2c3e50");
  text.textContent = location.name;
  g.appendChild(text);

  svg.appendChild(g);
}

function drawLandmark(svg, landmark, knownArea, viewport) {
  if (landmark.xMetres == null || landmark.yMetres == null) {
    // Glimpsed: show bearing indicator at viewport edge
    if (landmark.bearing) {
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", viewport.width / 2);
      text.setAttribute("y", 15);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "9");
      text.setAttribute("fill", "#7f8c8d");
      text.setAttribute("font-style", "italic");
      text.textContent = `${landmark.name} — ${landmark.bearing}`;
      svg.appendChild(text);
    }
    return;
  }

  const pos = projectPoint(landmark.xMetres, landmark.yMetres, knownArea, viewport);
  if (!pos) return;

  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("role", "img");
  g.setAttribute("aria-label", `${landmark.name} (${landmark.silhouette})`);

  // Diamond shape for landmarks
  const diamond = document.createElementNS(SVG_NS, "polygon");
  const s = landmark.silhouette === "monolith" ? 8 : 6;
  diamond.setAttribute("points", `${pos.x},${pos.y - s} ${pos.x + s},${pos.y} ${pos.x},${pos.y + s} ${pos.x - s},${pos.y}`);
  diamond.setAttribute("fill", landmark.knowledge === "observed" ? "#9b59b6" : "#8e44ad");
  diamond.setAttribute("stroke", "#6c3483");
  diamond.setAttribute("stroke-width", "1");
  g.appendChild(diamond);

  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", pos.x + s + 4);
  text.setAttribute("y", pos.y + 4);
  text.setAttribute("font-size", "10");
  text.setAttribute("fill", "#2c3e50");
  text.textContent = landmark.name;
  g.appendChild(text);

  svg.appendChild(g);
}

function drawRoute(svg, route, knownArea, viewport, mapDto) {
  if (!route.geometry) return;

  if (route.geometry.kind === "observed_path") {
    const points = route.geometry.points;
    if (points.length < 2) return;

    const pathData = points.map((p, i) => {
      const pos = projectPoint(p.xMetres, p.yMetres, knownArea, viewport);
      return pos ? `${i === 0 ? "M" : "L"}${pos.x},${pos.y}` : null;
    }).filter(Boolean).join(" ");

    if (!pathData) return;

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathData);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", route.kind === "crossing" ? "#e67e22" : "#7f8c8d");
    path.setAttribute("stroke-width", route.kind === "river" ? "2" : "1.5");
    if (route.knowledge !== "observed" && route.knowledge !== "traversed") {
      path.setAttribute("stroke-dasharray", "4,2");
    }
    path.setAttribute("aria-label", route.label);
    svg.appendChild(path);
  } else if (route.geometry.kind === "directional_stub") {
    // Show bearing text only
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", viewport.width / 2);
    text.setAttribute("y", viewport.height - 10);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", "9");
    text.setAttribute("fill", "#95a5a6");
    text.textContent = `${route.label} — ${route.geometry.bearing}`;
    svg.appendChild(text);
  }
}

function buildMapList(mapDto) {
  const section = document.createElement("section");
  section.className = "player-map-list";
  section.setAttribute("aria-label", "Известные места");

  const heading = document.createElement("h3");
  heading.textContent = "Известные места";
  section.appendChild(heading);

  const ul = document.createElement("ul");

  for (const loc of mapDto.locations) {
    const li = document.createElement("li");
    li.textContent = `${loc.name} (${loc.knowledge})`;
    ul.appendChild(li);
  }

  for (const lm of mapDto.landmarks) {
    const li = document.createElement("li");
    const bearing = lm.bearing ? ` — ${lm.bearing}` : "";
    const coord = lm.xMetres != null ? "" : " (точная позиция неизвестна)";
    li.textContent = `${lm.name}${bearing}${coord}`;
    ul.appendChild(li);
  }

  section.appendChild(ul);
  return section;
}

function buildMapDescription(mapDto) {
  const parts = [];
  if (mapDto.locations?.length) parts.push(`${mapDto.locations.length} известных мест`);
  if (mapDto.landmarks?.length) parts.push(`${mapDto.landmarks.length} ориентиров`);
  if (mapDto.routes?.length) parts.push(`${mapDto.routes.length} маршрутов`);
  return parts.length > 0 ? parts.join(", ") : "Нет данных";
}
