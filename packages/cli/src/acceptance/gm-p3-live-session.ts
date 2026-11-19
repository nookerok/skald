/**
 * Isolated 22-turn Conversation Director P3 session.
 *
 * Runs the real loopback HTTP command path and explicitly pinned OpenCode Server route
 * in a disposable SQLite world. Includes a persisted QuestionPlan, server reload, replay, refusal,
 * correction, supported mixed action/question, an addressed multi-part NPC question
 * (questionPlan fragments + per-part fact/gap composition), and injected provider failure.
 * No production database or service is opened.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createTcpServer } from "node:net";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  buildMasterTurnSceneContext, buildNarrativeAdapterContext, executeQuestionReadingRound, getRegionEntrypoint,
  type AllowedNarrativeFacts,
} from "@skald/world";
import { actionOutcomeText } from "../conversation/builder.js";
import { startServer, type StartedServer } from "../http-server.js";
import { createRouterConfiguration } from "../runtime/router-factory.js";
import { WorldRuntimeManager } from "../runtime/world-runtime-manager.js";
import { extractJsonObject, gmDirectorLiveTimeoutMs } from "../runtime/conversation-director.js";
import {
  OPENCODE_SERVER_ALLOW_PAID_FALLBACK_ENV,
  OPENCODE_SERVER_ALLOW_PAID_PRIMARY_ENV,
  OPENCODE_SERVER_ENABLE_ENV,
  OPENCODE_SERVER_FALLBACK_MODEL_ENV,
  OPENCODE_SERVER_MAX_CONTEXT_TOKENS,
  OPENCODE_SERVER_MAX_MESSAGE_BYTES,
  OPENCODE_SERVER_MAX_OUTPUT_TOKENS,
  OPENCODE_SERVER_MODEL_ENV,
  OPENCODE_SERVER_PORT_ENV,
  OPENCODE_SERVER_PROVIDER_ID,
  OPENCODE_SERVER_STATE_DIR_ENV,
} from "../runtime/opencode-server-provider.js";
import { createOpenCodeGenerationBudget, openCodeRequestDelta } from "./opencode-live-budget.js";
import { readOpenCodePaidBudgetLedger, reserveOpenCodePaidBudget } from "./opencode-paid-budget-ledger.js";
import {
  extractP3PlayerVisibleResponse,
  evaluateP3LiveModelGate,
  evaluateP3ModelBackedTurnProbe,
  p3PaidPrimaryPermissionFlag,
  summarizeP3LiveRunnerFailure,
  P3_RUINS_INSPECTION_REPLICA,
  P3_RUINS_LOCATION,
  readP3RuinsQuestionSpec,
  verifyP3RuinsNarration,
  verifyP3RuinsPerception,
  verifyP3RuinsQuestionReading,
} from "./gm-p3-live-gate.js";
import { applyServiceEnv } from "./service-env.js";
import { createP3TransportTrace } from "./gm-p3-transport-trace.js";

const schema = "GM_DIRECTOR_P3_LIVE_SESSION_V20";
const dbValue = process.env["SKALD_P3_DB_PATH"] ?? "";
const dbPath = resolve(dbValue);
const scratchDir = dirname(dbPath);
const reportPath = resolve(process.env["OUT"] ?? (scratchDir + "/session-report.json"));
const p3Mode = process.env["SKALD_P3_MODE"] ?? "full";
const singleModelBackedTurnProbe = p3Mode === "single-interpret-probe";
// The 22-turn script observed 18 category calls in the preceding live trace.
// Allow a small retry-free buffer for the complete session; the independent
// worst-case USD reservation cap remains the hard spend ceiling.
const maxGenerationRequests = singleModelBackedTurnProbe ? 1 : 25;
// The single request must also fit a one-cent reservation at current catalogue prices.
const singleProbeReservationCapUsd = 0.01;
// 25 pinned GLM calls at the observed token ceilings reserve ~$0.127.
// The full scene also has an independent ceiling if catalogue prices change.
const fullSceneReservationCapUsd = 0.13;
const narrationSettleTimeoutMs = 20_000;
const narrationPollIntervalMs = 100;
const paidBudgetLedgerPath = resolve("docs/acceptance/opencode-paid-budget-2026-11-14.json");

function findFreeLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createTcpServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        rejectPort(new Error("could not allocate loopback port"));
        return;
      }
      const port = address.port;
      server.close((error) => error ? rejectPort(error) : resolvePort(port));
    });
  });
}

function blocked(reason: string): never {
  console.error(JSON.stringify({ schema, verdict: "BLOCKED", reason }));
  process.exit(2);
}

if (p3Mode !== "full" && !singleModelBackedTurnProbe) blocked("p3_mode_invalid");

let paidBudgetBefore: ReturnType<typeof readOpenCodePaidBudgetLedger>;
let activeRunStage = "configuration";
let worldCreated = false;
let completedTurns = 0;
let partialLedger: Record<string, any>[] = [];
try {
  paidBudgetBefore = readOpenCodePaidBudgetLedger(paidBudgetLedgerPath);
} catch {
  blocked("paid_budget_ledger_missing_or_invalid");
}
const paidRunId = process.env["SKALD_P3_RUN_ID"] ?? randomUUID();
if (!/^[A-Za-z0-9_-]{1,80}$/u.test(paidRunId)) blocked("paid_run_id_invalid");

if (!isAbsolute(dbValue) || !scratchDir.startsWith("/home/nooker/skald-data/codex-gm-p3-session-")) {
  blocked("scratch_db_path_must_be_under_codex_p3_session_root");
}
if (!existsSync(scratchDir)) blocked("scratch_root_missing");
const reportRelative = relative(scratchDir, reportPath);
if (reportRelative.startsWith("..") || isAbsolute(reportRelative)) blocked("report_path_outside_scratch_root");
if (existsSync(dbPath) || existsSync(dbPath + "-wal") || existsSync(dbPath + "-shm")) blocked("scratch_database_exists");
if (existsSync(reportPath)) blocked("report_exists");

const envFile = process.env["SKALD_ENV_FILE"];
if (!envFile) blocked("service_env_file_required");
let envText: string;
try { envText = readFileSync(envFile, "utf8"); }
catch { blocked("service_env_file_unreadable"); }
if (!applyServiceEnv(process.env, envText!).ok) blocked("service_env_invalid");
const productionServerEnabled = process.env[OPENCODE_SERVER_ENABLE_ENV] === "1";
const productionModel = process.env[OPENCODE_SERVER_MODEL_ENV] ?? null;
const acceptanceModel = process.env["SKALD_P3_MODEL"] ?? productionModel;
if (!acceptanceModel) blocked("acceptance_model_pin_missing");
// The service env is not consent for a paid acceptance call. Require a
// per-run opt-in even if the production environment already allows paid use.
process.env[OPENCODE_SERVER_ALLOW_PAID_PRIMARY_ENV] = p3PaidPrimaryPermissionFlag(
  process.env["SKALD_P3_ALLOW_PAID"],
);
process.env[OPENCODE_SERVER_ENABLE_ENV] = "1";
process.env[OPENCODE_SERVER_MODEL_ENV] = acceptanceModel!;

// Keep the measurement on the exact production primary, but isolate all
// mutable OpenCode state and use one route only. This prevents live discovery,
// fallbacks, and the persistent OpenCode service from receiving the request.
const opencodeStateDir = resolve(scratchDir, "opencode-server-state");
if (existsSync(opencodeStateDir)) blocked("scratch_opencode_state_dir_exists");
const opencodePort = await findFreeLoopbackPort();
process.env[OPENCODE_SERVER_PORT_ENV] = String(opencodePort);
process.env[OPENCODE_SERVER_STATE_DIR_ENV] = opencodeStateDir;
delete process.env[OPENCODE_SERVER_FALLBACK_MODEL_ENV];
process.env[OPENCODE_SERVER_ALLOW_PAID_FALLBACK_ENV] = "0";

process.env["GM_DIRECTOR_LIVE"] = "1";
process.env["GM_DIRECTOR_SHADOW"] = "0";
process.env["SKALD_INTENT_LLM_MODE"] = "fallback";

const transportTrace = createP3TransportTrace();
const generationBudget = createOpenCodeGenerationBudget({
  baseUrl: "http://127.0.0.1:" + opencodePort,
  maxGenerationRequests,
  maxReservedCostUsd: Math.min(
    singleModelBackedTurnProbe ? singleProbeReservationCapUsd : fullSceneReservationCapUsd,
    paidBudgetBefore!.remainingUsd,
  ),
  maxInputTokens: OPENCODE_SERVER_MAX_CONTEXT_TOKENS,
  maxOutputTokens: OPENCODE_SERVER_MAX_OUTPUT_TOKENS,
  observeHttp: transportTrace.observeHttp,
  onReserve: (reservation) => reserveOpenCodePaidBudget(paidBudgetLedgerPath, paidRunId, reservation),
});
const originalFetch = globalThis.fetch;
globalThis.fetch = generationBudget.fetch;

const routerPreparation = (() => {
  try {
    return { configuration: createRouterConfiguration(), failure: null };
  } catch (error) {
    return { configuration: null, failure: summarizeP3LiveRunnerFailure(error) };
  }
})();
const { configuration } = routerPreparation;

let baseCommit = process.env["SKALD_P3_BASE_COMMIT"] ?? "";
let baseCommitSource: "git_rev_parse" | "operator_verified_remote" | "unavailable" = baseCommit
  ? "operator_verified_remote"
  : "unavailable";
if (!baseCommit) {
  try {
    baseCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    baseCommitSource = "git_rev_parse";
  } catch {
    baseCommit = "unavailable";
  }
}
const sourceFiles = [
  "package.json",
  "package-lock.json",
  "packages/cli/package.json",
  "packages/cli/src/acceptance/gm-p3-live-session.ts",
  "packages/cli/src/acceptance/gm-p3-transport-trace.ts",
  "packages/cli/src/acceptance/opencode-live-budget.ts",
  "packages/cli/src/acceptance/opencode-paid-budget-ledger.ts",
  "packages/cli/src/acceptance/gm-p3-live-gate.ts",
  "packages/cli/src/acceptance/gm-corpus.ts",
  "packages/cli/src/acceptance/gm-shadow-scorecard.ts",
  "packages/cli/src/conversation/gm-context.ts",
  "packages/cli/src/conversation/builder.ts",
  "packages/cli/src/conversation/gm-prompt.ts",
  "packages/cli/src/conversation/gm-scorecard.ts",
  "packages/cli/src/http-server.ts",
  "packages/cli/src/http/world-handlers.ts",
  "packages/cli/src/persistence/sqlite-store.ts",
  "packages/cli/src/runtime/conversation-director.ts",
  "packages/cli/src/runtime/master-turn-diagnostics.ts",
  "packages/cli/src/runtime/opencode-server-provider.ts",
  "packages/cli/src/runtime/router-factory.ts",
  "packages/cli/src/runtime/world-runtime-manager.ts",
  "packages/cli/src/conversation/focus-stack.ts",
  "packages/cli/src/runtime/master-turn-gateway.ts",
  "packages/cli/src/runtime/master-turn-validator.ts",
  "packages/cli/src/runtime/master-turn-prompt.ts",
  "packages/intent-parser/src/gm-contract.ts",
  "packages/intent-parser/src/index.ts",
  "packages/intent-parser/src/turn-proposal-validator.ts",
  "packages/intent-parser/src/inquiry.ts",
  "packages/intent-parser/src/deterministic-interpreter.ts",
  "packages/world/src/event-types.ts",
  "packages/world/src/llm/errors.ts",
  "packages/world/src/llm/data-policy.ts",
  "packages/world/src/llm/types.ts",
  "packages/world/src/narration-diagnostics.ts",
  "packages/world/src/narrative-llm.ts",
  "packages/world/src/allowed-narrative-facts.ts",
  "packages/world/src/index.ts",
  "packages/world/src/npc-dossier.ts",
  "packages/world/src/projection.ts",
  "packages/world/src/read-side/answer-plan.ts",
  "packages/world/src/read-side/question-readings.ts",
  "packages/world/src/read-side/question-round.ts",
  "packages/world/src/setup/background-context.ts",
  "packages/world/src/setup/bootstrap-builder.ts",
];
const sourceHashes = Object.fromEntries(sourceFiles.map((file) => [
  file, createHash("sha256").update(readFileSync(file)).digest("hex"),
]));
const sourceDigest = createHash("sha256").update(JSON.stringify(sourceHashes)).digest("hex");

const selection = configuration?.selectionReport;
let providerWarmup: {
  status: "not_applicable" | "passed" | "failed";
  failure?: ReturnType<typeof summarizeP3LiveRunnerFailure>;
  openCodeHttp?: ReturnType<typeof openCodeRequestDelta>;
} = {
  status: "not_applicable",
};
let routeCheck: {
  status: "not_run" | "passed" | "failed";
  reason?: string;
  failure?: ReturnType<typeof summarizeP3LiveRunnerFailure>;
} = { status: "not_run" };
const categoryCalls: Record<string, number> = {};
const categorySuccesses: Record<string, number> = {};
const interpretRoutes = configuration?.router?.routeCandidates("interpret") ?? [];
const narrateRoutes = configuration?.router?.routeCandidates("narrate") ?? [];
const providerSelection = {
  mode: "static production pin; live discovery not run",
  runMode: p3Mode,
  provider: OPENCODE_SERVER_PROVIDER_ID,
  primaryModel: process.env[OPENCODE_SERVER_MODEL_ENV] ?? null,
  productionConfig: { enabled: productionServerEnabled, primaryModel: productionModel },
  acceptanceModelOverride: acceptanceModel !== productionModel,
  expectedVersion: "2.3.0",
  paidPrimaryAllowed: process.env["SKALD_OPENCODE_SERVER_ALLOW_PAID_PRIMARY"] === "1",
  fallbackDisabledForAcceptance: true,
  serverEndpoint: "http://127.0.0.1:" + opencodePort,
  stateDirScope: "scratch-only",
  maxGenerationRequests,
  maxMessageBytes: OPENCODE_SERVER_MAX_MESSAGE_BYTES,
  interpretRoutes: interpretRoutes.map((candidate) => ({
    provider: candidate.provider, model: candidate.model, tier: candidate.tier,
  })) ?? [],
  interpretTimeoutMs: gmDirectorLiveTimeoutMs(),
  narrateRoutes: narrateRoutes.map((candidate) => ({
    provider: candidate.provider, model: candidate.model, tier: candidate.tier,
  })) ?? [],
  candidates: selection?.candidates.map((candidate) => ({
    model: candidate.model,
    active: candidate.active,
    interpret: {
      status: candidate.interpret.status,
      phase: candidate.interpret.phase,
      ...(candidate.interpret.httpStatus !== undefined ? { httpStatus: candidate.interpret.httpStatus } : {}),
      ...(candidate.interpret.providerCode && /^[A-Za-z0-9_.:-]{1,80}$/u.test(candidate.interpret.providerCode)
        ? { providerCode: candidate.interpret.providerCode }
        : {}),
    },
    narrate: {
      status: candidate.narrate.status,
      phase: candidate.narrate.phase,
      ...(candidate.narrate.httpStatus !== undefined ? { httpStatus: candidate.narrate.httpStatus } : {}),
      ...(candidate.narrate.providerCode && /^[A-Za-z0-9_.:-]{1,80}$/u.test(candidate.narrate.providerCode)
        ? { providerCode: candidate.narrate.providerCode }
        : {}),
    },
    ...(candidate.exclusionReason ? { exclusionReason: candidate.exclusionReason } : {}),
  })) ?? [],
  excluded: selection?.excluded ?? [],
};
function blockedLiveRun(reason: string): never {
  const report = {
    schema,
    verdict: "BLOCKED",
    mode: "live-provider preflight; no world or gameplay requests created",
    reason,
    baseCommit,
    baseCommitSource,
    sourceDigest,
    sourceHashes,
    paidBudgetBefore: paidBudgetBefore!,
    providerSelection,
    routeCheck,
    providerWarmup,
    transportTrace: transportTrace.snapshot(),
    generationBudget: generationBudget.snapshot(),
    world: { worldId: "not-created", initialWorldTime: 0, turnCount: 0 },
    checks: { liveInterpretRouteAvailable: false },
    failures: [],
    ledger: [],
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
  console.error(JSON.stringify({ schema, verdict: "BLOCKED", reason, providerSelection, reportPath }, null, 2));
  process.exit(2);
}
function blockedRoute(reason: string, failure?: ReturnType<typeof summarizeP3LiveRunnerFailure>): never {
  routeCheck = { status: "failed", reason, ...(failure ? { failure } : {}) };
  return blockedLiveRun(reason);
}
if (routerPreparation.failure) blockedRoute("router_configuration_failed", routerPreparation.failure);
if (!configuration?.router) blockedRoute("no_live_router_configured");
if (interpretRoutes.length !== 1
  || interpretRoutes[0]?.provider !== OPENCODE_SERVER_PROVIDER_ID
  || interpretRoutes[0]?.model !== process.env[OPENCODE_SERVER_MODEL_ENV]
  || narrateRoutes.length !== 1
  || narrateRoutes[0]?.provider !== OPENCODE_SERVER_PROVIDER_ID
  || narrateRoutes[0]?.model !== process.env[OPENCODE_SERVER_MODEL_ENV]) {
  blockedRoute("acceptance_requires_one_exact_opencode_server_model_for_interpret_and_narrate");
}
if (!configuration.prewarm) blockedRoute("opencode_server_prewarm_unavailable");
routeCheck = { status: "passed" };
activeRunStage = "provider_prewarm";
const beforeWarmup = generationBudget.snapshot();
try {
  await transportTrace.run("initial_prewarm", null, configuration.prewarm);
  providerWarmup = { status: "passed", openCodeHttp: openCodeRequestDelta(beforeWarmup, generationBudget.snapshot()) };
} catch (error) {
  providerWarmup = {
    status: "failed",
    failure: summarizeP3LiveRunnerFailure(error),
    openCodeHttp: openCodeRequestDelta(beforeWarmup, generationBudget.snapshot()),
  };
  try { await configuration.router.close(); } catch { /* preserve the sanitized prewarm failure */ }
  blockedLiveRun("opencode_server_prewarm_failed");
}
activeRunStage = "world_create";
type AcceptanceRouter = NonNullable<ReturnType<typeof createRouterConfiguration>["router"]>;
let baseRouter = configuration.router as AcceptanceRouter;
let injectProviderFailure = false;
let interpretCalls = 0;
// Keep only the ruins fixture's evidence in memory for independent checks.
// Raw replies, model handles and correlation IDs do not enter the report.
let ruinsDecision: unknown = null;
let ruinsNarration: { allowed: AllowedNarrativeFacts; text: string; correlationId: string } | null = null;
function instrumentRouter(target: AcceptanceRouter): AcceptanceRouter {
  return new Proxy(target, {
    get(proxyTarget, property, receiver) {
      if (property === "chat") return async (...args: unknown[]) => {
        const category = args[0] === "interpret" || args[0] === "narrate" || args[0] === "analyze" ? args[0] : null;
        const captureRuins = activeRunStage === "turn_ruins-inspection";
        const messageBytes = Array.isArray(args[1]) ? Buffer.byteLength(JSON.stringify(args[1]), "utf8") : undefined;
        if (category !== null) categoryCalls[category] = (categoryCalls[category] ?? 0) + 1;
        const result = await transportTrace.run("router_call", category, async () => {
          if (category === "interpret") {
            interpretCalls += 1;
            if (injectProviderFailure) throw new Error("acceptance-injected-provider-outage");
          }
          return Reflect.apply(proxyTarget.chat as (...values: unknown[]) => unknown, proxyTarget, args);
        }, messageBytes);
        const value = typeof result === "object" && result !== null ? result as Record<string, unknown> : {};
        if (category !== null && value["provider"] === OPENCODE_SERVER_PROVIDER_ID
          && value["usedFallback"] !== true) {
          categorySuccesses[category] = (categorySuccesses[category] ?? 0) + 1;
          if (captureRuins && value["model"] === acceptanceModel && typeof value["text"] === "string") {
            if (category === "interpret") ruinsDecision = extractJsonObject(value["text"]);
            if (category === "narrate" && Array.isArray(args[1])) {
              const options = args[2] as { readonly correlationId?: unknown } | undefined;
              const envelope = extractJsonObject(args[1][1]?.content ?? "") as { allowed?: AllowedNarrativeFacts } | null;
              if (envelope?.allowed?.question === P3_RUINS_INSPECTION_REPLICA && typeof options?.correlationId === "string") {
                ruinsNarration = { allowed: envelope.allowed, text: value["text"], correlationId: options.correlationId };
              }
            }
          }
        }
        return result;
      };
      const value = Reflect.get(proxyTarget, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(proxyTarget) : value;
    },
  }) as AcceptanceRouter;
}

let router = instrumentRouter(baseRouter);
let runningServer: StartedServer | undefined;
let scratchHttpBaseUrl: string | null = null;
let httpServerStarts = 0;
let httpServerRestarts = 0;
let httpCommandRequests = 0;
let httpJournalRequests = 0;
let worldCreateStatus: number | null = null;

async function requestSkald(path: string, init?: RequestInit): Promise<{ statusCode: number; body: string }> {
  if (!runningServer) throw new Error("scratch_http_server_not_running");
  const response = await originalFetch(runningServer.url + path, init);
  return { statusCode: response.status, body: await response.text() };
}

async function runGameplay(): Promise<number> {
let worldId = "";
let manager: WorldRuntimeManager;
let runtime: Awaited<ReturnType<WorldRuntimeManager["get"]>>;
activeRunStage = "create_scratch_world";
runningServer = await startServer({
  host: "127.0.0.1", port: 0, dbPath, router, discoverAI: false,
});
scratchHttpBaseUrl = runningServer.url;
httpServerStarts += 1;
const createKey = "gm-p3-create-" + randomUUID();
const createResult = await requestSkald("/api/worlds", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Idempotency-Key": createKey },
  body: JSON.stringify({
    characterName: "P3Session", backgroundId: "keeper", entrypointId: "riverwatch_city_arrival",
  }),
});
worldCreateStatus = createResult.statusCode;
worldCreated = createResult.statusCode === 201;
const createdWorld = JSON.parse(createResult.body);
if (createResult.statusCode !== 201 || typeof createdWorld?.world?.worldId !== "string") {
  throw new Error("scratch_world_http_creation_failed");
}
worldId = createdWorld.world.worldId;
activeRunStage = "open_world_runtime";
manager = runningServer.app.runtimes;
runtime = await manager.get(worldId);
const failures: string[] = [];
const ledger: Record<string, any>[] = [];
partialLedger = ledger;
const acceptanceScenarios: Array<{ id: string; input: string; readOnly?: boolean; advances?: boolean; reopen?: boolean; offline?: boolean }> = [
  { id: "question-plan-clarification", input: "Что на нём надето и как он себя ведёт?", readOnly: true },
  { id: "question-plan-answer", input: "Я имею в виду Архивиста", readOnly: true, reopen: true },
  { id: "people-list", input: "Кто рядом?", readOnly: true },
  { id: "role-identification", input: "Кто ведёт журнал проходов у ворот?", readOnly: true },
  { id: "npc-greeting", input: "Привет, смотритель", readOnly: true },
  { id: "npc-question", input: "Смотритель, что ты видел перед пожаром?", readOnly: true },
  { id: "npc-unsupported-detail", input: "Смотритель, кто последним ушёл по восточному тракту?", readOnly: true },
  { id: "unsupported-two-actions", input: "Оглянусь на городские ворота и прислушаюсь к торговому шуму.", readOnly: true },
  { id: "single-action", input: "Подойду к смотрителю", advances: true },
  { id: "repeat-action", input: "Подойду к смотрителю ещё раз", advances: true },
  // The city bootstrap does not guarantee a visible object named "двор".
  // An ambient observation still proves the supported action+question subset
  // without making acceptance depend on an authored target being present.
  { id: "safe-mixed", input: "Осматриваюсь, что я вижу?", advances: true },
  { id: "withdraw", input: "Отхожу от смотрителя", advances: true },
  { id: "change-decision", input: "Нет, передумал: осматриваюсь.", advances: true },
  { id: "absent-refusal", input: "Подойти к перевозчику", readOnly: true },
  { id: "conversation", input: "Хочу поговорить с ним", readOnly: true },
  { id: "thanks", input: "Спасибо", readOnly: true },
  { id: "focused-question", input: "Как выглядит Архивист?", readOnly: true },
  { id: "people-list-again", input: "Кто ещё рядом?", readOnly: true },
  { id: "npc-topic", input: "Смотритель, расскажи о дороге к воротам.", readOnly: true },
  { id: "npc-multipart-question", input: "Смотритель, расскажите про журнал проходов у ворот и кто ещё дежурит с вами?", readOnly: true },
  { id: "provider-unavailable", input: "Привет, смотритель", readOnly: true, offline: true },
  { id: "post-outage-question", input: "Кто сейчас рядом?", readOnly: true },
  { id: "open-question", input: "Что известно о ночном шуме?", readOnly: true },
];
const modelBackedProbeScenario = acceptanceScenarios.find((scenario) => scenario.id === "npc-greeting");
if (singleModelBackedTurnProbe && !modelBackedProbeScenario) blocked("model_backed_probe_scenario_missing");
const session = singleModelBackedTurnProbe ? [modelBackedProbeScenario!] : acceptanceScenarios;
let ruinsReached = false;
let ruinsInspectionBody: any = null;
let ruinsEvidence = {
  exactPerception: false, acceptedPinnedMixedDecision: false, anchoredQuestion: false,
  groundedSameTurnNarration: false,
};

function time(): number { return runtime.projection.getSnapshot().time; }
function eventCount(): number { return runtime.bus.query().length; }
async function postWorldCommand(input: string, idempotencyKey: string): Promise<{ statusCode: number; body: string }> {
  httpCommandRequests += 1;
  return requestSkald("/api/worlds/" + encodeURIComponent(worldId) + "/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input, idempotencyKey }),
  });
}
async function awaitPlayerFacingResponse(body: any, worldTimeAfter: number) {
  const initial = extractP3PlayerVisibleResponse(body);
  // Conversation turn keys and event journal turn keys are from different
  // namespaces. Match the renderer's shared opaque narration handle.
  const narrationHandle = typeof body?.conversationTurn?.narrationHandle === "string"
    ? body.conversationTurn.narrationHandle : "";
  const inputClass = body?.conversationTurn?.inputClass;
  if (body?.masterTurn?.narration?.status !== "pending" || !narrationHandle
    || !["action", "mixed", "speech"].includes(inputClass)) return initial;

  const deadline = Date.now() + narrationSettleTimeoutMs;
  while (Date.now() < deadline) {
    httpJournalRequests += 1;
    const journalResponse = await requestSkald("/api/worlds/" + encodeURIComponent(worldId) + "/journal?limit=50");
    if (journalResponse.statusCode === 200) {
      const journal = JSON.parse(journalResponse.body);
      const journalTurn = Array.isArray(journal.turns)
        ? journal.turns.find((turn: any) => turn.narrationHandle === narrationHandle && turn.worldTime === worldTimeAfter)
        : undefined;
      if (journalTurn) {
        const response = extractP3PlayerVisibleResponse({ ...body, journalTurn });
        if (response.narrationText || ["ready", "unavailable", "not_requested"].includes(journalTurn.narrationState)) return response;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, narrationPollIntervalMs));
  }
  return initial;
}
async function reopen(): Promise<void> {
  activeRunStage = "reopen_sqlite_runtime";
  if (!runningServer) throw new Error("scratch_http_server_not_running_during_reload");
  await runningServer.close();
  runningServer = undefined;

  const nextConfiguration = createRouterConfiguration();
  if (!nextConfiguration.router || !nextConfiguration.prewarm) {
    throw new Error("opencode_router_unavailable_after_reload");
  }
  try {
    await transportTrace.run("reload_prewarm", null, nextConfiguration.prewarm);
  } catch (error) {
    try { await nextConfiguration.router.close(); } catch { /* preserve prewarm failure */ }
    throw error;
  }
  baseRouter = nextConfiguration.router as AcceptanceRouter;
  router = instrumentRouter(baseRouter);
  runningServer = await startServer({
    host: "127.0.0.1", port: 0, dbPath, router, discoverAI: false,
  });
  scratchHttpBaseUrl = runningServer.url;
  httpServerStarts += 1;
  httpServerRestarts += 1;
  manager = runningServer.app.runtimes;
  runtime = await manager.get(worldId);
}

