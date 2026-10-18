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
import { cleanupManagedTempDirs, isOwnedByLiveProcess, OWNER_MARKER } from "./tmp-hygiene.mjs";

/**
 * Teardown TTL: strictly larger than any full suite duration (validate runs
 * in minutes; the gate is minutes). Contract-tested — do not lower it below
 * 30 minutes without re-proving concurrent-run safety.
 */
export const VITEST_TEARDOWN_TTL_MS = 60 * 60 * 1000;

/** Prefix of the private temp root a bare `npm test` run owns. */
export const VITEST_RUN_PREFIX = "skald-vitest-run-";

export default function globalSetup(): () => void {
  // OWNERSHIP by MARKER, never by path shape: a custom/shared TMPDIR
  // (`/var/tmp`, `/tmp/ci-job`, ...) is NOT private just because it is not
  // `/tmp`. Only an `.owner` marker naming a LIVE pid proves the directory is
  // a run's own root (validate.sh exports `skald-validate-run-*`, and a nested
  // vitest reuses it). Otherwise this run creates its own root INSIDE the
  // inherited TMPDIR and marks it, so concurrent sweeps spare it by liveness.
  const envTmp = process.env["TMPDIR"];
  const inherited = typeof envTmp === "string" && envTmp.length > 0 ? envTmp : tmpdir();
  const ownedByLiveRun = isOwnedByLiveProcess(inherited);
  // No `XXXXXX` template: mkdtemp appends the random part itself.
  const runRoot = ownedByLiveRun ? null : mkdtempSync(join(inherited, VITEST_RUN_PREFIX));
  if (runRoot) {
    process.env["TMPDIR"] = runRoot;
    writeFileSync(join(runRoot, OWNER_MARKER), `pid=${process.pid}\n`);
  }

  return () => {
    // Sweep the INHERITED temp root (captured BEFORE TMPDIR was reassigned),
    // not tmpdir(): after setup TMPDIR is this run's private root, so sweeping
    // tmpdir() would only ever look inside it and stale scratch dirs left in a
    // shared base (`/tmp`, `/var/tmp`, a CI job dir) would never be reclaimed.
    // TTL + liveness: live-owned and fresh siblings survive.
    const receipt = cleanupManagedTempDirs(inherited, { prefix: "skald-", ttlMs: VITEST_TEARDOWN_TTL_MS });
    console.error("[tmp-hygiene] teardown", JSON.stringify(receipt));
    // Remove ONLY this run's own root (it is marker-owned and already above).
    if (runRoot) rmSync(runRoot, { recursive: true, force: true });
  };
}
