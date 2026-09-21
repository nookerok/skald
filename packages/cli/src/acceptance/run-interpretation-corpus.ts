/**
 * Opt-in interpretation-corpus runner (full-master Stage 1e).
 *
 * Runs the closed corpus (each entry in its own scene fixture) and the
 * sequential scenarios through the real master-turn gateway with the
 * configured providers, then scores valid + correctly interpreted plans.
 * No player world is touched: corpus entries use read-only projections, and
 * each scenario runs in its own disposable scratch world.
 *
 *   npm run acceptance:interpretation:corpus            # ambient env
 *   SKALD_ENV_FILE=/path/to/skald.env npm run ...        # service env (data)
 *
 * Exit codes: 0 pass, 1 score below threshold / generic fallback / scenario
 * failure, 2 unusable provider environment (fail-closed, no measurement).
 */

import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DomainEvent } from "@skald/event-bus";
import {
  buildBootstrapEvents,
  buildMasterTurnSceneContext,
  rebuildProjection,
} from "@skald/world";
import { createRouterConfiguration } from "../runtime/router-factory.js";
import { buildMasterConversationContext } from "../conversation/context-builder.js";
import { interpretMasterTurn } from "../runtime/master-turn-gateway.js";
import { createMultiWorldStore } from "../persistence/sqlite-store.js";
import { WorldRuntimeManager } from "../runtime/world-runtime-manager.js";
import { handleWorldCommand } from "../http/world-handlers.js";
import { INTERPRETATION_CORPUS, classifyOutcome, scoreCorpus, type InterpretationObservation } from "./interpretation-corpus.js";
import { INTERPRETATION_SCENARIOS, classifyCommandResponse, evaluateScenarioStep, type Scenario } from "./interpretation-scenarios.js";
import { applyServiceEnv, type ServiceEnvResult } from "./service-env.js";

const THRESHOLD = 0.95;

/** Loads `SKALD_ENV_FILE` as systemd data; fail-closed, never printed. */
function loadServiceEnv(): ServiceEnvResult {
  const envFile = process.env["SKALD_ENV_FILE"];
  if (!envFile) return { ok: true };
  let text: string;
  try {
    text = readFileSync(envFile, "utf8");
  } catch {
    return { ok: false, reason: "env file not readable" };
  }
  return applyServiceEnv(process.env, text);
}

type DiagnosticEvent = { readonly category?: unknown; readonly failureCategory?: unknown };
type DiagnosticSink = (event: DiagnosticEvent) => void;

function countFailure(byCategory: Map<string, number>, event: DiagnosticEvent): void {
  const category = typeof event.failureCategory === "string" && event.failureCategory.length > 0
    ? event.failureCategory
    : typeof event.category === "string" && event.category.length > 0 ? event.category : "unknown";
  byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
}

function moveEvent(locationId: string): DomainEvent {
  return { eventId: `fixture-move-${locationId}`, type: "PlayerLocationChanged", schemaVersion: 1, payload: { locationId }, timestamp: 0, correlationId: "fixture", causationId: null };
}

/** Read-only snapshot at the entry's scene fixture (defaults to the crossing). */
function snapshotAt(location?: string) {
  const events = location && location !== "river_waystation"
    ? [...buildBootstrapEvents("living_region"), moveEvent(location)]
    : buildBootstrapEvents("living_region");
  const world = rebuildProjection(events).getSnapshot();
  return {
    events,
    world,
    scene: buildMasterTurnSceneContext(events, world),
    conversation: buildMasterConversationContext([], "interpretation-corpus"),
  };
}

async function runCorpus(
  router: ReturnType<typeof createRouterConfiguration>["router"],
  diagnostics: DiagnosticSink,
): Promise<InterpretationObservation[]> {
  const observations: InterpretationObservation[] = [];
  for (const entry of INTERPRETATION_CORPUS) {
    try {
      const outcome = await interpretMasterTurn(entry.input, snapshotAt(entry.location), router, { timeoutMs: 15_000, mode: "fallback", diagnostics });
      observations.push(classifyOutcome(outcome));
    } catch {
      observations.push({ status: "error", kind: "unavailable", primary: null, queryId: null, genericFallback: false });
    }
  }
  return observations;
}