function sanitizedNarrationDiagnosticsSince(startIndex: number): Record<string, unknown>[] {
  return manager.narrationDiagnostics().slice(startIndex)
    .filter((entry: any) => entry.kind === "llm" || entry.kind === "scheduler")
    .map((entry: any) => ({
      kind: entry.kind,
      category: entry.category,
      outcome: entry.outcome,
      provider: entry.provider,
      ...(typeof entry.model === "string" ? { model: entry.model } : {}),
      ...(typeof entry.configuredModel === "string" ? { configuredModel: entry.configuredModel } : {}),
      ...(typeof entry.phase === "string" ? { phase: entry.phase } : {}),
      ...(typeof entry.httpStatus === "number" ? { httpStatus: entry.httpStatus } : {}),
      ...(typeof entry.providerCode === "string" && /^[A-Za-z0-9_.:-]{1,80}$/u.test(entry.providerCode)
        ? { providerCode: entry.providerCode } : {}),
      ...(typeof entry.failureCategory === "string" && /^[A-Za-z0-9_.:-]{1,100}$/u.test(entry.failureCategory)
        ? { failureCategory: entry.failureCategory } : {}),
      ...(typeof entry.durationMs === "number" ? { durationMs: entry.durationMs } : {}),
      ...(typeof entry.attempt === "number" ? { attempt: entry.attempt } : {}),
      ...(typeof entry.timeoutMs === "number" ? { timeoutMs: entry.timeoutMs } : {}),
      ...(typeof entry.retryOutcome === "string" ? { retryOutcome: entry.retryOutcome } : {}),
    }));
}

