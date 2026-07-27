import { sendCommand, fetchState, retryLast } from "./api-client.js";
import { renderTurn, renderState, renderDiagnostics } from "./presentation-view.js";
import { loadJournal } from "./journal-view.js";
import { keepPendingVisible, setControlsBusy } from "./ui-state.js";

let isBusy = false;

function setBusy(b) {
  isBusy = b;
  setControlsBusy(b);
}

async function handle(input) {
  if (isBusy) return;
  const startedAt = performance.now();
  setBusy(true);
  try {
    const result = await sendCommand(input);
    if (result.body && result.body.ok) {
      const pres = result.body.presentation;
      if (pres) renderTurn(pres);
      if (result.body.events) result.body.events.forEach((e) => renderDiagnostics.addEvent(e));
      if (result.body.tickEvents) result.body.tickEvents.forEach((e) => renderDiagnostics.addEvent(e));
      if (result.body.state) renderState(result.body.state);
      await loadJournal();
      renderDiagnostics.title("OK");
    } else if (result.body && result.body.error) {
      if (result.body.error.code === "duplicate_request") {
        renderDiagnostics.title("Duplicate (retry may be needed)");
      } else {
        renderDiagnostics.title("Error: " + (result.body.error.message || "unknown"));
      }
    } else {
      renderDiagnostics.title("HTTP " + result.status);
    }
  } catch (err) {
    renderDiagnostics.title(err.name === "AbortError" ? "Timeout" : "Network error");
  } finally {
    await keepPendingVisible(startedAt);
    setBusy(false);
  }
}

// D-pad
document.getElementById("btn-n").addEventListener("click", () => handle("move north"));
document.getElementById("btn-s").addEventListener("click", () => handle("move south"));
document.getElementById("btn-e").addEventListener("click", () => handle("move east"));
document.getElementById("btn-w").addEventListener("click", () => handle("move west"));
document.getElementById("btn-wait").addEventListener("click", () => handle("wait"));

// Social
document.getElementById("btn-help").addEventListener("click", () => handle("give help to guild"));
document.getElementById("btn-respect").addEventListener("click", () => handle("give respect to guild"));
document.getElementById("btn-fear").addEventListener("click", () => handle("give fear to guild"));

// Diagnostics raw command
document.getElementById("send-btn").addEventListener("click", () => {
  const input = document.getElementById("command-input").value.trim();
  if (input) handle(input);
});
document.getElementById("retry-btn").addEventListener("click", async () => {
  if (isBusy) return;
  const startedAt = performance.now();
  const result = retryLast();
  if (!result) return;

  setBusy(true);
  try {
    const response = await result;
    if (response.body && response.body.ok) {
      if (response.body.presentation) renderTurn(response.body.presentation);
      if (response.body.state) renderState(response.body.state);
      await loadJournal();
      renderDiagnostics.title("OK");
    }
  } catch (err) {
    renderDiagnostics.title(err.name === "AbortError" ? "Timeout" : "Network error");
  } finally {
    await keepPendingVisible(startedAt);
    setBusy(false);
  }
});

// Initial load + polling
document.addEventListener("DOMContentLoaded", async () => {
  const initial = await fetchState();
  if (initial.body && initial.body.ok && initial.body.state) {
    renderState(initial.body.state);
  }
  await loadJournal();
  // Poll silently
  setInterval(async () => {
    const res = await fetchState();
    if (res.body && res.body.ok && res.body.state) {
      renderState(res.body.state);
    }
  }, 5000);
});
