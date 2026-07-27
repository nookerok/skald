let retryKey = null;
let retryInput = null;

function genKey() {
  return crypto.randomUUID();
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
    const res = await fetch("/api/command", {
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
    const res = await fetch("/api/state", { signal: AbortSignal.timeout(5000) });
    const body = await res.json();
    return { body };
  } catch {
    return { body: null };
  }
}

export function retryLast() {
  if (retryKey && retryInput) {
    return sendCommand(retryInput, retryKey);
  }
  return null;
}