function sanitizedDirectorDiagnostic(entry: any): Record<string, unknown> {
  const safeToken = (value: unknown, max = 128): string | null =>
    typeof value === "string" && value.length > 0 && value.length <= max && /^[A-Za-z0-9_.:-]+$/u.test(value)
      ? value : null;
  const status = (value: unknown): number | null =>
    typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
  const delay = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  const retryAfter = typeof entry.retryAfterHeaderRaw === "string"
    && entry.retryAfterHeaderRaw.length > 0 && entry.retryAfterHeaderRaw.length <= 128
    && /^[\x20-\x7e]+$/u.test(entry.retryAfterHeaderRaw)
    ? entry.retryAfterHeaderRaw : null;
  return {
    outcome: safeToken(entry.outcome, 32),
    provider: safeToken(entry.provider, 40),
    model: typeof entry.model === "string" ? entry.model.slice(0, 128) : null,
    failureCategory: safeToken(entry.failureCategory, 80),
    rawSchemaValid: typeof entry.rawSchemaValid === "boolean" ? entry.rawSchemaValid : null,
    schemaValid: typeof entry.schemaValid === "boolean" ? entry.schemaValid : null,
    decisionAccepted: typeof entry.decisionAccepted === "boolean" ? entry.decisionAccepted : null,
    decisionKind: safeToken(entry.decisionKind, 32),
    addresseeKind: safeToken(entry.addresseeKind, 32),
    validationErrors: typeof entry.validationErrors === "string" ? entry.validationErrors.slice(0, 240) : null,
    replyShape: typeof entry.replyShape === "string" ? entry.replyShape.slice(0, 160) : null,
    providerPhase: safeToken(entry.providerPhase, 32),
    httpStatus: status(entry.httpStatus),
    gatewayHttpStatus: status(entry.gatewayHttpStatus),
    providerCode: safeToken(entry.providerCode, 80),
    providerTraceId: safeToken(entry.providerTraceId, 128),
    retryAfterHeaderRaw: retryAfter,
    retryAfterMsParsed: delay(entry.retryAfterMsParsed),
    retryAfterMsApplied: entry.retryAfterMsApplied === null ? null : delay(entry.retryAfterMsApplied),
    providerRetryable: typeof entry.providerRetryable === "boolean" ? entry.providerRetryable : null,
    providerLatencyMs: delay(entry.providerLatencyMs),
    totalLatencyMs: delay(entry.totalLatencyMs),
  };
}

