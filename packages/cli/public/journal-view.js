let fullJournalData = null;
let currentThreadFilter = null;

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
  container.innerHTML = "";

  // Thread filters
  const threadBar = document.createElement("div");
  threadBar.className = "thread-bar";
  const allBtn = document.createElement("button");
  allBtn.textContent = "Все ходы";
  allBtn.addEventListener("click", () => { currentThreadFilter = null; renderJournal(); });
  threadBar.appendChild(allBtn);
  for (const thread of (fullJournalData?.threads || [])) {
    const btn = document.createElement("button");
    btn.textContent = thread.label;
    btn.className = "thread-btn";
    if (currentThreadFilter === thread.threadKey) btn.style.borderColor = "#e94560";
    btn.addEventListener("click", () => {
      currentThreadFilter = (currentThreadFilter === thread.threadKey) ? null : thread.threadKey;
      renderJournal();
    });
    threadBar.appendChild(btn);
  }
  container.appendChild(threadBar);

  // Turns
  const turnsList = document.createElement("div");
  turnsList.className = "turns-list";
  const filteredTurns = getFilteredTurns();
  for (let i = 0; i < filteredTurns.length; i++) {
    const turn = filteredTurns[i];
    const turnEl = document.createElement("div");
    turnEl.className = "turn-entry";
    const isFirst = i === 0;
    const header = document.createElement("div");
    header.className = "turn-header";
    header.textContent = "T" + turn.worldTime;
    header.addEventListener("click", () => {
      const body = turnEl.querySelector(".turn-body");
      if (body) body.style.display = body.style.display === "none" ? "block" : "none";
    });
    turnEl.appendChild(header);

    const body = document.createElement("div");
    body.className = "turn-body";
    body.style.display = isFirst ? "block" : "none";
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
      notableToggle.addEventListener("click", () => {
        const list = notableToggle.nextElementSibling;
        if (list) list.style.display = list.style.display === "none" ? "block" : "none";
      });
      body.appendChild(notableToggle);

      const notableList = document.createElement("div");
      notableList.className = "notable-list";
      notableList.style.display = "none";
      for (const n of pres.notable) {
        const nEl = document.createElement("div");
        nEl.className = "notable-entry";
        nEl.textContent = n.text;
        notableList.appendChild(nEl);
      }
      body.appendChild(notableList);
    }

    turnEl.appendChild(body);
    turnsList.appendChild(turnEl);
  }
  container.appendChild(turnsList);

  if (fullJournalData && fullJournalData.hasMore) {
    const moreBtn = document.createElement("button");
    moreBtn.textContent = "Ранее";
    moreBtn.addEventListener("click", async () => {
      const res = await fetch("/api/journal?limit=20&before=" + fullJournalData.nextBefore);
      const body = await res.json();
      if (body.ok && fullJournalData) {
        for (const t of body.turns) fullJournalData.turns.push(t);
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
