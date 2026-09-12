export const MIN_PENDING_MS = 150;

/**
 * The single atomic composer-state setter. Busy/free always flips together:
 * the form and controls-section aria-busy flags plus the disabled state of
 * the input, send, retry and voice controls. Previously three writers
 * (this module, game-shell-view setShellBusy and the status-view state
 * machine) toggled overlapping subsets on different ticks, which left the
 * send button active while the input was disabled. All pending transitions
 * must go through this function.
 */
export function setComposerBusy(busy) {
  const form = document.getElementById("command-form");
  if (form) form.setAttribute("aria-busy", String(busy));
  const controls = document.getElementById("controls-section");
  if (controls) controls.setAttribute("aria-busy", String(busy));
  for (const id of ["command-input", "send-btn", "retry-btn", "voice-btn"]) {
    const element = document.getElementById(id);
    if (element) element.disabled = busy;
  }
}

export function setControlsBusy(busy) {
  setComposerBusy(busy);
}

export async function keepPendingVisible(startedAt, minimumMs = MIN_PENDING_MS) {
  const elapsed = performance.now() - startedAt;
  const remaining = minimumMs - elapsed;
  if (remaining <= 0) return;

  await new Promise((resolve) => {
    setTimeout(resolve, remaining);
  });
}
