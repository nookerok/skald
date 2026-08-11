import { sendCommand, fetchState, fetchGameShell, setCurrentWorld, createRequestKey, submitOfflineEnvelope } from "./world-api-client.js";
import { readQueue, enqueueOfflineIntent, removeProcessed } from "./offline-queue.js";
import { renderGameShell, renderChatFeed, renderShellConnection, setShellBusy, setShellLoading, showShellError, clearShellError, initShellView, openShellOverlay, addLocalIntent, bindIntentWorldTime, setIntentStatus, addClarification, clearLocalIntents } from "./game-shell-view.js";
import { createNarrationPoll } from "./narration-poll.js";
import { loadJournal, renderJournal } from "./journal-view.js";
import { loadDiscoveries, renderDiscoveries } from "./discovery-view.js";
import { loadMenu } from "./menu-view.js";
import { initNewGame } from "./new-game-view.js";
import { startPresenceEntry } from "./presence-entry-controller.js";
import { hasPresenceLease } from "./presence-lease.js";
import { resolveWorldRoute, ROUTE } from "./presence-route.js";
import { initExitFlow, requestLeave, isExitInProgress } from "./presence-exit-controller.js";
import { renderStatus, renderJournalStatus } from "./status-view.js";
import { createInitialState, transition, CMD } from "./client-state.js";
import { setControlsBusy } from "./ui-state.js";
import { showContextLocation } from "./context-rail-view.js";
import { loadObserverMap } from "./map-client.js";
import { renderLivingWorldMap } from "./living-world-shell.js";

let state = createInitialState();
let interactionReady = false;
let currentWorldId = null;
let lastKnownRevision = 0;
let latestJournal = null;

/**
 * Server-driven narration polling (ADR-0024 "МИР" voice). The journal DTO now
 * reports a per-turn `narrationState`, so the browser never guesses by elapsed
 * time: it polls `pending`, stops on `ready`/`unavailable`/`not_requested` and
 * re-arms safely per new command. See narration-poll.js for the stale-tick/
 * generation contract that protects against duplicate timers on rearm.
 */
const narrationPoll = createNarrationPoll({
  intervalMs: 4000,
  watchdogMs: 150000,
});

async function narrationPollTick({ worldId, targetWorldTime }) {
  if (currentWorldId !== worldId || isExitInProgress()) return "unavailable";
  const data = await refreshJournal();
  const target = data && Array.isArray(data.turns)
    ? data.turns.find((t) => t.worldTime === targetWorldTime)
    : null;
  return target?.narrationState ?? "not_requested";
}

function scheduleNarrationRefresh(routerAvailable, targetWorldTime) {
  if (!routerAvailable || !Number.isFinite(targetWorldTime)) {
    narrationPoll.stop();
    return;
  }
  narrationPoll.start(narrationPollTick, { worldId: currentWorldId, targetWorldTime });
}

function renderOfflineBanner(text) {
  const banner = document.getElementById("offline-banner");
  if (!banner) return;
  if (!text) { banner.hidden = true; banner.textContent = ""; return; }
  banner.textContent = text;
  banner.hidden = false;
}

