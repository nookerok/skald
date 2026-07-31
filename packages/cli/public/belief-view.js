import { emptyState, makeNode } from "./dom-helpers.js";

function percent(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
}

function label(patternId) {
  return patternId.replace(/^(object|entity|location|observation|discovery|relation|heat|sound|consequence|barrier):/, "");
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

export function renderBeliefModel(container, model) {
  if (!container) return;
  container.replaceChildren();
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
    const card = makeNode("article", { className: "belief-card", attrs: { role: "listitem", "data-pattern-id": belief.patternId } });
    const header = makeNode("header", { className: "belief-card-header" });
    header.append(
      makeNode("strong", { text: label(belief.patternId) }),
      makeNode("span", { className: "belief-confidence", text: percent(belief.confidence) + "%" }),
    );
    const freshness = makeNode("div", { className: "belief-freshness", attrs: { role: "meter", "aria-label": "Свежесть свидетельств", "aria-valuenow": String(percent(1 - ((model.lastUpdated - belief.lastObserved) / 12)))} });
    freshness.appendChild(makeNode("span", { attrs: { style: "width:" + percent(1 - ((model.lastUpdated - belief.lastObserved) / 12)) + "%" } }));
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

