import { sendCommand, fetchState, retryLast } from "./api-client.js";
import { renderTurn, renderState, renderDiagnostics } from "./presentation-view.js";
import { loadJournal, renderJournal } from "./journal-view.js";
import { loadDiscoveries, renderDiscoveries } from "./discovery-view.js";
import { renderStatus, renderJournalStatus } from "./status-view.js";
import { createInitialState, transition, APP, CMD } from "./client-state.js";
import { setControlsBusy } from "./ui-state.js";

let state = createInitialState();

function dispatch(action, payload) {
  const next = transition(state, action, payload);
  // Copy pending fields that shouldn't be lost on UI-only actions
  if (next.command === CMD.IDLE && state.pendingKey && action !== "COMMAND_SUCCESS" && action !== "COMMAND_REJECTED") {
    next.pendingKey = state.pendingKey;
    next.pendingInput = state.pendingInput;
  }
  state = next;
  renderStatus(state);
  renderJournalStatus(state);
}

async function handle(input) {
  if (state.command === CMD.PENDING) return;
  const key = crypto.randomUUID();
  dispatch("COMMAND_START", { input, key });
  setControlsBusy(true);

  try {
    const result = await sendCommand(input, key);
    if (result.body && result.body.ok) {
      dispatch("COMMAND_SUCCESS");
      if (result.body.presentation) renderTurn(result.body.presentation);
      if (result.body.state) renderState(result.body.state);
      if (result.body.events) result.body.events.forEach((e) => renderDiagnostics.addEvent(e));
      if (result.body.tickEvents) result.body.tickEvents.forEach((e) => renderDiagnostics.addEvent(e));
      await loadJournal();
      await loadDiscoveries();
    } else if (result.body && result.body.error) {
      if (result.body.error.code === "duplicate_request") {
        dispatch("COMMAND_DUPLICATE");
        await reconcileAfterDuplicate();
      } else if (result.body.error.code === "parse_error") {
        dispatch("COMMAND_REJECTED", { message: result.body.error.message || "Неизвестная команда." });
      } else {
        dispatch("COMMAND_REJECTED", { message: result.body.error.message || "Мир не отвечает." });
      }
    } else {
      dispatch("COMMAND_TRANSPORT_FAIL");
    }
  } catch (err) {
    if (err.name === "AbortError") {
      dispatch("COMMAND_TIMEOUT");
    } else {
      dispatch("COMMAND_TRANSPORT_FAIL");
    }
  } finally {
    setControlsBusy(false);
  }
}

async function reconcileAfterDuplicate() {
  const fresh = await fetchState();
  if (fresh.body && fresh.body.ok && fresh.body.state) renderState(fresh.body.state);
  await loadJournal();
  await loadDiscoveries();
}

async function connect() {
  dispatch("BOOT_FAILURE"); // in case of silent start, re-enter booting
  state.application = APP.BOOTING;
  renderStatus(state);

  try {
    const stateRes = await fetchState();
    const turns = stateRes.body?.ok ? (await (await fetch("/api/journal?limit=1")).json()) : { turns: [] };
    const journalHasTurns = turns.ok && turns.turns.length > 0;
    dispatch("BOOT_SUCCESS", { turns: journalHasTurns ? 1 : 0 });
    if (stateRes.body && stateRes.body.ok && stateRes.body.state) renderState(stateRes.body.state);
    if (journalHasTurns) { await loadJournal(); await loadDiscoveries(); }
  } catch {
    dispatch("BOOT_FAILURE");
    startReconnectLoop();
  }
}

let reconnectTimer = null;
let reconnectDelay = 1000;

function startReconnectLoop() {
  dispatch("RECONNECT");
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(async () => {
    try {
      const res = await fetchState();
      if (res.body && res.body.ok) {
        reconnectDelay = 1000;
        dispatch("RECONNECT_SUCCESS", { turns: 0 });
        await loadJournal();
        await loadDiscoveries();
        return;
      }
    } catch {}
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);
    startReconnectLoop();
  }, reconnectDelay);
}

// --- Event listeners ---

