let currentWorldId = null;

export async function fetchWorlds() {
  try {
    const res = await fetch("/api/worlds");
    const body = await res.json();
    return body.worlds || [];
  } catch {
    return [];
  }
}

export async function fetchContinue() {
  try {
    const res = await fetch("/api/continue");
    const body = await res.json();
    return body.worldId || null;
  } catch {
    return null;
  }
}

export function setCurrentWorld(worldId) {
  currentWorldId = worldId;
  try { sessionStorage.setItem("skald:worldId", worldId); } catch {}
}

export function getCurrentWorld() {
  if (currentWorldId) return currentWorldId;
  try { currentWorldId = sessionStorage.getItem("skald:worldId"); } catch {}
  return currentWorldId;
}

function apiBase() {
  const wid = currentWorldId || "legacy-world";
  return `/api/worlds/${wid}`;
}

export async function sendCommand(input, overrideKey) {
  const key = overrideKey || genKey();
  if (!overrideKey) {
    retryKey = key;
    retryInput = input;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${apiBase()}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input, idempotencyKey: key }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchState() {
  try {
    const res = await fetch(`${apiBase()}/state`, { signal: AbortSignal.timeout(5000) });
    const body = await res.json();
    return { body };
  } catch {
    return { body: null };
  }
}

let retryKey = null;
let retryInput = null;
let fallbackKeySequence = 0;

function genKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackKeySequence += 1;
  return ["web", Date.now().toString(36), fallbackKeySequence.toString(36), Math.random().toString(36).slice(2)].join("-");
}

export function retryLast() {
  if (retryKey && retryInput) {
    return sendCommand(retryInput, retryKey);
  }
  return null;
}