async function supplementalTurn(id: string, input: string): Promise<{ row: Record<string, any>; body: any }> {
  activeRunStage = "turn_" + id;
  const beforeTime = time();
  const beforeEvents = eventCount();
  const beforeCalls = interpretCalls;
  const beforeBudget = generationBudget.snapshot();
  const traceAfter = transportTrace.checkpoint();
  const beforeDiagnostics = manager.narrationDiagnostics().length;
  const beforeNarrations = categorySuccesses["narrate"] ?? 0;
  const key = "p3-extra-" + id;
  const result = await postWorldCommand(input, key);
  const body = JSON.parse(result.body);
  const afterTime = time();
  const playerResponse = await awaitPlayerFacingResponse(body, afterTime);
  const afterBudget = generationBudget.snapshot();
  const events = runtime.bus.query();
  const diagnosticDelta = manager.narrationDiagnostics().slice(beforeDiagnostics);
  const diagnostics = diagnosticDelta
    .filter((entry: any) => entry.category === "gm_director")
    .map(sanitizedDirectorDiagnostic);
  const narrationDiagnostics = sanitizedNarrationDiagnosticsSince(beforeDiagnostics);
  const questionReadings = Array.isArray(body.questionReadings?.results)
    ? body.questionReadings.results.map((reading: any) => ({
      partId: reading.request?.partId ?? null,
      aspect: reading.request?.aspect ?? (reading.request?.source === "known_events" ? "known_event" : null),
      source: reading.request?.source ?? null,
      status: reading.status ?? null, factCount: Array.isArray(reading.facts) ? reading.facts.length : 0,
      factTexts: Array.isArray(reading.facts)
        ? reading.facts.map((fact: any) => typeof fact.text === "string" ? fact.text : "").filter(Boolean) : [],
      gapStatuses: Array.isArray(reading.gaps) ? reading.gaps.map((gap: any) => gap.status ?? null) : [],
    })) : [];
  const inquiryAnswers = Array.isArray(body.inquiryAnswers)
    ? body.inquiryAnswers.map((answer: any) => ({ queryId: answer.queryId ?? null, answer: typeof answer.answer === "string" ? answer.answer : "" }))
    : body.inquiryAnswer ? [{ queryId: body.inquiryAnswer.queryId ?? null, answer: typeof body.inquiryAnswer.answer === "string" ? body.inquiryAnswer.answer : "" }]
      : [];
  const responseText = playerResponse.visibleText;
  const hasInternalLeak = /targetRef|establishedAt|contactRef|internalId|locationId|person_|object_|route_/iu.test(JSON.stringify(body));
  const row = {
    turn: ledger.length + 1, id, input, statusCode: result.statusCode,
    responseKind: body.conversationTurn?.responseKind ?? body.status ?? null,
    masterTurnKind: body.masterTurn?.kind ?? null,
    responseText,
    deterministicResponseText: playerResponse.deterministicText,
    deterministicResponseSource: playerResponse.deterministicSource,
    narrationText: playerResponse.narrationText,
    narrationState: playerResponse.narrationState,
    questionReadings, inquiryAnswers,
    worldTimeBefore: beforeTime, worldTimeAfter: afterTime,
    eventNumberBefore: beforeEvents, eventNumberAfter: events.length, eventDelta: events.length - beforeEvents,
    eventTypes: events.slice(beforeEvents).map((event: any) => event.type),
    interpretCalls: interpretCalls - beforeCalls, directorDiagnostics: diagnostics, narrationDiagnostics, hasInternalLeak,
    narrateSuccesses: (categorySuccesses["narrate"] ?? 0) - beforeNarrations,
    transportWindow: { afterSequence: traceAfter, throughSequence: transportTrace.checkpoint() },
    openCodeHttp: openCodeRequestDelta(beforeBudget, afterBudget),
    generationRequests: afterBudget.generationRequests - beforeBudget.generationRequests,
    budgetBlocks: afterBudget.blockedRequests - beforeBudget.blockedRequests,
    reservedCostUsd: Number((afterBudget.reservedCostUsd - beforeBudget.reservedCostUsd).toFixed(8)),
    reportedCostUsd: Number((afterBudget.reportedCostUsd - beforeBudget.reportedCostUsd).toFixed(8)),
  };
  ledger.push(row);
  completedTurns = ledger.length;
  if (result.statusCode !== 200) failures.push(id + ": unexpected status " + result.statusCode);
  if (hasInternalLeak) failures.push(id + ": internal identifier leaked");
  if (row.budgetBlocks > 0) failures.push(id + ": OpenCode generation budget was exhausted");
  return { row, body };
}

