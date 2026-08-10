import { byId, makeNode } from "./dom-helpers.js";
import { renderWorldStage } from "./world-stage-view.js";
import { renderWorldSidebar } from "./world-sidebar-view.js";
import { renderContextRail } from "./context-rail-view.js";
import { renderActivity } from "./activity-view.js";
import { renderCausalChain } from "./causal-view.js";
import { renderCriticalCheck } from "./critical-check-view.js";
import { renderObserverMap } from "./map-view.js";
import { renderMapLegend } from "./map-legend.js";
function setText(id, value) { const element = byId(id); if (element) element.textContent = value == null ? "" : String(value); }
function renderConnection(snapshot) {
  setText("active-world-label", snapshot.worldId || "Мир");
  setText("time-display", "Ход " + (snapshot.revision?.worldTime ?? 0));
  const world = snapshot.world || {};
  setText("place-display", world.locationName || "Место неизвестно");
}
function renderJourneyStatus(journey) {
  const section = byId("journey-status");
  const text = byId("journey-status-text");
  const stage = byId("journey-status-stage");
  if (!section) return;
  const active = journey && journey.status !== "idle";
  section.hidden = !active;
  if (!active) {
    if (text) text.textContent = "";
    if (stage) stage.textContent = "";
    return;
  }
  if (text) text.textContent = journey.text || "Путь продолжается.";
  if (stage) {
    if (journey.status === "traveling") {
      const elapsed = Number.isFinite(journey.elapsedTicks) ? journey.elapsedTicks : 0;
      const total = Math.max(Number.isFinite(journey.totalTicks) ? journey.totalTicks : 0, 1);
      stage.textContent = "Этап " + Math.min(elapsed + 1, total) + " из " + total;
    } else {
      stage.textContent = "Путь завершён.";
    }
  }
}
export function renderLivingWorldMap(mapDto, journey) {
  const mapContainer = byId("player-map-canvas");
  const legendContainer = byId("player-map-legend");
  if (!mapContainer) return;
  if (!mapDto) {
    mapContainer.replaceChildren(makeNode("p", {
      className: "map-empty-state",
      text: "Карта временно недоступна.",
      attrs: { role: "status" },
    }));
    if (legendContainer) legendContainer.replaceChildren();
    return;
  }
  renderObserverMap(mapContainer, mapDto, { journey });
  if (legendContainer) renderMapLegend(legendContainer);
}

export function renderLivingWorld(snapshot) {
  if (!snapshot) return;
  renderConnection(snapshot);
  renderJourneyStatus(snapshot.journey);
  renderWorldStage(snapshot.world, snapshot.attention, snapshot.currentSituation);
  renderWorldSidebar(snapshot);
  renderContextRail(snapshot);
  renderActivity(snapshot.recentActivity || []);
  renderCausalChain(snapshot.lastTurn?.causalChain || []);
  renderCriticalCheck(snapshot.lastTurn?.causalChain || []);

  // Some single-world snapshots still embed the DTO. Multi-world shells
  // load the same observer-scoped contract through map-client.js.
  if (snapshot.observerMap) renderLivingWorldMap(snapshot.observerMap, snapshot.journey);
}
