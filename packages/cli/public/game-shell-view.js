import { renderLivingWorld } from "./living-world-shell.js";
import { renderChatFeed as renderChatFeedModel, getLocalIntents, addLocalIntent as addLocalIntentModel, bindIntentWorldTime as bindIntentWorldTimeModel, clearLocalIntents as clearLocalIntentsModel } from "./chat-feed-view.js";
import { initActivityView } from "./activity-view.js";
const overlayOpeners = new Map();
export function renderGameShell(snapshot) { renderLivingWorld(snapshot); }
export function humanizeLatestResponse(text) {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return "";
  const cleaned = value.replace(/^Ты находишься в точке\s*\(-?\d+\s*,\s*-?\d+\)\.\s*/u, "").replace(/^Ты пытаешься:\s*/u, "").trim();
  return cleaned || value;
}
export function renderChatFeed(journal) { renderChatFeedModel(journal?.turns, getLocalIntents()); }
export function addLocalIntent(...args) { return addLocalIntentModel(...args); }
export function bindIntentWorldTime(...args) { return bindIntentWorldTimeModel(...args); }
export function clearLocalIntents(...args) { return clearLocalIntentsModel(...args); }
export function renderLatestIntent() {
  const node = document.getElementById("latest-intent");
  if (!node) return;
  const intent = getLocalIntents().at(-1);
  node.hidden = !intent;
  node.textContent = intent?.text || "";
}

export function renderLatestResponse(journal) {
  renderLatestIntent();
  const title=document.getElementById("latest-response-title");
  const notable=document.getElementById("latest-response-notable");
  if(!title||!notable)return;
  const turn=Array.isArray(journal?.turns)?journal.turns[0]:null;
  if(turn?.presentation?.primary?.text) title.textContent=humanizeLatestResponse(turn.presentation.primary.text);
  notable.replaceChildren();
  for(const entry of (turn?.presentation?.notable||[]).slice(0,1)){
    const item=document.createElement("p");
    item.className="latest-response-item";
    item.textContent=humanizeLatestResponse(entry.text||"");
    notable.appendChild(item);
  }
  renderChroniclePreview(journal);
}

