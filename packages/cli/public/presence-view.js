// presence-view.js — renders the "return" montage strictly from backend DTOs
// (ObserverSessionDTO + WorldPresenceSummary). The browser classifies nothing
// and never invents sentences; every line here is server-authored.

export function presenceModeFor(session) {
  if (session.checkpointState === "missing") return "first";
  if (session.checkpointState === "incompatible") return "invalid";
  if (session.drift.level === "low") return "valid-low";
  if (session.drift.level === "medium") return "valid-medium";
  if (session.drift.level === "high") return "valid-high";
  return "valid-none";
}

export function renderPresenceView(session, summary) {
  const fragment = document.createDocumentFragment();
  const mode = presenceModeFor(session);

  const panel = document.createElement("div");
  panel.className = "presence-entry-panel";
  panel.dataset.mode = mode;

  const heading = document.createElement("h2");
  heading.className = "presence-entry-heading";
  heading.textContent = "Возвращение в мир";
  panel.appendChild(heading);

  const status = document.createElement("p");
  status.className = "presence-entry-status";
  status.textContent = (summary && summary.presenceStatus) || "Ты вернулся.";
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

  if (session.presence && session.presence.drift && session.presence.drift.reasons.length > 0) {
    const reasons = document.createElement("ul");
    reasons.className = "presence-reasons";
    for (const reason of session.presence.drift.reasons) {
      const item = document.createElement("li");
      item.textContent = reason.text;
      reasons.appendChild(item);
    }
    panel.appendChild(reasons);
  }

  const doubts = (session.presence && session.presence.suggestedReobservations) || [];
  if (doubts.length > 0) {
    const section = document.createElement("section");
    section.className = "presence-doubts";
    const title = document.createElement("h3");
    title.textContent = "Сомнения";
    section.appendChild(title);
    for (const subject of doubts) {
      const item = document.createElement("p");
      item.className = "presence-doubt";
      item.textContent = `${subject.displayName}: ${subject.reason}`;
      section.appendChild(item);
    }
    panel.appendChild(section);
  }

  fragment.appendChild(panel);
  return fragment;
}