/** Re-submit queued Command envelopes; the server alone decides the outcome. */
async function flushOfflineQueue() {
  if (!currentWorldId) return;
  const pending = readQueue(currentWorldId);
  if (pending.length === 0) { renderOfflineBanner(null); return; }
  renderOfflineBanner(`Отложенных намерений: ${pending.length}. Возвращаем их миру…`);
  const done = [];
  let failed = false;
  for (const envelope of pending) {
    const sessionIntent = addLocalIntent(envelope.input, envelope.idempotencyKey);
    setIntentStatus(sessionIntent, "offline");
    renderChatFeed(latestJournal);
    let result;
    try {
      result = await submitOfflineEnvelope(currentWorldId, envelope);
    } catch {
      failed = true;
      break;
    }
    const resolution = result?.body?.resolution;
    if (!resolution) { failed = true; break; }
    done.push(envelope.idempotencyKey);
    if (resolution === "accepted") {
      setIntentStatus(sessionIntent, "accepted");
      if (Number.isFinite(result.body.state?.worldTime)) bindIntentWorldTime(sessionIntent, result.body.state.worldTime);
      if (result.body.state?.eventNumber) lastKnownRevision = result.body.state.eventNumber;
      renderOfflineBanner(`«${envelope.input}» — записано с опозданием.`);
      await refreshShell();
      await refreshJournal();
      await refreshDiscoveries();
      scheduleNarrationRefresh(Boolean(result.body.state?.routerAvailable), result.body.state?.worldTime);
    } else if (resolution === "already_processed") {
      setIntentStatus(sessionIntent, "accepted");
      renderChatFeed(latestJournal);
      renderOfflineBanner(`«${envelope.input}» — уже было записано ранее.`);
    } else {
      setIntentStatus(sessionIntent, "failed");
      renderChatFeed(latestJournal);
      renderOfflineBanner(`«${envelope.input}» — ${result.body.message || "не записано."}`);
    }
  }
  removeProcessed(currentWorldId, done);
  const remaining = readQueue(currentWorldId).length;
  if (failed || remaining > 0) {
    renderOfflineBanner(remaining > 0 ? `Отложенных намерений: ${remaining}. Они ждут связи.` : "Часть намерений ждёт связи.");
  } else {
    renderOfflineBanner(null);
  }
}

