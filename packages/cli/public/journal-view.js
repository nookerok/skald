const STORAGE_KEY = "skald:journal:thread";
const SEEN_TURN_IDS = new Set();

let fullJournalData = null;
let currentThreadFilter = null;
let loadGeneration = 0;
let loadedWorld = null;

function worldScope() {
  try { return sessionStorage.getItem("skald:worldId") || "legacy"; } catch { return "legacy"; }
}

function filterStorageKey() { return STORAGE_KEY + ":" + worldScope(); }

function restoreFilter() {
  try {
    const stored = sessionStorage.getItem(filterStorageKey());
    currentThreadFilter = stored && /^[a-f0-9]{64}$/.test(stored) ? stored : null;
  } catch {
    // silent
  }
}

function persistFilter() {
  try {
    if (currentThreadFilter && /^[a-f0-9]{64}$/.test(currentThreadFilter)) {
      sessionStorage.setItem(filterStorageKey(), currentThreadFilter);
    } else {
      sessionStorage.removeItem(filterStorageKey());
    }
  } catch {
    // silent
  }
}

function apiPath(path) { try { const id = sessionStorage.getItem("skald:worldId"); return id ? `/api/worlds/${encodeURIComponent(id)}${path}` : `/api${path}`; } catch { return "/api" + path; } }

// The journal API deliberately omits persistence identifiers. These helpers
// keep filtering and DOM ids local to this render, while accepting older
// fixtures during a rolling upgrade.
function localThreadKey(thread, index) { return thread.threadHandle || thread.threadKey || "local-thread-" + index; }
function localTurnKey(turn, index) { return turn.turnHandle || turn.turnId || "local-turn-" + index; }

export async function loadJournal() {
  const generation = ++loadGeneration;
  const world = worldScope();
  if (loadedWorld !== world) {
    fullJournalData = null;
    currentThreadFilter = null;
    SEEN_TURN_IDS.clear();
    loadedWorld = world;
  }
  const isCurrent = () => generation === loadGeneration && world === worldScope();
  try {
    const res = await fetch(apiPath("/journal?limit=50"));
    const body = await res.json();
    if (!isCurrent()) return null;
    if (body.ok) {
      fullJournalData = body;
      SEEN_TURN_IDS.clear();
      for (const [index, turn] of (body.turns || []).entries()) SEEN_TURN_IDS.add(localTurnKey(turn, index));
      restoreFilter();
      if (!(body.threads || []).some((thread, index) => localThreadKey(thread, index) === currentThreadFilter)) currentThreadFilter = null;
      renderJournal();
      return body;
    }
  } catch {
    // silent
  }
}

function getFilteredTurns() {
  if (!fullJournalData) return [];
  if (!currentThreadFilter) return fullJournalData.turns || [];
  const thread = (fullJournalData.threads || []).find((t, index) => localThreadKey(t, index) === currentThreadFilter);
  if (!thread) return fullJournalData.turns || [];
  const turnKeys = new Set(thread.entries.map((entry) => entry.turnHandle || entry.turnId).filter(Boolean));
  return (fullJournalData.turns || []).filter((turn, index) => {
    if (turn.turnHandle || turn.turnId) return turnKeys.has(localTurnKey(turn, index));
    // Older DTOs have no identity: never guess among equal-time scenes.
    return fullJournalData.turns.filter((candidate) => candidate.worldTime === turn.worldTime).length === 1
      && thread.entries.some((entry) => entry.worldTime === turn.worldTime);
  });
}

