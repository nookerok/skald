// presence-view.js — unified return screen. The entry flow deliberately
// stays in one calm surface: the server-provided return montage, current
// location and sensory context are shown together before one acknowledge action.

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
  const node = document.createElement("ul");
  node.className = className;
  return node;
}

function appendFocusContext(panel, session) {
  const presence = session.presence || {};
  const focus = presence.focus || {};
  const location = presence.location || {};
  const block = document.createElement("section");
  block.className = "presence-return-context";
  block.setAttribute("aria-label", "Ты здесь");
  block.appendChild(sectionTitle("Ты здесь"));

  if (location.title || location.description) {
    const place = document.createElement("div");
    place.className = "presence-focus-place";
    if (location.title) {
      const title = document.createElement("p");
      title.className = "presence-focus-place-title";
      title.textContent = location.title;
      place.appendChild(title);
    }
    if (location.description) {
      const description = document.createElement("p");
      description.className = "presence-focus-place-description";
      description.textContent = location.description;
      place.appendChild(description);
    }
    block.appendChild(place);
  }
  if (focus.ambientDescription) {
    const ambient = document.createElement("p");
    ambient.className = "presence-focus-ambient";
    ambient.textContent = focus.ambientDescription;
    block.appendChild(ambient);
  }
  if (Array.isArray(focus.sensoryCues) && focus.sensoryCues.length > 0) {
    const cues = list("presence-focus-cues");
    for (const cue of focus.sensoryCues) {
      const item = document.createElement("li");
      item.textContent = cue;
      cues.appendChild(item);
    }
    block.appendChild(cues);
  }
  if (Array.isArray(focus.rememberedContext) && focus.rememberedContext.length > 0) {
    const remembered = document.createElement("p");
    remembered.className = "presence-focus-remembered";
    remembered.textContent = focus.rememberedContext.join(" ");
    block.appendChild(remembered);
  }
  panel.appendChild(block);
}

export function renderPresenceView(session, summary) {
  const fragment = document.createDocumentFragment();
  const mode = presenceModeFor(session);
  const panel = document.createElement("div");
  panel.className = "presence-entry-panel";
  panel.dataset.mode = mode;

  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "LIVING WORLD";
  panel.appendChild(eyebrow);

  const heading = document.createElement("h2");
  heading.className = "presence-entry-heading";
  heading.id = "presence-phase-title";
  heading.setAttribute("data-phase-title", "true");
  heading.tabIndex = -1;
  heading.textContent = "Возвращение в мир";
  panel.appendChild(heading);

  const status = document.createElement("p");
  status.className = "presence-entry-status";
  const hasServerStatus = summary && summary.schemaVersion === 1 && typeof summary.presenceStatus === "string";
  status.textContent = hasServerStatus ? summary.presenceStatus : "Мир ждёт твоего возвращения.";
  panel.appendChild(status);

  if (Array.isArray(session.statements) && session.statements.length > 0) {
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

  const nearbyChanges = session.presence?.nearbyChanges || [];
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

  if (session.presence?.drift?.reasons?.length > 0) {
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

  const staleBeliefs = session.presence?.staleBeliefs || [];
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

  const dormantThreads = session.presence?.dormantThreads || [];
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

  const doubts = session.presence?.suggestedReobservations || [];
  if (doubts.length > 0) {
    const section = document.createElement("section");
    section.className = "presence-doubts";
    section.appendChild(sectionTitle("Сомнения"));
    for (const subject of doubts) {
      const item = document.createElement("p");
      item.className = "presence-doubt";
      item.textContent = subject.displayName + ": " + subject.reason;
      section.appendChild(item);
    }
    panel.appendChild(section);
  }

  appendFocusContext(panel, session);

  const enterBtn = document.createElement("button");
  enterBtn.className = "presence-enter-btn";
  enterBtn.type = "button";
  enterBtn.textContent = mode === "first" ? "Войти в мир" : "Продолжить";
  enterBtn.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("skald:presence-ack"));
  });
  panel.appendChild(enterBtn);

  fragment.appendChild(panel);
  return fragment;
}
