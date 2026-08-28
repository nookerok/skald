import { emptyState, makeNode } from "./dom-helpers.js";

const CATEGORIES = [
  ["seen", "Что ты видел", "Пока ты не заметил ничего устойчивого."],
  ["told", "Что тебе рассказали", "Пока тебе не передали ни одного рассказа."],
  ["inferred", "Что ты предполагаешь", "Пока у тебя нет версии, связывающей увиденное."],
  ["doubt", "В чём сомневаешься", "Сейчас известное тебе не противоречит само себе."],
];

export function isPlayerKnowledgePresentation(value) {
  return Boolean(value && value.schemaVersion === 1 && Array.isArray(value.entries)
    && value.entries.every((entry) => entry && ["seen", "told", "inferred", "doubt"].includes(entry.category)
      && typeof entry.text === "string" && typeof entry.origin === "string"
      && ["current", "uncertain", "contradicted"].includes(entry.status)
      && Number.isFinite(entry.worldTime)));
}

// Kept for the trusted /beliefs compatibility surface and older extensions;
// the normal renderer never forwards this model to the player.
export function isBeliefModelV2(model) {
  const bounded = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
  const evidence = (value) => Boolean(value && typeof value.id === "string" && typeof value.type === "string"
    && typeof value.description === "string" && bounded(value.strength) && Number.isFinite(value.observedAt)
    && Array.isArray(value.linkedObservationIds));
  const hypothesis = (value) => Boolean(value && typeof value.id === "string" && typeof value.targetId === "string"
    && typeof value.statement === "string" && bounded(value.confidence) && Array.isArray(value.supportingEvidenceIds)
    && Array.isArray(value.contradictingEvidenceIds) && typeof value.status === "string"
    && Number.isFinite(value.createdAt) && Number.isFinite(value.lastUpdated));
  const factor = (value) => Boolean(value && typeof value.description === "string" && bounded(value.strength)
    && bounded(value.confidence) && Array.isArray(value.evidenceIds));
  const explanation = (value) => Boolean(value && typeof value.patternId === "string" && bounded(value.confidence)
    && Array.isArray(value.supportingFactors) && value.supportingFactors.every(factor)
    && Array.isArray(value.weakeningFactors) && value.weakeningFactors.every(factor)
    && Array.isArray(value.criticalDependencies) && value.criticalDependencies.every(factor)
    && Array.isArray(value.collapseConditions) && value.collapseConditions.every((item) => Boolean(item && typeof item.description === "string" && typeof item.thresholdExpression === "string" && bounded(item.currentProximity) && bounded(item.confidence))));
  const belief = (value) => Boolean(value && typeof value.patternId === "string" && typeof value.displayName === "string"
    && typeof value.currentInterpretation === "string" && bounded(value.confidence)
    && Array.isArray(value.supportingEvidence) && value.supportingEvidence.every(evidence)
    && Array.isArray(value.openHypotheses) && value.openHypotheses.every(hypothesis)
    && Number.isFinite(value.lastObserved) && bounded(value.freshness)
    && (value.existenceExplanation === undefined || explanation(value.existenceExplanation)));
  return Boolean(model && model.schemaVersion === 2 && typeof model.observerId === "string"
    && Array.isArray(model.beliefs) && model.beliefs.every(belief)
    && Array.isArray(model.activeHypotheses) && model.activeHypotheses.every(hypothesis)
    && Array.isArray(model.knownRelations) && model.knownRelations.every((item) => item !== null && typeof item === "object")
    && Array.isArray(model.contradictions) && model.contradictions.every((item) => Boolean(item && typeof item.id === "string" && typeof item.description === "string"))
    && Number.isFinite(model.lastUpdated));
}

function legacyPresentation(model) {
  if (!isBeliefModelV2(model)) return null;
  const category = (type) => type === "testimony" ? "told" : type === "pattern-match" || type === "inference" ? "inferred" : "seen";
  const origin = (kind) => kind === "told" ? "Тебе это рассказали." : kind === "inferred" ? "Это твоя версия." : "Ты заметил это сам.";
  const entries = [];
  for (const belief of model.beliefs) for (const evidence of belief.supportingEvidence) {
    const kind = category(evidence.type);
    entries.push({ category: kind, text: evidence.description, origin: origin(kind), status: kind === "inferred" ? "uncertain" : "current", worldTime: evidence.observedAt });
  }
  for (const contradiction of model.contradictions) entries.push({ category: "doubt", text: contradiction.description, origin: "Требуется новое наблюдение.", status: "contradicted", worldTime: contradiction.detectedAt });
  return { schemaVersion: 1, entries };
}

function renderEntry(entry) {
  const card = makeNode("article", { className: "knowledge-entry", attrs: { role: "listitem" } });
  card.appendChild(makeNode("p", { className: "knowledge-entry-copy", text: entry.text }));
  card.appendChild(makeNode("p", { className: "knowledge-entry-origin", text: entry.origin }));
  return card;
}

export function renderKnowledgePresentation(container, presentation) {
  if (!container) return;
  container.replaceChildren();
  if (!isPlayerKnowledgePresentation(presentation)) {
    container.appendChild(emptyState("Твои знания временно недоступны.", "knowledge-unavailable belief-unavailable"));
    return;
  }
  const entries = presentation.entries.slice(0, 100);
  for (const [category, title, emptyText] of CATEGORIES) {
    const section = makeNode("section", { className: "knowledge-origin-section knowledge-origin--" + category });
    section.appendChild(makeNode("h3", { text: title }));
    const categoryEntries = entries.filter((entry) => entry.category === category);
    if (categoryEntries.length === 0) section.appendChild(emptyState(emptyText, "knowledge-origin-empty"));
    else {
      const list = makeNode("div", { className: "knowledge-origin-list", attrs: { role: "list" } });
      list.append(...categoryEntries.map(renderEntry));
      section.appendChild(list);
    }
    container.appendChild(section);
  }
}

// Compatibility export for extensions that used the old function name. It
// deliberately accepts only the new DTO; internal BeliefModel never renders.
export function renderBeliefModel(container, presentation) {
  renderKnowledgePresentation(container, isBeliefModelV2(presentation) ? legacyPresentation(presentation) : presentation);
}
