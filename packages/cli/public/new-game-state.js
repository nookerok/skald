const DRAFT_KEY = "skald:new-game-draft:1";

export function loadDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveDraft(draft) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}
}

export function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
}

export function createWorldId() {
  return globalThis.crypto?.randomUUID?.() ?? "world-" + Date.now().toString(36);
}

export function createIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? "ik-" + Date.now().toString(36);
}
