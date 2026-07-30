import { byId, makeNode } from "./dom-helpers.js";
import { renderWorldStage } from "./world-stage-view.js";
import { renderWorldSidebar } from "./world-sidebar-view.js";
import { renderContextRail } from "./context-rail-view.js";
import { renderActivity } from "./activity-view.js";
import { renderCausalChain } from "./causal-view.js";
import { renderCriticalCheck } from "./critical-check-view.js";
import { renderTurnHistory } from "./turn-history-view.js";
function setText(id, value) { const element = byId(id); if (element) element.textContent = value == null ? "" : String(value); }
function renderNarrative(turn) {
  const card = byId("primary-card"); const empty = byId("empty-state"); if (!card) return;
  card.replaceChildren();
  const primary = turn?.primary;
  if (!primary) { card.hidden = true; if (empty) empty.hidden = false; } else {
    if (empty) empty.hidden = true;
    card.hidden = false;
    card.append(makeNode("span", { className: "eyebrow", text: "ПОСЛЕДНЕЕ ИЗМЕНЕНИЕ" }), makeNode("h2", { className: "primary-title", text: primary.text || "Мир изменился." }));
    if (primary.discoveryMark) card.appendChild(makeNode("span", { className: "discovery-mark", text: primary.discoveryMark }));
  }
  const notable = byId("notable-list"); if (notable) notable.replaceChildren(...(turn?.notable || []).slice(0, 3).map((entry) => makeNode("article", { className: "notable-item", text: entry.text })));
  const background = byId("background-list"); if (background) background.replaceChildren(...(turn?.background || []).slice(0, 5).map((entry) => makeNode("p", { className: "background-item", text: entry.text })));
}
function renderConnection(snapshot) {
  setText("active-world-label", snapshot.worldId || "Мир");
  setText("time-display", "Ход " + (snapshot.revision?.worldTime ?? 0));
  const world = snapshot.world || {};
  setText("place-display", world.locationName || "Место неизвестно");
  const position = world.position || { x: 0, y: 0 };
  setText("pos-display", position.x + ", " + position.y);
}
export function renderLivingWorld(snapshot) {
  if (!snapshot) return;
  renderConnection(snapshot);
  renderWorldStage(snapshot.world, snapshot.attention, snapshot.currentSituation);
  renderWorldSidebar(snapshot);
  renderContextRail(snapshot);
  renderActivity(snapshot.recentActivity || []);
  renderNarrative(snapshot.lastTurn);
  renderCausalChain(snapshot.lastTurn?.causalChain || []);
  renderCriticalCheck(snapshot.lastTurn?.causalChain || []);
}
export { renderTurnHistory };
