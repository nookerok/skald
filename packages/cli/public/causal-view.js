import { byId, makeNode } from "./dom-helpers.js";
const labels = { intention: "Намерение", action: "Действие", outcome: "Результат", observation: "Наблюдение", consequence: "Последствие" };
export function renderCausalChain(steps = []) {
  const list = byId("causal-timeline");
  if (!list) return;
  list.replaceChildren();
  if (!steps.length) { list.appendChild(makeNode("li", { className: "causal-empty", text: "Последствий последнего хода пока нет." })); return; }
  steps.slice(0, 8).forEach((step) => {
    const item = makeNode("li", { className: "causal-step " + (step.kind || "outcome") });
    item.append(makeNode("span", { className: "causal-kind", text: labels[step.kind] || "Событие" }), makeNode("p", { text: step.text || "Мир изменился." }));
    list.appendChild(item);
  });
}
