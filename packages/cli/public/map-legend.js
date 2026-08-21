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
    { color: "#ef715c", label: "Ты здесь", type: "circle" },
    { color: "#d7aa52", label: "Пройденное место", type: "circle" },
    { color: "#64c7d8", label: "Наблюдённое место", type: "circle" },
    { color: "#c8d2ce", label: "Дальний силуэт", type: "haze" },
    { color: "#d8c08d", label: "Запомненный путь", type: "line" },
    { color: "#b7c4c4", label: "Слух в направлении", type: "note" },
    { color: "#081017", label: "Неизведанное", type: "fog" },
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

    if (item.type === "circle" || item.type === "haze") {
      swatch.style.borderRadius = "50%";
      swatch.style.border = `2px solid ${item.color}`;
      if (item.type === "haze") {
        swatch.style.background = "radial-gradient(circle, rgba(200,210,206,.7), transparent 70%)";
        swatch.style.borderStyle = "dashed";
      } else {
        swatch.style.backgroundColor = item.color;
      }
    } else if (item.type === "diamond") {
      swatch.style.backgroundColor = item.color;
      swatch.style.transform = "rotate(45deg)";
      swatch.style.width = "10px";
      swatch.style.height = "10px";
    } else if (item.type === "fog") {
      swatch.style.borderRadius = "3px";
      swatch.style.background = "linear-gradient(135deg, #14242d, #02070b)";
      swatch.style.border = "1px solid #61747b";
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