export function renderChroniclePreview(journal) {
  const container = document.getElementById("chronicle-scene-list");
  if (!container) return;
  container.replaceChildren();
  const seen = new Set();
  const turns = Array.isArray(journal?.turns) ? journal.turns : [];
  const scenes = [];
  for (const turn of turns) {
    const primary = turn?.presentation?.primary;
    const text = humanizeLatestResponse(primary?.text || "");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const time = Number.isFinite(turn?.worldTime)
      ? turn.worldTime
      : Number.isFinite(primary?.timestamp) ? primary.timestamp : null;
    scenes.push({ label: chronicleSceneLabel(text, scenes.length), text, mark: primary.discoveryMark, time });
    if (scenes.length >= 3) break;
  }
  if (!scenes.length) {
    const empty = document.createElement("p");
    empty.className = "chronicle-empty";
    empty.textContent = "Путь ещё не оставил сцен.";
    container.appendChild(empty);
    return;
  }
  for (const scene of scenes) {
    const card = document.createElement("article");
    card.className = "chronicle-scene";
    const time = document.createElement("span");
    time.className = "chronicle-scene-time";
    time.textContent = scene.time == null ? "Сцена" : "Ход " + scene.time;
    const copy = document.createElement("p");
    copy.textContent = scene.text;
    card.append(time, copy);
    if (scene.mark) {
      const mark = document.createElement("span");
      mark.className = "chronicle-scene-mark";
      mark.textContent = scene.mark === "trace" ? "След" : scene.mark === "echo" ? "Эхо" : "Знамение";
      card.appendChild(mark);
    }
    container.appendChild(card);
  }
}
function chronicleSceneLabel(text, index) {
  const normalized = String(text || "").toLowerCase();
  if (normalized.includes("\u043f\u0443\u0442\u044c") || normalized.includes("\u0434\u043e\u0440\u043e\u0433") || normalized.includes("\u043f\u0435\u0440\u0435\u043f\u0440\u0430\u0432") || normalized.includes("\u0432\u043e\u0434\u043e\u043f\u0430\u0434") || normalized.includes("\u0440\u0443\u0438\u043d")) return "\u041f\u0443\u0442\u0435\u0448\u0435\u0441\u0442\u0432\u0438\u0435";
  if (normalized.includes("\u043e\u0442\u043a\u0440\u044b") || normalized.includes("\u0437\u0430\u043c\u0435\u0442") || normalized.includes("\u0441\u043b\u0435\u0434") || normalized.includes("\u043d\u0430\u0431\u043b\u044e\u0434") || normalized.includes("\u0443\u0437\u043d\u0430\u0451\u0442")) return "\u041e\u0442\u043a\u0440\u044b\u0442\u0438\u0435";
  if (normalized.includes("\u043e\u0442\u043d\u043e\u0448") || normalized.includes("\u043e\u0431\u0449\u0438\u043d") || normalized.includes("\u0434\u043e\u0432\u0435\u0440") || normalized.includes("\u0443\u0432\u0430\u0436\u0435\u043d")) return "\u041e\u0442\u043d\u043e\u0448\u0435\u043d\u0438\u0435";
  if (normalized.includes("\u043e\u043f\u0430\u0441") || normalized.includes("\u043f\u0440\u0435\u0433\u0440\u0430\u0434") || normalized.includes("\u043e\u0433\u043e\u043d\u044c") || normalized.includes("\u0436\u0430\u0440") || normalized.includes("\u0442\u0440\u0435\u0432\u043e\u0433")) return "\u041e\u043f\u0430\u0441\u043d\u043e\u0441\u0442\u044c";
  if (normalized.includes("\u043f\u043e\u0441\u043b\u0435\u0434\u0441\u0442\u0432") || normalized.includes("\u0438\u0437\u043c\u0435\u043d\u0438\u043b") || normalized.includes("\u043f\u0440\u043e\u044f\u0432\u0438\u043b")) return "\u041f\u043e\u0441\u043b\u0435\u0434\u0441\u0442\u0432\u0438\u0435";
  return "\u0421\u0446\u0435\u043d\u0430 " + (index + 1);
}
function setText(id, value) { const element = document.getElementById(id); if (element) element.textContent = value == null ? "" : String(value); }
export function renderShellConnection(mode, message) { const dot = document.getElementById("connection-dot"); if (dot) dot.dataset.mode = mode || "ready"; setText("status-text", message || "Готов"); }
export function setShellBusy(busy, stage = "Мир отвечает…") {
  document.body.classList.toggle("shell-busy", busy);
  const form = document.getElementById("command-form"); if (form) form.setAttribute("aria-busy", String(busy));
  const input = document.getElementById("command-input"); const send = document.getElementById("send-btn");
  if (input) input.disabled = busy; if (send) send.disabled = busy; const voice = document.getElementById("voice-btn"); if (voice) voice.disabled = busy;
  const loadingStage = document.getElementById("loading-stage");
  if (loadingStage) loadingStage.textContent = busy ? stage : "Мир готов.";
}
function focusDialogSurface(element) {
  // The dialog itself is tabindex="-1", so it can take programmatic focus and
  // announce its accessible name while trapping Tab inside via trapFocus.
  const focusTarget = element.querySelector("button, [href], input, textarea, select, [tabindex]:not([tabindex=\"-1\"])") || element;
  focusTarget.focus?.();
}
export function showShellError(message) { const element = document.getElementById("shell-error"); if (element) { element.hidden = false; element.setAttribute("aria-hidden", "false"); setText("shell-error-message", message || "Не удалось подключиться к миру"); refreshBackgroundInert(); focusDialogSurface(element); } }
export function clearShellError() { const element = document.getElementById("shell-error"); if (element) { element.hidden = true; element.setAttribute("aria-hidden", "true"); } refreshBackgroundInert(); }
export function setShellLoading(visible) {
  const element = document.getElementById("shell-loading");
  if (!element) return;
  element.hidden = !visible;
  element.setAttribute("aria-hidden", String(!visible));
  refreshBackgroundInert();
  if (visible) focusDialogSurface(element);
}
function focusableElements(root) {
  return Array.from(root.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
    .filter((el) => !el.hidden && el.offsetParent !== null);
}
function trapFocus(root, event) {
  const focusable = focusableElements(root);
  if (focusable.length === 0) { event.preventDefault(); return; }
  const currentIndex = focusable.indexOf(document.activeElement);
  let nextIndex;
  if (event.shiftKey) nextIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
  else nextIndex = currentIndex === -1 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1;
  event.preventDefault();
  focusable[nextIndex].focus();
}
/**
 * The only visible `aria-modal="true"` dialog owns the page: everything else
 * gets `inert` so Tab/focus and the accessibility tree cannot leave it. This
 * covers the shared overlays (`openShellOverlay`), the loading screen, the
 * connection error dialog and the presence entry dialog.
 */
function refreshBackgroundInert() {
  document.querySelectorAll("#app [inert]").forEach((el) => el.removeAttribute("inert"));
  const modal = document.querySelector('#app [role="dialog"][aria-modal="true"]:not([hidden]):not([aria-hidden="true"])');
  if (modal && modal.parentElement) {
    for (const child of modal.parentElement.children) {
      if (child !== modal) child.setAttribute("inert", "");
    }
  }
}
export function syncShellModalInert() { refreshBackgroundInert(); }
export function openShellOverlay(id, opener = document.activeElement) {
  const element = document.getElementById(id);
  if (!element) return;
  overlayOpeners.set(id, opener);
  element.hidden = false;
  element.setAttribute("aria-hidden", "false");
  refreshBackgroundInert();
  const focusTarget = element.querySelector("button, [href], input, textarea, select, [tabindex]:not([tabindex=\"-1\"])") || element;
  focusTarget.focus?.();
}
export function closeShellOverlay(id, restoreFocus = true) {
  const element = document.getElementById(id);
  if (!element) return;
  element.hidden = true;
  element.setAttribute("aria-hidden", "true");
  if (id === "journal-overlay") {
    document.querySelectorAll('[data-mobile-target="journal-overlay"]').forEach((button) => {
      button.classList.remove("active");
      button.setAttribute("aria-pressed", "false");
    });
  }
  // Un-inert the background first: while the dialog is open the opener lives
  // inside an inert subtree, so focusing it before refreshBackgroundInert
  // would silently fail and leave focus on a hidden element / BODY.
  refreshBackgroundInert();
  if (restoreFocus) overlayOpeners.get(id)?.focus?.();
  overlayOpeners.delete(id);
}
export function initShellView(onCommand) {
  document.querySelectorAll(".context-tab").forEach((tab) => tab.addEventListener("click", () => {
    document.querySelectorAll(".context-tab").forEach((item) => item.setAttribute("aria-selected", String(item === tab)));
    document.querySelectorAll(".context-panel").forEach((panel) => { panel.hidden = panel.id !== "context-" + tab.dataset.context; });
  }));
  initActivityView();
  const submitCommand = () => { const input = document.getElementById("command-input"); const value = input?.value.trim(); if (value) onCommand(value); };
  document.getElementById("command-form")?.addEventListener("submit", (event) => { event.preventDefault(); submitCommand(); });
  document.getElementById("command-input")?.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitCommand(); } });
  document.getElementById("open-journal-inline")?.addEventListener("click", () => openShellOverlay("journal-overlay"));
  initVoiceInput();
  document.querySelectorAll("[data-close-overlay]").forEach((button) => button.addEventListener("click", () => closeShellOverlay(button.dataset.closeOverlay)));
  document.querySelectorAll("[data-mobile-target]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-mobile-target]").forEach((item) => { item.classList.toggle("active", item === button); item.setAttribute("aria-pressed", String(item === button)); });
    const target = button.dataset.mobileTarget;
    if (target === "journal-overlay") {
      openShellOverlay(target, button);
      return;
    }
    if (target === "context-knowledge") {
      document.querySelector('.context-tab[data-context="knowledge"]')?.click();
    }
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const openOverlay = [...overlayOpeners.keys()].find((id) => {
        const element = document.getElementById(id);
        return element && !element.hidden;
      });
      if (openOverlay) { event.preventDefault(); closeShellOverlay(openOverlay); }
      return;
    }
    if (event.key === "Tab") {
      const dialog = document.querySelector('#app [role="dialog"][aria-modal="true"]:not([hidden]):not([aria-hidden="true"])');
      if (dialog) trapFocus(dialog, event);
    }
  });
  document.getElementById("shell-retry-connect")?.addEventListener("click", () => window.dispatchEvent(new CustomEvent("skald:retry-connect")));
}

