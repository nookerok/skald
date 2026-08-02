// Offline Intent Queue (UX-6.3)
//
// The browser stores ONLY Command envelopes — { input, idempotencyKey,
// baseRevision } — in localStorage, never Domain Events, never Projection,
// never optimistic state. The server decides on reconnect whether the
// envelope is accepted, rejected, in conflict or already processed; this
// module only persists, lists, trims and drops envelopes and exposes pure
// helpers for tests. All storage access is guarded so the module is safe to
// import in node (no localStorage).

export const MAX_QUEUED_INTENTS = 20;

export function storageKey(worldId) {
  return `skald:offline-queue:${worldId}`;
}

/** Pure: parse raw localStorage JSON into valid envelopes (corrupt → []). */
export function parseStoredQueue(raw) {
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item) =>
    item && typeof item === "object" &&
    typeof item.input === "string" && item.input.length > 0 &&
    typeof item.idempotencyKey === "string" && item.idempotencyKey.length > 0 &&
    Number.isSafeInteger(item.baseRevision) && item.baseRevision >= 0,
  );
}

/** Pure: keep the newest `max` envelopes (oldest dropped first). */
export function trimQueue(queue, max = MAX_QUEUED_INTENTS) {
  return queue.slice(-max);
}

function safeStorage(storage) {
  if (storage) return storage;
  try {
    if (typeof globalThis.localStorage === "object" && globalThis.localStorage !== null) {
      return globalThis.localStorage;
    }
  } catch {
    // localStorage unavailable (private mode, node) — queue degrades to empty.
  }
  return null;
}

export function readQueue(worldId, storage) {
  const s = safeStorage(storage);
  if (!s) return [];
  try {
    return parseStoredQueue(s.getItem(storageKey(worldId)));
  } catch {
    return [];
  }
}

export function writeQueue(worldId, queue, storage) {
  const s = safeStorage(storage);
  if (!s) return false;
  try {
    s.setItem(storageKey(worldId), JSON.stringify(queue));
    return true;
  } catch {
    return false;
  }
}

/** Add or refresh (by idempotencyKey) one envelope, bounded at the maximum. */
export function enqueueOfflineIntent(worldId, envelope, storage) {
  const queue = readQueue(worldId, storage);
  const withoutKey = queue.filter((item) => item.idempotencyKey !== envelope.idempotencyKey);
  const next = trimQueue([...withoutKey, {
    input: envelope.input,
    idempotencyKey: envelope.idempotencyKey,
    baseRevision: envelope.baseRevision,
  }]);
  writeQueue(worldId, next, storage);
  return next;
}

/** Drop envelopes whose keys are listed (processed, cleared, expired). */
export function removeProcessed(worldId, keys, storage) {
  const drop = new Set(keys);
  const queue = readQueue(worldId, storage);
  const next = queue.filter((item) => !drop.has(item.idempotencyKey));
  writeQueue(worldId, next, storage);
  return next;
}

export function countQueued(worldId, storage) {
  return readQueue(worldId, storage).length;
}
