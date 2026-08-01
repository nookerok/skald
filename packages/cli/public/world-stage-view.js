import { byId, makeNode } from "./dom-helpers.js";
export function renderWorldStage(world = {}, attention = {}, situation = null) {
  const title = world.locationName || "Место неизвестно";
  const titleElement = byId("stage-location-title");
  const descriptionElement = byId("stage-location-description");
  if (titleElement) titleElement.textContent = title;
  if (descriptionElement) descriptionElement.textContent = world.locationDescription || "Летопись ещё не открыла это место.";
  const marker = byId("stage-marker");
  if (marker) marker.setAttribute("aria-label", "Текущее положение: " + title);
  const links = byId("stage-links");
  if (links) {
    links.replaceChildren();
    const connected = Array.isArray(world.connectedLocations) ? world.connectedLocations : [];
    if (connected.length === 0) links.appendChild(makeNode("p", { className: "stage-empty", text: "Другие места пока не открыты." }));
    connected.slice(0, 4).forEach((location) => {
      const name = location.label || location.name || "Место";
      const button = makeNode("button", { className: "stage-link", text: name, attrs: { type: "button", "aria-label": "Показать сведения о " + name } });
      button.addEventListener("click", () => document.dispatchEvent(new CustomEvent("skald:context-select", { detail: { locationId: location.id, name } })));
      links.appendChild(button);
    });
  }
  const marks = byId("stage-attention");
  if (marks) {
    marks.replaceChildren();
    const count = Math.max(0, Math.min(Number(attention.marks) || 0, Number(attention.maxMarks) || 5));
    const max = Number(attention.maxMarks) || 5;
    for (let index = 0; index < max; index += 1) marks.appendChild(makeNode("span", { className: "attention-mark" + (index < count ? " is-filled" : "") }));
    marks.setAttribute("aria-label", "Внимание мира: " + count + " из " + max);
  }
  const attentionText = byId("stage-attention-text");
  if (attentionText) attentionText.textContent = attention.explanation || "Мир спокоен";
  const situationCard = byId("situation-card");
  if (situationCard) {
    situationCard.replaceChildren();
    situationCard.hidden = !situation;
    if (situation) {
      situationCard.append(makeNode("span", { className: "eyebrow", text: "АКТИВНАЯ СИТУАЦИЯ" }), makeNode("strong", { text: situation.title || "Ситуация" }), makeNode("p", { text: situation.description || "" }));
      if (Array.isArray(situation.effects) && situation.effects.length) {
        const effects = makeNode("div", { className: "situation-effects" });
        situation.effects.forEach((effect) => effects.appendChild(makeNode("span", { className: "situation-effect " + (effect.tone || "neutral"), text: effect.label })));
        situationCard.appendChild(effects);
      }
    }
  }
}
