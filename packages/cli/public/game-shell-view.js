import { renderLivingWorld } from "./living-world-shell.js";
import { renderChatFeed as renderChatFeedModel, getLocalIntents, addLocalIntent, bindIntentWorldTime, clearLocalIntents } from "./chat-feed-view.js";
import { initActivityView } from "./activity-view.js";
const overlayOpeners = new Map();
export function renderGameShell(snapshot) { renderLivingWorld(snapshot); }
export function renderChatFeed(journal) { renderChatFeedModel(journal?.turns, getLocalIntents()); }
export { addLocalIntent, bindIntentWorldTime, clearLocalIntents };
export function renderLatestResponse(journal) { const title=document.getElementById('latest-response-title'); const notable=document.getElementById('latest-response-notable'); if(!title||!notable)return; const turn=Array.isArray(journal?.turns)?journal.turns[0]:null; if(turn?.presentation?.primary?.text) title.textContent=turn.presentation.primary.text; notable.replaceChildren(); for(const entry of (turn?.presentation?.notable||[]).slice(0,2)){const item=document.createElement('p'); item.className='latest-response-item'; item.textContent=entry.text||''; notable.appendChild(item);} }
function setText(id, value) { const element = document.getElementById(id); if (element) element.textContent = value == null ? "" : String(value); }
export function renderShellConnection(mode, message) { const dot = document.getElementById("connection-dot"); if (dot) dot.dataset.mode = mode || "ready"; setText("status-text", message || "Готов"); }
export function setShellBusy(busy, stage = "Мир отвечает…") {
  document.body.classList.toggle("shell-busy", busy);
  const form = document.getElementById("command-form"); if (form) form.setAttribute("aria-busy", String(busy));
  const input = document.getElementById("command-input"); const send = document.getElementById("send-btn");
  if (input) input.disabled = busy; if (send) send.disabled = busy;
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
    if (target === "context-threads") {
      document.querySelector('.context-tab[data-context="threads"]')?.click();
    }
    if (target === "context-activity") {
      document.querySelector('.context-tab[data-context="activity"]')?.click();
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
