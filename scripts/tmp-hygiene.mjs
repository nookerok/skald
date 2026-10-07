/**
 * Managed temporary-directory hygiene (operational-hygiene).
 *
 * Skald tests create scratch dirs under the OS temp root with a known prefix
 * (`skald-`). Repeated runs filled the tmpfs on the Orange Pi and broke a
 * deploy with ENOSPC. This module provides a SAFE, testable cleanup:
 *
 * - only DIRECT child directories whose name starts with the managed prefix;
 * - never symlinks (so it cannot escape the temp root);
 * - only entries older than a TTL;
 * - a headroom preflight (free bytes + free inodes) that fails early;
 * - a receipt with removed count/bytes and remaining headroom.
 *
 * It never touches the production DB or unrelated directories.
 */

import { readdirSync, statSync, rmSync, statfsSync, lstatSync } from "node:fs";
import { join } from "node:path";

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

/** Remove stale managed temp dirs; returns a receipt. Best-effort. */
export function cleanupManagedTempDirs(root, options) {
  const now = options.now ?? Date.now();
  let dirents = [];
  try { dirents = readdirSync(root, { withFileTypes: true }); } catch { return { root, prefix: options.prefix, ttlMs: options.ttlMs, removed: 0, removedBytes: 0, scanned: 0 }; }
  const entries = dirents.map((dirent) => {
    const full = join(root, dirent.name);
    let mtimeMs = 0;
    try { mtimeMs = statSync(full).mtimeMs; } catch { /* ignore */ }
    return { name: dirent.name, mtimeMs, isDirectory: dirent.isDirectory(), isSymbolicLink: dirent.isSymbolicLink() };
  });
  const targets = selectStaleManagedDirs(entries, { prefix: options.prefix, ttlMs: options.ttlMs, now });
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
  return { root, prefix: options.prefix, ttlMs: options.ttlMs, removed, removedBytes, scanned: entries.length };
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

if (process.argv[1] && process.argv[1].endsWith("tmp-hygiene.mjs")) {
  const root = arg("root", process.env["TMPDIR"] ?? "/tmp");
  const prefix = arg("prefix", "skald-");
  const ttlMs = Number(arg("ttl-minutes", "120")) * 60_000;
  const minFreeMb = Number(arg("min-free-mb", "200"));
  const minFreeInodes = Number(arg("min-free-inodes", "1000"));
  const minFreeBytes = minFreeMb * 1024 * 1024;

  let headroom = tempHeadroom(root);
  let receipt = null;
  // Routine pass: drop managed dirs older than the TTL (safe with concurrent
  // runs). If headroom is still too low, aggressively drop ALL managed dirs
  // (still prefix-scoped, never symlinks/foreign) so a full tmpfs recovers.
  const routine = cleanupManagedTempDirs(root, { prefix, ttlMs });
  if (routine.removed > 0) receipt = routine;
  headroom = tempHeadroom(root);
  if (headroom.freeBytes < minFreeBytes || headroom.freeInodes < minFreeInodes) {
    const aggressive = cleanupManagedTempDirs(root, { prefix, ttlMs: 0 });
    receipt = { ...aggressive, removed: aggressive.removed + (receipt?.removed ?? 0) };
    headroom = tempHeadroom(root);
  }
  const ok = headroom.freeBytes >= minFreeBytes && headroom.freeInodes >= minFreeInodes;
  console.log(JSON.stringify({ ok, root, prefix, receipt, headroom, minFreeBytes, minFreeInodes }));
  process.exit(ok ? 0 : 1);
}