async function runRuinsAcceptance(): Promise<void> {
  activeRunStage = "ruins_preflight";
  const startingLocation = runtime.projection.getSnapshot().currentLocationId;
  const ruinsExist = runtime.projection.getSnapshot().locations.has("old_ruins");
  if (startingLocation !== "riverwatch_city" || !ruinsExist) {
    failures.push("ruins acceptance precondition failed");
    return;
  }
  await supplementalTurn("journey-to-old-ruins", "Иду по дороге к Развалины на уступе");
  let waits = 0;
  while (runtime.projection.getSnapshot().currentLocationId !== "old_ruins"
    && runtime.projection.getSnapshot().activeJourneyId !== null && waits < 12) {
    const wait = await supplementalTurn("wait-to-old-ruins-" + String(waits + 1), "ждать");
    if (wait.row.worldTimeAfter !== wait.row.worldTimeBefore + 1) {
      failures.push("ruins journey wait did not advance exactly one tick");
      return;
    }
    waits += 1;
  }
  if (runtime.projection.getSnapshot().currentLocationId !== "old_ruins") {
    failures.push("journey did not reach the authored ruins location");
    return;
  }
  const ruinsLabel = runtime.projection.getSnapshot().locations.get("old_ruins")?.name?.trim() ?? "";
  if (!ruinsLabel) {
    failures.push("ruins location has no observer-safe label for question-read relevance checks");
    return;
  }
  ruinsReached = true;
  const before = runtime.projection.getSnapshot();
  const eventOffset = eventCount();
  const { row, body } = await supplementalTurn("ruins-inspection", P3_RUINS_INSPECTION_REPLICA);
  ruinsInspectionBody = body;
  const after = runtime.projection.getSnapshot();
  const events = runtime.bus.query();
  const slice = events.slice(eventOffset);
  const exactPerception = verifyP3RuinsPerception(
    before.currentLocationId, after.currentLocationId, before.time, after.time,
    after.locations.get(P3_RUINS_LOCATION)?.description ?? "", slice,
  );
  const spec = readP3RuinsQuestionSpec(ruinsDecision, ruinsLabel, { worldTime: before.time, eventNumber: before.eventNumber });
  const acceptedPinnedMixedDecision = spec !== null && row.interpretCalls === 1
    && row.masterTurnKind === "mixed_outcome" && row.directorDiagnostics.some((d: any) =>
      d.provider === OPENCODE_SERVER_PROVIDER_ID && d.model === acceptanceModel
      && d.outcome === "accepted" && d.decisionKind === "mixed" && d.decisionAccepted === true);
  const record = runningServer!.app.store.getWorldRecord(worldId);
  const profile = record?.characterId ? runningServer!.app.store.getCharacterProfile(record.characterId) : null;
  const expectedReading = spec && executeQuestionReadingRound(spec, {
    scene: buildMasterTurnSceneContext(events, after),
    revision: { worldTime: after.time, eventNumber: after.eventNumber },
    narrative: buildNarrativeAdapterContext(events, after, {
      profile, characterName: record?.characterName ?? null,
      entrypoint: record?.entrypointId ? getRegionEntrypoint(record.entrypointId) : null,
      presentation: null, openingWindow: false,
    }),
    transcript: null,
  });
  const questionStatements = verifyP3RuinsQuestionReading(expectedReading, body.questionReadings);
  const saved = runningServer!.app.store.getConversationTurn(worldId, "p3-extra-ruins-inspection");
  const pinnedSuccess = !!ruinsNarration && !!saved && ruinsNarration.correlationId === saved.correlationId
    && manager.narrationDiagnostics().some((diagnostic) =>
      diagnostic.kind === "llm" && diagnostic.category === "success" && diagnostic.outcome === "success"
      && diagnostic.correlationId === saved.correlationId && diagnostic.worldTime === after.time
      && diagnostic.provider === OPENCODE_SERVER_PROVIDER_ID && diagnostic.model === acceptanceModel);
  ruinsEvidence = {
    exactPerception, acceptedPinnedMixedDecision, anchoredQuestion: questionStatements !== null,
    groundedSameTurnNarration: verifyP3RuinsNarration(
      exactPerception ? actionOutcomeText(P3_RUINS_INSPECTION_REPLICA, slice, after).text : null,
      questionStatements, ruinsNarration?.allowed ?? null, ruinsNarration?.text ?? null,
      {
        deterministicText: row.deterministicResponseText, deterministicSource: row.deterministicResponseSource,
        narrationText: row.narrationText, narrationState: row.narrationState, visibleText: row.responseText,
      },
      pinnedSuccess,
    ),
  };
  ruinsDecision = null;
  ruinsNarration = null;
}

