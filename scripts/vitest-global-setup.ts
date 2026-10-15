/**
 * Vitest global setup: returns a teardown that removes managed temp scratch
 * dirs after the suite. Vitest 2 runs the returned function once, after all
 * workers finish, so it cannot race a parallel test.
 *
 * CONCURRENCY SAFETY: the sweep is TTL-scoped, never `ttlMs: 0`. Two
 * OVERLAPPING vitest instances used to destroy each other: the second
 * instance's teardown removed the first instance's ACTIVE SQLite dirs
 * (reproduced: full suite → `2 failed` persistence tests / transient
 * "disk I/O error" in `journey-continuation-http`, `observer-checkpoint`,
 * `command-time-integration`, `game-shell-http`, `presence-http`). A dir
 * younger than this TTL always belongs to a live run, so it must survive;
 * genuinely stale garbage from crashed runs is swept by the NEXT teardown
 * (once it ages past the TTL) or by the CLI preflight (120-minute routine
 * pass, aggressive pass only under low headroom — see scripts/tmp-hygiene.mjs).
 */

import { tmpdir } from "node:os";
// @ts-ignore - plain Node ESM module without type declarations
import { cleanupManagedTempDirs } from "./tmp-hygiene.mjs";

/**
 * Teardown TTL: strictly larger than any full suite duration (validate runs
 * in minutes; the gate is minutes). Contract-tested — do not lower it below
 * 30 minutes without re-proving concurrent-run safety.
 */
export const VITEST_TEARDOWN_TTL_MS = 60 * 60 * 1000;

export default function globalSetup(): () => void {
  return () => {
    const receipt = cleanupManagedTempDirs(tmpdir(), { prefix: "skald-", ttlMs: VITEST_TEARDOWN_TTL_MS });
    console.error("[tmp-hygiene] teardown", JSON.stringify(receipt));
  };
}
