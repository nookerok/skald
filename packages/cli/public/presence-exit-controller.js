// presence-exit-controller.js — graceful return I/O. Owns the exit overlay,
// the durable pending exit acknowledge and the exit state machine from
// presence-exit-state.js. Decisions live in the reducer; this file only
// performs fetches, storage and rendering.

import {
  transitionExitState,
  exitInitialState,
  EXIT_PHASE,
  EXIT_ACTION,
  EXIT_LOADING_TEXT,
  EXIT_ERROR_TEXT,
  exitStorageKey,
  parseExitPending,
} from "./presence-exit-state.js";
import { fetchObserverSession, acknowledgePresence, createRequestKey } from "./world-api-client.js";
import { clearPresenceLease } from "./presence-lease.js";

let state = exitInitialState();
let overlay = null;
let waitForPendingCommand = async () => {};

export function isExitInProgress() {
  return state.phase !== EXIT_PHASE.IDLE && state.phase !== EXIT_PHASE.LEAVE_READY;
}

export function readExitPending(worldId) {
  try {
    const pending = parseExitPending(sessionStorage.getItem(exitStorageKey(worldId)));
    if (pending && pending.worldId !== worldId) {
      clearExitPending(worldId);
      return null;
    }
    return pending;
  } catch {
    return null;
  }
}

function writeExitPending(worldId, data) {
  try { sessionStorage.setItem(exitStorageKey(worldId), JSON.stringify(data)); } catch {}
}

export function clearExitPending(worldId) {
  try { sessionStorage.removeItem(exitStorageKey(worldId)); } catch {}
}

function setStatus(text) {
  const status = overlay && overlay.querySelector("#exit-overlay-status");
  if (status) status.textContent = text;
}

function renderOverlay() {
  if (!overlay) return;
  const errorBox = overlay.querySelector("#exit-overlay-error");
  const message = overlay.querySelector("#exit-overlay-message");
  const retryBtn = overlay.querySelector("#exit-retry-btn");
  const stayBtn = overlay.querySelector("#exit-stay-btn");
  const busy = state.phase === EXIT_PHASE.FETCHING_CURRENT_SESSION || state.phase === EXIT_PHASE.ACKNOWLEDGING_EXIT;

  overlay.hidden = false;
  overlay.setAttribute("aria-hidden", "false");
  overlay.setAttribute("aria-busy", String(busy));
  if (retryBtn) retryBtn.hidden = !busy && state.phase !== EXIT_PHASE.EXIT_ERROR;
  if (stayBtn) stayBtn.hidden = !busy && state.phase !== EXIT_PHASE.EXIT_ERROR;
  if (busy) {
    errorBox.hidden = true;
    setStatus(EXIT_LOADING_TEXT[state.phase] || EXIT_LOADING_TEXT[EXIT_PHASE.FETCHING_CURRENT_SESSION]);
  } else if (state.phase === EXIT_PHASE.EXIT_ERROR) {
    errorBox.hidden = false;
    if (message) message.textContent = state.error && state.error.message ? state.error.message : EXIT_ERROR_TEXT;
    overlay.querySelector("#exit-retry-btn")?.focus();
    return;
  } else if (state.phase === EXIT_PHASE.LEAVE_REQUESTED) {
    errorBox.hidden = true;
    setStatus(EXIT_LOADING_TEXT[EXIT_PHASE.FETCHING_CURRENT_SESSION]);
  } else {
    errorBox.hidden = true;
  }
  const title = overlay.querySelector("#exit-overlay-title");
  if (title) title.focus();
}

function hideOverlay() {
  if (!overlay) return;
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("aria-busy", "false");
}