let singleActionKey = "";
let singleActionInput = "";
let singleActionResponse: any = null;
let firstQuestionBody: any = null;
for (let index = 0; index < session.length; index += 1) {
  const turn = session[index]!;
  if (turn.id === "provider-unavailable") {
    const world = runtime.projection.getSnapshot();
    const scene = buildMasterTurnSceneContext(runtime.bus.query(), world);
    if (world.currentLocationId !== "riverwatch_city"
      || !scene.context.knownPeople.some((person) => person.label === "Смотритель речных ворот")) {
      failures.push("provider outage probe did not target the present gatekeeper in riverwatch_city");
    }
  }
  if (turn.id === "post-outage-question") await runRuinsAcceptance();
  if (turn.reopen) await reopen();
  activeRunStage = "turn_" + turn.id;
  const beforeTime = time();
  const beforeEvents = eventCount();
  const beforeCalls = interpretCalls;
  const beforeBudget = generationBudget.snapshot();
  const traceAfter = transportTrace.checkpoint();
  const beforeDiagnostics = manager.narrationDiagnostics().length;
  const beforeNarrations = categorySuccesses["narrate"] ?? 0;
  const key = "p3-" + String(index + 1).padStart(2, "0");
  injectProviderFailure = turn.offline === true;
  let result: { statusCode: number; body: string };
  try { result = await postWorldCommand(turn.input, key); }
  finally { injectProviderFailure = false; }
  const body = JSON.parse(result.body);
  const afterTime = time();
  const playerResponse = await awaitPlayerFacingResponse(body, afterTime);
  const afterBudget = generationBudget.snapshot();
  const events = runtime.bus.query();
  const diagnosticDelta = manager.narrationDiagnostics().slice(beforeDiagnostics);
  const diagnostics = diagnosticDelta
    .filter((entry: any) => entry.category === "gm_director")
    .map(sanitizedDirectorDiagnostic);
  const narrationDiagnostics = sanitizedNarrationDiagnosticsSince(beforeDiagnostics);
  const readingResults = Array.isArray(body.questionReadings?.results)
    ? body.questionReadings.results.map((reading: any) => ({
      partId: reading.request?.partId ?? null,
      aspect: reading.request?.aspect ?? null,
      source: reading.request?.source ?? null,
      status: reading.status ?? null,
      factCount: Array.isArray(reading.facts) ? reading.facts.length : 0,
      factTexts: Array.isArray(reading.facts)
        ? reading.facts.map((fact: any) => typeof fact.text === "string" ? fact.text : "").filter(Boolean)
        : [],
      gapStatuses: Array.isArray(reading.gaps) ? reading.gaps.map((gap: any) => gap.status ?? null) : [],
    }))
    : [];
  const inquiryAnswers = Array.isArray(body.inquiryAnswers)
    ? body.inquiryAnswers.map((answer: any) => ({
      queryId: answer.queryId ?? null,
      answer: typeof answer.answer === "string" ? answer.answer : "",
    }))
    : body.inquiryAnswer
      ? [{
        queryId: body.inquiryAnswer.queryId ?? null,
        answer: typeof body.inquiryAnswer.answer === "string" ? body.inquiryAnswer.answer : "",
      }]
      : [];
  const responseText = playerResponse.visibleText;
  const serialized = JSON.stringify(body);
  const hasInternalLeak = /targetRef|establishedAt|contactRef|internalId|locationId|person_|object_|route_/iu.test(serialized);
  const stored = runningServer!.app.store.getConversationTurn(worldId, key);
  const row = {
    turn: index + 1, id: turn.id, input: turn.input, statusCode: result.statusCode,
    responseKind: body.conversationTurn?.responseKind ?? body.status ?? null,
    masterTurnKind: body.masterTurn?.kind ?? null,
    responseText,
    deterministicResponseText: playerResponse.deterministicText,
    deterministicResponseSource: playerResponse.deterministicSource,
    narrationText: playerResponse.narrationText,
    narrationState: playerResponse.narrationState,
    questionReadings: readingResults,
    inquiryAnswers,
    clarificationSlot: stored?.contextMetadata?.clarification?.framed?.slot ?? null,
    worldTimeBefore: beforeTime, worldTimeAfter: afterTime,
    eventNumberBefore: beforeEvents, eventNumberAfter: events.length, eventDelta: events.length - beforeEvents,
    eventTypes: events.slice(beforeEvents).map((event: any) => event.type),
    interpretCalls: interpretCalls - beforeCalls, directorDiagnostics: diagnostics, narrationDiagnostics, hasInternalLeak,
    narrateSuccesses: (categorySuccesses["narrate"] ?? 0) - beforeNarrations,
    injectedProviderOutage: turn.offline === true,
    transportWindow: { afterSequence: traceAfter, throughSequence: transportTrace.checkpoint() },
    openCodeHttp: openCodeRequestDelta(beforeBudget, afterBudget),
    generationRequests: afterBudget.generationRequests - beforeBudget.generationRequests,
    budgetBlocks: afterBudget.blockedRequests - beforeBudget.blockedRequests,
    reservedCostUsd: Number((afterBudget.reservedCostUsd - beforeBudget.reservedCostUsd).toFixed(8)),
    reportedCostUsd: Number((afterBudget.reportedCostUsd - beforeBudget.reportedCostUsd).toFixed(8)),
  };
  ledger.push(row);
  completedTurns = ledger.length;
  if (result.statusCode !== 200) failures.push(turn.id + ": unexpected status " + result.statusCode);
  if (hasInternalLeak) failures.push(turn.id + ": internal identifier leaked");
  if (turn.readOnly && (afterTime !== beforeTime || events.length !== beforeEvents)) failures.push(turn.id + ": read-only state changed");
  if (turn.advances && afterTime !== beforeTime + 1) failures.push(turn.id + ": expected one tick");
  if (row.budgetBlocks > 0) failures.push(turn.id + ": OpenCode generation budget was exhausted");
  if (turn.id === "question-plan-clarification") firstQuestionBody = body;
  if (turn.id === "single-action") {
    singleActionKey = key;
    singleActionInput = turn.input;
    singleActionResponse = body;
  }
}

if (singleModelBackedTurnProbe) {
  const row = ledger[0];
  const directorDiagnostic = row?.directorDiagnostics.find((entry: any) =>
    entry.provider === OPENCODE_SERVER_PROVIDER_ID);
  const budget = generationBudget.snapshot();
  const checks = evaluateP3ModelBackedTurnProbe({
    scratchWorldHttpStatus: worldCreateStatus,
    scratchServerBaseUrl: scratchHttpBaseUrl,
    commandRequests: httpCommandRequests,
    commandHttpStatus: row?.statusCode ?? null,
    interpretCalls,
    interpretCategoryCalls: categoryCalls["interpret"] ?? 0,
    commandInterpretCalls: row?.interpretCalls ?? null,
    generationRequests: budget.generationRequests,
    successfulGenerationResponses: budget.successfulGenerationResponses,
    directorDecisionAccepted: directorDiagnostic?.decisionAccepted === true,
    directorOutcome: directorDiagnostic?.outcome ?? null,
    directorDecisionKind: directorDiagnostic?.decisionKind ?? null,
    directorAddresseeKind: directorDiagnostic?.addresseeKind ?? null,
    directorProvider: directorDiagnostic?.provider ?? null,
    directorModel: directorDiagnostic?.model ?? null,
    expectedProvider: OPENCODE_SERVER_PROVIDER_ID,
    expectedModel: acceptanceModel!,
    scenarioId: row?.id ?? null,
    playerInput: row?.input ?? null,
    responseKind: row?.responseKind ?? null,
    responseText: row?.responseText ?? null,
    hasInternalLeak: row?.hasInternalLeak ?? null,
    worldTimeBefore: row?.worldTimeBefore ?? null,
    worldTimeAfter: row?.worldTimeAfter ?? null,
    eventDelta: row?.eventDelta ?? null,
    budgetBlocks: budget.blockedRequests,
    reservationViolations: budget.reservationViolations,
    reportedCostUsd: budget.reportedCostUsd,
    reservedCostUsd: budget.reservedCostUsd,
  });
  const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  const verdict = failures.length === 0 ? "PASS" : "FAIL";
  const report = {
    schema,
    verdict,
    mode: "one live Director decision and server-rendered NPC greeting on scratch loopback HTTP; full gameplay/narration acceptance not run",
    fullGameplayAcceptance: "NOT_RUN",
    baseCommit,
    baseCommitSource,
    sourceDigest,
    sourceHashes,
    providerSelection,
    routeCheck,
    providerWarmup,
    transportTrace: transportTrace.snapshot(),
    liveModelEvidence: {
      generationRequests: budget.generationRequests,
      successfulGenerationResponses: budget.successfulGenerationResponses,
      failedGenerationResponses: budget.failedGenerationResponses,
      modelCatalogRequests: budget.modelCatalogRequests,
      modelCatalogFailures: budget.modelCatalogFailures,
      sessionCreateRequests: budget.sessionCreateRequests,
      sessionCreateFailures: budget.sessionCreateFailures,
      lastFailureEndpoint: budget.lastFailureEndpoint,
      lastFailureHttpStatus: budget.lastFailureHttpStatus,
      acceptedDirectorDecisionCount: directorDiagnostic?.decisionAccepted === true ? 1 : 0,
    },
    paidBudget: {
      ledger: "docs/acceptance/opencode-paid-budget-2026-11-14.json",
      runId: paidRunId,
      authorizedUsd: paidBudgetBefore!.authorizedUsd,
      reservedUsdBefore: paidBudgetBefore!.reservedUsd,
      remainingUsdBefore: paidBudgetBefore!.remainingUsd,
      runReservedUsd: budget.reservedCostUsd,
      modelReportedCostUsd: budget.reportedCostUsd,
      remainingUsdAfter: readOpenCodePaidBudgetLedger(paidBudgetLedgerPath).remainingUsd,
    },
    world: {
      worldId: "<redacted:" + worldId.slice(-8) + ">",
      initialWorldTime: 0,
      turnCount: ledger.length,
    },
    probe: row ?? null,
    checks,
    failures,
    generationBudget: budget,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ schema, verdict, mode: p3Mode, checks, failures, reportPath }, null, 2));
  return verdict === "PASS" ? 0 : 1;
}

