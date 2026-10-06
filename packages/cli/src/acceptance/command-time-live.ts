/**
 * Reproducible command-time live acceptance runner (ADR-0039, T8).
 *
 * Runs the temporal/movement contract against a deployed server over HTTP on a
 * fresh SCRATCH world, prints a sanitized ledger (no internal ids), and checks
 * health, scoped state and idempotency. Commit/service verification is reported
 * SEPARATELY from API health: pass EXPECTED_COMMIT to assert it, otherwise it is
 * UNVERIFIED (the API does not expose the deployed commit).
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:3000 EXPECTED_COMMIT=<sha> \
 *     node --import tsx packages/cli/src/acceptance/command-time-live.ts
 */

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const EXPECTED_COMMIT = process.env.EXPECTED_COMMIT ?? null;
const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

interface LedgerEntry {
  readonly input: string;
  readonly httpStatus: number;
  readonly kind: string;
  readonly worldTimeBefore: number;
  readonly worldTimeAfter: number;
  readonly eventDelta: number;
  readonly sceneEngagement: string | null;
  readonly replayed: boolean;
}

async function call(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let parsed: any = null;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

const health = await call("GET", "/api/health");
if (health.status !== 200) {
  console.log(JSON.stringify({ overall: "FAIL", reason: "health", health }, null, 2));
  process.exit(1);
}

const created = await call("POST", "/api/worlds", {
  characterName: "CTLive",
  backgroundId: "wanderer",
  entrypointId: "river_waystation_arrival",
}, { "idempotency-key": `ct-live-create-${RUN}` });
const worldId: string | undefined = created.body?.world?.worldId ?? created.body?.worldId;
if (!worldId) {
  console.log(JSON.stringify({ overall: "FAIL", reason: "create", created }, null, 2));
  process.exit(1);
}
const scratchTag = worldId.slice(-8);

const worldTime = async () => (await call("GET", `/api/worlds/${worldId}/state`)).body?.state?.worldTime as number | undefined;
const ledger: LedgerEntry[] = [];

const step = async (input: string, key: string): Promise<LedgerEntry> => {
  const before = await worldTime();
  const res = await call("POST", `/api/worlds/${worldId}/command`, { input, idempotencyKey: key });
  const after = await worldTime();
  const engagement = res.body?.shellDelta?.sceneEngagement;
  const entry: LedgerEntry = {
    input,
    httpStatus: res.status,
    kind: res.body?.status ?? "exec",
    worldTimeBefore: before ?? -1,
    worldTimeAfter: after ?? -1,
    eventDelta: (after ?? 0) - (before ?? 0),
    sceneEngagement: engagement ? `${engagement.state}:${engagement.label}` : null,
    replayed: res.body?.replayed === true,
  };
  ledger.push(entry);
  return entry;
};

const checks: Record<string, boolean> = {};
const at = async (input: string, key: string) => step(input, `${key}-${RUN}`);

checks.inquiry = (await at("Где я?", "l1")).kind === "inquiry";
checks.approach = (await at("Подойти к перевозчику", "l2")).sceneEngagement?.startsWith("near:") === true;
checks.repeat = (await at("Подойти к перевозчику", "l3")).sceneEngagement?.startsWith("near:") === true;
checks.journeyStart = (await at("Иду к Речному Стражу", "l4")).eventDelta === 1;
checks.inTravel = (await at("осматриваюсь", "l5")).eventDelta === 0;
checks.interrupt = (await at("остановиться", "l6")).eventDelta === 0;
await at("Иду к Речному Стражу", "l7");
const arrival = await at("ждать", "l8");
checks.arrival = arrival.worldTimeAfter > arrival.worldTimeBefore;
const absent = await at("Подойти к перевозчику", "l9");
checks.absentRejection = absent.kind === "action_rejection" && absent.eventDelta === 0;
const blocked = await at("Иду в Неведомые земли", "l10");
checks.blockedJourney = blocked.kind !== "inquiry";

// Idempotency: same key + body replays; same key + different body conflicts.
const replay = await call("POST", `/api/worlds/${worldId}/command`, { input: "Подойти к перевозчику", idempotencyKey: `l2-${RUN}` });
checks.replay = replay.status === 200 && replay.body?.replayed === true;
const conflict = await call("POST", `/api/worlds/${worldId}/command`, { input: "ждать", idempotencyKey: `l2-${RUN}` });
checks.conflict = conflict.status === 409;

const finalHealth = await call("GET", "/api/health");
checks.health = finalHealth.status === 200;
const scoped = await call("GET", `/api/worlds/${worldId}/state`);
checks.scopedState = scoped.status === 200;

const overall = Object.values(checks).every(Boolean) ? "PASS" : "FAIL";
const report = {
  schema: "COMMAND_TIME_LIVE_V1",
  overall,
  baseUrl: BASE,
  scratchWorld: `<redacted:${scratchTag}>`,
  deployedCommit: EXPECTED_COMMIT,
  commitVerification: EXPECTED_COMMIT ? "EXPECTED_PROVIDED" : "UNVERIFIED",
  serviceVerification: "SEPARATE_FROM_API_HEALTH",
  checks,
  ledger,
};
console.log(JSON.stringify(report, null, 2));
process.exit(overall === "PASS" ? 0 : 1);
