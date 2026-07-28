import { sendCommand, fetchState, retryLast, setCurrentWorld, getCurrentWorld } from "./world-api-client.js";
import { renderTurn, renderState, renderDiagnostics } from "./presentation-view.js";
import { loadJournal, renderJournal } from "./journal-view.js";
import { loadDiscoveries, renderDiscoveries } from "./discovery-view.js";
import { loadGuidance, applyGuidance, renderGuidance } from "./guidance-view.js";
import { loadMenu } from "./menu-view.js";
import { renderStatus, renderJournalStatus } from "./status-view.js";
import { createInitialState, transition, APP, CMD } from "./client-state.js";
import { setControlsBusy } from "./ui-state.js";

let state = createInitialState();
let interactionReady = false;

function dispatch(action, payload) {
  const next = transition(state, action, payload);
  if (next.command === CMD.IDLE && state.pendingKey && action !== "COMMAND_SUCCESS" && action !== "COMMAND_REJECTED") {
    next.pendingKey = state.pendingKey;
    next.pendingInput = state.pendingInput;
  }
  state = next;
  renderStatus(state);
  renderJournalStatus(state);
}

async function handle(input) {
  if (!interactionReady || state.command === CMD.PENDING) return;
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
      if (result.body.guidance) applyGuidance(result.body.guidance);
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
    setControlsBusy(!interactionReady);
  }
}

async function reconcileAfterDuplicate() {
  const fresh = await fetchState();
  if (fresh.body && fresh.body.ok && fresh.body.state) renderState(fresh.body.state);
  await loadJournal();
  await loadDiscoveries();
}

async function connect() {
  dispatch("BOOT_FAILURE");
  state.application = APP.BOOTING;
  renderStatus(state);

  try {
    const stateRes = await fetchState();
    const turnsRes = await fetch("/api/worlds/" + (getCurrentWorld() || "legacy-world") + "/journal?limit=1");
    const turns = await turnsRes.json();
    const journalHasTurns = turns.ok && turns.turns.length > 0;
    dispatch("BOOT_SUCCESS", { turns: journalHasTurns ? 1 : 0 });
    if (stateRes.body && stateRes.body.ok && stateRes.body.state) renderState(stateRes.body.state);
    if (journalHasTurns) { await loadJournal(); await loadDiscoveries(); }
    await loadGuidance();
    renderGuidance();
    setControlsBusy(false);
    interactionReady = true;
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
        await loadGuidance();
        setControlsBusy(false);
        interactionReady = true;
        return;
      }
    } catch {}
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);
    startReconnectLoop();
  }, reconnectDelay);
}

// --- View switching ---

function showMenu() {
  interactionReady = false;
  document.getElementById("panel-menu").style.display = "block";
  document.getElementById("panel-game-shell").style.display = "none";
  document.getElementById("diagnostics-panel").style.display = "none";
  loadMenu();
}

function bindGameplayControls() {
  const actions = { "btn-n": "move north", "btn-s": "move south", "btn-e": "move east", "btn-w": "move west", "btn-wait": "wait", "btn-help": "give help to guild", "btn-respect": "give respect to guild", "btn-fear": "give fear to guild" };
  for (const [id, input] of Object.entries(actions)) {
    const button = document.getElementById(id);
    if (button) button.onclick = () => handle(input);
  }
}

function showGame(worldId) {
  document.getElementById("panel-menu").style.display = "none";
  document.getElementById("panel-game-shell").style.display = "block";
  document.getElementById("diagnostics-panel").style.display = "block";
  setCurrentWorld(worldId);
  interactionReady = false;
  setControlsBusy(true);
  bindGameplayControls();
  connect();
}

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

// --- Hash routing ---

function handleRoute() {
  const hash = window.location.hash;
  const worldMatch = hash.match(/^#\/world\/(.+)$/);
  if (worldMatch) {
    showGame(worldMatch[1]);
  } else {
    showMenu();
  }
}

window.addEventListener("hashchange", handleRoute);

// --- Event listeners ---

function setupListeners() {
  document.getElementById("btn-to-menu")?.addEventListener("click", () => {
    window.location.hash = "#/menu";
  });


  document.getElementById("send-btn")?.addEventListener("click", () => {
    const input = document.getElementById("command-input").value.trim();
    if (input) handle(input);
  });

  document.getElementById("retry-btn")?.addEventListener("click", async () => {
    if (!state.pendingKey || !state.pendingInput) return;
    if (!interactionReady || state.command === CMD.PENDING) return;
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
        if (result.body.guidance) applyGuidance(result.body.guidance);
        await loadJournal();
        await loadDiscoveries();
      } else if (result.body && result.body.error) {
        if (result.body.error.code === "duplicate_request") { dispatch("COMMAND_DUPLICATE"); await reconcileAfterDuplicate(); }
        else if (result.body.error.code === "parse_error") { dispatch("COMMAND_REJECTED", { message: result.body.error.message || "Неизвестная команда." }); }
        else { dispatch("COMMAND_REJECTED", { message: result.body.error.message || "Мир не отвечает." }); }
      } else { dispatch("COMMAND_TRANSPORT_FAIL"); }
    } catch (err) {
      if (err.name === "AbortError") { dispatch("COMMAND_TIMEOUT"); }
      else { dispatch("COMMAND_TRANSPORT_FAIL"); }
    } finally { setControlsBusy(!interactionReady); }
  });

  document.getElementById("tab-game")?.addEventListener("click", () => switchView("game"));
  document.getElementById("tab-journal")?.addEventListener("click", () => switchView("journal"));
  document.getElementById("tab-discoveries")?.addEventListener("click", () => switchView("discoveries"));

  document.addEventListener("skald:command", (e) => {
    const { input } = e.detail;
    if (input && state.application === APP.READY && state.command !== CMD.PENDING) {
      handle(input);
    }
  });

  document.addEventListener("skald:navigate", (e) => {
    const { view, turnId } = e.detail;
    if (view === "journal") {
      switchView("journal");
      if (turnId) {
        try { sessionStorage.setItem("skald:journal:turn-navigate", turnId); } catch {}
        loadJournal();
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
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

function startPolling() {
  setInterval(async () => {
    const res = await fetchState();
    if (res.body && res.body.ok && res.body.state) {
      if (state.command === CMD.PENDING || state.command === CMD.SUCCEEDED) return;
      renderState(res.body.state);
    }
  }, 5000);
}

document.addEventListener("DOMContentLoaded", () => {
  setupListeners();
  handleRoute();
  startPolling();
});
