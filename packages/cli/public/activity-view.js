import { byId, emptyState, makeNode } from "./dom-helpers.js";
let currentScope = "visible";
let currentItems = [];
function renderItems() {
  const container = byId("world-activity-list");
  if (!container) return;
  container.replaceChildren();
  const filtered = currentItems.filter((item) => item.scope === currentScope);
  if (!filtered.length) { container.appendChild(emptyState(currentScope === "visible" ? "Рядом пока ничего не изменилось." : "В этой области пока нет новых сведений.", "activity-empty")); return; }
  filtered.slice(0, 8).forEach((item) => {
    const row = makeNode("article", { className: "activity-entry " + (item.origin || "") });
    row.append(makeNode("span", { className: "activity-origin", text: item.origin === "world_tick" ? "МИР" : item.origin === "consequence" ? "ОТКЛИК" : "ТЫ" }), makeNode("p", { text: item.text || "Изменение мира." }));
    container.appendChild(row);
  });
}
export function initActivityView() {
  document.querySelectorAll("[data-activity-scope]").forEach((button) => button.addEventListener("click", () => {
    currentScope = button.dataset.activityScope || "visible";
    document.querySelectorAll("[data-activity-scope]").forEach((item) => item.setAttribute("aria-selected", String(item === button)));
    renderItems();
  }));
}
export function renderActivity(items = []) { currentItems = Array.isArray(items) ? items : []; renderItems(); }