function initVoiceInput() {
  const button = document.getElementById("voice-btn");
  const cancel = document.getElementById("voice-cancel-btn");
  const input = document.getElementById("command-input");
  if (!button || !input) return;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (typeof Recognition !== "function") {
    button.hidden = true;
    button.style.display = "none";
    if (cancel) cancel.hidden = true;
    return;
  }
  button.hidden = false;
  button.style.display = "";
  button.classList.remove("voice-fallback-hidden");
  const status = document.getElementById("voice-status");
  const recognition = new Recognition();
  recognition.lang = "ru-RU";
  recognition.interimResults = true;
  recognition.continuous = false;
  let listening = false;
  const syncCancel = () => {
    if (cancel) cancel.hidden = !listening && !input.value.trim();
  };
  const setListening = (value) => {
    listening = value;
    button.setAttribute("aria-pressed", String(value));
    button.textContent = value ? "■" : "◉";
    if (status) status.textContent = value ? "Слушаю… проверь текст перед отправкой." : "";
    syncCancel();
  };
  recognition.onstart = () => setListening(true);
  recognition.onend = () => {
    setListening(false);
    if (input.value.trim() && status) status.textContent = "Проверь текст или отмени перед отправкой.";
  };
  recognition.onerror = () => {
    setListening(false);
    if (status) status.textContent = "Голос не распознан — можно написать намерение.";
  };
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results || []).map((result) => result[0]?.transcript || "").join(" ").trim();
    if (transcript) input.value = transcript;
    syncCancel();
  };
  input.addEventListener("input", syncCancel);
  cancel?.addEventListener("click", () => {
    try { recognition.abort(); } catch {}
    input.value = "";
    setListening(false);
    if (status) status.textContent = "Голосовое намерение отменено.";
    syncCancel();
    input.focus?.();
  });
  button.addEventListener("click", () => {
    if (listening) recognition.stop();
    else {
      try { recognition.start(); } catch { setListening(false); }
    }
  });
  syncCancel();
}
