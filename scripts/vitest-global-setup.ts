/**
 * Vitest global setup: returns a teardown that removes managed temp scratch
 * dirs after the suite. Vitest 2 runs the returned function once, after all
 * workers finish, so it cannot race a parallel test.
 */

import { tmpdir } from "node:os";
// @ts-ignore - plain Node ESM module without type declarations
import { cleanupManagedTempDirs } from "./tmp-hygiene.mjs";

export default function globalSetup(): () => void {
  return () => {
    const receipt = cleanupManagedTempDirs(tmpdir(), { prefix: "skald-", ttlMs: 0 });
    console.error("[tmp-hygiene] teardown", JSON.stringify(receipt));
  };
}
