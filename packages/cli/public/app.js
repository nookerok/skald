let currentIdempotencyKey = "";
let polling = false;

function genKey() {
  return crypto.randomUUID();
}

function updateStatus(msg) {
  document.getElementById("status-text").textContent = msg;
}

function setLoading(loading) {
  document.getElementById("send-btn").disabled = loading;
  document.getElementById("wait-btn").disabled = loading;
  document.getElementById("advance-btn").disabled = loading;
}

function addEvent(ev) {
  const log = document.getElementById("event-log");
  const item = document.createElement("div");
  item.className = "event-item";
  item.innerHTML = `<span class="event-type">[${ev.type}]</span> ${JSON.stringify(ev.payload)} <small>${ev.eventId}</small>`;
  log.appendChild(item);
  log.scrollTop = log.scrollHeight;
}

function clearEvents() {
  document.getElementById("event-log").innerHTML = "";
}

function renderState(state) {
  document.getElementById("time-display").textContent = `T: ${state.worldTime}`;
  document.getElementById("pos-display").textContent = `(${state.player.x}, ${state.player.y})`;

  // Map
  const grid = document.getElementById("map-grid");
  grid.innerHTML = "";
  for (let y = 4; y >= 0; y--) {
    for (let x = 0; x < 5; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const key = `${x},${y}`;
      if (state.walls && state.walls.includes(key)) cell.classList.add("wall");
      if (state.player.x === x && state.player.y === y) {
        cell.classList.add("player");
        cell.innerHTML = '<span class="player-icon">&#9679;</span>';
      }
      if (state.heatMap && state.heatMap[key]) {
        cell.classList.add("heat");
        const hl = document.createElement("span");
        hl.className = "heat-level";
        hl.textContent = state.heatMap[key];
        cell.appendChild(hl);
      }
      grid.appendChild(cell);
    }
  }

  // Observations
  const obsList = document.getElementById("observations-list");
  obsList.innerHTML = "";
  if (state.observations) {
    for (const [k, v] of Object.entries(state.observations)) {
      const item = document.createElement("div");
      item.className = "obs-item";
      item.textContent = `${k}: ${v}`;
      obsList.appendChild(item);
    }
  }

  // Consequences
  const consList = document.getElementById("consequences-list");
  consList.innerHTML = "";
  if (state.consequences) {
    for (const c of state.consequences) {
      const item = document.createElement("div");
      item.className = "consequence-item";
      item.textContent = `${c.type} (exp ${c.expiresAt})`;
      consList.appendChild(item);
    }
  }

  // Situations
  const sitList = document.getElementById("situations-list");
  sitList.innerHTML = "";
  if (state.activeSituations) {
    for (const s of state.activeSituations) {
      const item = document.createElement("div");
      item.className = "situation-item";
      item.textContent = `${s.type} (${s.startedAt} + ${s.duration})`;
      sitList.appendChild(item);
    }
  }

  // Relations
  const relList = document.getElementById("relations-list");
  relList.innerHTML = "";
  if (state.relations) {
    for (const r of state.relations) {
      const item = document.createElement("div");
      item.className = "relation-item";
      item.textContent = `${r.kind} → ${r.to}: ${r.value}`;
      relList.appendChild(item);
    }
  }
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return res.json();
}

async function fetchState() {
  try {
    const data = await api("/api/state");
    if (data.ok) {
      renderState(data.state);
      updateStatus("Connected");
    }
  } catch {
    updateStatus("Network error");
  }
}

async function pollState() {
  if (polling) return;
  polling = true;
  while (true) {
    await new Promise((r) => setTimeout(r, 2000));
    await fetchState();
  }
}

async function sendCommand(input, key) {
  setLoading(true);
  try {
    const data = await api("/api/command", {
      method: "POST",
      body: JSON.stringify({ input, idempotencyKey: key }),
    });
    if (data.ok) {
      if (data.events) for (const e of data.events) addEvent(e);
      if (data.tickEvents) for (const e of data.tickEvents) addEvent(e);
      if (data.state) renderState(data.state);
      updateStatus("Command sent");
    } else if (data.error) {
      if (data.error.code === "duplicate_request") {
        updateStatus("Duplicate (retry)");
      } else {
        updateStatus(`Error: ${data.error.message}`);
      }
    }
  } catch {
    updateStatus("Network error");
  }
  setLoading(false);
}

async function narrate(since) {
  const url = since ? `/api/narrative?since=${since}` : "/api/narrative";
  const data = await api(url);
  if (data.ok && data.entries) {
    document.getElementById("narrative-text").innerHTML = data.entries.map((e) =>
      `<div>[${e.kind}] ${e.text}</div>`
    ).join("");
  }
}

async function narrateLLM(since) {
  const url = since ? `/api/narrative-llm?since=${since}` : "/api/narrative-llm";
  const data = await api(url);
  if (data.ok) {
    const nt = document.getElementById("narrative-text");
    if (data.usedFallback) {
      nt.innerHTML = `<div class="error">[LLM fallback: ${data.fallbackReason}]</div>${data.text.replace(/\n/g, '<br>')}`;
    } else {
      nt.innerHTML = data.text.replace(/\n/g, '<br>');
    }
  }
}

async function doWait() {
  const key = genKey();
  setLoading(true);
  try {
    const data = await api("/api/wait", {
      method: "POST",
      body: JSON.stringify({ count: 1, idempotencyKey: key }),
    });
    if (data.ok) {
      if (data.tickEvents) for (const e of data.tickEvents) addEvent(e);
      if (data.state) renderState(data.state);
      updateStatus("Tick passed");
    }
  } catch {
    updateStatus("Network error");
  }
  setLoading(false);
}

async function doAdvance() {
  const count = parseInt(document.getElementById("advance-count").value, 10) || 5;
  const key = genKey();
  setLoading(true);
  try {
    const data = await api("/api/command", {
      method: "POST",
      body: JSON.stringify({ input: `advance ${count}`, idempotencyKey: key }),
    });
    if (data.ok) {
      if (data.tickEvents) for (const e of data.tickEvents) addEvent(e);
      if (data.state) renderState(data.state);
      updateStatus(`Advanced ${count} ticks`);
    }
  } catch {
    updateStatus("Network error");
  }
  setLoading(false);
}

// Entry
document.addEventListener("DOMContentLoaded", async () => {
  await fetchState();
  pollState();

  document.getElementById("send-btn").addEventListener("click", async () => {
    const input = document.getElementById("command-input").value.trim();
    if (!input) return;
    currentIdempotencyKey = genKey();

    if (input.startsWith("narrate")) {
      const rest = input.slice(7).trim();
      if (rest.startsWith("llm")) {
        const since = parseInt(rest.replace(/^llm\s*/, "").replace(/^since\s+/, ""), 10);
        await narrateLLM(isNaN(since) ? undefined : since);
      } else {
        const since = parseInt(rest.replace(/^since\s+/, ""), 10);
        await narrate(isNaN(since) ? undefined : since);
      }
      return;
    }

    if (input === "wait") {
      await doWait();
      return;
    }

    if (input.startsWith("advance ")) {
      await doAdvance();
      return;
    }

    await sendCommand(input, currentIdempotencyKey);
  });

  document.getElementById("command-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("send-btn").click();
  });

  document.getElementById("wait-btn").addEventListener("click", doWait);
  document.getElementById("advance-btn").addEventListener("click", doAdvance);
});
