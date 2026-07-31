import { byId, makeNode } from "./dom-helpers.js";
export function renderCriticalCheck(steps = []) {
  const card = byId("critical-check-card");
  if (!card) return;
  const relevant = steps.filter((step) => step.critical || /Критический момент|Бросок:|Итого /.test(step.text || ""));
  card.replaceChildren();
  card.hidden = !relevant.length;
  if (!relevant.length) return;
  card.append(makeNode("span", { className: "eyebrow", text: "CRITICAL CHECK" }), makeNode("h2", { text: "Критический момент" }));
  relevant.forEach((step) => {
    const row = makeNode("div", { className: "check-row" });
    if (step.critical) {
      const stakes = makeNode("strong", { className: "check-stakes" });
      stakes.append(makeNode("span", { text: "Успех: " + step.critical.success }), makeNode("span", { text: "Провал: " + step.critical.failure }));
      row.append(makeNode("span", { className: "check-label", text: "Ставки" }), stakes);
    } else {
      row.append(makeNode("span", { className: "check-label", text: step.text.startsWith("Критический") ? "Ставки" : step.text.startsWith("Бросок") ? "Бросок" : "Итог" }), makeNode("strong", { text: step.text }));
    }
    card.appendChild(row);
  });
}
