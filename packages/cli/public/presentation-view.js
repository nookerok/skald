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
    primaryEl.textContent = "Здесь начинается твой путь. Осмотрись и опиши первое намерение.";
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
  const time = document.getElementById("time-display");
  if (time) time.textContent = "T: " + state.worldTime;
  // Spatial state belongs to the dedicated observer map DTO. The compatibility
  // renderer remains loadable for old tests, but intentionally has no access to
  // player coordinates, walls or heat values.
  const position = document.getElementById("pos-display");
  if (position) position.textContent = "Место скрыто до открытия карты.";
  const grid = document.getElementById("map-grid");
  if (grid) grid.replaceChildren();
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
