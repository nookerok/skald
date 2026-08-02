// presence-view.js — renders the "return" montage strictly from backend DTOs
// (ObserverSessionDTO + WorldPresenceSummary). The browser classifies nothing
// and never invents sentences; every line here is server-authored. The single
// interactive element is a client-only continue button: it never acknowledges
// and never creates a Domain Event.

export function presenceModeFor(session) {
  if (session.checkpointState === "missing") return "first";
  if (session.checkpointState === "incompatible") return "invalid";
  if (session.drift.level === "low") return "valid-low";
  if (session.drift.level === "medium") return "valid-medium";
  if (session.drift.level === "high") return "valid-high";
  return "valid-none";
}

function sectionTitle(text) {
  const title = document.createElement("h3");
  title.className = "presence-section-title";
  title.textContent = text;
  return title;
}

function list(className) {
  const list = document.createElement("ul");
  list.className = className;
  return list;
}

export function renderPresenceView(session, summary) {
  const fragment = document.createDocumentFragment();
  const mode = presenceModeFor(session);

  const panel = document.createElement("div");
  panel.className = "presence-entry-panel";
  panel.dataset.mode = mode;

  const heading = document.createElement("h2");
  heading.className = "presence-entry-heading";
  heading.id = "presence-phase-title";
  heading.setAttribute("data-phase-title", "true");
  heading.tabIndex = -1;
  heading.textContent = "Возвращение в мир";
  panel.appendChild(heading);

  // Server-authored status; a generic fallback is reserved for defensive
  // rendering only (no summary, or a DTO version this client cannot read).
  const status = document.createElement("p");
  status.className = "presence-entry-status";
  const hasServerStatus = summary && summary.schemaVersion === 1 && typeof summary.presenceStatus === "string";
  status.textContent = hasServerStatus ? summary.presenceStatus : "Ты вернулся.";
  panel.appendChild(status);

  if (session.statements && session.statements.length > 0) {
    const montage = document.createElement("div");
    montage.className = "presence-montage";
    montage.setAttribute("aria-label", "Пока тебя не было");
    for (const statement of session.statements) {
      const line = document.createElement("p");
      line.className = "presence-montage-line";
      line.textContent = statement.text;
      montage.appendChild(line);
    }
    panel.appendChild(montage);
  }

  const nearbyChanges = (session.presence && session.presence.nearbyChanges) || [];
  if (nearbyChanges.length > 0) {
    const section = document.createElement("section");
    section.className = "presence-changes";
    section.appendChild(sectionTitle("Что изменилось рядом"));
    const items = list("presence-changes-list");
    for (const change of nearbyChanges) {
      const item = document.createElement("li");
      item.textContent = change.description;
      items.appendChild(item);
    }
    section.appendChild(items);
    panel.appendChild(section);
  }

  if (session.presence && session.presence.drift && session.presence.drift.reasons.length > 0) {
    const section = document.createElement("section");
    section.className = "presence-reasons-section";
    section.appendChild(sectionTitle("Почему память расходится"));
    const reasons = list("presence-reasons");
    for (const reason of session.presence.drift.reasons) {
      const item = document.createElement("li");
      item.textContent = reason.text;
      reasons.appendChild(item);
    }
    section.appendChild(reasons);
    panel.appendChild(section);
  }

  const staleBeliefs = (session.presence && session.presence.staleBeliefs) || [];
  if (staleBeliefs.length > 0) {
    const section = document.createElement("section");
    section.className = "presence-stale";
    section.appendChild(sectionTitle("Ослабшие воспоминания"));
    for (const belief of staleBeliefs) {
      const item = document.createElement("p");
      item.className = "presence-stale-line";
      item.textContent = belief.displayName;
      section.appendChild(item);
    }
    panel.appendChild(section);
  }

  const dormantThreads = (session.presence && session.presence.dormantThreads) || [];
  if (dormantThreads.length > 0) {
    const section = document.createElement("section");
    section.className = "presence-dormant";
    section.appendChild(sectionTitle("Нить без продолжения"));
    for (const thread of dormantThreads) {
      const item = document.createElement("p");
      item.className = "presence-dormant-line";
      item.textContent = thread.label;
      section.appendChild(item);
    }
    panel.appendChild(section);
  }

  const doubts = (session.presence && session.presence.suggestedReobservations) || [];
  if (doubts.length > 0) {
    const section = document.createElement("section");
    section.className = "presence-doubts";
    section.appendChild(sectionTitle("Сомнения"));
    for (const subject of doubts) {
      const item = document.createElement("p");
      item.className = "presence-doubt";
      item.textContent = `${subject.displayName}: ${subject.reason}`;
      section.appendChild(item);
    }
    panel.appendChild(section);
  }

  // Client-only transition: dispatches an event, never acknowledges.
  const continueBtn = document.createElement("button");
  continueBtn.className = "presence-continue-btn";
  continueBtn.type = "button";
  continueBtn.textContent = mode === "first" ? "Войти" : "Осмотреться";
  continueBtn.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("skald:presence-continue"));
  });
  panel.appendChild(continueBtn);

  fragment.appendChild(panel);
  return fragment;
}
