let currentGuidance = null;
let lastAppliedTime = 0;
let requestSeq = 0;

function apiPath(path) { try { const id = sessionStorage.getItem("skald:worldId"); return id ? `/api/worlds/${encodeURIComponent(id)}${path}` : `/api${path}`; } catch { return path; } }

export async function loadGuidance() {
  const seq = ++requestSeq;
  try {
    const res = await fetch(apiPath("/guidance"));
    const body = await res.json();
    if (body.ok && seq === requestSeq) {
      applyGuidance(body.guidance);
    }
  } catch {
    // silent
  }
}

export function applyGuidance(guidance) {
  if (!guidance) return;
  // Stale-response guard: don't apply guidance older than the last applied
  if (guidance.worldTime < lastAppliedTime) return;
  lastAppliedTime = guidance.worldTime;
  currentGuidance = guidance;
  renderGuidance();
}

function isDismissed(phase) {
  try {
    const key = "skald:guidance:dismissed:1:" + phase;
    return sessionStorage.getItem(key) === "1";
  } catch { return false; }
}

function dismissCurrent() {
  if (!currentGuidance) return;
  try {
    const key = "skald:guidance:dismissed:1:" + currentGuidance.phase;
    sessionStorage.setItem(key, "1");
  } catch {}
  currentGuidance = null;
  renderGuidance();
}

export function renderGuidance() {
  const container = document.getElementById("guidance-container");
  if (!container) return;
  container.replaceChildren();

  if (!currentGuidance) return;

  // Check dismissal
  if (isDismissed(currentGuidance.phase)) {
    currentGuidance = null;
    return;
  }

  if (currentGuidance.mode === "free_play") {
    renderFreePlay(container);
  } else {
    renderOnboarding(container);
  }
}

function renderOnboarding(container) {
  const section = document.createElement("div");
  section.className = "guidance-onboarding";

  const header = document.createElement("div");
  header.className = "guidance-header";

  const title = document.createElement("span");
  title.className = "guidance-title";
  title.textContent = currentGuidance.title;

  const dismissBtn = document.createElement("button");
  dismissBtn.className = "guidance-dismiss";
  dismissBtn.textContent = "Скрыть";
  dismissBtn.setAttribute("aria-label", "Скрыть эту подсказку");
  dismissBtn.addEventListener("click", dismissCurrent);

  header.appendChild(title);
  header.appendChild(dismissBtn);
  section.appendChild(header);

  if (currentGuidance.text) {
    const textEl = document.createElement("p");
    textEl.className = "guidance-text";
    textEl.textContent = currentGuidance.text;
    section.appendChild(textEl);
  }

  appendIntentExamples(section);
  container.appendChild(section);
}

function renderFreePlay(container) {
  const details = document.createElement("details");
  details.className = "guidance-free-play";

  const summary = document.createElement("summary");
  summary.textContent = currentGuidance.title || "Куда дальше?";
  details.appendChild(summary);

  appendIntentExamples(details);
  container.appendChild(details);
}

function appendIntentExamples(parent) {
  const examples = Array.isArray(currentGuidance.intentExamples) ? currentGuidance.intentExamples : [];
  if (examples.length > 0) {
    const heading = document.createElement("p");
    heading.className = "guidance-examples-title";
    heading.textContent = "Можно попробовать:";
    parent.appendChild(heading);
    const list = document.createElement("ul");
    list.className = "guidance-examples";
    for (const example of examples) {
      const item = document.createElement("li");
      item.className = "guidance-example";
      item.textContent = "— " + example.text;
      if (example.description) item.setAttribute("aria-label", example.description);
      list.appendChild(item);
    }
    parent.appendChild(list);
  }

  const navigation = Array.isArray(currentGuidance.navigation) ? currentGuidance.navigation : [];
  if (navigation.length === 0) return;
  const nav = document.createElement("nav");
  nav.className = "guidance-navigation";
  for (const item of navigation) {
    const link = document.createElement("button");
    link.className = "guidance-navigation-link";
    link.type = "button";
    link.textContent = item.label;
    link.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("skald:navigate", { detail: { view: item.view } }));
    });
    nav.appendChild(link);
  }
  parent.appendChild(nav);
}