export function renderJournal() {
  const container = document.getElementById("journal-container");
  if (!container) return;

  container.replaceChildren();

  // Thread filters
  const threadBar = document.createElement("div");
  threadBar.className = "thread-bar";
  threadBar.setAttribute("role", "group");
  threadBar.setAttribute("aria-label", "Фильтры сцен");

  const allBtn = document.createElement("button");
  allBtn.textContent = "Все сцены";
  allBtn.setAttribute("aria-pressed", String(!currentThreadFilter));
  allBtn.addEventListener("click", () => {
    currentThreadFilter = null;
    persistFilter();
    renderJournal();
  });
  threadBar.appendChild(allBtn);

  for (const [index, thread] of (fullJournalData?.threads || []).entries()) {
    const btn = document.createElement("button");
    btn.textContent = thread.label;
    btn.className = "thread-btn";
    const threadKey = localThreadKey(thread, index);
    const active = currentThreadFilter === threadKey;
    btn.setAttribute("aria-pressed", String(active));
    btn.addEventListener("click", () => {
      currentThreadFilter = (currentThreadFilter === threadKey) ? null : threadKey;
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
  turnsList.setAttribute("aria-label", "Хроника сцен");

  const filteredTurns = getFilteredTurns();
  const uniqueTurns = [];
  const seenSceneKeys = new Set();
  for (const [index, turn] of filteredTurns.entries()) {
    const key = localTurnKey(turn, index);
    if (seenSceneKeys.has(key)) continue;
    seenSceneKeys.add(key);
    uniqueTurns.push(turn);
  }
  for (let i = 0; i < uniqueTurns.length; i++) {
    const turn = uniqueTurns[i];
    const turnEl = document.createElement("div");
    turnEl.className = "turn-entry";
    turnEl.setAttribute("role", "listitem");
    const turnId = "t-" + localTurnKey(turn, i);
    const isFirst = i === 0;

    const header = document.createElement("button");
    header.type = "button";
    header.className = "turn-header";
    header.textContent = sceneLabel(turn, i);
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
    body.setAttribute("aria-label", "Содержание сцены " + (i + 1));
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
      const notableToggle = document.createElement("button");
      notableToggle.type = "button";
      notableToggle.className = "notable-toggle";
      notableToggle.textContent = "Подробнее...";
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
  for (const [index, t] of uniqueTurns.entries()) {
    const id = localTurnKey(t, index);
    SEEN_TURN_IDS.add(id);
  }

  container.appendChild(turnsList);

  if (fullJournalData && fullJournalData.hasMore) {
    const moreBtn = document.createElement("button");
    moreBtn.textContent = "Ранее";
    moreBtn.setAttribute("aria-label", "Загрузить более ранние ходы");
    moreBtn.addEventListener("click", async () => {
      if (moreBtn.disabled || !fullJournalData) return;
      const snapshot = fullJournalData;
      const generation = loadGeneration;
      const world = worldScope();
      const isCurrent = () => generation === loadGeneration && world === worldScope() && snapshot === fullJournalData;
      const cursor = snapshot.nextBeforeTurn
        ? "beforeTurn=" + encodeURIComponent(snapshot.nextBeforeTurn)
        : "before=" + encodeURIComponent(snapshot.nextBefore);
      moreBtn.disabled = true;
      moreBtn.setAttribute("aria-busy", "true");
      try {
        const res = await fetch(apiPath("/journal?limit=20&" + cursor));
        const body = await res.json();
        if (!isCurrent()) return;
        if (!body.ok) throw new Error("journal page unavailable");
        for (const [index, turn] of (body.turns || []).entries()) {
          const id = localTurnKey(turn, index);
          if (!SEEN_TURN_IDS.has(id)) {
            snapshot.turns.push(turn);
            SEEN_TURN_IDS.add(id);
          }
        }
        snapshot.nextBefore = body.nextBefore;
        snapshot.nextBeforeTurn = body.nextBeforeTurn;
        snapshot.hasMore = body.hasMore;
        renderJournal();
      } catch {
        if (!isCurrent()) return;
        moreBtn.setAttribute("aria-label", "Повторить загрузку более ранних ходов");
        const notice = document.createElement("p");
        notice.setAttribute("role", "status");
        notice.textContent = "Не удалось загрузить ранние сцены. Нажми «Ранее», чтобы повторить.";
        container.appendChild(notice);
      } finally {
        if (isCurrent()) {
          moreBtn.disabled = false;
          moreBtn.setAttribute("aria-busy", "false");
        }
      }
    });
    container.appendChild(moreBtn);
  }
}

function sceneLabel(turn, index) {
  const text = String(turn.presentation?.primary?.text || "").toLowerCase();
  if (/путь|дорог|переправ|добрал|водопад|руин/.test(text)) return "Путешествие";
  if (/откры|замет|след|наблюд|узнаёт/.test(text)) return "Открытие";
  if (/отнош|общин|довер|уважен/.test(text)) return "Отношение";
  if (/опас|преград|огонь|жар|тревог/.test(text)) return "Опасность";
  if (/последств|изменил|проявил/.test(text)) return "Последствие";
  return "Сцена " + (index + 1);
}

function markLabel(m) {
  switch (m) {
    case "trace": return "След";
    case "echo": return "Эхо";
    case "omen": return "Знамение";
    default: return "";
  }
}
