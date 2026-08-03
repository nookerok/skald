/**
 * Map Legend — legend rendering for Player Map (ADR-0019 §4).
 */

/**
 * Render map legend into a container.
 * @param {HTMLElement} container
 */
export function renderMapLegend(container) {
  if (!container) return;
  container.replaceChildren();

  const items = [
    { color: "#e74c3c", label: "Твоё положение", type: "circle" },
    { color: "#2ecc71", label: "Посещённое место", type: "circle" },
    { color: "#3498db", label: "Наблюдённое место", type: "circle" },
    { color: "#95a5a6", label: "Мельком замеченное", type: "dashed-circle" },
    { color: "#9b59b6", label: "Ориентир", type: "diamond" },
    { color: "#7f8c8d", label: "Маршрут", type: "line" },
    { color: "#e67e22", label: "Переправа", type: "line" },
  ];

  const list = document.createElement("ul");
  list.className = "map-legend-list";
  list.setAttribute("aria-label", "Условные обозначения карты");

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "map-legend-item";

    const swatch = document.createElement("span");
    swatch.className = "map-legend-swatch";
    swatch.style.display = "inline-block";
    swatch.style.width = "12px";
    swatch.style.height = "12px";
    swatch.style.marginRight = "6px";
    swatch.style.verticalAlign = "middle";

    if (item.type === "circle" || item.type === "dashed-circle") {
      swatch.style.borderRadius = "50%";
      swatch.style.border = `2px solid ${item.color}`;
      if (item.type === "dashed-circle") {
        swatch.style.borderStyle = "dashed";
      } else {
        swatch.style.backgroundColor = item.color;
      }
    } else if (item.type === "diamond") {
      swatch.style.backgroundColor = item.color;
      swatch.style.transform = "rotate(45deg)";
      swatch.style.width = "10px";
      swatch.style.height = "10px";
    } else {
      swatch.style.height = "2px";
      swatch.style.backgroundColor = item.color;
      swatch.style.width = "12px";
    }

    const label = document.createElement("span");
    label.textContent = item.label;

    li.appendChild(swatch);
    li.appendChild(label);
    list.appendChild(li);
  }

  container.appendChild(list);
}
