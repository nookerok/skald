export const MIN_PENDING_MS = 150;

export function setControlsBusy(busy) {
  document
    .querySelectorAll(".dir-btn, .social-btn, #send-btn, #retry-btn")
    .forEach((element) => {
      element.disabled = busy;
    });

  const controls = document.getElementById("controls-section");
  if (controls) controls.setAttribute("aria-busy", String(busy));
}

export async function keepPendingVisible(startedAt, minimumMs = MIN_PENDING_MS) {
  const elapsed = performance.now() - startedAt;
  const remaining = minimumMs - elapsed;
  if (remaining <= 0) return;

  await new Promise((resolve) => {
    setTimeout(resolve, remaining);
  });
}
