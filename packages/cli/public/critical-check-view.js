import { byId, makeNode } from "./dom-helpers.js";
export function renderCriticalCheck(steps = []) {
  const card = byId("critical-check-card");
  if (!card) return;
  const relevant = steps.filter((step) => /Критический момент|Бросок:|Итого /.test(step.text || ""));
  card.replaceChildren();
  card.hidden = !relevant.length;
  if (!relevant.length) return;
  card.append(makeNode("span", { className: "eyebrow", text: "CRITICAL CHECK" }), makeNode("h2", { text: "Критический момент" }));
  relevant.forEach((step) => {
    const row = makeNode("div", { className: "check-row" });
    row.append(makeNode("span", { className: "check-label", text: step.text.startsWith("Критический") ? "Ставки" : step.text.startsWith("Бросок") ? "Бросок" : "Итог" }), makeNode("strong", { text: step.text }));
    card.appendChild(row);
  });
}
