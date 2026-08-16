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

const MAX_RETURN_HIGHLIGHTS = 2;

function uniqueText(values) {
  const seen = new Set();
  return values.filter((value) => {
    const text = typeof value === "string" ? value.trim() : "";
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Select only concrete, player-actionable signals for the return screen. */
export function selectPresenceHighlights(session) {
  const presence = session?.presence || {};
  const nearby = Array.isArray(presence.nearbyChanges)
    ? presence.nearbyChanges.map((change) => change.description)
    : [];
  const observedStatements = Array.isArray(session?.statements)
    ? session.statements
      .filter((statement) => statement.source === "observation_delta" || statement.source === "belief_contradiction")
      .map((statement) => statement.text)
    : [];
  return uniqueText([...nearby, ...observedStatements]).slice(0, MAX_RETURN_HIGHLIGHTS);
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
  if (!focus.ambientDescription && Array.isArray(focus.sensoryCues) && focus.sensoryCues.length > 0) {
    const cues = list("presence-focus-cues");
    for (const cue of uniqueText(focus.sensoryCues).slice(0, 1)) {
      const item = document.createElement("li");
      item.textContent = cue;
      cues.appendChild(item);
    }
    block.appendChild(cues);
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
  heading.textContent = mode === "first" ? "Начало пути" : "Возвращение в мир";
  panel.appendChild(heading);

  const status = document.createElement("p");
  status.className = "presence-entry-status";
  const hasServerStatus = summary && summary.schemaVersion === 1 && typeof summary.presenceStatus === "string";
  status.textContent = hasServerStatus ? summary.presenceStatus : mode === "first" ? "Здесь начнётся твой первый след." : "Мир ждёт твоего возвращения.";
  panel.appendChild(status);

  const highlights = selectPresenceHighlights(session);
  if (highlights.length > 0) {
    const section = document.createElement("section");
    section.className = "presence-highlights";
    section.setAttribute("aria-label", "Главное при возвращении");
    section.appendChild(sectionTitle("Главное сейчас"));
    const items = list("presence-highlights-list");
    for (const highlight of highlights) {
      const item = document.createElement("li");
      item.className = "presence-highlight";
      item.textContent = highlight;
      items.appendChild(item);
    }
    section.appendChild(items);
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