async function performAck() {
  const { idempotencyKey, revision, worldId } = state;
  if (!idempotencyKey || !revision) return;
  state = transitionExitState(state, EXIT_ACTION.ACK_START);
  renderOverlay();
  const result = await acknowledgePresence(worldId, idempotencyKey, revision.worldTime, revision.eventNumber);
  if (result.body && result.body.ok) {
    clearExitPending(worldId);
    clearPresenceLease(worldId);
    state = transitionExitState(state, EXIT_ACTION.ACK_SUCCESS);
    hideOverlay();
    window.dispatchEvent(new CustomEvent("skald:exit-ready", { detail: { worldId } }));
    return;
  }
  if (result.status === 409) {
    const code = result.body && result.body.error && result.body.error.code;
    if (code === "stale_revision") {
      // The world moved past the pinned revision: one automatic refetch with
      // a fresh key; the reducer allows a single stale retry.
      clearExitPending(worldId);
      state = transitionExitState(state, EXIT_ACTION.STALE_REVISION);
      renderOverlay();
      if (state.phase === EXIT_PHASE.LEAVE_REQUESTED) await performExit();
      return;
    }
    state = transitionExitState(state, EXIT_ACTION.CONFLICT);
    renderOverlay();
    return;
  }
  // Transport failure keeps the durable pending request: retry reuses the
  // same key, worldTime and eventNumber.
  state = transitionExitState(state, EXIT_ACTION.ACK_TRANSPORT_FAIL);
  renderOverlay();
}

async function performExit() {
  if (state.phase !== EXIT_PHASE.LEAVE_REQUESTED) return;
  await waitForPendingCommand();
  if (state.phase !== EXIT_PHASE.LEAVE_REQUESTED) return;
  state = transitionExitState(state, EXIT_ACTION.REVISION_FETCHING);
  renderOverlay();

  // Resume a durable pending exit (e.g. after a reload mid-exit): the same
  // key and body are replayed; the server answers the stored result.
  const pending = readExitPending(state.worldId);
  if (pending) {
    state = transitionExitState(state, EXIT_ACTION.REVISION_OK, {
      key: pending.idempotencyKey,
      worldTime: pending.worldTime,
      eventNumber: pending.eventNumber,
    });
    renderOverlay();
    await performAck();
    return;
  }

  const result = await fetchObserverSession(state.worldId);
  const revision = result.body && result.body.ok && result.body.session && result.body.session.revision;
  if (!revision) {
    state = transitionExitState(state, EXIT_ACTION.REVISION_FAIL);
    renderOverlay();
    return;
  }
  const key = createRequestKey("presence-exit");
  writeExitPending(state.worldId, {
    schemaVersion: 1,
    worldId: state.worldId,
    idempotencyKey: key,
    worldTime: revision.worldTime,
    eventNumber: revision.eventNumber,
  });
  state = transitionExitState(state, EXIT_ACTION.REVISION_OK, {
    key,
    worldTime: revision.worldTime,
    eventNumber: revision.eventNumber,
  });
  renderOverlay();
  await performAck();
}

/** Starts the graceful return. A second click while in flight is ignored. */
export function requestLeave(worldId) {
  if (isExitInProgress()) return;
  state = transitionExitState(state, EXIT_ACTION.LEAVE_START, { worldId });
  renderOverlay();
  performExit();
}

/** Manual retry after a failure; starts a fresh revision/ack cycle. */
export function retryExit() {
  if (state.phase !== EXIT_PHASE.EXIT_ERROR) return;
  state = transitionExitState(state, EXIT_ACTION.RETRY);
  renderOverlay();
  performExit();
}

/** Cancels the exit and stays in the world; the pending request is void. */
export function stayInWorld() {
  if (state.phase === EXIT_PHASE.IDLE || state.phase === EXIT_PHASE.LEAVE_READY) return;
  clearExitPending(state.worldId);
  state = transitionExitState(state, EXIT_ACTION.STAY);
  hideOverlay();
}

export function initExitFlow({ onWaitForPendingCommand } = {}) {
  if (typeof onWaitForPendingCommand === "function") waitForPendingCommand = onWaitForPendingCommand;
  overlay = document.getElementById("exit-overlay");
  document.getElementById("exit-retry-btn")?.addEventListener("click", retryExit);
  document.getElementById("exit-stay-btn")?.addEventListener("click", stayInWorld);
}
