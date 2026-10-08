/**
 * Scratch-world retention CLI (dry-run by default).
 *
 * Archives (soft) old scratch worlds that match an explicit saveLabel pattern,
 * protecting the primary world, succession targets and the most-recently-played
 * worlds. Pass --apply to actually archive; without it, it only reports.
 *
 * Usage:
 *   SKALD_DB_PATH=/home/nooker/skald-data/events.sqlite \
 *     node --import tsx packages/cli/src/admin/run-world-retention.ts --apply
 */

import { createMultiWorldStore } from "../persistence/sqlite-store.js";
import { planWorldRetention } from "./world-retention.js";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((entry) => entry.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const dbPath = arg("db", process.env["SKALD_DB_PATH"] ?? "/home/nooker/skald-data/events.sqlite");
const ttlDays = Number(arg("ttl-days", "7"));
const protectRecent = Number(arg("protect-recent", "3"));
const scratchRegex = arg("scratch-regex", "^(Smoke|CTLive|DC Live|T5Qa|T4|T7|T6|T3|QA|Test)");
const apply = process.argv.includes("--apply");

if (!Number.isFinite(ttlDays) || ttlDays < 0) throw new Error("--ttl-days must be a non-negative number");
if (!Number.isInteger(protectRecent) || protectRecent < 0) throw new Error("--protect-recent must be a non-negative integer");

const store = createMultiWorldStore(dbPath);
try {
  const worlds = store.listWorlds();
  const plan = planWorldRetention(worlds, {
    now: Date.now(),
    ttlMs: ttlDays * 24 * 60 * 60 * 1000,
    scratchPattern: new RegExp(scratchRegex, "i"),
    protectRecent,
  });
  if (apply) {
    for (const world of plan.archive) store.setWorldStatus(world.worldId, "archived");
  }
  console.log(JSON.stringify({
    schema: "WORLD_RETENTION_V1",
    applied: apply,
    dbPath,
    ttlDays,
    protectRecent,
    scratchRegex,
    totalWorlds: worlds.length,
    archiveCount: plan.archive.length,
    keepCount: plan.keep.length,
    archive: plan.archive.map((world) => ({ worldId: world.worldId, saveLabel: world.saveLabel })),
  }, null, 2));
} finally {
  store.close();
}
