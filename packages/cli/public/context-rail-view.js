import { byId, emptyState, makeNode } from "./dom-helpers.js";
import { renderBeliefModel } from "./belief-view.js";

function addSection(parent, title, content) {
  const section = makeNode("section", { className: "context-section player-space-section" });
  section.appendChild(makeNode("h3", { text: title }));
  if (content) section.appendChild(content);
  parent.appendChild(section);
}

function listValues(values, emptyText, formatter = null) {
  const list = makeNode("ul", { className: "context-list" });
  if (!values || !values.length) { list.appendChild(emptyState(emptyText, "context-empty")); return list; }
  values.slice(0, 8).forEach((value) => {
    const text = formatter
      ? formatter(value)
      : typeof value === "string"
        ? value
        : (value.label || value.targetLabel || "—");
    list.appendChild(makeNode("li", { text }));
  });
  return list;
}

function renderMapContext(snapshot) {
  const location = byId("map-current-location");
  const route = byId("map-route-status");
  const world = snapshot.world || {};
  const journey = snapshot.journey || {};
  if (location) location.textContent = world.locationName
    ? "Ты находишься здесь: " + world.locationName
    : "Текущее место ещё не определено.";
  if (!route) return;
  if (journey.status === "traveling") {
    route.textContent = journey.text || "Путь продолжается.";
    return;
  }
  if (journey.status === "interrupted") {
    route.textContent = journey.text || "Путь прерван. Ты можешь осмотреться и решить, что делать дальше.";
    return;
  }
  const routes = Array.isArray(world.knownRoutes) ? world.knownRoutes : [];
  const difficult = routes.find((item) => item.status === "blocked" || item.status === "difficult");
  if (difficult) {
    route.textContent = difficult.label + (difficult.status === "blocked" ? " — путь сейчас закрыт." : " — путь сейчас труден.");
  } else if (routes.length > 0) {
    route.textContent = "Отсюда тебе знакомо направлений: " + routes.length + ".";
  } else {
    route.textContent = "Ты пока не знаешь надёжного пути отсюда.";
  }
}

function renderCharacter(characterPanel, character) {
  const identity = makeNode("header", { className: "character-identity" });
  identity.appendChild(makeNode("span", { className: "eyebrow", text: "ТВОЯ ИСТОРИЯ" }));
  identity.appendChild(makeNode("h2", { text: character.displayName || "Странник" }));
  if (character.backgroundTitle) identity.appendChild(makeNode("strong", { className: "character-background-title", text: character.backgroundTitle }));
  if (character.backgroundSummary) identity.appendChild(makeNode("p", { className: "context-copy character-summary", text: character.backgroundSummary }));
  characterPanel.replaceChildren(identity);

  const story = makeNode("div", { className: "character-story-grid" });
  addSection(story, "Откуда ты пришёл", makeNode("p", {
    className: "context-copy",
    text: character.origin || "Твоё прошлое пока не получило ясных очертаний.",
  }));
  addSection(story, "Что ты потерял", makeNode("p", { className: "context-copy", text: character.loss || character.wound || "Эта память пока не названа." }));
  addSection(story, "Что ты обещал", makeNode("p", { className: "context-copy", text: character.promise || "Обещание ещё не дано." }));
  addSection(story, "Что ещё не завершено", makeNode("p", { className: "context-copy", text: character.obligation || "Незавершённое обязательство пока не определилось." }));
  characterPanel.appendChild(story);

  const present = makeNode("div", { className: "character-present-grid" });
  addSection(present, "Кому доверяешь", listValues(
    character.relations,
    "Знакомые и доверенные лица пока не появились.",
    (relation) => relation.targetLabel + (relation.relationLabel ? " — " + relation.relationLabel : ""),
  ));
  addSection(present, "Что несёшь с собой", listValues(character.items, "Сейчас при тебе нет доступных предметов."));
  addSection(present, "Что с тобой сейчас", listValues(
    [...(character.conditions || []), ...(character.consequences || [])],
    "Ничто заметно не сковывает тебя.",
  ));
  characterPanel.appendChild(present);
}

export function renderContextRail(snapshot = {}) {
  const character = snapshot.character || {};
  const beliefModel = snapshot.beliefModel;
  const characterPanel = byId("context-character");
  const knowledgePanel = byId("context-knowledge");
  renderMapContext(snapshot);
  if (characterPanel) renderCharacter(characterPanel, character);
  if (knowledgePanel) {
    const discoveries = makeNode("section", { className: "knowledge-discoveries", attrs: { id: "discovery-container", "aria-label": "Следы и открытия" } });
    const surface = makeNode("div", { attrs: { id: "knowledge-belief-surface" } });
    knowledgePanel.replaceChildren(surface, discoveries);
    if (beliefModel) renderBeliefModel(surface, beliefModel);
    else surface.appendChild(emptyState("Твои наблюдения сейчас недоступны.", "knowledge-unavailable"));
  }
}
