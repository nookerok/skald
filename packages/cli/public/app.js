import { sendCommand, fetchState, retryLast } from "./api-client.js";
import { renderTurn, renderState, renderDiagnostics } from "./presentation-view.js";

let isBusy = false;

function setBusy(b) {
  isBusy = b;
  document.querySelectorAll(".dir-btn, .social-btn").forEach((el) => el.disabled = b);
  document.getElementById("send-btn").disabled = b;
}

async function handle(input) {
  if (isBusy) return;
  setBusy(true);
  try {
    const result = await sendCommand(input);
    if (result.body && result.body.ok) {
      const pres = result.body.presentation;
      if (pres) renderTurn(pres);
      if (result.body.events) result.body.events.forEach((e) => renderDiagnostics.addEvent(e));
      if (result.body.tickEvents) result.body.tickEvents.forEach((e) => renderDiagnostics.addEvent(e));
      if (result.body.state) renderState(result.body.state);
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
  }
  setBusy(false);
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
document.getElementById("retry-btn").addEventListener("click", () => {
  const result = retryLast();
  if (result) result.then((r) => {
    if (r.body && r.body.ok && r.body.presentation) renderTurn(r.body.presentation);
  });
});

// Initial load + polling
document.addEventListener("DOMContentLoaded", async () => {
  const initial = await fetchState();
  if (initial.body && initial.body.ok && initial.body.state) {
    renderState(initial.body.state);
  }
  // Poll silently
  setInterval(async () => {
    const res = await fetchState();
    if (res.body && res.body.ok && res.body.state) {
      renderState(res.body.state);
    }
  }, 5000);
});
