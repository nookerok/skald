/** Presentation-only image layer and map affordances. */
import { isPresentationDetailUnlocked } from "./presentation-map.js";
const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_STORAGE_PREFIX = "skald.map.view.";

function storageKey(regionId) {
  return VIEW_STORAGE_PREFIX + (regionId || "region");
}

function readView(regionId) {
  const fallback = { zoom: 1, panX: 0, panY: 0, assetId: "overview" };
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(regionId));
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      zoom: Number.isFinite(parsed?.zoom) ? Math.min(2.4, Math.max(0.7, parsed.zoom)) : fallback.zoom,
      panX: Number.isFinite(parsed?.panX) ? Math.max(-600, Math.min(600, parsed.panX)) : fallback.panX,
      panY: Number.isFinite(parsed?.panY) ? Math.max(-600, Math.min(600, parsed.panY)) : fallback.panY,
      assetId: typeof parsed?.assetId === "string" ? parsed.assetId : fallback.assetId,
    };
  } catch {
    return fallback;
  }
}

function writeView(regionId, view) {
  try {
    globalThis.localStorage?.setItem(storageKey(regionId), JSON.stringify(view));
  } catch {
    // Private browsing and test DOMs may not expose storage.
  }
}

export function readMapView(regionId) {
  return readView(regionId);
}

export function rememberMapAsset(regionId, assetId) {
  const view = readView(regionId);
  writeView(regionId, { ...view, assetId: assetId || "overview" });
}

function clampView(view) {
  return {
    zoom: Math.min(2.4, Math.max(0.7, Number(view.zoom.toFixed(2)))),
    panX: Math.max(-600, Math.min(600, Number(view.panX.toFixed(1)))),
    panY: Math.max(-600, Math.min(600, Number(view.panY.toFixed(1)))),
    assetId: typeof view.assetId === "string" ? view.assetId : "overview",
  };
}

export function drawPresentationImage(svg, manifest, viewport, asset = manifest.overview) {
  const image = document.createElementNS(SVG_NS, "image");
  image.classList.add("player-map-artwork");
  image.setAttribute("x", "0");
  image.setAttribute("y", "0");
  image.setAttribute("width", String(viewport.width));
  image.setAttribute("height", String(viewport.height));
  // The full source remains visible at overview scale; fog is the only veil.
  image.setAttribute("preserveAspectRatio", "xMidYMid meet");
  image.setAttribute("href", asset.src);
  image.setAttribute("data-map-artifact", asset.id);
  image.setAttribute("data-map-coverage", JSON.stringify(asset.coverageBounds || null));
  image.setAttribute("aria-label", asset.alt);
  svg.appendChild(image);
  return image;
}

export function buildMapControls(svg, options = {}) {
  const controls = document.createElement("div");
  controls.className = "player-map-controls";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "Управление картой");

  const regionId = options.regionId || "region";
  let view = readView(regionId);
  const label = document.createElement("span");
  label.className = "map-zoom-label";
  controls.appendChild(label);

  const applyView = (persist = true) => {
    view = clampView(view);
    svg.style.transformOrigin = "50% 50%";
    svg.style.transition = "transform 220ms ease-out";
    svg.style.transform = "translate(" + view.panX + "px, " + view.panY + "px) scale(" + view.zoom + ")";
    svg.setAttribute("data-zoom", String(view.zoom));
    label.textContent = "Масштаб " + Math.round(view.zoom * 100) + "%";
    if (persist) writeView(regionId, view);
  };

  const addButton = (text, accessibleName, action, control) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-zoom-button";
    button.textContent = text;
    button.setAttribute("aria-label", accessibleName);
    button.setAttribute("data-map-control", control);
    if (button.addEventListener) button.addEventListener("click", action);
    controls.appendChild(button);
  };

  addButton("−", "Уменьшить карту", () => {
    view.zoom -= 0.15;
    applyView();
  }, "zoom-out");
  addButton("+", "Увеличить карту", () => {
    view.zoom += 0.15;
    applyView();
  }, "zoom-in");
  addButton("⌖", "Вернуться к текущей области", () => {
    const point = options.currentPoint;
    if (point) {
      view.panX = 200 - (200 + (point.x - 200) * view.zoom);
      view.panY = 150 - (150 + (point.y - 150) * view.zoom);
    } else {
      view.panX = 0;
      view.panY = 0;
    }
    applyView();
  }, "center-current");
  addButton("↺", "Сбросить вид карты", () => {
    view = { zoom: 1, panX: 0, panY: 0, assetId: "overview" };
    applyView();
  }, "reset-view");

  // Dragging is a presentation gesture only; it never changes observer facts.
  if (svg.addEventListener) {
    let drag = null;
    svg.style.touchAction = "none";
    svg.addEventListener("pointerdown", (event) => {
      drag = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
      svg.setPointerCapture?.(event.pointerId);
    });
    svg.addEventListener("pointermove", (event) => {
      if (!drag) return;
      view.panX = drag.panX + event.clientX - drag.x;
      view.panY = drag.panY + event.clientY - drag.y;
      applyView();
    });
    const stopDrag = () => { drag = null; };
    svg.addEventListener("pointerup", stopDrag);
    svg.addEventListener("pointercancel", stopDrag);
    svg.addEventListener("pointerleave", stopDrag);
  }

  applyView(false);
  return controls;
}

