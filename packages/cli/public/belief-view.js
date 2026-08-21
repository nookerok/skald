import { emptyState, makeNode } from "./dom-helpers.js";

function percent(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
}


function isBounded(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

const EVIDENCE_TYPES = new Set(["sensory", "pattern-match", "testimony", "anomaly", "ritual", "inference"]);
const HYPOTHESIS_STATUSES = new Set(["open", "strengthening", "weakening", "confirmed", "refuted"]);
const RELATION_TYPES = new Set(["supports", "feeds", "threatens", "depends", "enables", "constrains"]);
const TRENDS = new Set(["rising", "stable", "falling", "unknown"]);

function isBeliefEvidence(value) {
  return Boolean(value && typeof value.id === "string" && EVIDENCE_TYPES.has(value.type)
    && typeof value.description === "string" && isBounded(value.strength)
    && Number.isFinite(value.observedAt) && Array.isArray(value.linkedObservationIds)
    && value.linkedObservationIds.every((id) => typeof id === "string"));
}

function isHypothesis(value) {
  return Boolean(value && typeof value.id === "string" && typeof value.targetId === "string"
    && typeof value.statement === "string" && isBounded(value.confidence)
    && Array.isArray(value.supportingEvidenceIds) && value.supportingEvidenceIds.every((id) => typeof id === "string")
    && Array.isArray(value.contradictingEvidenceIds) && value.contradictingEvidenceIds.every((id) => typeof id === "string")
    && HYPOTHESIS_STATUSES.has(value.status) && Number.isFinite(value.createdAt) && Number.isFinite(value.lastUpdated));
}

function isRelation(value) {
  return Boolean(value && typeof value.sourceId === "string" && typeof value.targetId === "string"
    && RELATION_TYPES.has(value.type) && isBounded(value.observedStrength)
    && isBounded(value.confidence) && TRENDS.has(value.trend)
    && Number.isFinite(value.discoveredAt) && Array.isArray(value.evidenceIds)
    && value.evidenceIds.every((id) => typeof id === "string"));
}

function isContradiction(value) {
  return Boolean(value && typeof value.id === "string" && typeof value.description === "string"
    && Array.isArray(value.involvedHypothesisIds) && value.involvedHypothesisIds.every((id) => typeof id === "string")
    && Array.isArray(value.involvedEvidenceIds) && value.involvedEvidenceIds.every((id) => typeof id === "string")
    && Number.isFinite(value.detectedAt));
}

function isFactor(value) {
  return Boolean(value && typeof value.description === "string" && isBounded(value.strength)
    && isBounded(value.confidence) && Array.isArray(value.evidenceIds)
    && value.evidenceIds.every((id) => typeof id === "string")
    && (value.relatedPatternId === undefined || typeof value.relatedPatternId === "string"));
}

function isCollapseCondition(value) {
  return Boolean(value && typeof value.description === "string"
    && typeof value.thresholdExpression === "string" && isBounded(value.currentProximity)
    && isBounded(value.confidence));
}

function isExistenceExplanation(value) {
  return Boolean(value && typeof value.patternId === "string" && isBounded(value.confidence)
    && Array.isArray(value.supportingFactors) && value.supportingFactors.every(isFactor)
    && Array.isArray(value.weakeningFactors) && value.weakeningFactors.every(isFactor)
    && Array.isArray(value.criticalDependencies) && value.criticalDependencies.every(isFactor)
    && Array.isArray(value.collapseConditions) && value.collapseConditions.every(isCollapseCondition));
}

export function isBeliefModelV2(model) {
  const validBelief = (value) => Boolean(value && typeof value.patternId === "string"
    && typeof value.displayName === "string" && typeof value.currentInterpretation === "string" && isBounded(value.confidence)
    && Array.isArray(value.supportingEvidence) && value.supportingEvidence.every(isBeliefEvidence)
    && Array.isArray(value.openHypotheses) && value.openHypotheses.every(isHypothesis)
    && Number.isFinite(value.lastObserved) && isBounded(value.freshness)
    && (value.existenceExplanation === undefined || isExistenceExplanation(value.existenceExplanation)));
  return Boolean(model && model.schemaVersion === 2 && typeof model.observerId === "string"
    && Array.isArray(model.beliefs) && model.beliefs.every(validBelief)
    && Array.isArray(model.activeHypotheses) && model.activeHypotheses.every(isHypothesis)
    && Array.isArray(model.knownRelations) && model.knownRelations.every(isRelation)
    && Array.isArray(model.contradictions) && model.contradictions.every(isContradiction)
    && Number.isFinite(model.lastUpdated));
}

const SEEN_EVIDENCE = new Set(["sensory", "anomaly", "ritual"]);
const INFERRED_EVIDENCE = new Set(["pattern-match", "inference"]);

const TESTIMONY_EVIDENCE = new Set(["testimony"]);
function renderKnowledgeMeter(label, value) {
  const bounded = percent(value);
  const row = makeNode("div", { className: "knowledge-meter-row" });
  row.appendChild(makeNode("span", { text: label }));
  const meter = makeNode("span", {
    className: "knowledge-meter",
    attrs: { role: "meter", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(bounded) },
  });
  meter.appendChild(makeNode("span", { attrs: { style: "width:" + bounded + "%" } }));
  row.appendChild(meter);
  return row;
}

function renderEvidenceCards(beliefs, evidenceTypes, limit) {
  const cards = [];
  for (const belief of beliefs) {
    const evidence = belief.supportingEvidence.filter((entry) => evidenceTypes.has(entry.type)).slice().reverse();
    for (const entry of evidence) {
      const card = makeNode("article", { className: "knowledge-entry", attrs: { role: "listitem" } });
      card.appendChild(makeNode("h4", { text: belief.displayName }));
      card.appendChild(makeNode("p", { className: "knowledge-entry-copy", text: entry.description }));
      const meters = makeNode("div", { className: "knowledge-entry-meters" });
      meters.append(
        renderKnowledgeMeter("Насколько ясно", entry.strength),
        renderKnowledgeMeter("Насколько свежо", belief.freshness),
      );
      card.appendChild(meters);
      cards.push(card);
      if (cards.length >= limit) return cards;
    }
  }
  return cards;
}

function renderOriginSection(container, title, entries, emptyText, className) {
  const section = makeNode("section", { className: "knowledge-origin-section " + className });
  section.appendChild(makeNode("h3", { text: title }));
  if (entries.length === 0) {
    section.appendChild(emptyState(emptyText, "knowledge-origin-empty"));
  } else {
    const list = makeNode("div", { className: "knowledge-origin-list", attrs: { role: "list" } });
    list.append(...entries);
    section.appendChild(list);
  }
  container.appendChild(section);
}

export function renderBeliefModel(container, model) {
  if (!container) return;
  container.replaceChildren();
  if (!isBeliefModelV2(model)) {
    container.appendChild(emptyState("Твои наблюдения временно недоступны.", "belief-unavailable"));
    return;
  }
  const beliefs = Array.isArray(model?.beliefs) ? model.beliefs : [];
  const hypotheses = Array.isArray(model?.activeHypotheses) ? model.activeHypotheses : [];
  const contradictions = Array.isArray(model?.contradictions) ? model.contradictions : [];

  const seen = renderEvidenceCards(beliefs, SEEN_EVIDENCE, 8);
  const told = renderEvidenceCards(beliefs, TESTIMONY_EVIDENCE, 8);
  const inferred = renderEvidenceCards(beliefs, INFERRED_EVIDENCE, 6);
  for (const hypothesis of hypotheses.filter((entry) => entry.status !== "weakening" && entry.status !== "refuted").slice(0, 6)) {
    const card = makeNode("article", { className: "knowledge-entry knowledge-entry--inference", attrs: { role: "listitem" } });
    card.appendChild(makeNode("p", { className: "knowledge-entry-copy", text: hypothesis.statement }));
    card.appendChild(renderKnowledgeMeter("Насколько ясно", hypothesis.confidence));
    inferred.push(card);
  }

  const doubts = contradictions.slice(0, 8).map((item) => {
    const card = makeNode("article", { className: "knowledge-entry knowledge-entry--doubt", attrs: { role: "listitem" } });
    card.appendChild(makeNode("p", { className: "knowledge-entry-copy", text: item.description }));
    return card;
  });
  for (const hypothesis of hypotheses.filter((entry) => entry.status === "weakening" || entry.status === "refuted").slice(0, 6)) {
    const card = makeNode("article", { className: "knowledge-entry knowledge-entry--doubt", attrs: { role: "listitem" } });
    card.appendChild(makeNode("p", { className: "knowledge-entry-copy", text: hypothesis.statement }));
    doubts.push(card);
  }

  renderOriginSection(container, "Что ты видел", seen, "Пока ты не заметил ничего устойчивого.", "knowledge-origin--seen");
  renderOriginSection(container, "Что тебе рассказали", told, "Пока тебе не передали ни одного рассказа, которому стоит уделить внимание.", "knowledge-origin--told");
  renderOriginSection(container, "Что ты предполагаешь", inferred, "Пока у тебя нет версии, связывающей увиденное.", "knowledge-origin--inferred");
  renderOriginSection(container, "В чём сомневаешься", doubts, "Сейчас ничто из известного тебе не противоречит само себе.", "knowledge-origin--doubts");
}