interface ScenarioStepResult {
  readonly scenario: string;
  readonly input: string;
  readonly ok: boolean;
  readonly reason: string | null;
}

async function runScenario(
  router: ReturnType<typeof createRouterConfiguration>["router"],
  scenario: Scenario,
  diagnostics: DiagnosticSink,
): Promise<ScenarioStepResult[]> {
  const dbPath = join(mkdtempSync(join(tmpdir(), "skald-corpus-scenario-")), "events.sqlite");
  const store = createMultiWorldStore(dbPath);
  try {
    const worldId = `corpus-${scenario.id}`;
    store.createWorld({
      worldId,
      idempotencyKey: `create-${worldId}`,
      requestHash: `hash-${worldId}`,
      saveLabel: scenario.id,
      characterName: "Corpus",
      characterPresetId: "wanderer",
      worldTemplateId: "living_region",
      characterWound: "none",
      characterPromise: "observe",
      characterPrinciple: "care",
      characterProfileVersion: 1,
      bootstrapEvents: buildBootstrapEvents("living_region"),
    });
    const runtime = await new WorldRuntimeManager(store, router, diagnostics as never).get(worldId);
    const results: ScenarioStepResult[] = [];
    let index = 0;
    for (const step of scenario.steps) {
      const response = await handleWorldCommand(runtime, { input: step.input, idempotencyKey: `${scenario.id}-${index}` });
      const body = JSON.parse(response.body) as unknown;
      const evaluation = evaluateScenarioStep(step, classifyCommandResponse({ statusCode: response.statusCode, body }));
      results.push({ scenario: scenario.id, input: step.input, ok: evaluation.ok, reason: evaluation.reason });
      index += 1;
    }
    return results;
  } finally {
    store.close();
  }
}

async function main(): Promise<number> {
  const env = loadServiceEnv();
  if (!env.ok) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: "provider_env_rejected", reason: env.reason }, null, 2)}\n`);
    return 2;
  }

  const configuration = createRouterConfiguration();
  const router = configuration?.router ?? null;
  const liveSelection = (router as unknown as { liveModelSelection?: () => { activeModel?: string; provider?: string; status?: string } | undefined })?.liveModelSelection?.();
  const activeModel = liveSelection?.activeModel ?? configuration?.selectionReport?.activeModel ?? null;

  const byCategory = new Map<string, number>();
  const diagnostics: DiagnosticSink = (event) => countFailure(byCategory, event);

  const corpusScore = scoreCorpus(INTERPRETATION_CORPUS, await runCorpus(router, diagnostics));
  const scenarioResults: ScenarioStepResult[] = [];
  for (const scenario of INTERPRETATION_SCENARIOS) {
    scenarioResults.push(...await runScenario(router, scenario, diagnostics));
  }
  const scenarioFailures = scenarioResults.filter((result) => !result.ok);
  const ok = corpusScore.rate >= THRESHOLD && corpusScore.genericFallback === 0 && scenarioFailures.length === 0;
  process.stdout.write(`${JSON.stringify({
    ok,
    threshold: THRESHOLD,
    provider: {
      activeModel,
      provider: liveSelection?.provider ?? configuration?.selectionReport?.provider ?? null,
      configFingerprint: configuration?.configFingerprint ?? null,
      required: configuration?.required ?? false,
      missingProviders: configuration?.missingProviders ?? [],
      failureCategories: Object.fromEntries([...byCategory.entries()].sort((a, b) => b[1] - a[1])),
    },
    corpus: { total: corpusScore.total, correct: corpusScore.correct, rate: corpusScore.rate, genericFallback: corpusScore.genericFallback, failures: corpusScore.failures.slice(0, 25) },
    scenarios: { steps: scenarioResults.length, failures: scenarioFailures },
  }, null, 2)}\n`);
  return ok ? 0 : 1;
}

main().then(
  (code) => { process.exitCode = code; },
  () => { process.exitCode = 1; },
);
