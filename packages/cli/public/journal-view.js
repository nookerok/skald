const STORAGE_KEY = "skald:journal:thread";
const SEEN_TURN_IDS = new Set();

let fullJournalData = null;
let currentThreadFilter = null;

function restoreFilter() {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) currentThreadFilter = stored;
  } catch {
    // silent
  }
}

function persistFilter() {
  try {
    if (currentThreadFilter) {
      sessionStorage.setItem(STORAGE_KEY, currentThreadFilter);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // silent
  }
}

export async function loadJournal() {
  try {
    const res = await fetch("/api/journal?limit=50");
    const body = await res.json();
    if (body.ok) {
      fullJournalData = body;
      renderJournal();
    }
  } catch {
    // silent
  }
}

function getFilteredTurns() {
  if (!fullJournalData) return [];
  if (!currentThreadFilter) return fullJournalData.turns || [];
  const thread = (fullJournalData.threads || []).find((t) => t.threadKey === currentThreadFilter);
  if (!thread) return fullJournalData.turns || [];
  const turnIds = new Set(thread.entries.map((e) => e.turnId));
  return (fullJournalData.turns || []).filter((t) => turnIds.has(t.turnId));
}

export function renderJournal() {
  const container = document.getElementById("journal-container");
  if (!container) return;

  restoreFilter();

  container.innerHTML = "";

  // Thread filters
  const threadBar = document.createElement("div");
  threadBar.className = "thread-bar";
  threadBar.setAttribute("role", "group");
  threadBar.setAttribute("aria-label", "Фильтры хроники");

  const allBtn = document.createElement("button");
  allBtn.textContent = "Все ходы";
  allBtn.setAttribute("aria-pressed", String(!currentThreadFilter));
  allBtn.addEventListener("click", () => {
    currentThreadFilter = null;
    persistFilter();
    renderJournal();
  });
  threadBar.appendChild(allBtn);

  for (const thread of (fullJournalData?.threads || [])) {
    const btn = document.createElement("button");
    btn.textContent = thread.label;
    btn.className = "thread-btn";
    const active = currentThreadFilter === thread.threadKey;
    btn.setAttribute("aria-pressed", String(active));
    if (active) btn.style.borderColor = "#e94560";
    btn.addEventListener("click", () => {
      currentThreadFilter = (currentThreadFilter === thread.threadKey) ? null : thread.threadKey;
      persistFilter();
      renderJournal();
    });
    threadBar.appendChild(btn);
  }
  container.appendChild(threadBar);

  // Turns
  const turnsList = document.createElement("div");
  turnsList.className = "turns-list";
  turnsList.setAttribute("role", "list");
  turnsList.setAttribute("aria-label", "Хроника ходов");

  const filteredTurns = getFilteredTurns();
  for (let i = 0; i < filteredTurns.length; i++) {
    const turn = filteredTurns[i];
    const turnEl = document.createElement("div");
    turnEl.className = "turn-entry";
    turnEl.setAttribute("role", "listitem");
    const turnId = turn.turnId || "t" + turn.worldTime;
    const isFirst = i === 0;

    const header = document.createElement("div");
    header.className = "turn-header";
    header.textContent = "T" + turn.worldTime;
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    header.setAttribute("aria-expanded", String(isFirst));
    header.setAttribute("aria-controls", "body-" + turnId);
    header.addEventListener("click", () => {
      const body = turnEl.querySelector(".turn-body");
      if (body) {
        const open = body.style.display === "none";
        body.style.display = open ? "block" : "none";
        header.setAttribute("aria-expanded", String(open));
      }
    });
    turnEl.appendChild(header);

    const body = document.createElement("div");
    body.className = "turn-body";
    body.id = "body-" + turnId;
    body.style.display = isFirst ? "block" : "none";
    body.setAttribute("role", "region");
    body.setAttribute("aria-label", "Детали хода T" + turn.worldTime);
    const pres = turn.presentation;

    if (pres && pres.primary) {
      const pEl = document.createElement("div");
      pEl.className = "turn-primary";
      pEl.textContent = pres.primary.text;
      if (pres.primary.discoveryMark) {
        const mark = document.createElement("span");
        mark.className = "discovery-mark";
        mark.textContent = " [" + markLabel(pres.primary.discoveryMark) + "]";
        pEl.appendChild(mark);
      }
      body.appendChild(pEl);
    }

    if (pres && pres.notable && pres.notable.length > 0) {
      const notableToggle = document.createElement("div");
      notableToggle.className = "notable-toggle";
      notableToggle.textContent = "Подробнее...";
      notableToggle.setAttribute("role", "button");
      notableToggle.setAttribute("tabindex", "0");
      notableToggle.setAttribute("aria-expanded", "false");
      notableToggle.addEventListener("click", () => {
        const list = notableToggle.nextElementSibling;
        if (list) {
          const open = list.style.display === "none";
          list.style.display = open ? "block" : "none";
          notableToggle.setAttribute("aria-expanded", String(open));
        }
      });
      body.appendChild(notableToggle);

      const notableList = document.createElement("div");
      notableList.className = "notable-list";
      notableList.style.display = "none";
      notableList.setAttribute("role", "list");
      for (const n of pres.notable) {
        const nEl = document.createElement("div");
        nEl.className = "notable-entry";
        nEl.setAttribute("role", "listitem");
        nEl.textContent = n.text;
        notableList.appendChild(nEl);
      }
      body.appendChild(notableList);
    }

    turnEl.appendChild(body);
    turnsList.appendChild(turnEl);
  }

  // Track seen turn IDs for dedup
  for (const t of filteredTurns) {
    const id = t.turnId || ("t" + t.worldTime);
    SEEN_TURN_IDS.add(id);
  }

  container.appendChild(turnsList);

  if (fullJournalData && fullJournalData.hasMore) {
    const moreBtn = document.createElement("button");
    moreBtn.textContent = "Ранее";
    moreBtn.setAttribute("aria-label", "Загрузить более ранние ходы");
    moreBtn.addEventListener("click", async () => {
      const res = await fetch("/api/journal?limit=20&before=" + fullJournalData.nextBefore);
      const body = await res.json();
      if (body.ok && fullJournalData) {
        for (const t of body.turns) {
          const id = t.turnId || ("t" + t.worldTime);
          if (!SEEN_TURN_IDS.has(id)) {
            fullJournalData.turns.push(t);
            SEEN_TURN_IDS.add(id);
          }
        }
        fullJournalData.nextBefore = body.nextBefore;
        fullJournalData.hasMore = body.hasMore;
        renderJournal();
      }
    });
    container.appendChild(moreBtn);
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
