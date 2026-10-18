/**
 * Vitest global setup. Two jobs:
 *   1. OWNERSHIP — a bare run owns a private temp root (exported TMPDIR +
 *      `.owner` marker with this pid), removed by the teardown alone.
 *   2. SWEEP — the returned teardown runs once, after all workers finish, so
 *      it cannot race THIS run's parallel tests; it removes TTL-stale managed
 *      dirs and SPARES any dir owned by a live process (marker liveness beats
 *      age). A TTL of 0 was never used here: it destroyed concurrent runs'
 *      active SQLite files.
 */

import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// @ts-ignore - plain Node ESM module without type declarations
import { cleanupManagedTempDirs } from "./tmp-hygiene.mjs";

/**
 * Teardown TTL: strictly larger than any full suite duration (validate runs
 * in minutes; the gate is minutes). Contract-tested — do not lower it below
 * 30 minutes without re-proving concurrent-run safety.
 */
export const VITEST_TEARDOWN_TTL_MS = 60 * 60 * 1000;

/** Prefix of the private temp root a bare `npm test` run owns. */
export const VITEST_RUN_PREFIX = "skald-vitest-run-";

export default function globalSetup(): () => void {
  // OWNERSHIP: a bare `npm test` (outside validate.sh) must ALSO own its temp
  // root, so its scratch dirs never sit in the shared base where another run's
  // sweep could reach them. Workers inherit this env; the root carries the
  // `.owner` marker, so any concurrent sweep spares it by LIVENESS, not age.
  // When TMPDIR is already a run-owned root (validate.sh exports
  // `skald-validate-run-*`), we keep it and only sweep TTL-scoped.
  const envTmp = process.env["TMPDIR"];
  const alreadyPrivate = typeof envTmp === "string" && envTmp.length > 0 && !/^\/tmp\/?$/.test(envTmp);
  const runRoot = alreadyPrivate ? null : mkdtempSync(join(tmpdir(), `${VITEST_RUN_PREFIX}XXXXXX`));
  if (runRoot) {
    process.env["TMPDIR"] = runRoot;
    writeFileSync(join(runRoot, ".owner"), `pid=${process.pid}\n`);
  }

  return () => {
    // Sweep the temp root by TTL — live-owned dirs are spared by marker.
    const receipt = cleanupManagedTempDirs(tmpdir(), { prefix: "skald-", ttlMs: VITEST_TEARDOWN_TTL_MS });
    console.error("[tmp-hygiene] teardown", JSON.stringify(receipt));
    // Remove ONLY this run's own root (it is marker-owned and already above).
    if (runRoot) rmSync(runRoot, { recursive: true, force: true });
  };
}
