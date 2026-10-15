/**
 * Managed temp hygiene tests (operational-hygiene): only managed, real
 * directories older than the TTL are removed; foreign dirs and symlinks are
 * never touched.
 */

import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
// @ts-ignore - plain Node ESM module without type declarations
import { cleanupManagedTempDirs, isSafePrefix, selectStaleManagedDirs, tempHeadroom } from "../../../scripts/tmp-hygiene.mjs";
import { VITEST_TEARDOWN_TTL_MS } from "../../../scripts/vitest-global-setup.js";

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

  it("a real vitest run sweeps AGED managed dirs but spares a fresh one (process level)", () => {
    const stamp = `${process.pid}-${Date.now()}`;
    const aged = join(tmpdir(), `skald-sentinel-aged-${stamp}`);
    const fresh = join(tmpdir(), `skald-sentinel-fresh-${stamp}`);
    mkdirSync(aged, { recursive: true });
    mkdirSync(fresh, { recursive: true });
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(aged, old, old);
    const res = spawnSync("npx", ["vitest", "run", "packages/events/test/events.test.ts", "--reporter=dot"], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(res.status).toBe(0);
    // AGED garbage from crashed runs is swept…
    expect(existsSync(aged)).toBe(false);
    // …but a FRESH dir can belong to a CONCURRENT vitest instance and must
    // survive — deleting it is how overlapping runs destroyed each other's
    // active SQLite files ("disk I/O error" flake).
    expect(existsSync(fresh)).toBe(true);
    rmSync(fresh, { recursive: true, force: true });
  }, 150_000);
});

describe("vitest teardown TTL (concurrent-run safety)", () => {
  it("is far larger than any suite duration and never sweeps fresh dirs", () => {
    // Contract: the teardown TTL must exceed a full suite by a wide margin;
    // lowering it below 30 minutes re-opens the cross-run destruction bug.
    expect(VITEST_TEARDOWN_TTL_MS).toBeGreaterThanOrEqual(30 * 60 * 1000);
    const root = mkdtempSync(join(tmpdir(), "hygiene-teardown-"));
    mkdirSync(join(root, "skald-active-run")); // another live instance's dir
    mkdirSync(join(root, "skald-dead-garbage"));
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(join(root, "skald-dead-garbage"), old, old);

    const receipt = cleanupManagedTempDirs(root, { prefix: "skald-", ttlMs: VITEST_TEARDOWN_TTL_MS });
    expect(existsSync(join(root, "skald-active-run"))).toBe(true);
    expect(existsSync(join(root, "skald-dead-garbage"))).toBe(false);
    expect(receipt.removed).toBe(1);
  });
});

describe("low headroom (no forced wipe)", () => {
  it("fails early instead of deleting fresh dirs when space is short", () => {
    const root = mkdtempSync(join(tmpdir(), "hygiene-headroom-"));
    mkdirSync(join(root, "skald-live-run")); // fresh: belongs to a live run
    // Impossible headroom request → the CLI must error WITHOUT wiping.
    const res = spawnSync(process.execPath, [
      "scripts/tmp-hygiene.mjs", `--root=${root}`, "--prefix=skald-",
      "--ttl-minutes=120", "--min-free-mb=999999999", "--min-free-inodes=0",
    ], { cwd: process.cwd(), encoding: "utf8" });

    expect(res.status).toBe(1);
    const body = JSON.parse(res.stdout);
    expect(body.ok).toBe(false);
    expect(body.receipt.reason).toBe("low_headroom");
    // The fresh dir survives: low space is an operator error, never a reason
    // to destroy another (or this) run's active state.
    expect(existsSync(join(root, "skald-live-run"))).toBe(true);
    // The routine TTL pass still removed nothing here (nothing was aged).
    expect(body.receipt.removed).toBe(0);
  });
});

describe("validate EXIT-trap ownership", () => {
  it("removes only this run's private TMPDIR root and spares a concurrent run's dir", () => {
    const base = mkdtempSync(join(tmpdir(), "hygiene-base-"));
    const foreign = join(base, "skald-other-run-active"); // another run's dir
    mkdirSync(foreign);
    writeFileSync(join(foreign, "events.sqlite"), "x".repeat(512));

    const res = spawnSync("bash", [
      "-c",
      `TMPDIR=${JSON.stringify(base)} bash -c 'source scripts/validate-tmp-root.sh; skald_validate_tmp_init; echo "root=$TMPDIR"; touch "$TMPDIR/mine"; exit 7'`,
    ], { cwd: process.cwd(), encoding: "utf8" });

    // Exit code is preserved (7), not masked by cleanup.
    expect(res.status).toBe(7);
    const ownedRoot = (res.stdout.match(/root=(.*)/) ?? [])[1];
    expect(ownedRoot).toBeTruthy();
    expect(String(ownedRoot).startsWith(base)).toBe(true);
    // The owned root is gone after exit…
    expect(existsSync(String(ownedRoot))).toBe(false);
    // …and the CONCURRENT run's fresh dir with a live DB is untouched.
    expect(existsSync(join(foreign, "events.sqlite"))).toBe(true);
    rmSync(base, { recursive: true, force: true });
  });
});
