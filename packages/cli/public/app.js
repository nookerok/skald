let currentKey = "";
let pendingRequest = null;
let polling = false;
let retryKey = null;
let retryInput = null;

function genKey() { return crypto.randomUUID(); }

function updateStatus(msg) {
  document.getElementById("status-text").textContent = msg;
}

function setLoading(loading) {
  document.getElementById("send-btn").disabled = loading;
  document.getElementById("wait-btn").disabled = loading;
  document.getElementById("advance-btn").disabled = loading;
}

function addText(el, text) {
  const span = document.createElement("span");
  span.textContent = text;
  el.appendChild(span);
}

function appendNode(parent, child) { parent.appendChild(child); }

function clearEvents() {
  document.getElementById("event-log").innerHTML = "";
}

function addEvent(ev) {
  const log = document.getElementById("event-log");
  const item = document.createElement("div");
  item.className = "event-item";
  const typeEl = document.createElement("span");
  typeEl.className = "event-type";
  typeEl.textContent = `[${ev.type}]`;
  item.appendChild(typeEl);
  const payloadText = document.createTextNode(" " + JSON.stringify(ev.payload));
  item.appendChild(payloadText);
  const idSmall = document.createElement("small");
  idSmall.textContent = " " + ev.eventId;
  item.appendChild(idSmall);
  log.appendChild(item);
  log.scrollTop = log.scrollHeight;
}

function renderState(state) {
  document.getElementById("time-display").textContent = `T: ${state.worldTime}`;
  document.getElementById("pos-display").textContent = `(${state.player.x}, ${state.player.y})`;

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
        cell.textContent = "\u25CF";
      }
      if (state.heatMap && state.heatMap[key]) {
        cell.classList.add("heat");
        const hl = document.createElement("span");
        hl.className = "heat-level";
        hl.textContent = String(state.heatMap[key]);
        cell.appendChild(hl);
      }
      grid.appendChild(cell);
    }
  }

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

  const relList = document.getElementById("relations-list");
  relList.innerHTML = "";
  if (state.relations) {
    for (const r of state.relations) {
      const item = document.createElement("div");
      item.className = "relation-item";
      item.textContent = `${r.kind} \u2192 ${r.to}: ${r.value}`;
      relList.appendChild(item);
    }
  }

  const statusEl = document.getElementById("status-details");
  if (statusEl) {
    statusEl.textContent = `Events: ${state.eventNumber ?? "?"} | Trees burned: ${state.burnedTrees ?? 0} | Router: ${state.routerAvailable ? "\u2705" : "\u274C"}`;
  }
}

async function api(path, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      ...opts,
    });
    return { status: res.status, body: await res.json() };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchState() {
  try {
    const { body } = await api("/api/state");
    if (body.ok) { renderState(body.state); updateStatus("Connected"); }
  } catch { updateStatus("Network error"); }
}

async function pollState() {
  if (polling) return;
  polling = true;
  while (true) {
    await new Promise((r) => setTimeout(r, 2000));
    const prev = await fetch("/api/state", { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (prev) try { const data = await prev.json(); if (data.ok) renderState(data.state); } catch {}
  }
}

async function sendRequest(input, key) {
  currentKey = key;
  pendingRequest = { key, input };
  retryKey = key;
  retryInput = input;
  setLoading(true);
  try {
    const { status, body } = await api("/api/command", {
      method: "POST",
      body: JSON.stringify({ input, idempotencyKey: key }),
    });
    if (body && body.ok) {
      if (body.events) body.events.forEach(addEvent);
      if (body.tickEvents) body.tickEvents.forEach(addEvent);
      if (body.state) renderState(body.state);
      updateStatus("OK");
      pendingRequest = null;
      retryKey = null;
      retryInput = null;
    } else if (body && body.error) {
      if (body.error.code === "duplicate_request") {
        updateStatus("Duplicate (retry)");
      } else {
        updateStatus("Error: " + (body.error.message || "unknown"));
      }
    } else {
      updateStatus("HTTP " + status);
    }
  } catch (err) {
    if (err.name === "AbortError") updateStatus("Timeout");
    else updateStatus("Network error");
  }
  setLoading(false);
}

function retryLast() {
  if (retryKey && retryInput) {
    sendRequest(retryInput, retryKey);
  }
}

async function narrate(since) {
  const url = since != null ? `/api/narrative?since=${since}` : "/api/narrative";
  const { body } = await api(url);
  const nt = document.getElementById("narrative-text");
  nt.innerHTML = "";
  if (body && body.ok && body.entries) {
    for (const e of body.entries) {
      const el = document.createElement("div");
      el.textContent = `[${e.kind}] ${e.text}`;
      nt.appendChild(el);
    }
  }
}

async function narrateLLM(since) {
  const url = since != null ? `/api/narrative-llm?since=${since}` : "/api/narrative-llm";
  const { body } = await api(url);
  const nt = document.getElementById("narrative-text");
  nt.innerHTML = "";
  if (body && body.ok) {
    if (body.usedFallback) {
      const fb = document.createElement("div");
      fb.className = "error";
      fb.textContent = `[LLM fallback: ${body.fallbackReason}]`;
      nt.appendChild(fb);
    }
    const textEl = document.createElement("div");
    textEl.style.whiteSpace = "pre-wrap";
    textEl.textContent = body.text || "";
    nt.appendChild(textEl);
  }
}

async function sendCommand(input, key) {
  if (input === "wait" || input.startsWith("advance ")) {
    await sendRequest(input, key);
    return;
  }
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
  await sendRequest(input, key);
}

document.addEventListener("DOMContentLoaded", async () => {
  await fetchState();
  pollState();

  document.getElementById("send-btn").addEventListener("click", () => {
    const input = document.getElementById("command-input").value.trim();
    if (!input) return;
    const key = genKey();
    sendCommand(input, key);
  });

  document.getElementById("command-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("send-btn").click();
  });

  document.getElementById("wait-btn").addEventListener("click", () => {
    const key = genKey();
    sendRequest("wait", key);
  });

  document.getElementById("advance-btn").addEventListener("click", () => {
    const count = parseInt(document.getElementById("advance-count").value, 10) || 5;
    const key = genKey();
    sendRequest(`advance ${count}`, key);
  });

  const retryBtn = document.getElementById("retry-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", retryLast);
  }
});
