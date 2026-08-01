import { emptyState, makeNode } from "./dom-helpers.js";

function percent(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
}

function renderEvidence(entries) {
  const list = makeNode("ul", { className: "belief-evidence" });
  for (const entry of (entries || []).slice(-4).reverse()) {
    list.appendChild(makeNode("li", {
      text: entry.description + " · T" + entry.observedAt + " · " + percent(entry.strength) + "%",
    }));
  }
  return list;
}

function renderExplanation(belief) {
  const details = makeNode("div", { className: "belief-explanation" });
  const explanation = belief.existenceExplanation;
  if (!explanation) {
    details.appendChild(emptyState("Пока недостаточно свидетельств.", "belief-empty"));
    return details;
  }
  details.appendChild(makeNode("p", {
    className: "belief-explanation-confidence",
    text: "Уверенность в трактовке: " + percent(explanation.confidence) + "%",
  }));
  if (explanation.supportingFactors?.length) {
    details.appendChild(makeNode("strong", { text: "Что поддерживает" }));
    details.appendChild(renderEvidence(explanation.supportingFactors.map((factor) => ({
      description: factor.description,
      observedAt: "",
      strength: factor.strength,
    }))));
  }
  if (explanation.collapseConditions?.length) {
    details.appendChild(makeNode("strong", { text: "Что может изменить трактовку" }));
    details.appendChild(renderEvidence(explanation.collapseConditions.map((condition) => ({
      description: condition.description,
      observedAt: "",
      strength: condition.confidence,
    }))));
  }
  return details;
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
export function renderBeliefModel(container, model) {
  if (!container) return;
  container.replaceChildren();
  if (!isBeliefModelV2(model)) {
    container.appendChild(emptyState("Наблюдения временно недоступны: несовместимая версия данных.", "belief-unavailable"));
    return;
  }
  const beliefs = Array.isArray(model?.beliefs) ? model.beliefs : [];
  const hypotheses = Array.isArray(model?.activeHypotheses) ? model.activeHypotheses : [];
  const contradictions = Array.isArray(model?.contradictions) ? model.contradictions : [];
  if (!beliefs.length && !hypotheses.length) {
    container.appendChild(emptyState("Пока нет наблюдений. Опиши намерение и прислушайся к последствиям.", "belief-empty"));
    return;
  }

  const summary = makeNode("div", { className: "belief-summary" });
  summary.append(
    makeNode("span", { text: beliefs.length + " наблюдений" }),
    makeNode("span", { text: hypotheses.length + " гипотез" }),
    makeNode("span", { text: contradictions.length + " противоречий" }),
  );
  container.appendChild(summary);

  if (contradictions.length) {
    const warning = makeNode("section", { className: "belief-contradictions", attrs: { "aria-live": "polite" } });
    warning.appendChild(makeNode("h3", { text: "Противоречия остаются открытыми" }));
    warning.append(...contradictions.map((item) => makeNode("p", { text: item.description })));
    container.appendChild(warning);
  }

  const list = makeNode("div", { className: "belief-list", attrs: { role: "list" } });
  for (const belief of beliefs.slice(0, 8)) {
    const card = makeNode("article", { className: "belief-card", attrs: { role: "listitem" } });
    const header = makeNode("header", { className: "belief-card-header" });
    header.append(
      makeNode("strong", { text: belief.displayName }),
      makeNode("span", { className: "belief-confidence", text: percent(belief.confidence) + "%" }),
    );
    const freshnessPercent = percent(Number.isFinite(belief.freshness) ? belief.freshness : 0);
    const freshness = makeNode("div", { className: "belief-freshness", attrs: { role: "meter", "aria-label": "Свежесть свидетельств", "aria-valuenow": String(freshnessPercent) } });
    freshness.appendChild(makeNode("span", { attrs: { style: "width:" + freshnessPercent + "%" } }));
    const interpretation = makeNode("p", { className: "belief-interpretation", text: belief.currentInterpretation });
    const evidence = makeNode("details", { className: "belief-details" });
    evidence.appendChild(makeNode("summary", { text: "Свидетельства (" + (belief.supportingEvidence?.length || 0) + ")" }));
    evidence.appendChild(renderEvidence(belief.supportingEvidence));
    const why = makeNode("details", { className: "belief-details" });
    why.appendChild(makeNode("summary", { text: "Почему я так думаю?" }));
    why.appendChild(renderExplanation(belief));
    card.append(header, freshness, interpretation, evidence, why);
    list.appendChild(card);
  }
  container.appendChild(list);
  if (hypotheses.length) {
    const section = makeNode("section", { className: "belief-hypotheses" });
    section.appendChild(makeNode("h3", { text: "Активные гипотезы" }));
    for (const hypothesis of hypotheses.slice(0, 6)) {
      section.appendChild(makeNode("p", { text: hypothesis.statement + " · " + percent(hypothesis.confidence) + "% · " + hypothesis.status }));
    }
    container.appendChild(section);
  }
}