function dispatch(action, payload) {
  state = transition(state, action, payload);
  renderStatus(state);
  renderJournalStatus(state);
}
function setRetryVisible(visible) {
  const button = document.getElementById("retry-btn");
  if (button) button.hidden = !visible;
}
async function refreshShell() {
  const result = await fetchGameShell();
  if (!result.body?.ok || !result.body.snapshot) { showShellError("Сервер не вернул состояние мира."); return false; }
  renderGameShell(result.body.snapshot);
  try {
    const mapDto = await loadObserverMap(currentWorldId);
    renderLivingWorldMap(mapDto, result.body.snapshot.journey);
  } catch {
    renderLivingWorldMap(null, result.body.snapshot.journey);
  }
  clearShellError();
  return true;
}
async function refreshJournal() {
  dispatch("JOURNAL_LOADING");
  try {
    const data = await loadJournal();
    if (data) {
      renderJournal(data);
      latestJournal = data;
      renderChatFeed(data);
      dispatch("JOURNAL_AVAILABLE", { turns: data.turns?.length || 0 });
      return data;
    }
    dispatch("JOURNAL_UNAVAILABLE");
  } catch {
    dispatch("JOURNAL_UNAVAILABLE");
  }
  return null;
}
async function refreshDiscoveries() {
  dispatch("DISCOVERIES_LOADING");
  try {
    const data = await loadDiscoveries();
    if (data) { renderDiscoveries(data); dispatch("DISCOVERIES_AVAILABLE", { cards: data.cards?.length || 0 }); }
    else dispatch("DISCOVERIES_UNAVAILABLE");
  } catch { dispatch("DISCOVERIES_UNAVAILABLE"); }
}
function renderIntentClarification(intent, body) {
  setIntentStatus(intent, "clarification");
  addClarification(intent, body?.question, body?.options);
  renderChatFeed(latestJournal);
}
async function handle(input, overrideKey) {
  if (!interactionReady || state.command === CMD.PENDING || isExitInProgress()) return;
  const key = overrideKey || createRequestKey();
  const sessionIntent = addLocalIntent(input, key);
  setRetryVisible(false);
  dispatch("COMMAND_START", { input, key });
  setControlsBusy(true);
  setShellBusy(true, "Разбираем намерение…");
  renderShellConnection("pending", "Мир отвечает…");
  try {
    const result = await sendCommand(input, key);
    if (result.body?.ok && result.body?.status === "clarification") {
      dispatch("COMMAND_REJECTED");
      renderIntentClarification(sessionIntent, result.body);
      renderShellConnection("ready", "Мастер уточняет действие");
      return;
    }
    if (result.body?.ok) {
      if (result.body.state?.eventNumber) lastKnownRevision = result.body.state.eventNumber;
      setIntentStatus(sessionIntent, "accepted");
      if (sessionIntent && Number.isFinite(result.body.state?.worldTime)) {
        bindIntentWorldTime(sessionIntent, result.body.state.worldTime);
      }
      const inputElement = document.getElementById("command-input");
      if (inputElement) inputElement.value = "";
      dispatch("COMMAND_SUCCESS");
      renderShellConnection("ready", "Ход записан");
      await refreshJournal();
      await refreshShell();
      await refreshDiscoveries();
      scheduleNarrationRefresh(Boolean(result.body?.state?.routerAvailable), result.body?.state?.worldTime);
    } else if (result.status === 409) {
      // The original request may have committed before its response was lost.
      // Reconcile all authoritative read models before hiding retry.
      dispatch("COMMAND_DUPLICATE");
      setRetryVisible(false);
      await refreshShell();
      await refreshJournal();
      await refreshDiscoveries();
    } else {
      setIntentStatus(sessionIntent, "failed");
      renderChatFeed(latestJournal);
      dispatch("COMMAND_REJECTED");
    }
  } catch (error) {
    dispatch(error?.name === "AbortError" ? "COMMAND_TIMEOUT" : "COMMAND_TRANSPORT_FAIL");
    setIntentStatus(sessionIntent, "offline");
    renderChatFeed(latestJournal);
    renderShellConnection("error", "Связь прервана");
    setRetryVisible(true);
    if (currentWorldId) {
      enqueueOfflineIntent(currentWorldId, { input, idempotencyKey: key, baseRevision: lastKnownRevision });
      renderOfflineBanner(`«${input}» сохранено — отправим, когда связь вернётся.`);
    }
  } finally {
    setControlsBusy(false);
    setShellBusy(false);
  }
}
async function connect() {
  clearLocalIntents();
  latestJournal = null;
  interactionReady = false;
  dispatch("RECONNECT");
  // Cover the static shell frame (hardcoded «Ход 0» placeholders) with the
  // loading dialog until the first snapshot renders — without this the shell
  // flashes with a T0 frame right after the acknowledge completes.
  setShellLoading(true);
  setShellBusy(true, "Читаем летопись…");
  const stateResult = await fetchState();
  const shellOk = await refreshShell();
  if (!stateResult.body || !shellOk) {
    setShellLoading(false);
    dispatch("BOOT_FAILURE");
    renderShellConnection("error", "Нет связи");
    setShellBusy(false);
    return;
  }
  dispatch("BOOT_SUCCESS", { turns: stateResult.body.state?.eventNumber || 0 });
  if (stateResult.body.state?.eventNumber) lastKnownRevision = stateResult.body.state.eventNumber;
  await refreshJournal();
  await refreshDiscoveries();
  interactionReady = true;
  dispatch("RECONNECT_SUCCESS");
  renderShellConnection("ready", "Мир слушает");
  await flushOfflineQueue();
  setShellLoading(false);
  setShellBusy(false);
}
function showPanel(name) {
  document.getElementById("panel-menu").hidden = name !== "menu";
  document.getElementById("panel-new-game").hidden = name !== "new";
  document.getElementById("panel-game-shell").hidden = name !== "game";
  const presencePanel = document.getElementById("panel-presence-entry");
  if (presencePanel) presencePanel.hidden = name !== "presence";
}
async function route() {
  const hash = window.location.hash || "#/menu";
  const worldMatch = hash.match(/^#\/world\/([^/]+)(\/return)?$/);
  if (worldMatch) {
    const worldId = decodeURIComponent(worldMatch[1]);
    const requestedRoute = "/world/" + worldId + (worldMatch[2] || "");
    const decision = resolveWorldRoute({ requestedRoute, worldId, hasLease: hasPresenceLease(worldId) });
    if (decision === ROUTE.PRESENCE) {
      if (requestedRoute !== "/world/" + worldId + "/return") {
        // No browser-session lease: never render the shell frame; redirect
        // so history cannot land back on the shell without presence.
        window.location.replace("#/world/" + worldId + "/return");
        return;
      }
      currentWorldId = worldId;
      setCurrentWorld(worldId);
      showPanel("presence");
      await startPresenceEntry(document.getElementById("presence-entry-container"), worldId);
      return;
    }
    if (decision === ROUTE.GAME) {
      currentWorldId = worldId;
      setCurrentWorld(worldId);
      showPanel("game");
      await connect();
      return;
    }
  }
  if (hash.startsWith("#/new/")) {
    showPanel("new");
    await initNewGame();
    return;
  }
  currentWorldId = null;
  showPanel("menu");
  await loadMenu();
}
function waitForPendingCommand() {
  return new Promise((resolve) => {
    if (state.command !== CMD.PENDING) { resolve(); return; }
    const timer = setTimeout(done, 5000);
    const interval = setInterval(() => { if (state.command !== CMD.PENDING) done(); }, 150);
    function done() { clearTimeout(timer); clearInterval(interval); resolve(); }
  });
}

function bindGlobal() {
  initShellView(handle);
  initExitFlow({ onWaitForPendingCommand: waitForPendingCommand });
  document.getElementById("exit-world-btn")?.addEventListener("click", () => {
    if (currentWorldId) requestLeave(currentWorldId);
  });
  document.getElementById("btn-to-menu")?.addEventListener("click", () => { interactionReady = false; window.location.hash = "#/menu"; });
  const openPlayerSpace = (tabName, openerId) => {
    const tab = document.querySelector('.context-tab[data-context="' + tabName + '"]');
    tab?.click();
    openShellOverlay("context-overlay", document.getElementById(openerId));
  };
  document.getElementById("open-map-btn")?.addEventListener("click", () => openPlayerSpace("map", "open-map-btn"));
  document.getElementById("open-character-btn")?.addEventListener("click", () => openPlayerSpace("character", "open-character-btn"));
  document.getElementById("open-knowledge-btn")?.addEventListener("click", () => openPlayerSpace("knowledge", "open-knowledge-btn"));
  document.getElementById("timeline-journal-btn")?.addEventListener("click", () => openShellOverlay("journal-overlay"));
  document.getElementById("retry-btn")?.addEventListener("click", () => { if (state.pendingInput && state.pendingKey) handle(state.pendingInput, state.pendingKey); });
  window.addEventListener("skald:retry-connect", () => connect());
  window.addEventListener("skald:presence-ready", (event) => {
    const readyWorldId = event.detail?.worldId;
    if (readyWorldId) window.location.hash = "#/world/" + readyWorldId;
  });
  window.addEventListener("skald:exit-ready", (event) => {
    interactionReady = false;
    window.location.hash = "#/menu";
  });
  window.addEventListener("skald:return-to-world", (event) => {
    const worldId = event.detail?.worldId;
    if (worldId) window.location.hash = "#/world/" + worldId + "/return";
  });
  window.addEventListener("hashchange", () => route());
  window.addEventListener("skald:travel", (event) => {
    const name = event.detail?.name;
    if (typeof name === "string" && name.length > 0) handle("идти к " + name);
  });
  document.addEventListener("skald:context-select", (event) => {
    const label = event.detail?.name || event.detail?.label;
    if (event.detail?.locationId) showContextLocation(event.detail.locationId, label);
    if (label) renderShellConnection("ready", "Выбрано: " + label);
  });
}
bindGlobal();
route();
