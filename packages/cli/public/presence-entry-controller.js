// presence-entry-controller.js — drives the deterministic entry state
// machine: atomic session fetch (session + summary on one revision),
// presence/focus phases with explicit player transitions, durable
// acknowledge retry, reload recovery and the presence lease. I/O lives
// here; all decisions live in presence-entry-state.js.

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
import { renderFocusView } from "./focus-view.js";
import { savePresenceLease } from "./presence-lease.js";
import { clearExitPending } from "./presence-exit-controller.js";

let state = initialState();
let container = null;
let worldId = null;

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
  if (!container) return [];
  return [...container.querySelectorAll("button, [href], input, textarea, select, [tabindex]:not([tabindex=\"-1\"])")];
}

function trapFocus() {
  const list = focusables();
  if (list.length === 0) return;
  const first = list[0];
  first.focus();
}

function focusPhaseTitle() {
  const title = container.querySelector("[data-phase-title]");
  if (title) title.focus();
  else trapFocus();
}

function setBusy(busy) {
  if (container) container.setAttribute("aria-busy", String(busy));
}

function renderLoading(phase) {
  const card = document.createElement("div");
  card.className = "presence-entry-card";
  const line = document.createElement("p");
  line.className = "presence-entry-loading";
  line.setAttribute("role", "status");
  line.setAttribute("aria-live", "polite");
  line.textContent = loadingTextForPhase(phase);
  card.appendChild(line);
  container.replaceChildren(card);
}

function renderError(title, message, retryLabel, onRetry) {
  const card = document.createElement("div");
  card.className = "presence-entry-card error";
  const head = document.createElement("p");
  head.className = "presence-entry-error-title";
  head.textContent = title;
  card.appendChild(head);
  if (message) {
    const body = document.createElement("p");
    body.className = "presence-entry-error-message";
    body.textContent = message;
    card.appendChild(body);
  }
  const retry = document.createElement("button");
  retry.className = "presence-ack-btn";
  retry.type = "button";
  retry.textContent = retryLabel;
  retry.addEventListener("click", onRetry);
  card.appendChild(retry);
  container.replaceChildren(card);
  trapFocus();
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
      focusPhaseTitle();
      return;
    case PHASE.FOCUS:
      setBusy(false);
      container.replaceChildren(renderFocusView(state.session));
      focusPhaseTitle();
      return;
    case PHASE.RETRYABLE_ERROR:
      setBusy(false);
      if (state.error && state.error.code === "ack_transport") {
        renderError("Не удалось подтвердить присутствие.", state.error.message, "Попробовать снова", retryAck);
      } else {
        renderError("Не удалось восстановить присутствие.", state.error && state.error.message, "Попробовать снова", retrySession);
      }
      return;
    case PHASE.STALE_REVISION:
      setBusy(false);
      renderError("Мир успел измениться.", "Возвращаемся к свежим наблюдениям…", "Продолжить", retrySession);
      return;
    case PHASE.UNAVAILABLE:
      setBusy(false);
      renderError("Мир сейчас недоступен.", state.error && state.error.message, "Вернуться в меню", () => { window.location.hash = "#/menu"; });
      return;
    default:
      return;
  }
}

async function loadSession() {
  const result = await fetchObserverSession(worldId);
  if (!result.body || !result.body.ok) {
    state = transitionPresenceEntry(state, result.status >= 400 && result.status < 500 ? ACTION.SESSION_FAIL : ACTION.UNAVAILABLE);
    render();
    return;
  }
  state = transitionPresenceEntry(state, ACTION.SESSION_OK, {
    session: result.body.session,
    summary: result.body.summary,
  });
  render();
}

async function ack(key, worldTime, eventNumber) {
  state = transitionPresenceEntry(state, ACTION.ACK_START, { key });
  writePending({ key, worldTime, eventNumber });
  render();
  const result = await acknowledgePresence(worldId, key, worldTime, eventNumber);
  if (result.body && result.body.ok) {
    clearPending();
    savePresenceLease(worldId, { worldTime, eventNumber });
    state = transitionPresenceEntry(state, ACTION.ACK_SUCCESS, { checkpoint: result.body.checkpoint });
    window.dispatchEvent(new CustomEvent("skald:presence-ready", { detail: { worldId } }));
    return;
  }
  if (result.status === 409) {
    const code = result.body && result.body.error && result.body.error.code;
    clearPending();
    if (code === "stale_revision") {
      state = transitionPresenceEntry(state, ACTION.STALE_REVISION);
      render();
      state = transitionPresenceEntry(state, ACTION.RELOAD_SESSION);
      render();
      await loadSession();
      return;
    }
    if (code === "duplicate_request") {
      state = transitionPresenceEntry(state, ACTION.DUPLICATE_REQUEST);
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
  // A fresh entry voids any unfinished graceful-return intent.
  clearExitPending(worldId);
  window.addEventListener("skald:presence-continue", () => {
    if (state.phase !== PHASE.PRESENCE) return;
    state = transitionPresenceEntry(state, ACTION.PRESENCE_CONTINUE);
    render();
  });
  window.addEventListener("skald:presence-ack", () => {
    if (state.phase !== PHASE.FOCUS) return;
    const revision = state.session && state.session.revision;
    if (revision) ack(createRequestKey("presence-ack"), revision.worldTime, revision.eventNumber);
  });
  window.addEventListener("keydown", (event) => {
    const interactive = [PHASE.PRESENCE, PHASE.FOCUS, PHASE.RETRYABLE_ERROR, PHASE.STALE_REVISION];
    if (!interactive.includes(state.phase)) return;
    if (event.key !== "Tab") return;
    const list = focusables();
    if (list.length < 2) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
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
  if (pending && typeof pending.key === "string" && pending.key === state.ackKey) {
    ack(pending.key, pending.worldTime, pending.eventNumber);
  }
}

export function retrySession() {
  if (state.phase !== PHASE.RETRYABLE_ERROR && state.phase !== PHASE.STALE_REVISION) return;
  state = transitionPresenceEntry(state, ACTION.RELOAD_SESSION);
  render();
  loadSession();
}
