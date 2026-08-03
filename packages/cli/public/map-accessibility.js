/**
 * Map Accessibility — ARIA, keyboard, screen reader support (ADR-0019 §11).
 */

/**
 * Make map SVG keyboard-navigable.
 * Adds tabindex and keyboard handlers to interactive elements.
 * @param {SVGElement} svg
 */
export function makeMapKeyboardNavigable(svg) {
  if (!svg) return;

  const interactiveElements = svg.querySelectorAll("[role='img']");
  interactiveElements.forEach((el, index) => {
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        el.dispatchEvent(new CustomEvent("map-point-select", {
          bubbles: true,
          detail: { label: el.getAttribute("aria-label") },
        }));
      }
    });
  });
}

/**
 * Announce map update to screen readers.
 * @param {HTMLElement} container
 * @param {string} message
 */
export function announceMapUpdate(container, message) {
  if (!container) return;
  let announcer = container.querySelector(".map-announcer");
  if (!announcer) {
    announcer = document.createElement("div");
    announcer.className = "map-announcer";
    announcer.setAttribute("aria-live", "polite");
    announcer.setAttribute("aria-atomic", "true");
    announcer.style.position = "absolute";
    announcer.style.width = "1px";
    announcer.style.height = "1px";
    announcer.style.overflow = "hidden";
    announcer.style.clip = "rect(0,0,0,0)";
    container.appendChild(announcer);
  }
  announcer.textContent = message;
}