function setupListeners() {
  document.getElementById("btn-n")?.addEventListener("click", () => handle("move north"));
  document.getElementById("btn-s")?.addEventListener("click", () => handle("move south"));
  document.getElementById("btn-e")?.addEventListener("click", () => handle("move east"));
  document.getElementById("btn-w")?.addEventListener("click", () => handle("move west"));
  document.getElementById("btn-wait")?.addEventListener("click", () => handle("wait"));
  document.getElementById("btn-help")?.addEventListener("click", () => handle("give help to guild"));
  document.getElementById("btn-respect")?.addEventListener("click", () => handle("give respect to guild"));
  document.getElementById("btn-fear")?.addEventListener("click", () => handle("give fear to guild"));

  // Diagnostics raw command
  document.getElementById("send-btn")?.addEventListener("click", () => {
    const input = document.getElementById("command-input").value.trim();
    if (input) handle(input);
  });
  document.getElementById("retry-btn")?.addEventListener("click", async () => {
    if (!state.pendingKey || !state.pendingInput) return;
    if (state.command === CMD.PENDING) return;
    setControlsBusy(true);
    dispatch("COMMAND_START", { input: state.pendingInput, key: state.pendingKey });
    try {
      const result = await sendCommand(state.pendingInput, state.pendingKey);
      if (result.body && result.body.ok) {
        dispatch("COMMAND_SUCCESS");
        if (result.body.presentation) renderTurn(result.body.presentation);
        if (result.body.state) renderState(result.body.state);
        if (result.body.events) result.body.events.forEach((e) => renderDiagnostics.addEvent(e));
        if (result.body.tickEvents) result.body.tickEvents.forEach((e) => renderDiagnostics.addEvent(e));
        await loadJournal();
        await loadDiscoveries();
      } else if (result.body && result.body.error) {
        if (result.body.error.code === "duplicate_request") {
          dispatch("COMMAND_DUPLICATE");
          await reconcileAfterDuplicate();
        } else if (result.body.error.code === "parse_error") {
          dispatch("COMMAND_REJECTED", { message: result.body.error.message || "Неизвестная команда." });
        } else {
          dispatch("COMMAND_REJECTED", { message: result.body.error.message || "Мир не отвечает." });
        }
      } else {
        dispatch("COMMAND_TRANSPORT_FAIL");
      }
    } catch (err) {
      if (err.name === "AbortError") {
        dispatch("COMMAND_TIMEOUT");
      } else {
        dispatch("COMMAND_TRANSPORT_FAIL");
      }
    } finally {
      setControlsBusy(false);
    }
  });

  // Tab navigation
  function switchView(view) {
    dispatch("SET_VIEW", view);
    try { sessionStorage.setItem("skald:activeView", view); } catch {}

    const tabs = { game: "tab-game", journal: "tab-journal", discoveries: "tab-discoveries" };
    const panels = { game: "panel-game", journal: "panel-journal", discoveries: "panel-discoveries" };

    for (const [key, tabId] of Object.entries(tabs)) {
      const tab = document.getElementById(tabId);
      const panel = document.getElementById(panels[key]);
      if (!tab || !panel) continue;
      const active = key === view;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      panel.style.display = active ? "block" : "none";
    }

    if (view === "journal") loadJournal();
    if (view === "discoveries") loadDiscoveries();
  }

  document.getElementById("tab-game")?.addEventListener("click", () => switchView("game"));
  document.getElementById("tab-journal")?.addEventListener("click", () => switchView("journal"));
  document.getElementById("tab-discoveries")?.addEventListener("click", () => switchView("discoveries"));

  // Handle navigation events from other views (e.g., discovery evidence → journal)
  document.addEventListener("skald:navigate", (e) => {
    const { view, turnId } = e.detail;
    if (view === "journal") {
      switchView("journal");
      // Try restoring the turn filter from sessionStorage
      if (turnId) {
        try { sessionStorage.setItem("skald:journal:turn-navigate", turnId); } catch {}
        loadJournal();
      }
    }
  });

  // Keyboard
  document.addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    switch (e.key) {
      case "ArrowUp": case "w": e.preventDefault(); handle("move north"); break;
      case "ArrowDown": case "s": e.preventDefault(); handle("move south"); break;
      case "ArrowLeft": case "a": e.preventDefault(); handle("move west"); break;
      case "ArrowRight": case "d": e.preventDefault(); handle("move east"); break;
      case " ": case "Space": e.preventDefault(); handle("wait"); break;
    }
  });
}

// --- Polling with stale-response guard ---
function startPolling() {
  setInterval(async () => {
    const res = await fetchState();
    if (res.body && res.body.ok && res.body.state) {
      if (state.command === CMD.PENDING || state.command === CMD.SUCCEEDED) return;
      renderState(res.body.state);
    }
  }, 5000);
}

// --- Init ---
document.addEventListener("DOMContentLoaded", () => {
  setupListeners();
  connect();
  startPolling();
});
