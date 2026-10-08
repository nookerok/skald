/**
 * Deploy receipt (operational-hygiene follow-up): verifies the REMOTE commit,
 * systemd services/timers and health over SSH, then writes an immutable JSON
 * receipt with its SHA-256. Exits non-zero when verification fails.
 *
 * Usage:
 *   EXPECTED_COMMIT=<sha> node scripts/deploy-receipt.mjs
 * Env: HOST (default nooker@192.168.0.5), KEY (default the Skald deploy key),
 *      OUT (default acceptance-out/deploy-receipt.json).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const HOST = process.env["HOST"] ?? "nooker@192.168.0.5";
const KEY = process.env["KEY"] ?? "/home/nook/.ssh/id_ed25519_skald";
const OUT = process.env["OUT"] ?? "acceptance-out/deploy-receipt.json";
const EXPECTED = process.env["EXPECTED_COMMIT"] ?? null;
const FORCE = process.argv.includes("--force");

function ssh(command) {
  return execFileSync("ssh", ["-o", "BatchMode=yes", "-i", KEY, HOST, command], { encoding: "utf8" }).trim();
}

const remoteHead = ssh("git -C /home/nooker/skald rev-parse HEAD");
const services = ssh("systemctl is-active skald.service skald-healthcheck.timer skald-backup.timer").split("\n");
const healthRaw = ssh("curl -fsS http://127.0.0.1:3000/api/health");
let health = null;
try { health = JSON.parse(healthRaw); } catch { /* keep null */ }

const serviceActive = services[0] === "active";
const timersActive = services[1] === "active" && services[2] === "active";
const healthOk = health?.status === "ok";
const commitVerified = EXPECTED === null
  ? "EXPECTED_NOT_PROVIDED"
  : (remoteHead === EXPECTED || remoteHead.startsWith(EXPECTED) ? "VERIFIED" : "MISMATCH");

const receipt = {
  schema: "DEPLOY_RECEIPT_V1",
  recordedAt: new Date().toISOString(),
  host: HOST,
  expectedCommit: EXPECTED,
  remoteHead,
  commitVerification: commitVerified,
  serviceActive,
  timersActive,
  healthOk,
  health,
  verified: serviceActive && timersActive && healthOk && commitVerified !== "MISMATCH",
};

const body = JSON.stringify(receipt, null, 2);
const sha256 = createHash("sha256").update(body).digest("hex");

if (existsSync(OUT) && !FORCE) {
  const existing = createHash("sha256").update(readFileSync(OUT, "utf8")).digest("hex");
  console.error(JSON.stringify({ ...receipt, sha256, error: "receipt already exists", existingSha256: existing }));
  process.exit(1);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, body);
writeFileSync(`${OUT}.sha256`, `${sha256}\n`);
console.log(JSON.stringify({ ...receipt, sha256, out: OUT }));
process.exit(receipt.verified ? 0 : 1);
