import { byId, makeNode } from "./dom-helpers.js";
function markLabel(mark) { return mark === "trace" ? "След" : mark === "omen" ? "Знамение" : mark === "echo" ? "Эхо" : mark || ""; }
export function renderTurnHistory(journal) {
  const container = byId("turn-history-list");
  if (!container) return;
  container.replaceChildren();
  const turns = Array.isArray(journal?.turns) ? journal.turns.slice(-5) : [];
  if (!turns.length) { container.appendChild(makeNode("p", { className: "history-empty", text: "История начнётся с первого последствия." })); return; }
  turns.forEach((turn, index) => {
    const primary = turn.presentation?.primary;
    const card = makeNode("article", { className: "history-card" + (index === turns.length - 1 ? " is-current" : "") });
    card.append(makeNode("span", { className: "history-time", text: "Ход " + turn.worldTime }), makeNode("p", { className: "history-primary", text: primary?.text || "Мир продолжил жить." }));
    if (primary?.discoveryMark) card.appendChild(makeNode("span", { className: "history-mark", text: markLabel(primary.discoveryMark) }));
    const notable = turn.presentation?.notable?.[0];
    if (notable) card.appendChild(makeNode("small", { className: "history-notable", text: notable.text }));
    container.appendChild(card);
    if (index < turns.length - 1) container.appendChild(makeNode("span", { className: "history-arrow", text: "→", attrs: { "aria-hidden": "true" } }));
  });
}
