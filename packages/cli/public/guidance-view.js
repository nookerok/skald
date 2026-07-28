let currentGuidance = null;
let lastAppliedTime = 0;
let requestSeq = 0;

export async function loadGuidance() {
  const seq = ++requestSeq;
  try {
    const res = await fetch("/api/guidance");
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
  container.innerHTML = "";

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

  const actions = document.createElement("div");
  actions.className = "guidance-actions";

  for (const sug of currentGuidance.suggestions) {
    const btn = document.createElement("button");
    btn.className = "guidance-action";
    btn.textContent = sug.label;
    btn.setAttribute("aria-label", sug.description || sug.label);
    btn.addEventListener("click", () => {
      if (sug.kind === "command" && sug.input) {
        document.dispatchEvent(new CustomEvent("skald:command", {
          detail: { input: sug.input },
        }));
      } else if (sug.kind === "navigate" && sug.view) {
        document.dispatchEvent(new CustomEvent("skald:navigate", {
          detail: { view: sug.view },
        }));
      }
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        btn.click();
      }
    });
    actions.appendChild(btn);
  }

  section.appendChild(actions);
  container.appendChild(section);
}

function renderFreePlay(container) {
  const details = document.createElement("details");
  details.className = "guidance-free-play";

  const summary = document.createElement("summary");
  summary.textContent = currentGuidance.title || "Куда дальше?";
  details.appendChild(summary);

  const actions = document.createElement("div");
  actions.className = "guidance-actions";

  for (const sug of currentGuidance.suggestions) {
    const btn = document.createElement("button");
    btn.className = "guidance-action";
    btn.textContent = sug.label;
    btn.addEventListener("click", () => {
      if (sug.kind === "command" && sug.input) {
        document.dispatchEvent(new CustomEvent("skald:command", {
          detail: { input: sug.input },
        }));
      } else if (sug.kind === "navigate" && sug.view) {
        document.dispatchEvent(new CustomEvent("skald:navigate", {
          detail: { view: sug.view },
        }));
      }
    });
    actions.appendChild(btn);
  }

  details.appendChild(actions);
  container.appendChild(details);
}