export function buildDetailGallery(manifest, onSelect, mapDto) {
  const section = document.createElement("section");
  const selectAsset = (event, asset) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    onSelect?.(asset);
  };
  section.className = "map-detail-gallery";
  section.setAttribute("aria-label", "Укрупнённые регионы");
  const heading = document.createElement("div");
  heading.className = "map-detail-heading";
  const title = document.createElement("h3");
  title.textContent = "Участки региона";
  heading.appendChild(title);
  const note = document.createElement("p");
  note.textContent = "Визуальная справка без новых фактов: туман скрывает неизведанное.";
  heading.appendChild(note);
  section.appendChild(heading);

  const overviewButton = document.createElement("button");
  overviewButton.type = "button";
  overviewButton.className = "map-detail-switch map-detail-switch--overview";
  overviewButton.textContent = "Обзор региона";
  overviewButton.setAttribute("aria-label", "Показать общий вид региона");
  overviewButton.setAttribute("data-map-detail", "overview");
  overviewButton.setAttribute("data-map-asset", "overview");
  if (overviewButton.addEventListener) overviewButton.addEventListener("click", (event) => selectAsset(event, manifest.overview));
  section.appendChild(overviewButton);

  const grid = document.createElement("div");
  grid.className = "map-detail-grid";
  for (const detail of manifest.details) {
    const unlocked = isPresentationDetailUnlocked(detail, mapDto);
    const figure = document.createElement("figure");
    figure.classList.add("map-detail-card");
    if (!unlocked) figure.classList.add("map-detail-card--locked");
    figure.setAttribute("role", unlocked ? "button" : "img");
    if (unlocked) {
      // Identifiers, labels and coverage metadata become public only after the
      // server-scoped knowledge policy allows this detail.
      figure.setAttribute("data-map-detail", detail.id);
      figure.setAttribute("data-map-asset", detail.id);
      figure.setAttribute("tabindex", "0");
      figure.setAttribute("aria-label", "Показать " + detail.label);
    } else {
      figure.setAttribute("data-map-detail-state", "locked");
      figure.setAttribute("aria-label", "Участок карты скрыт туманом");
      figure.setAttribute("aria-disabled", "true");
    }
    const image = document.createElement("img");
    if (unlocked) {
      image.src = detail.src;
      image.setAttribute("data-map-detail-image", detail.id);
      image.setAttribute("data-map-coverage", JSON.stringify(detail.coverageBounds || null));
    }
    image.alt = unlocked ? detail.alt : "Участок скрыт туманом";
    image.loading = "lazy";
    figure.appendChild(image);
    const veil = document.createElement("span");
    veil.className = "map-detail-fog";
    veil.setAttribute("aria-hidden", "true");
    figure.appendChild(veil);
    const caption = document.createElement("figcaption");
    caption.textContent = unlocked ? detail.label : "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c";
    figure.appendChild(caption);
    if (unlocked && figure.addEventListener) {
      figure.addEventListener("click", (event) => selectAsset(event, detail));
      figure.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") selectAsset(event, detail);
      });
    }
    grid.appendChild(figure);
  }
  const slotCount = Number.isInteger(manifest.detailSlotCount) ? manifest.detailSlotCount : manifest.details.length;
  for (let index = manifest.details.length; index < slotCount; index += 1) {
    const figure = document.createElement("figure");
    figure.className = "map-detail-card map-detail-card--locked";
    figure.setAttribute("role", "img");
    figure.setAttribute("data-map-detail-state", "locked");
    figure.setAttribute("aria-label", "\u0423\u0447\u0430\u0441\u0442\u043e\u043a \u043a\u0430\u0440\u0442\u044b \u0441\u043a\u0440\u044b\u0442 \u0442\u0443\u043c\u0430\u043d\u043e\u043c");
    figure.setAttribute("aria-disabled", "true");
    const image = document.createElement("img");
    image.alt = "\u0423\u0447\u0430\u0441\u0442\u043e\u043a \u0441\u043a\u0440\u044b\u0442 \u0442\u0443\u043c\u0430\u043d\u043e\u043c";
    image.loading = "lazy";
    figure.appendChild(image);
    const veil = document.createElement("span");
    veil.className = "map-detail-fog";
    veil.setAttribute("aria-hidden", "true");
    figure.appendChild(veil);
    const caption = document.createElement("figcaption");
    caption.textContent = "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u043e\u0431\u043b\u0430\u0441\u0442\u044c";
    figure.appendChild(caption);
    grid.appendChild(figure);
  }
  section.appendChild(grid);
  return section;
}
