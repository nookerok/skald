import { byId, emptyState, makeNode } from "./dom-helpers.js";
let currentSnapshot = null;
function addSection(parent, title, content) {
  const section = makeNode("section", { className: "context-section" });
  section.appendChild(makeNode("h3", { text: title }));
  if (content) section.appendChild(content);
  parent.appendChild(section);
}
function listValues(values, emptyText) {
  const list = makeNode("ul", { className: "context-list" });
  if (!values || !values.length) { list.appendChild(emptyState(emptyText, "context-empty")); return list; }
  values.slice(0, 8).forEach((value) => list.appendChild(makeNode("li", { text: typeof value === "string" ? value : (value.text || value.title || value.name || value.target || value.kind || "—") })));
  return list;
}
export function renderContextRail(snapshot = {}) {
  currentSnapshot = snapshot;
  const world = snapshot.world || {};
  const attention = snapshot.attention || {};
  const character = snapshot.character || {};
  const knowledge = snapshot.knowledge || {};
  const worldPanel = byId("context-world");
  const characterPanel = byId("context-character");
  const knowledgePanel = byId("context-knowledge");
  if (worldPanel) {
    worldPanel.replaceChildren();
    const placeCard = makeNode("div", { className: "place-card" });
    placeCard.appendChild(makeNode("span", { className: "place-glyph", text: "✦" }));
    const copy = makeNode("div", { className: "place-copy" });
    copy.append(makeNode("strong", { text: world.locationName || "Место неизвестно" }), makeNode("small", { text: world.locationDescription || "Сведений пока мало." }));
    placeCard.appendChild(copy);
    worldPanel.appendChild(placeCard);
    const state = makeNode("div", { className: "stat-stack" });
    state.append(makeNode("div", { className: "stat-row", text: "Координаты: " + (world.position?.x ?? 0) + ", " + (world.position?.y ?? 0) }), makeNode("div", { className: "stat-row", text: "Тепло: " + (world.heatDescription || "не ощущается") }), makeNode("div", { className: "stat-row", text: "Внимание: " + (attention.explanation || attention.level || "спокойно") }));
    addSection(worldPanel, "Состояние места", state);
    addSection(worldPanel, "Связанные места", listValues(world.connectedLocations, "Связей пока нет."));
    if (snapshot.currentSituation) addSection(worldPanel, "Ситуация", makeNode("p", { className: "context-copy", text: snapshot.currentSituation.description || snapshot.currentSituation.title }));
  }
  if (characterPanel) {
    characterPanel.replaceChildren(makeNode("div", { className: "character-card", text: character.displayName || "Странник" }));
    addSection(characterPanel, "Рана", makeNode("p", { className: "context-copy", text: character.wound || "—" }));
    addSection(characterPanel, "Обещание", makeNode("p", { className: "context-copy", text: character.promise || "—" }));
    addSection(characterPanel, "Принцип", makeNode("p", { className: "context-copy", text: character.principle || "—" }));
    addSection(characterPanel, "Последствия", listValues(character.consequences, "Активных последствий нет."));
    addSection(characterPanel, "Отношения", listValues(character.relations, "Отношения ещё не определились."));
  }
  if (knowledgePanel) {
    knowledgePanel.replaceChildren();
    [["Факты", knowledge.facts], ["Гипотезы", knowledge.hypotheses], ["Следы", knowledge.traces], ["Последние свидетельства", knowledge.recentEvidence]].forEach(([title, values]) => addSection(knowledgePanel, title, listValues(values, "Пока пусто.")));
  }
}

export function showContextLocation(locationId, name) {
  const worldPanel = byId("context-world");
  if (!worldPanel) return;
  const locations = currentSnapshot?.world?.connectedLocations || [];
  const location = locations.find((item) => item.id === locationId) || { id: locationId, name };
  worldPanel.querySelector?.("#selected-location-card")?.remove?.();
  const card = makeNode("article", { className: "selected-location-card", attrs: { id: "selected-location-card", "aria-live": "polite" } });
  card.append(
    makeNode("span", { className: "eyebrow", text: "ИЗВЕСТНОЕ МЕСТО" }),
    makeNode("strong", { text: location.name || name || location.id || "Место" }),
    makeNode("p", { text: location.description || "Это место уже связано с текущей областью мира. Подробности откроются по мере исследования." }),
  );
  worldPanel.appendChild(card);
}
