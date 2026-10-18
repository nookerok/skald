/**
 * Managed temporary-directory hygiene (operational-hygiene).
 *
 * Skald tests create scratch dirs under the OS temp root with a known prefix
 * (`skald-`). Repeated runs filled the tmpfs on the Orange Pi and broke a
 * deploy with ENOSPC. This module provides a SAFE, testable cleanup:
 *
* - only DIRECT child directories whose name starts with the managed prefix;
 * - never symlinks (so it cannot escape the temp root);
 * - only entries older than the TTL;
 * - LIVENESS beats TTL: a dir whose `.owner` marker names a live pid (a run
 *   that is long or hung) is never removed, however old its mtime;
 * - a headroom preflight (free bytes + free inodes) that fails early;
 * - a receipt with removed count/bytes, sparedLive and remaining headroom.
 *
 * It never touches the production DB or unrelated directories.
 */

import { readdirSync, statSync, rmSync, statfsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Ownership marker a run writes into its private temp root (`pid=<n>`). */
export const OWNER_MARKER = ".owner";

/** Reads the owning pid from a managed dir; null when absent/unparsable. */
export function ownerPid(path, readFile = readFileSync) {
  try {
    const text = readFile(join(path, OWNER_MARKER), "utf8");
    const match = /^pid=(\d+)$/m.exec(String(text).trim());
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** True when the pid names a live process. EPERM counts as alive (not ours). */
export function isPidAlive(pid, kill = process.kill) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/**
 * Whether a managed dir is owned by a STILL-LIVE run. Age is not proof of
 * death: a long or hung validation must never be swept mid-flight, so every
 * cleanup skips dirs whose owner marker names a live pid (pid reuse only ever
 * spares a dir for longer — the conservative direction).
 */
export function isOwnedByLiveProcess(path, probe = isPidAlive) {
  const pid = ownerPid(path);
  return pid !== null && probe(pid);
}

/** Pure selection: managed, real directories older than the TTL. */
export function selectStaleManagedDirs(entries, options) {
  return entries
    .filter((entry) => entry.isDirectory
      && !entry.isSymbolicLink
      && entry.name.startsWith(options.prefix)
      && entry.name !== options.prefix
      && (options.now - entry.mtimeMs) >= options.ttlMs)
    .map((entry) => entry.name);
}

function dirSize(path) {
  let total = 0;
  let stat;
  try { stat = lstatSync(path); } catch { return 0; }
  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  let names = [];
  try { names = readdirSync(path); } catch { return 0; }
  for (const name of names) total += dirSize(join(path, name));
  return total;
}

/**
 * Remove stale managed temp dirs; returns a receipt. Best-effort.
 * A dir owned by a LIVE run (see isOwnedByLiveProcess) is never removed, no
 * matter how old its mtime is; the receipt reports `sparedLive` for them.
 */
export function cleanupManagedTempDirs(root, options) {
  const now = options.now ?? Date.now();
  let dirents = [];
  try { dirents = readdirSync(root, { withFileTypes: true }); } catch { return { root, prefix: options.prefix, ttlMs: options.ttlMs, removed: 0, removedBytes: 0, sparedLive: 0, scanned: 0 }; }
  const entries = dirents.map((dirent) => {
    const full = join(root, dirent.name);
    let mtimeMs = 0;
    try { mtimeMs = statSync(full).mtimeMs; } catch { /* ignore */ }
    return { name: dirent.name, mtimeMs, isDirectory: dirent.isDirectory(), isSymbolicLink: dirent.isSymbolicLink() };
  });
  const stale = selectStaleManagedDirs(entries, { prefix: options.prefix, ttlMs: options.ttlMs, now });
  let sparedLive = 0;
  const targets = [];
  for (const name of stale) {
    // Liveness beats TTL: an owner with a live pid means a run is still using it.
    if (isOwnedByLiveProcess(join(root, name))) { sparedLive += 1; continue; }
    targets.push(name);
  }
  let removedBytes = 0;
  let removed = 0;
  for (const name of targets) {
    const full = join(root, name);
    try {
      removedBytes += dirSize(full);
      rmSync(full, { recursive: true, force: true });
      removed += 1;
    } catch { /* best-effort */ }
  }
  return { root, prefix: options.prefix, ttlMs: options.ttlMs, removed, removedBytes, sparedLive, scanned: entries.length };
}

export function tempHeadroom(root) {
  const fs = statfsSync(root);
  return { freeBytes: fs.bavail * fs.bsize, freeInodes: fs.ffree };
}

// --- CLI: preflight + cleanup ------------------------------------------------

function arg(name, fallback) {
  const hit = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/**
 * A managed prefix is a plain name fragment: never empty, never a path, never a
 * traversal token. An unsafe prefix is refused so the CLI cannot widen its
 * deletion scope to every old directory under the root.
 */
export function isSafePrefix(prefix) {
  return typeof prefix === "string"
    && prefix.length > 0
    && !prefix.includes("/")
    && !prefix.includes("\\")
    && prefix !== "."
    && prefix !== ".."
    && /^[A-Za-z0-9._-]+$/.test(prefix);
}

if (process.argv[1] && process.argv[1].endsWith("tmp-hygiene.mjs")) {
  const root = arg("root", process.env["TMPDIR"] ?? "/tmp");
  const prefix = arg("prefix", "skald-");
  const ttlMs = Number(arg("ttl-minutes", "120")) * 60_000;
  const minFreeMb = Number(arg("min-free-mb", "200"));
  const minFreeInodes = Number(arg("min-free-inodes", "1000"));
  const minFreeBytes = minFreeMb * 1024 * 1024;

  if (!root.startsWith("/") || !isSafePrefix(prefix)) {
    console.log(JSON.stringify({ ok: false, error: "unsafe_root_or_prefix", root, prefix }));
    process.exit(1);
  }

  // Routine pass: managed dirs older than the TTL (safe with concurrent runs).
  // NO aggressive ttl:0 sweep here: a forced wipe can delete ANOTHER live
  // run's active dirs (TTL does not prove a dir is idle, but ttl:0 certainly
  // does not prove it is dead). If headroom is still too low, fail early and
  // loud — the operator frees space or scopes an explicit
  // `--ttl-minutes=0` pass to a root they own.
  const routine = cleanupManagedTempDirs(root, { prefix, ttlMs });
  let receipt = routine;
  const headroom = tempHeadroom(root);
  const ok = headroom.freeBytes >= minFreeBytes && headroom.freeInodes >= minFreeInodes;
  if (!ok) receipt = { ...receipt, ok: false, reason: "low_headroom" };
  console.log(JSON.stringify({ ok, root, prefix, receipt, headroom, minFreeBytes, minFreeInodes }));
  process.exit(ok ? 0 : 1);
}
