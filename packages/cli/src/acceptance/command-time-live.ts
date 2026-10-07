/**
 * Reproducible command-time live acceptance runner (ADR-0039, T8.1).
 *
 * Runs the temporal/movement contract against a deployed server over HTTP on a
 * fresh SCRATCH world with STRICT per-step predicates: expected HTTP status,
 * response kind, numeric world time / event number, committed event types,
 * scene engagement, journey status, no internal identifiers, and replay/conflict
 * that do not change state. It prints a sanitized ledger (no internal ids).
 *
 * Commit/service verification is NOT performed here — the runner only echoes an
 * optional EXPECTED_COMMIT; SSH/systemd checks are separate by design.
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:3000 EXPECTED_COMMIT=<sha> \
 *     node --import tsx packages/cli/src/acceptance/command-time-live.ts
 */

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const EXPECTED_COMMIT = process.env.EXPECTED_COMMIT ?? null;
const RUN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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

const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

const health = await call("GET", "/api/health");
if (health.status !== 200) {
  console.log(JSON.stringify({ schema: "COMMAND_TIME_LIVE_V1", overall: "FAIL", reason: "health", health }, null, 2));
  process.exit(1);
}

const created = await call("POST", "/api/worlds", {
  characterName: "CTLive", backgroundId: "wanderer", entrypointId: "river_waystation_arrival",
}, { "idempotency-key": `ct-live-create-${RUN}` });
const worldId: string | undefined = created.body?.world?.worldId ?? created.body?.worldId;
if (!worldId) {
  console.log(JSON.stringify({ schema: "COMMAND_TIME_LIVE_V1", overall: "FAIL", reason: "create" }, null, 2));
  process.exit(1);
}

const scoped = async () => {
  const r = await call("GET", `/api/worlds/${worldId}/state`);
  return { worldTime: r.body?.state?.worldTime, eventNumber: r.body?.state?.eventNumber };
};
const eventsSince = async (offset: number): Promise<string[]> => {
  const r = await call("GET", `/api/worlds/${worldId}/events?offset=${offset}&limit=100`);
  if (r.status !== 200) { fail(`/events http ${r.status} at offset ${offset}`); return []; }
  if (typeof r.body?.count !== "number" || !Array.isArray(r.body?.events)) { fail("/events malformed"); return []; }
  return (r.body.events as any[]).map((e) => e.type as string);
};

interface Ledger {
  input: string; httpStatus: number; kind: string;
  worldTimeBefore: number; worldTimeAfter: number; eventDelta: number;
  eventTypes: string[]; sceneEngagement: string | null; journey: string | null; replayed: boolean;
}
const ledger: Ledger[] = [];

const step = async (input: string, key: string) => {
  const before = await scoped();
  if (typeof before.worldTime !== "number" || typeof before.eventNumber !== "number") fail(`non-numeric state before ${input}`);
  const res = await call("POST", `/api/worlds/${worldId}/command`, { input, idempotencyKey: `${key}-${RUN}` });
  const after = await scoped();
  const types = await eventsSince(before.eventNumber ?? 0);
  const engagement = res.body?.shellDelta?.sceneEngagement;
  const entry: Ledger = {
    input, httpStatus: res.status, kind: res.body?.status ?? "exec",
    worldTimeBefore: before.worldTime ?? -1, worldTimeAfter: after.worldTime ?? -1,
    eventDelta: (after.eventNumber ?? 0) - (before.eventNumber ?? 0),
    eventTypes: types,
    sceneEngagement: engagement ? `${engagement.state}:${engagement.label}` : null,
    journey: res.body?.shellDelta?.journey?.status ?? null,
    replayed: res.body?.replayed === true,
  };
  ledger.push(entry);
  if (res.status !== 200) fail(`http ${res.status} for ${input}`);
  if (typeof after.worldTime !== "number" || typeof after.eventNumber !== "number") fail(`non-numeric state after ${input}`);
  const dump = JSON.stringify(res.body ?? {});
  if (/targetRef|establishedAt|contactRef|internalId|locationId|person_|object_|route_/.test(dump)) fail(`internal id leaked for ${input}`);
  return { ...entry, res };
};

const q = await step("Где я?", "l1");
if (q.kind !== "inquiry" || q.eventDelta !== 0 || q.worldTimeAfter !== q.worldTimeBefore) fail("inquiry not read-only");

