import { renderLivingWorld } from "./living-world-shell.js";
import { renderChatFeed as renderChatFeedModel, getLocalIntents, addLocalIntent as addLocalIntentModel, addLocalInquiry as addLocalInquiryModel, removeLocalIntent as removeLocalIntentModel, bindIntentWorldTime as bindIntentWorldTimeModel, setIntentStatus as setIntentStatusModel, addClarification as addClarificationModel, clearLocalIntents as clearLocalIntentsModel } from "./chat-feed-view.js";
import { initActivityView } from "./activity-view.js";
const overlayOpeners = new Map();
let currentSnapshot = null;
let currentJournal = null;
export function renderGameShell(snapshot) { currentSnapshot = snapshot || null; renderLivingWorld(snapshot); if (currentJournal) renderChatFeedModel(currentJournal.turns, getLocalIntents(), currentSnapshot); }
export function humanizeLatestResponse(text) {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return "";
  const cleaned = value.replace(/^Ты находишься в точке\s*\(-?\d+\s*,\s*-?\d+\)\.\s*/u, "").replace(/^Ты пытаешься:\s*/u, "").trim();
  return cleaned || value;
}
export function renderChatFeed(journal) { currentJournal = journal || null; renderChatFeedModel(journal?.turns, getLocalIntents(), currentSnapshot); }
export function addLocalIntent(...args) { return addLocalIntentModel(...args); }
export function addLocalInquiry(...args) { return addLocalInquiryModel(...args); }
export function removeLocalIntent(...args) { return removeLocalIntentModel(...args); }
export function bindIntentWorldTime(...args) { return bindIntentWorldTimeModel(...args); }
export function setIntentStatus(...args) { return setIntentStatusModel(...args); }
export function addClarification(...args) { return addClarificationModel(...args); }
export function clearLocalIntents(...args) { currentJournal = null; return clearLocalIntentsModel(...args); }
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
  const contextTabs = [...document.querySelectorAll(".context-tab")];
  const activateContextTab = (tab, focus = false) => {
    contextTabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.setAttribute("tabindex", selected ? "0" : "-1");
    });
    document.querySelectorAll(".context-panel").forEach((panel) => { panel.hidden = panel.id !== "context-" + tab.dataset.context; });
    if (focus) tab.focus();
  };
  contextTabs.forEach((tab, index) => {
    if (tab.getAttribute("aria-selected") !== "true") tab.setAttribute("tabindex", "-1");
    tab.addEventListener("click", () => activateContextTab(tab));
    tab.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % contextTabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + contextTabs.length) % contextTabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = contextTabs.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      const next = contextTabs[nextIndex];
      if (next) activateContextTab(next, true);
    });
  });
  initActivityView();
  document.getElementById("open-journal-inline")?.addEventListener("click", () => openShellOverlay("journal-overlay"));
  const submitCommand = () => { const input = document.getElementById("command-input"); const value = input?.value.trim(); if (value) onCommand(value); };
  document.getElementById("command-form")?.addEventListener("submit", (event) => { event.preventDefault(); submitCommand(); });
  document.getElementById("command-input")?.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitCommand(); } });
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
