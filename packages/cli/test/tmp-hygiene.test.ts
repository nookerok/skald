/**
 * Managed temp hygiene tests (operational-hygiene): only managed, real
 * directories older than the TTL are removed; foreign dirs and symlinks are
 * never touched.
 */

import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// @ts-ignore - plain Node ESM module without type declarations
import { cleanupManagedTempDirs, selectStaleManagedDirs, tempHeadroom } from "../../../scripts/tmp-hygiene.mjs";

describe("selectStaleManagedDirs", () => {
  const now = 1_000_000;
  const ttlMs = 1000;
  const entries = [
    { name: "skald-stale", mtimeMs: now - 5000, isDirectory: true, isSymbolicLink: false },
    { name: "skald-fresh", mtimeMs: now - 10, isDirectory: true, isSymbolicLink: false },
    { name: "foreign", mtimeMs: now - 5000, isDirectory: true, isSymbolicLink: false },
    { name: "skald-link", mtimeMs: now - 5000, isDirectory: true, isSymbolicLink: true },
    { name: "skald-file", mtimeMs: now - 5000, isDirectory: false, isSymbolicLink: false },
  ];

  it("selects only managed, real, stale directories", () => {
    expect(selectStaleManagedDirs(entries, { prefix: "skald-", ttlMs, now })).toEqual(["skald-stale"]);
  });
});

describe("cleanupManagedTempDirs", () => {
  it("removes only stale managed dirs and never follows a symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "hygiene-root-"));
    mkdirSync(join(root, "skald-stale"));
    writeFileSync(join(root, "skald-stale", "data.txt"), "x".repeat(1000));
    mkdirSync(join(root, "skald-fresh"));
    mkdirSync(join(root, "foreign"));
    writeFileSync(join(root, "foreign", "keep.txt"), "keep");
    symlinkSync(join(root, "foreign"), join(root, "skald-link"));

    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    utimesSync(join(root, "skald-stale"), old, old);

    const receipt = cleanupManagedTempDirs(root, { prefix: "skald-", ttlMs: 60 * 60 * 1000 });
    expect(receipt.removed).toBe(1);
    expect(receipt.removedBytes).toBeGreaterThan(0);
    expect(existsSync(join(root, "skald-stale"))).toBe(false);
    expect(existsSync(join(root, "skald-fresh"))).toBe(true);
    expect(existsSync(join(root, "foreign", "keep.txt"))).toBe(true);
    // The symlink target is untouched and the link itself is not removed.
    expect(existsSync(join(root, "skald-link"))).toBe(true);
  });

  it("reports headroom for the temp root", () => {
    const headroom = tempHeadroom(tmpdir());
    expect(headroom.freeBytes).toBeGreaterThan(0);
    expect(typeof headroom.freeInodes).toBe("number");
  });
});
