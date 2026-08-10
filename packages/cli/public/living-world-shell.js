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
  const position = world.position || { x: 0, y: 0 };
  setText("pos-display", position.x + ", " + position.y);
}
export function renderLivingWorldMap(mapDto) {
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
  renderObserverMap(mapContainer, mapDto);
  if (legendContainer) renderMapLegend(legendContainer);
}

export function renderLivingWorld(snapshot) {
  if (!snapshot) return;
  renderConnection(snapshot);
  renderWorldStage(snapshot.world, snapshot.attention, snapshot.currentSituation);
  renderWorldSidebar(snapshot);
  renderContextRail(snapshot);
  renderActivity(snapshot.recentActivity || []);
  renderCausalChain(snapshot.lastTurn?.causalChain || []);
  renderCriticalCheck(snapshot.lastTurn?.causalChain || []);

  // Some single-world snapshots still embed the DTO. Multi-world shells
  // load the same observer-scoped contract through map-client.js.
  if (snapshot.observerMap) renderLivingWorldMap(snapshot.observerMap);
}