const ap = await step("Подойти к перевозчику", "l2");
if (ap.kind !== "exec" || ap.worldTimeAfter !== ap.worldTimeBefore + 1) fail("approach time");
if (!ap.sceneEngagement?.startsWith("near:")) fail("approach not near");
if (!ap.eventTypes.includes("ActionResolved") || !ap.eventTypes.includes("TickPassed")) fail("approach missing ActionResolved/TickPassed");

const rep = await step("Подойти к перевозчику", "l3");
if (rep.worldTimeAfter !== rep.worldTimeBefore + 1 || !rep.sceneEngagement?.startsWith("near:")) fail("repeat approach");
if (!rep.eventTypes.includes("ActionResolved")) fail("repeat approach missing ActionResolved");

const js = await step("Иду к Речному Стражу", "l4");
if (js.worldTimeAfter !== js.worldTimeBefore + 1) fail("journey start time");
if (!js.eventTypes.includes("JourneyStarted")) fail("journey start missing JourneyStarted");
if (js.sceneEngagement !== null) fail("engagement not cleared by journey start");

const tr = await step("осматриваюсь", "l5");
if (tr.worldTimeAfter !== tr.worldTimeBefore || tr.eventDelta === 0) fail("in-travel not a refusal");
if (!tr.eventTypes.includes("ActionRejected")) fail("in-travel missing ActionRejected");

const it = await step("остановиться", "l6");
if (it.worldTimeAfter !== it.worldTimeBefore) fail("interrupt time");
if (!it.eventTypes.includes("JourneyInterrupted")) fail("interrupt missing JourneyInterrupted");

await step("Иду к Речному Стражу", "l7");
const ar = await step("ждать", "l8");
if (ar.worldTimeAfter !== ar.worldTimeBefore + 1) fail("arrival time");
if (ar.journey !== "completed") fail("arrival journey not completed");
if (!ar.eventTypes.includes("PlayerLocationChanged")) fail("arrival missing PlayerLocationChanged");

const ab = await step("Подойти к перевозчику", "l9");
if (ab.kind !== "action_rejection" || ab.eventDelta !== 0 || ab.worldTimeAfter !== ab.worldTimeBefore) fail("absent rejection");

const bl = await step("Иду в Неведомые земли", "l10");
if (!bl.eventTypes.includes("JourneyBlocked")) fail("blocked journey missing JourneyBlocked");
if (bl.worldTimeAfter !== bl.worldTimeBefore + 1) fail("blocked journey time");

const beforeReplay = await scoped();
const replay = await call("POST", `/api/worlds/${worldId}/command`, { input: "Подойти к перевозчику", idempotencyKey: `l2-${RUN}` });
const afterReplay = await scoped();
const replayEvents = await eventsSince(beforeReplay.eventNumber ?? 0);
if (replay.status !== 200 || replay.body?.replayed !== true) fail("replay not replayed");
if (afterReplay.worldTime !== beforeReplay.worldTime || afterReplay.eventNumber !== beforeReplay.eventNumber) fail("replay changed state");
if (replayEvents.length !== 0) fail("replay committed events");

const beforeConflict = await scoped();
const conflict = await call("POST", `/api/worlds/${worldId}/command`, { input: "ждать", idempotencyKey: `l2-${RUN}` });
const afterConflict = await scoped();
const conflictEvents = await eventsSince(beforeConflict.eventNumber ?? 0);
if (conflict.status !== 409) fail("conflict not 409");
if (afterConflict.worldTime !== beforeConflict.worldTime || afterConflict.eventNumber !== beforeConflict.eventNumber) fail("conflict changed state");
if (conflictEvents.length !== 0) fail("conflict committed events");

const finalHealth = await call("GET", "/api/health");
if (finalHealth.status !== 200) fail("final health");
const finalState = await call("GET", `/api/worlds/${worldId}/state`);
if (finalState.status !== 200) fail("scoped state");
if (typeof finalState.body?.state?.worldTime !== "number" || typeof finalState.body?.state?.eventNumber !== "number") fail("final state not numeric");

const report = {
  schema: "COMMAND_TIME_LIVE_V1",
  overall: failures.length === 0 ? "PASS" : "FAIL",
  baseUrl: BASE,
  scratchWorld: `<redacted:${worldId.slice(-8)}>`,
  expectedCommit: EXPECTED_COMMIT,
  commitVerification: "NOT_PERFORMED_BY_RUNNER",
  serviceVerification: "NOT_PERFORMED_BY_RUNNER",
  failures,
  ledger,
};
console.log(JSON.stringify(report, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
