/**
 * Live SINGLE-FLIGHT proof (S0): the REAL `handleWorldCommand` with the REAL
 * router (live discovery → actual Ollama Cloud), GM_DIRECTOR_SHADOW on, two
 * CONCURRENT identical requests in one process — where the follower is
 * guaranteed to reach the shadow path (an HTTP-level duplicate usually wins
 * the durable replay race instead, which proves idempotency, not sharing).
 *
 * Counts separately: interpret provider calls, decision rows and `shared`
 * rows (emitted ONLY when a request joined the in-flight call).
 *
 * Usage: SKALD_ENV_FILE=... node --import tsx \
 *   packages/cli/src/acceptance/gm-single-flight-live.ts [receiptPath]
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { buildBootstrapEvents } from "@skald/world";
import { createMultiWorldStore } from "../persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../http/world-handlers.js";
import { createLiveRouterConfiguration } from "../runtime/router-factory.js";
import { applyServiceEnv } from "./service-env.js";

const receiptPath = process.argv[2] ?? "/tmp/gm-shadow-live/receipt-v2.json";

// Shadow on + provider keys.
process.env["GM_DIRECTOR_SHADOW"] = "1";
const envFile = process.env["SKALD_ENV_FILE"];
if (envFile) {
  const applied = applyServiceEnv(process.env, readFileSync(envFile, "utf8"));
  if (!applied.ok) { console.error(JSON.stringify({ schema: "GM_SINGLE_FLIGHT_LIVE_RECEIPT_V2", verdict: "BLOCKED", reason: applied.reason })); process.exit(2); }
}

const configuration = await createLiveRouterConfiguration();
if (!configuration?.router) { console.error(JSON.stringify({ schema: "GM_SINGLE_FLIGHT_LIVE_RECEIPT_V2", verdict: "BLOCKED", reason: "no_router_configured" })); process.exit(2); }

const store = createMultiWorldStore(join(mkdtempSync(join(tmpdir(), "gm-sf-live-")), "events.sqlite"));
const worldId = "world-sf-live-proof";
store.createWorld({
  worldId,
  idempotencyKey: `create-${worldId}`,
  requestHash: `hash-${worldId}`,
  saveLabel: "Single flight live proof",
  characterName: "SFProof",
  characterPresetId: "wanderer",
  worldTemplateId: "living_region",
  characterWound: "none",
  characterPromise: "observe",
  characterPrinciple: "care",
  characterProfileVersion: 1,
  bootstrapEvents: buildBootstrapEvents("living_region"),
});
// Explicit interpret-call counter: a Proxy around the REAL router counts
// every `interpret` chat call. Never inferred from diagnostic rows.
let interpretChatCalls = 0;
const baseRouter = configuration.router;
const countingRouter = new Proxy(baseRouter, {
  get(target, prop, receiver) {
    if (prop === "chat") {
      return (category: string, messages: unknown, options: unknown) => {
        if (category === "interpret") interpretChatCalls += 1;
        return (target.chat as (c: string, m: unknown, o: unknown) => unknown)(category, messages, options);
      };
    }
    const value = Reflect.get(target, prop, receiver);
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
  },
});

const manager = new WorldRuntimeManager(store, countingRouter);
const runtime = await manager.get(worldId);

const gmRows = () => manager.narrationDiagnostics().filter((e: any) => e.category === "gm_director") as any[];
const decisions = () => gmRows().filter((r) => r.outcome !== "shared");
const shared = () => gmRows().filter((r) => r.outcome === "shared");

// Two CONCURRENT identical requests: the follower enters the handler in the
// same tick and reaches the shadow path before the durable duplicate window.
const [a, b] = await Promise.all([
  handleWorldCommand(runtime, { input: "Где я?", idempotencyKey: "sf-live-proof" }),
  handleWorldCommand(runtime, { input: "Где я?", idempotencyKey: "sf-live-proof" }),
]);
const parse = (r: { statusCode: number; body: string }) => JSON.parse(r.body);
const ra = parse(a);
const rb = parse(b);

// Wait for the shadow (real provider round-trip) to settle.
const deadline = Date.now() + 20000;
while (Date.now() < deadline && (decisions().length < 1 || shared().length < 1)) {
  await new Promise((resolve) => setTimeout(resolve, 100));
}
await new Promise((resolve) => setTimeout(resolve, 300));

const dec = decisions();
const sh = shared();
const rowsSha = createHash("sha256").update(JSON.stringify(gmRows())).digest("hex");

// Commit provenance: actualCommit is ALWAYS computed from git; the env value
// is only an expectation compared against it, never a substitute.
const actualCommit = execSync("git rev-parse HEAD", { cwd: process.cwd() }).toString().trim();
const expectedCommit = process.env["EXPECTED_COMMIT"] ?? null;
const commitMatches = expectedCommit === null || expectedCommit === actualCommit;

const statusesOk = a.statusCode === 200 && b.statusCode === 200;
const neitherReplayed = (ra.replayed ?? false) === false && (rb.replayed ?? false) === false;
const ok = statusesOk && neitherReplayed && commitMatches
  && dec.length === 1 && sh.length === 1 && interpretChatCalls === 1
  && dec[0].provider === "ollama_cloud" && String(dec[0].decisionAccepted) === "true";

const receipt = {
  schema: "GM_SINGLE_FLIGHT_LIVE_RECEIPT_V3",
  recordedAt: new Date().toISOString(),
  actualCommit,
  expectedCommit,
  commitMatches,
  mode: "in-process-concurrent with REAL provider (live discovery)",
  httpLayerNote: "Over HTTP a duplicate usually wins the durable replay race (12/12 bursts replayed in the parallel probe); replay proves idempotency only. This receipt proves SHARING: both requests reached the shadow path in one process.",
  environment: { envFile: envFile ?? null, providerSelection: configuration.selectionReport?.routes ? "live" : "unknown" },
  request: { worldId, input: "Где я?", idempotencyKey: "sf-live-proof", parallel: 2, httpStatus: [a.statusCode, b.statusCode], replayedFlags: [ra.replayed ?? false, rb.replayed ?? false] },
  guards: { statusesOk, neitherReplayed, commitMatches, oneDecision: dec.length === 1, oneShared: sh.length === 1, oneInterpretCall: interpretChatCalls === 1 },
  evidence: {
    interpretProviderCalls: interpretChatCalls,
    interpretCallsSource: "explicit Proxy counter around the real router.chat",
    leaderDecisionRows: dec.length,
    sharedRows: sh.length,
    decisionOutcome: dec[0]?.outcome ?? null,
    decisionProvider: dec[0]?.provider ?? null,
    decisionModel: dec[0]?.model ?? null,
    decisionLatencyMs: dec[0]?.providerLatencyMs ?? null,
    diagnosticRowsSha256: rowsSha,
  },
  decisionRow: dec[0] ?? null,
  sharedRow: sh[0] ?? null,
  expectation: { decisionRows: 1, sharedRows: 1, interpretProviderCalls: 1 },
  verdict: ok ? "PASS" : "FAIL",
};

if (existsSync(receiptPath)) { console.error(JSON.stringify({ verdict: "BLOCKED", reason: "receipt_exists", receiptPath })); process.exit(1); }
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ verdict: receipt.verdict, interpretCalls: interpretChatCalls, decisions: dec.length, shared: sh.length, provider: dec[0]?.provider, latency: dec[0]?.providerLatencyMs, receiptPath }));
process.exit(receipt.verdict === "PASS" ? 0 : 1);
