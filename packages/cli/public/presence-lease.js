// presence-lease.js — browser-session-only navigation lease. A lease only
// answers "did this browser session already acknowledge presence in this
// world?"; it is not a checkpoint, not persistence, not server authorization
// and never a source of truth. sessionStorage is used on purpose: closing the
// browser session ends the lease, so a fresh tab always passes through the
// presence entry again.

export const LEASE_SCHEMA_VERSION = 1;

export function leaseStorageKey(worldId) {
  return `skald:presence:lease:1:${worldId}`;
}

function parseLease(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.schemaVersion !== LEASE_SCHEMA_VERSION) return null;
  if (typeof parsed.worldId !== "string" || parsed.worldId.length === 0) return null;
  if (!Number.isSafeInteger(parsed.acknowledgedWorldTime) || parsed.acknowledgedWorldTime < 0) return null;
  if (!Number.isSafeInteger(parsed.acknowledgedEventNumber) || parsed.acknowledgedEventNumber < 0) return null;
  return parsed;
}

/** Returns the validated lease for the world, or null when absent/corrupt. */
export function loadPresenceLease(worldId) {
  try {
    const lease = parseLease(sessionStorage.getItem(leaseStorageKey(worldId)));
    if (!lease) return null;
    if (lease.worldId !== worldId) {
      // A lease from another world must never be accepted; drop it.
      clearPresenceLease(worldId);
      return null;
    }
    return lease;
  } catch {
    return null;
  }
}

/** Persists a lease only for a fully validated world + revision pair. */
export function savePresenceLease(worldId, revision) {
  if (!revision || typeof revision !== "object") return false;
  const worldTime = revision.worldTime;
  const eventNumber = revision.eventNumber;
  if (!Number.isSafeInteger(worldTime) || worldTime < 0) return false;
  if (!Number.isSafeInteger(eventNumber) || eventNumber < 0) return false;
  const lease = {
    schemaVersion: LEASE_SCHEMA_VERSION,
    worldId,
    acknowledgedWorldTime: worldTime,
    acknowledgedEventNumber: eventNumber,
  };
  try {
    sessionStorage.setItem(leaseStorageKey(worldId), JSON.stringify(lease));
    return true;
  } catch {
    return false;
  }
}

export function clearPresenceLease(worldId) {
  try { sessionStorage.removeItem(leaseStorageKey(worldId)); } catch {}
}

export function hasPresenceLease(worldId) {
  return loadPresenceLease(worldId) !== null;
}
