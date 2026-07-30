export function renderTurn(pres) {
  const primaryEl = document.getElementById("primary-card");
  primaryEl.replaceChildren();

  if (pres.primary) {
    const p = pres.primary;
    const textEl = document.createElement("div");
    textEl.textContent = p.text;
    primaryEl.appendChild(textEl);
    if (p.discoveryMark) {
      const mark = document.createElement("span");
      mark.className = "discovery-mark";
      mark.textContent = markLabel(p.discoveryMark);
      primaryEl.appendChild(mark);
    }
  } else {
    primaryEl.textContent = "Мир замер в ожидании.";
  }

  const notableList = document.getElementById("notable-list");
  notableList.replaceChildren();
  if (pres.notable && pres.notable.length > 0) {
    for (const n of pres.notable) {
      const el = document.createElement("div");
      el.className = "notable-entry";
      el.textContent = n.text;
      if (n.discoveryMark) {
        const mark = document.createElement("span");
        mark.className = "discovery-mark";
        mark.textContent = " [" + markLabel(n.discoveryMark) + "]";
        el.appendChild(mark);
      }
      notableList.appendChild(el);
    }
  }

  // Remove old suppressed message and add new one
  const existing = document.getElementById("suppressed-msg");
  if (existing) existing.remove();
  if (pres.suppressedEventCount > 0) {
    const muted = document.createElement("div");
    muted.id = "suppressed-msg";
    muted.style.cssText = "color:#666;font-size:0.8rem;margin-top:0.5rem;";
    muted.textContent = "Мир продолжает жить: ещё " + pres.suppressedEventCount + " изменений скрыты.";
    document.getElementById("primary-section").appendChild(muted);
  }
}

function markLabel(m) {
  switch (m) {
    case "trace": return "След";
    case "echo": return "Эхо";
    case "omen": return "Знамение";
    default: return "";
  }
}

export function renderState(state) {
  document.getElementById("time-display").textContent = "T: " + state.worldTime;
  document.getElementById("pos-display").textContent = "(" + state.player.x + ", " + state.player.y + ")";

  const grid = document.getElementById("map-grid");
  grid.replaceChildren();
  for (let y = 4; y >= 0; y--) {
    for (let x = 0; x < 5; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const key = x + "," + y;
      if (state.walls && state.walls.includes(key)) cell.classList.add("wall");
      if (state.player.x === x && state.player.y === y) {
        cell.classList.add("player");
        cell.textContent = "\u25CF";
      }
      if (state.heatMap && state.heatMap[key]) {
        cell.classList.add("heat");
        const tip = document.createElement("span");
        tip.className = "heat-tooltip";
        tip.textContent = "heat: " + state.heatMap[key];
        cell.appendChild(tip);
      }
      grid.appendChild(cell);
    }
  }
}

export const renderDiagnostics = {
  clear() {
    document.getElementById("event-log").replaceChildren();
  },
  addEvent(ev) {
    const log = document.getElementById("event-log");
    const item = document.createElement("div");
    item.className = "event-item";
    const typeEl = document.createElement("span");
    typeEl.className = "event-type";
    typeEl.textContent = "[" + ev.type + "]";
    item.appendChild(typeEl);
    item.appendChild(document.createTextNode(" " + JSON.stringify(ev.payload)));
    const idSmall = document.createElement("small");
    idSmall.textContent = " " + ev.eventId;
    item.appendChild(idSmall);
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
  },
  title(msg) {
    document.getElementById("status-text").textContent = msg;
  },
};
