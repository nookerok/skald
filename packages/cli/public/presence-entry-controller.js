// presence-entry-controller.js — one unified return surface.
import {
  transitionPresenceEntry,
  initialState,
  PHASE,
  ACTION,
  loadingTextForPhase,
  ackStorageKey,
} from "./presence-entry-state.js";
import { fetchObserverSession, acknowledgePresence, createRequestKey } from "./world-api-client.js";
import { renderPresenceView } from "./presence-view.js";
import { savePresenceLease } from "./presence-lease.js";
import { clearExitPending } from "./presence-exit-controller.js";

let state = initialState();
let container = null;
let worldId = null;
let presenceAckListener = null;

function readPending() {
  try {
    const raw = sessionStorage.getItem(ackStorageKey(worldId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writePending(data) {
  try { sessionStorage.setItem(ackStorageKey(worldId), JSON.stringify(data)); } catch {}
}
function clearPending() {
  try { sessionStorage.removeItem(ackStorageKey(worldId)); } catch {}
}
function focusables() {
  return container ? [...container.querySelectorAll("button, [href], input, textarea, select, [tabindex]:not([tabindex=\"-1\"])")] : [];
}
function focusFirst() {
  const list = focusables();
  if (list.length > 0) list[0].focus();
}
function setBusy(busy) {
  if (container) container.setAttribute("aria-busy", String(busy));
}
function renderLoading(phase) {
  const card = document.createElement("div");
  card.className = "presence-entry-card presence-entry-loading-card";
  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "LIVING WORLD";
  const line = document.createElement("p");
  line.className = "presence-entry-loading";
  line.setAttribute("role", "status");
  line.setAttribute("aria-live", "polite");
  line.textContent = loadingTextForPhase(phase);
  card.append(eyebrow, line);
  container.replaceChildren(card);
}
function renderError(title, message, retryLabel, onRetry) {
  const card = document.createElement("div");
  card.className = "presence-entry-card error";
  const eyebrow = document.createElement("span");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "LIVING WORLD";
  const head = document.createElement("p");
  head.className = "presence-entry-error-title";
  head.textContent = title;
  card.append(eyebrow, head);
  if (message) {
    const body = document.createElement("p");
    body.className = "presence-entry-error-message";
    body.textContent = message;
    card.appendChild(body);
  }
  const retry = document.createElement("button");
  retry.className = "presence-enter-btn";
  retry.type = "button";
  retry.textContent = retryLabel;
  retry.addEventListener("click", onRetry);
  card.appendChild(retry);
  container.replaceChildren(card);
  focusFirst();
}
function render() {
  if (!container) return;
  switch (state.phase) {
    case PHASE.REQUESTING_SESSION:
      setBusy(true);
      renderLoading(PHASE.REQUESTING_SESSION);
      return;
    case PHASE.ACKNOWLEDGING_ENTRY:
      setBusy(true);
      renderLoading(PHASE.ACKNOWLEDGING_ENTRY);
      return;
    case PHASE.PRESENCE:
      setBusy(false);
      container.replaceChildren(renderPresenceView(state.session, state.summary));
      focusFirst();
      return;
    case PHASE.RETRYABLE_ERROR:
      setBusy(false);
      if (state.error?.code === "ack_transport") {
        renderError("Не удалось подтвердить вход.", state.error.message, "Повторить вход", retryAck);
      } else {
        renderError("Не удалось открыть мир.", state.error?.message, "Повторить", retrySession);
      }
      return;
    case PHASE.STALE_REVISION:
      setBusy(false);
      renderError("Мир успел измениться.", "Получаем свежий взгляд на мир…", "Обновить взгляд", retrySession);
      return;
    case PHASE.UNAVAILABLE:
      setBusy(false);
      renderError("Мир сейчас недоступен.", state.error?.message, "Вернуться в меню", () => { window.location.hash = "#/menu"; });
      return;
    default:
      return;
  }
}
async function loadSession() {
  const result = await fetchObserverSession(worldId);
  const replacementWorldId = result.body?.error?.code === "world_superseded"
    ? result.body.error.replacementWorldId
    : null;
  if (typeof replacementWorldId === "string" && replacementWorldId.length > 0) {
    window.location.replace("#/world/" + encodeURIComponent(replacementWorldId) + "/return");
    return;
  }
  if (!result.body || !result.body.ok) {
    state = transitionPresenceEntry(state, result.status >= 400 && result.status < 500 ? ACTION.SESSION_FAIL : ACTION.UNAVAILABLE);
    render();
    return;
  }
  state = transitionPresenceEntry(state, ACTION.SESSION_OK, { session: result.body.session, summary: result.body.summary });
  render();
}
async function ack(key, worldTime, eventNumber) {
  state = transitionPresenceEntry(state, ACTION.ACK_START, { key });
  writePending({ key, worldTime, eventNumber });
  render();
  const result = await acknowledgePresence(worldId, key, worldTime, eventNumber);
  if (result.body?.ok) {
    clearPending();
    savePresenceLease(worldId, { worldTime, eventNumber });
    state = transitionPresenceEntry(state, ACTION.ACK_SUCCESS, { checkpoint: result.body.checkpoint });
    window.dispatchEvent(new CustomEvent("skald:presence-ready", { detail: { worldId } }));
    return;
  }
  if (result.status === 409) {
    const code = result.body?.error?.code;
    clearPending();
    if (code === "stale_revision" || code === "duplicate_request") {
      state = transitionPresenceEntry(state, code === "stale_revision" ? ACTION.STALE_REVISION : ACTION.DUPLICATE_REQUEST);
      render();
      state = transitionPresenceEntry(state, ACTION.RELOAD_SESSION);
      render();
      await loadSession();
      return;
    }
  }
  state = transitionPresenceEntry(state, ACTION.ACK_FAIL);
  render();
}
export async function startPresenceEntry(targetContainer, targetWorldId) {
  container = targetContainer;
  worldId = targetWorldId;
  clearExitPending(worldId);
  if (presenceAckListener) window.removeEventListener("skald:presence-ack", presenceAckListener);
  presenceAckListener = () => {
    if (state.phase !== PHASE.PRESENCE) return;
    const revision = state.session?.revision;
    if (revision) void ack(createRequestKey("presence-ack"), revision.worldTime, revision.eventNumber);
  };
  window.addEventListener("skald:presence-ack", presenceAckListener);
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const dialog = container?.closest('[role="dialog"][aria-modal="true"]');
    if (!dialog || dialog.hidden || dialog.getAttribute("aria-hidden") === "true") return;
    const list = focusables();
    if (list.length === 0) return;
    const current = list.indexOf(document.activeElement);
    const next = event.shiftKey ? (current <= 0 ? list.length - 1 : current - 1) : (current < 0 || current === list.length - 1 ? 0 : current + 1);
    event.preventDefault();
    list[next].focus();
  });
  state = transitionPresenceEntry(state, ACTION.ENTER, { worldId });
  render();
  const pending = readPending();
  if (pending && typeof pending.key === "string") {
    await ack(pending.key, pending.worldTime, pending.eventNumber);
    return;
  }
  await loadSession();
}
export function retryAck() {
  if (state.phase !== PHASE.RETRYABLE_ERROR) return;
  const pending = readPending();
  if (pending?.key && pending.key === state.ackKey) ack(pending.key, pending.worldTime, pending.eventNumber);
}
export function retrySession() {
  if (state.phase !== PHASE.RETRYABLE_ERROR && state.phase !== PHASE.STALE_REVISION) return;
  state = transitionPresenceEntry(state, ACTION.RELOAD_SESSION);
  render();
  loadSession();
}
