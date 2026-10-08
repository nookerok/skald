/**
 * Managed temp hygiene tests (operational-hygiene): only managed, real
 * directories older than the TTL are removed; foreign dirs and symlinks are
 * never touched.
 */

import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
// @ts-ignore - plain Node ESM module without type declarations
import { cleanupManagedTempDirs, isSafePrefix, selectStaleManagedDirs, tempHeadroom } from "../../../scripts/tmp-hygiene.mjs";

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

describe("isSafePrefix", () => {
  it("accepts a plain fragment and refuses unsafe values", () => {
    expect(isSafePrefix("skald-")).toBe(true);
    expect(isSafePrefix("")).toBe(false);
    expect(isSafePrefix("..")).toBe(false);
    expect(isSafePrefix("a/b")).toBe(false);
    expect(isSafePrefix("a\\b")).toBe(false);
    expect(isSafePrefix("a b")).toBe(false);
  });
});

describe("tmp-hygiene CLI", () => {
  it("emits a stable receipt and refuses an unsafe prefix", () => {
    const root = mkdtempSync(join(tmpdir(), "hygiene-cli-"));
    mkdirSync(join(root, "skald-a"));
    writeFileSync(join(root, "skald-a", "x"), "x".repeat(100));
    mkdirSync(join(root, "skald-b"));
    writeFileSync(join(root, "skald-b", "x"), "x".repeat(200));
    mkdirSync(join(root, "foreign"));

    const run = (prefix: string) => spawnSync(process.execPath, [
      "scripts/tmp-hygiene.mjs", `--root=${root}`, `--prefix=${prefix}`,
      "--ttl-minutes=0", "--min-free-mb=0", "--min-free-inodes=0",
    ], { cwd: process.cwd(), encoding: "utf8" });

    const ok = run("skald-");
    const body = JSON.parse(ok.stdout);
    expect(body.ok).toBe(true);
    expect(body.receipt.removed).toBe(2);
    expect(body.receipt.removedBytes).toBeGreaterThanOrEqual(300);
    expect(existsSync(join(root, "foreign"))).toBe(true);

    const refused = run("");
    expect(JSON.parse(refused.stdout).ok).toBe(false);
    expect(refused.status).toBe(1);
  });

  it("a real vitest run removes managed scratch dirs (process level)", () => {
    const sentinel = join(tmpdir(), `skald-sentinel-${process.pid}-${Date.now()}`);
    mkdirSync(sentinel, { recursive: true });
    const res = spawnSync("npx", ["vitest", "run", "packages/events/test/events.test.ts", "--reporter=dot"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(res.status).toBe(0);
    expect(existsSync(sentinel)).toBe(false);
  }, 150_000);
});
