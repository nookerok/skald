import { createRequestKey } from "./world-api-client.js";

const DRAFT_KEY = "skald:new-game-draft:2";
const LEGACY_DRAFT_KEY = "skald:new-game-draft:1";

export function loadDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY) || sessionStorage.getItem(LEGACY_DRAFT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveDraft(draft) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}
}

export function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); sessionStorage.removeItem(LEGACY_DRAFT_KEY); } catch {}
}

export function createWorldId() {
  return createRequestKey("world");
}

export function createIdempotencyKey() {
  return createRequestKey("ik");
}
