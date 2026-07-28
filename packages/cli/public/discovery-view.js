const STORAGE_ACTIVE_CARD = "skald:discovery:activeCard";

let discoveryData = null;
let activeCardId = null;

function restoreActiveCard() {
  try {
    activeCardId = sessionStorage.getItem(STORAGE_ACTIVE_CARD);
  } catch {
    activeCardId = null;
  }
}

function persistActiveCard() {
  try {
    if (activeCardId) {
      sessionStorage.setItem(STORAGE_ACTIVE_CARD, activeCardId);
    } else {
      sessionStorage.removeItem(STORAGE_ACTIVE_CARD);
    }
  } catch {}
}

export async function loadDiscoveries() {
  restoreActiveCard();
  try {
    const res = await fetch("/api/discoveries");
    const body = await res.json();
    if (body.ok) {
      discoveryData = body;
      renderDiscoveries();
    }
  } catch {
    // silent
  }
}

function stageLabel(stage) {
  switch (stage) {
    case "trace": return "След";
    case "hypothesis": return "Гипотеза";
    case "discovered": return "Открытие";
    default: return "";
  }
}

function signalLabel(kind) {
  switch (kind) {
    case "trace": return "След";
    case "omen": return "Знамение";
    case "echo": return "Эхо";
    default: return "";
  }
}

export function renderDiscoveries() {
  const container = document.getElementById("discovery-container");
  if (!container) return;
  container.innerHTML = "";

  if (!discoveryData || !discoveryData.cards || discoveryData.cards.length === 0) {
    const empty = document.createElement("div");
    empty.className = "discovery-empty";
    empty.innerHTML = "<p>Ты пока не заметил устойчивых закономерностей.</p><p>Продолжай наблюдать за ответами мира.</p>";
    container.appendChild(empty);
    return;
  }

  const layout = document.createElement("div");
  layout.className = "discovery-layout";

  // --- Sidebar: card list ---
  const sidebar = document.createElement("div");
  sidebar.className = "discovery-sidebar";
  sidebar.setAttribute("role", "list");
  sidebar.setAttribute("aria-label", "Список открытий");

  for (const card of discoveryData.cards) {
    const cardEl = document.createElement("div");
    cardEl.className = "discovery-card";
    cardEl.setAttribute("role", "listitem");

    if (activeCardId === card.discoveryId) {
      cardEl.classList.add("discovery-card-active");
    }

    const stageBadge = document.createElement("span");
    stageBadge.className = "discovery-stage-badge";
    stageBadge.classList.add("stage-" + card.stage);
    stageBadge.textContent = stageLabel(card.stage);

    const title = document.createElement("div");
    title.className = "discovery-card-title";
    title.textContent = card.title;

    const question = document.createElement("div");
    question.className = "discovery-card-question";
    question.textContent = card.stage === "discovered" ? card.summary : card.question;

    const evidenceInfo = document.createElement("div");
    evidenceInfo.className = "discovery-card-evidence";
    evidenceInfo.textContent = "Доказательств: " + card.evidenceCount + " (T" + card.lastSeenAt + ")";

    cardEl.appendChild(stageBadge);
    cardEl.appendChild(title);
    cardEl.appendChild(question);
    cardEl.appendChild(evidenceInfo);

    cardEl.setAttribute("tabindex", "0");
    cardEl.setAttribute("role", "button");
    cardEl.setAttribute("aria-expanded", String(activeCardId === card.discoveryId));
    cardEl.addEventListener("click", () => {
      activeCardId = activeCardId === card.discoveryId ? null : card.discoveryId;
      persistActiveCard();
      renderDiscoveries();
    });
    cardEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        cardEl.click();
      }
    });

    sidebar.appendChild(cardEl);
  }

  layout.appendChild(sidebar);

  // --- Detail area ---
  const detail = document.createElement("div");
  detail.className = "discovery-detail";

  const activeCard = activeCardId
    ? discoveryData.cards.find((c) => c.discoveryId === activeCardId)
    : null;

  if (activeCard) {
    const detailTitle = document.createElement("h3");
    detailTitle.textContent = activeCard.title;
    detail.appendChild(detailTitle);

    const detailSummary = document.createElement("div");
    detailSummary.className = "discovery-detail-summary";
    detailSummary.textContent = activeCard.summary;
    detail.appendChild(detailSummary);

    if (activeCard.evidence && activeCard.evidence.length > 0) {
      const evidenceHeader = document.createElement("div");
      evidenceHeader.className = "discovery-evidence-header";
      evidenceHeader.textContent = "Следы:";
      detail.appendChild(evidenceHeader);

      const evidenceList = document.createElement("div");
      evidenceList.setAttribute("role", "list");
      evidenceList.setAttribute("aria-label", "Список доказательств");

      for (const ev of activeCard.evidence) {
        const evEl = document.createElement("div");
        evEl.className = "discovery-evidence-item";
        evEl.setAttribute("role", "listitem");
        evEl.setAttribute("tabindex", "0");

        const kindTag = document.createElement("span");
        kindTag.className = "evidence-kind-tag";
        kindTag.classList.add("kind-" + ev.kind);
        kindTag.textContent = signalLabel(ev.kind);

        const evText = document.createElement("span");
        evText.className = "evidence-text";
        evText.textContent = "T" + ev.worldTime + " — " + ev.text;

        evEl.appendChild(kindTag);
        evEl.appendChild(evText);

        // Click to navigate to journal for that turn
        evEl.addEventListener("click", () => {
          // Set journal thread filter to open the correct journal view
          try {
            sessionStorage.setItem("skald:discovery:navigateToTurn", ev.journalTurnId);
          } catch {}
          // Dispatch custom event for app.js to handle
          document.dispatchEvent(new CustomEvent("skald:navigate", {
            detail: { view: "journal", turnId: ev.journalTurnId },
          }));
        });
        evEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            evEl.click();
          }
        });

        evidenceList.appendChild(evEl);
      }
      detail.appendChild(evidenceList);
    }
  } else if (discoveryData.cards.length > 0) {
    const hint = document.createElement("div");
    hint.className = "discovery-detail-hint";
    hint.textContent = "Выбери открытие, чтобы увидеть доказательства.";
    detail.appendChild(hint);
  }

  layout.appendChild(detail);
  container.appendChild(layout);

  // --- Recent evidence list at bottom ---
  if (discoveryData.recentEvidence && discoveryData.recentEvidence.length > 0) {
    const recentSection = document.createElement("details");
    recentSection.className = "discovery-recent";

    const summary = document.createElement("summary");
    summary.textContent = "Последние следы (" + discoveryData.recentEvidence.length + ")";
    recentSection.appendChild(summary);

    const recentList = document.createElement("div");
    recentList.setAttribute("role", "list");

    for (const ev of discoveryData.recentEvidence.slice(0, 5)) {
      const evEl = document.createElement("div");
      evEl.className = "discovery-evidence-item";
      evEl.setAttribute("role", "listitem");

      const kindTag = document.createElement("span");
      kindTag.className = "evidence-kind-tag";
      kindTag.classList.add("kind-" + ev.kind);
      kindTag.textContent = signalLabel(ev.kind);

      const evText = document.createElement("span");
      evText.className = "evidence-text";
      evText.textContent = "T" + ev.worldTime + " — " + ev.text;

      evEl.appendChild(kindTag);
      evEl.appendChild(evText);
      recentList.appendChild(evEl);
    }
    recentSection.appendChild(recentList);
    container.appendChild(recentSection);
  }
}
