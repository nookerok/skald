import { renderLivingWorld, renderTurnHistory as renderTurnHistoryModel } from "./living-world-shell.js";
import { initActivityView } from "./activity-view.js";
let busyStageTimer = null;
const overlayOpeners = new Map();
const BUSY_STAGES = ["Разбираем намерение…", "Применяем законы мира…", "Собираем последствия…"];
export function renderGameShell(snapshot) { renderLivingWorld(snapshot); }
export function renderTurnHistory(journal) { renderTurnHistoryModel(journal); }
function setText(id, value) { const element = document.getElementById(id); if (element) element.textContent = value == null ? "" : String(value); }
export function renderShellConnection(mode, message) { const dot = document.getElementById("connection-dot"); if (dot) dot.dataset.mode = mode || "ready"; setText("status-text", message || "Готов"); }
export function setShellBusy(busy, stage = "Мир отвечает…") {
  if (busyStageTimer) { clearInterval(busyStageTimer); busyStageTimer = null; }
  document.body.classList.toggle("shell-busy", busy);
  const form = document.getElementById("command-form"); if (form) form.setAttribute("aria-busy", String(busy));
  const input = document.getElementById("command-input"); const send = document.getElementById("send-btn");
  if (input) input.disabled = busy; if (send) send.disabled = busy;
  const loadingStage = document.getElementById("loading-stage");
  if (loadingStage) {
    loadingStage.textContent = busy ? (stage || BUSY_STAGES[0]) : "Мир готов.";
    if (busy) {
      let index = Math.max(0, BUSY_STAGES.indexOf(stage));
      busyStageTimer = setInterval(() => { index = (index + 1) % BUSY_STAGES.length; loadingStage.textContent = BUSY_STAGES[index]; }, 900);
    }
  }
}
export function showShellError(message) { const element = document.getElementById("shell-error"); if (element) { element.hidden = false; element.setAttribute("aria-hidden", "false"); setText("shell-error-message", message || "Не удалось подключиться к миру"); } }
export function clearShellError() { const element = document.getElementById("shell-error"); if (element) { element.hidden = true; element.setAttribute("aria-hidden", "true"); } }
export function openShellOverlay(id, opener = document.activeElement) {
  const element = document.getElementById(id);
  if (!element) return;
  overlayOpeners.set(id, opener);
  element.hidden = false;
  element.setAttribute("aria-hidden", "false");
  const focusTarget = element.querySelector("button, [href], input, textarea, select, [tabindex]:not([tabindex=\"-1\"])") || element;
  focusTarget.focus?.();
}
export function closeShellOverlay(id, restoreFocus = true) {
  const element = document.getElementById(id);
  if (!element) return;
  element.hidden = true;
  element.setAttribute("aria-hidden", "true");
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
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const openOverlay = [...overlayOpeners.keys()].find((id) => {
      const element = document.getElementById(id);
      return element && !element.hidden;
    });
    if (openOverlay) { event.preventDefault(); closeShellOverlay(openOverlay); }
  });
  document.getElementById("shell-retry-connect")?.addEventListener("click", () => window.dispatchEvent(new CustomEvent("skald:retry-connect")));
}
