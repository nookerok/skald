import { byId, emptyState, makeNode } from "./dom-helpers.js";
function renderList(id, items, emptyText) {
  const container = byId(id);
  if (!container) return;
  container.replaceChildren();
  if (!items || !items.length) { container.appendChild(emptyState(emptyText, "sidebar-empty")); return; }
  items.slice(0, 6).forEach((item) => {
    const label = typeof item === "string" ? item : (item.label || item.targetLabel || "Без названия");
    const detail = typeof item === "object" ? (item.detail || item.relationLabel || "") : "";
    const button = makeNode("button", { className: "sidebar-entry", attrs: { type: "button", "aria-label": "Показать сведения: " + label } });
    button.appendChild(makeNode("span", { className: "sidebar-entry-icon", text: "✧" }));
    const copy = makeNode("span", { className: "sidebar-entry-copy" });
    copy.appendChild(makeNode("strong", { text: label }));
    if (detail !== "" && detail !== undefined) copy.appendChild(makeNode("small", { text: String(detail) }));
    button.appendChild(copy);
    button.addEventListener("click", () => document.dispatchEvent(new CustomEvent("skald:context-select", { detail: { label } })));
    container.appendChild(button);
  });
}
export function renderWorldSidebar(snapshot = {}) {
  const world = snapshot.world || {};
  const character = snapshot.character || {};
  const knowledge = snapshot.knowledge || {};
  renderList("world-sidebar-nearby", (snapshot.recentActivity || []).filter((item) => item.scope === "visible"), "Пока ничего не замечено.");
  renderList("world-sidebar-places", world.connectedLocations || (world.locationName ? [{ name: world.locationName, text: "Текущее место" }] : []), "Известных мест пока нет.");
  renderList("world-sidebar-relations", character.relations || [], "Связи ещё не проявились.");
  renderList("world-sidebar-interest", [...(knowledge.traces || []), ...(knowledge.facts || [])], "Мир пока не оставил заметных следов.");
}