const qClarification = ledger.find((row) => row.id === "question-plan-clarification");
const qAnswer = ledger.find((row) => row.id === "question-plan-answer");
const action = ledger.find((row) => row.id === "single-action");
const mixed = ledger.find((row) => row.id === "safe-mixed");
const refusal = ledger.find((row) => row.id === "absent-refusal");
const outage = ledger.find((row) => row.id === "provider-unavailable");
const postOutageQuestion = ledger.find((row) => row.id === "post-outage-question");
const thanks = ledger.find((row) => row.id === "thanks");
const openQuestion = ledger.find((row) => row.id === "open-question");
const unsupportedNpcQuestion = ledger.find((row) => row.id === "npc-unsupported-detail");
const unsupportedTwoActions = ledger.find((row) => row.id === "unsupported-two-actions");
const multipartQuestion = ledger.find((row) => row.id === "npc-multipart-question");
const checks: Record<string, boolean> = {
  scratchWorldCreatedThroughHttp: worldCreateStatus === 201,
  scratchHttpBoundToLoopback: scratchHttpBaseUrl !== null && new URL(scratchHttpBaseUrl).hostname === "127.0.0.1",
  questionPlanClarificationStored: firstQuestionBody?.conversationTurn?.responseKind === "clarification"
    && qClarification?.clarificationSlot === "question_subject",
  questionPlanResumedAfterReload: qAnswer?.responseKind === "inquiry_answer"
    && /рабочем платье/u.test(qAnswer?.responseText ?? "")
    && /нет (?:доступных |проверенных )?сведений|не удалось наблюдать|не видно данных|пока нельзя понять/iu.test(qAnswer?.responseText ?? "")
    && !/спокоен|сердит|тревож|испуган|радостн|злится/iu.test(qAnswer?.responseText ?? ""),
  peopleListsAnswered: ["people-list", "people-list-again"].every((id) => {
    const row = ledger.find((entry) => entry.id === id);
    return row?.responseKind === "inquiry_answer"
      && /Архивист Речного Стража/u.test(row.responseText)
      && /Смотритель речных ворот/u.test(row.responseText)
      && row.eventDelta === 0 && row.worldTimeAfter === row.worldTimeBefore;
  }),
  roleQuestionAnswered: ledger.find((row) => row.id === "role-identification")?.responseKind === "inquiry_answer"
    && /Смотритель речных ворот/u.test(ledger.find((row) => row.id === "role-identification")?.responseText ?? ""),
  oneActionOneTick: action?.eventTypes.includes("ActionResolved") && action.worldTimeAfter === action.worldTimeBefore + 1,
  safeMixedSubsetExecuted: mixed?.masterTurnKind === "mixed_outcome"
    && mixed.worldTimeAfter === mixed.worldTimeBefore + 1
    && mixed.eventTypes.includes("ActionResolved")
    && mixed.eventTypes.includes("TickPassed")
    && (mixed.questionReadings.some((reading: any) => reading.factCount > 0)
      || mixed.inquiryAnswers.some((answer: any) => answer.answer.trim().length > 0)),
  addressedNpcQuestionIsReadOnly: ledger.find((row) => row.id === "npc-question")?.responseKind === "speech_reaction"
    && ledger.find((row) => row.id === "npc-question")?.eventDelta === 0
    && ledger.find((row) => row.id === "npc-question")?.worldTimeAfter === ledger.find((row) => row.id === "npc-question")?.worldTimeBefore,
  unsupportedNpcQuestionGetsHonestNoKnowledge: unsupportedNpcQuestion?.responseKind === "speech_reaction"
    && /нет подтверждённых сведений/iu.test(unsupportedNpcQuestion.responseText)
    && !/ведёт журнал проходов/iu.test(unsupportedNpcQuestion.responseText)
    && unsupportedNpcQuestion.eventDelta === 0
    && unsupportedNpcQuestion.worldTimeAfter === unsupportedNpcQuestion.worldTimeBefore,
  addressedNpcMultipartQuestion: multipartQuestion?.responseKind === "speech_reaction"
    // The NAMED addressee answers, not a model-chosen speaker.
    && /Смотритель/u.test(multipartQuestion.responseText)
    // Part 1 (про журнал проходов) is answered with the authored public fact.
    && /ведёт журнал проходов у ворот/iu.test(multipartQuestion.responseText)
    // Part 2 (кто ещё дежурит) is an explicit per-part honest gap — the
    // authored public dossier has no fact naming another person.
    && /Об этом я не могу сказать ничего определённого/u.test(multipartQuestion.responseText)
    // Exactly one Director interpretation for the composed reply.
    && multipartQuestion.interpretCalls === 1
    && multipartQuestion.directorDiagnostics.some((d: any) =>
      d.provider === OPENCODE_SERVER_PROVIDER_ID && d.model === acceptanceModel
      && d.outcome === "accepted" && d.decisionKind === "conversation"
      && d.addresseeKind === "npc" && d.decisionAccepted === true)
    && multipartQuestion.eventDelta === 0
    && multipartQuestion.worldTimeAfter === multipartQuestion.worldTimeBefore,
  unsupportedTwoActionsFailClosed: unsupportedTwoActions?.responseKind === "clarification"
    && unsupportedTwoActions.eventDelta === 0
    && unsupportedTwoActions.worldTimeAfter === unsupportedTwoActions.worldTimeBefore,
  addressedNpcConversation: ledger.find((row) => row.id === "npc-greeting")?.responseKind === "speech_reaction"
    && ledger.find((row) => row.id === "npc-greeting")?.eventDelta === 0
    && ledger.find((row) => row.id === "npc-greeting")?.worldTimeAfter === ledger.find((row) => row.id === "npc-greeting")?.worldTimeBefore,
  thanksAcknowledged: thanks?.responseKind === "speech_reaction"
    && /(?:пожалуйста|не за что)/iu.test(thanks?.responseText ?? "")
    && !/(?:речь о|что ты уже знаешь)/iu.test(thanks?.responseText ?? ""),
  pureConversationIsReadOnly: ledger.find((row) => row.id === "conversation")?.responseKind === "speech_reaction"
    && ledger.find((row) => row.id === "conversation")?.eventDelta === 0
    && ledger.find((row) => row.id === "conversation")?.worldTimeAfter === ledger.find((row) => row.id === "conversation")?.worldTimeBefore,
  absentNpcRefusedReadOnly: refusal?.responseKind === "action_rejection" && refusal.eventDelta === 0,
  injectedProviderFailureIsSafe: outage?.interpretCalls === 1
    && outage.responseKind === "speech_reaction"
    && typeof outage.responseText === "string"
    && outage.responseText.trim().length > 0
    && !/(?:OpenCode|HTTP\s*\d{3}|provider|провайдер|модель|api[- ]?key|authorization)/iu.test(outage.responseText)
    && outage.eventDelta === 0
    && outage.worldTimeAfter === outage.worldTimeBefore
    && outage.directorDiagnostics.some((row: any) => row.failureCategory === "provider_error"
      && row.decisionAccepted === false && typeof row.providerLatencyMs === "number"),
  postOutageQuestionStaysReadOnly: postOutageQuestion?.interpretCalls === 1
    && postOutageQuestion.responseKind === "inquiry_answer"
    && /Рядом с тобой сейчас никого различимого нет/iu.test(postOutageQuestion.responseText)
    && !/(?:Архивист Речного Стража|Смотритель речных ворот)/iu.test(postOutageQuestion.responseText)
    && postOutageQuestion.eventDelta === 0
    && postOutageQuestion.worldTimeAfter === postOutageQuestion.worldTimeBefore,
  unsupportedOpenQuestionFailsClosed: openQuestion?.responseKind === "clarification"
    || (/(?:нет (?:подтвержденных|доступных) сведений|не удалось наблюдать|пока нельзя понять|не могу надёжно связать)/iu.test(openQuestion?.responseText ?? "")
      && !/(?:Город за стенами|Архивист Речного Стража|Смотритель речных ворот|Переправа у Чёрного леса)/iu.test(openQuestion?.responseText ?? "")),
};
const acceptedDirectorDecisionCount = ledger.reduce((total, row) => total + row.directorDiagnostics.filter(
  (diagnostic: any) => diagnostic.provider === OPENCODE_SERVER_PROVIDER_ID && diagnostic.decisionAccepted === true,
).length, 0);
const liveModelGate = evaluateP3LiveModelGate({
  generationRequests: generationBudget.snapshot().generationRequests,
  successfulGenerationResponses: generationBudget.snapshot().successfulGenerationResponses,
  successfulNarrationResponses: categorySuccesses["narrate"] ?? 0,
  acceptedDirectorDecisions: acceptedDirectorDecisionCount,
});
Object.assign(checks, liveModelGate);

