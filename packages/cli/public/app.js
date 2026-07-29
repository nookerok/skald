import { sendCommand, fetchState, fetchGameShell, fetchEvents, setCurrentWorld, createRequestKey } from "./world-api-client.js";
import { renderGameShell, renderShellConnection, setShellBusy, showShellError, clearShellError, initShellView, openShellOverlay } from "./game-shell-view.js";
import { loadJournal, renderJournal } from "./journal-view.js";
import { loadDiscoveries, renderDiscoveries } from "./discovery-view.js";
import { loadGuidance, applyGuidance, renderGuidance } from "./guidance-view.js";
import { loadMenu } from "./menu-view.js";
import { initNewGame } from "./new-game-view.js";
import { renderStatus, renderJournalStatus } from "./status-view.js";
import { createInitialState, transition, CMD } from "./client-state.js";
import { setControlsBusy } from "./ui-state.js";

let state = createInitialState();
let interactionReady = false;

function dispatch(action, payload) { state = transition(state, action, payload); renderStatus(state); renderJournalStatus(state); }

async function refreshShell() {
  const result = await fetchGameShell();
  if (!result.body?.ok || !result.body.snapshot) { showShellError("Сервер не вернул состояние мира."); return false; }
  renderGameShell(result.body.snapshot); clearShellError(); return true;
}
async function refreshJournal() {
  dispatch("JOURNAL_LOADING");
  try { const data = await loadJournal(); if (data) { renderJournal(data); dispatch("JOURNAL_AVAILABLE", { turns: data.turns?.length || 0 }); } else dispatch("JOURNAL_UNAVAILABLE"); } catch { dispatch("JOURNAL_UNAVAILABLE"); }
}
async function refreshDiscoveries() {
  dispatch("DISCOVERIES_LOADING");
  try { const data = await loadDiscoveries(); if (data) { renderDiscoveries(data); dispatch("DISCOVERIES_AVAILABLE", { cards: data.cards?.length || 0 }); } else dispatch("DISCOVERIES_UNAVAILABLE"); } catch { dispatch("DISCOVERIES_UNAVAILABLE"); }
}
async function refreshGuidance() { try { const guidance = await loadGuidance(); if (guidance) { applyGuidance(guidance); renderGuidance(guidance); } } catch {} }
async function refreshDev() {
  const result = await fetchEvents(); const events = result.body?.events || result.body?.items || [];
  const log = document.getElementById("event-log"); if (log) { log.replaceChildren(...events.slice(-60).reverse().map(event => { const pre = document.createElement("pre"); pre.textContent = JSON.stringify(event, null, 2); return pre; })); }
  const pipeline = document.getElementById("pipeline-view"); if (pipeline) pipeline.textContent = "Event Log → Projection → Game Shell → Narrative → UI";
}
async function handle(input, overrideKey) {
  if (!interactionReady || state.command === CMD.PENDING) return;
  const key = overrideKey || createRequestKey(); dispatch("COMMAND_START", { input, key }); setControlsBusy(true); setShellBusy(true, "Разбираем намерение…"); renderShellConnection("pending", "Мир отвечает…");
  try {
    const result = await sendCommand(input, key);
    if (result.body?.ok) { dispatch("COMMAND_SUCCESS"); renderShellConnection("ready", "Ход записан"); await refreshShell(); await refreshJournal(); await refreshDiscoveries(); await refreshGuidance(); }
    else if (result.status === 409) dispatch("COMMAND_DUPLICATE"); else dispatch("COMMAND_REJECTED");
  } catch (error) { dispatch(error?.name === "AbortError" ? "COMMAND_TIMEOUT" : "COMMAND_TRANSPORT_FAIL"); renderShellConnection("error", "Связь прервана"); }
  finally { setControlsBusy(false); setShellBusy(false); }
}
async function connect() {
  interactionReady = false; dispatch("RECONNECT"); setShellBusy(true, "Читаем летопись…");
  const stateResult = await fetchState(); const shellOk = await refreshShell();
  if (!stateResult.body || !shellOk) { dispatch("BOOT_FAILURE"); renderShellConnection("error", "Нет связи"); setShellBusy(false); return; }
  dispatch("BOOT_SUCCESS", { turns: stateResult.body.state?.eventNumber || 0 }); await refreshJournal(); await refreshDiscoveries(); await refreshGuidance();
  interactionReady = true; dispatch("RECONNECT_SUCCESS"); renderShellConnection("ready", "Мир слушает"); setShellBusy(false);
}
function showPanel(name) { document.getElementById("panel-menu").hidden = name !== "menu"; document.getElementById("panel-new-game").hidden = name !== "new"; document.getElementById("panel-game-shell").hidden = name !== "game"; }
async function route() {
  const hash = window.location.hash || "#/menu";
  if (hash.startsWith("#/world/")) { setCurrentWorld(decodeURIComponent(hash.slice(8))); showPanel("game"); await connect(); return; }
  if (hash.startsWith("#/new/")) { showPanel("new"); await initNewGame(); return; }
  showPanel("menu"); await loadMenu();
}
function bindGlobal() {
  initShellView(handle);
  document.getElementById("btn-to-menu")?.addEventListener("click", () => { interactionReady = false; window.location.hash = "#/menu"; });
  document.getElementById("open-journal-btn")?.addEventListener("click", () => openShellOverlay("journal-overlay"));
  document.getElementById("open-discoveries-btn")?.addEventListener("click", () => openShellOverlay("discoveries-overlay"));
  document.getElementById("open-dev-btn")?.addEventListener("click", async () => { openShellOverlay("dev-overlay"); await refreshDev(); });
  document.getElementById("timeline-journal-btn")?.addEventListener("click", () => openShellOverlay("journal-overlay"));
  document.getElementById("retry-btn")?.addEventListener("click", () => { if (state.pendingInput && state.pendingKey) handle(state.pendingInput, state.pendingKey); });
  window.addEventListener("skald:retry-connect", () => connect()); window.addEventListener("hashchange", () => route());
}
bindGlobal(); route();