checks.everyBaseTurnRecorded = session.every((turn) => ledger.some((row) => row.id === turn.id));
checks.ruinsJourneyReached = ruinsReached;
checks.ruinsQuestionClauseRetained = ruinsEvidence.anchoredQuestion;
checks.ruinsInspectionResolvedByEvent = ruinsEvidence.exactPerception;
checks.ruinsInspectionAcceptedByLiveDirector = ruinsEvidence.acceptedPinnedMixedDecision;
checks.ruinsInspectionNarratedByLiveModel = ruinsEvidence.groundedSameTurnNarration;

activeRunStage = "postcondition_checks";
await reopen();
checks.serverReloadedAgainstSameScratchDatabase = httpServerStarts === 1 + httpServerRestarts && httpServerRestarts >= 2;
activeRunStage = "same_key_replay";
const retryTime = time();
const retryEvents = eventCount();
const beforeReplayBudget = generationBudget.snapshot();
const beforeReplayCalls = JSON.stringify(categoryCalls);
const replay = await postWorldCommand(singleActionInput, singleActionKey);
const replayBody = JSON.parse(replay.body);
const replayCheck = replay.statusCode === 200 && replayBody.replayed === true
  && time() === retryTime && eventCount() === retryEvents
  && JSON.stringify(replayBody.masterTurn) === JSON.stringify(singleActionResponse.masterTurn);
const ruinsReplay = ruinsInspectionBody && await postWorldCommand(P3_RUINS_INSPECTION_REPLICA, "p3-extra-ruins-inspection");
const ruinsReplayBody = ruinsReplay ? JSON.parse(ruinsReplay.body) : null;
checks.ruinsReplayAfterReloadIsPure = ruinsReplay?.statusCode === 200 && ruinsReplayBody?.replayed === true
  && time() === retryTime && eventCount() === retryEvents
  && JSON.stringify(ruinsReplayBody.masterTurn) === JSON.stringify(ruinsInspectionBody.masterTurn)
  && JSON.stringify(ruinsReplayBody.questionReadings) === JSON.stringify(ruinsInspectionBody.questionReadings);
activeRunStage = "idempotency_conflict";
const conflict = await postWorldCommand("другой текст", singleActionKey);
activeRunStage = "conflict_response_received";
const conflictCheck = conflict.statusCode === 409 && time() === retryTime && eventCount() === retryEvents;
activeRunStage = "final_acceptance_checks";
checks.replayAfterReloadIsPure = replayCheck;
checks.changedBodyRejected = conflictCheck;
checks.replaysAndConflictDoNotCallModels = generationBudget.snapshot().generationRequests === beforeReplayBudget.generationRequests
  && JSON.stringify(categoryCalls) === beforeReplayCalls;
checks.gameplayCommandsUsedLoopbackHttp = httpCommandRequests === ledger.length + (ruinsReplay ? 3 : 2);
checks.noOversizeProviderMessages = transportTrace.snapshot().droppedEntries === 0
  && transportTrace.snapshot().entries.every((entry) => entry.type !== "started"
    || entry.phase !== "router_call"
    || (entry.messageBytes !== undefined && entry.messageBytes <= OPENCODE_SERVER_MAX_MESSAGE_BYTES));
checks.noGenerationBudgetBlocks = generationBudget.snapshot().blockedRequests === 0;
checks.withinGenerationRequestCap = generationBudget.snapshot().generationRequests <= maxGenerationRequests;
checks.withinReservedAndReportedSpend = generationBudget.snapshot().reservationViolations === 0
  && generationBudget.snapshot().reportedCostUsd <= generationBudget.snapshot().reservedCostUsd + 1e-8;
if (!checks.everyBaseTurnRecorded) failures.push("one or more base acceptance turns were not recorded");
for (const [name, passed] of Object.entries(checks)) if (!passed) failures.push("failed check: " + name);

activeRunStage = "assemble_acceptance_report";
const report = {
  schema,
  verdict: failures.length === 0 ? "PASS" : "FAIL",
  mode: "real Skald loopback HTTP command path + live OpenCode router; isolated scratch SQLite; not browser or human QA",
  httpExecution: {
    baseUrl: scratchHttpBaseUrl,
    worldCreateStatus,
    commandRequests: httpCommandRequests,
    journalReads: httpJournalRequests,
    serverStarts: httpServerStarts,
    serverRestarts: httpServerRestarts,
    isolatedDatabase: true,
  },
  baseCommit,
  baseCommitSource,
  sourceDigest,
  sourceHashes,
  providerSelection,
  routeCheck,
  providerWarmup,
  transportTrace: transportTrace.snapshot(),
  liveModelEvidence: {
    generationRequests: generationBudget.snapshot().generationRequests,
    successfulGenerationResponses: generationBudget.snapshot().successfulGenerationResponses,
    failedGenerationResponses: generationBudget.snapshot().failedGenerationResponses,
    modelCatalogRequests: generationBudget.snapshot().modelCatalogRequests,
    modelCatalogFailures: generationBudget.snapshot().modelCatalogFailures,
    sessionCreateRequests: generationBudget.snapshot().sessionCreateRequests,
    sessionCreateFailures: generationBudget.snapshot().sessionCreateFailures,
    lastFailureEndpoint: generationBudget.snapshot().lastFailureEndpoint,
    lastFailureHttpStatus: generationBudget.snapshot().lastFailureHttpStatus,
    acceptedDirectorDecisionCount,
  },
  paidBudget: {
    ledger: "docs/acceptance/opencode-paid-budget-2026-11-14.json",
    runId: paidRunId,
    authorizedUsd: paidBudgetBefore!.authorizedUsd,
    reservedUsdBefore: paidBudgetBefore!.reservedUsd,
    remainingUsdBefore: paidBudgetBefore!.remainingUsd,
    runReservedUsd: generationBudget.snapshot().reservedCostUsd,
    modelReportedCostUsd: generationBudget.snapshot().reportedCostUsd,
    remainingUsdAfter: readOpenCodePaidBudgetLedger(paidBudgetLedgerPath).remainingUsd,
  },
  world: { worldId: "<redacted:" + worldId.slice(-8) + ">", initialWorldTime: 0, turnCount: ledger.length },
  checks,
  failures,
  replay: { statusCode: replay.statusCode, replayed: replayBody.replayed === true },
  conflictStatus: conflict.statusCode,
  totalInterpretCalls: interpretCalls,
  categoryCalls,
  categorySuccesses,
  generationBudget: generationBudget.snapshot(),
  ledger,
};
activeRunStage = "write_acceptance_report";
writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({
  schema, verdict: report.verdict, turns: ledger.length,
  totalInterpretCalls: interpretCalls, categoryCalls,
  generationBudget: generationBudget.snapshot(), checks, failures, reportPath,
}, null, 2));
return failures.length === 0 ? 0 : 1;
}

let exitCode = 2;
try {
  exitCode = await runGameplay();
} catch (error) {
  const verdict = worldCreated ? "FAIL" : "BLOCKED";
  const failure = { stage: activeRunStage, ...summarizeP3LiveRunnerFailure(error) };
  exitCode = worldCreated ? 1 : 2;
  if (!existsSync(reportPath)) {
    writeFileSync(reportPath, JSON.stringify({
      schema,
      verdict,
      mode: "real Skald loopback HTTP + static OpenCode Server pin; isolated scratch only",
      httpExecution: {
        baseUrl: scratchHttpBaseUrl,
        worldCreateStatus,
        commandRequests: httpCommandRequests,
        journalReads: httpJournalRequests,
        serverStarts: httpServerStarts,
        serverRestarts: httpServerRestarts,
        isolatedDatabase: true,
      },
      reason: "live_session_runner_error",
      failure,
      world: { created: worldCreated, turnCount: completedTurns },
      baseCommit,
      baseCommitSource,
      sourceDigest,
      sourceHashes,
      providerSelection,
      routeCheck,
      providerWarmup,
      transportTrace: transportTrace.snapshot(),
      categoryCalls,
      categorySuccesses,
      ledger: partialLedger,
      generationBudget: generationBudget.snapshot(),
    }, null, 2), { flag: "wx" });
  }
  console.error(JSON.stringify({
    schema,
    verdict,
    reason: "live_session_runner_error",
    failure,
    world: { created: worldCreated, turnCount: completedTurns },
    categoryCalls,
    categorySuccesses,
    generationBudget: generationBudget.snapshot(),
    reportPath,
  }, null, 2));
} finally {
  try {
    if (runningServer) await runningServer.close();
    else await baseRouter.close();
  }
  finally { globalThis.fetch = originalFetch; }
}
process.exitCode = exitCode;
