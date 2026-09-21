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
import { createLiveRouterConfiguration, createRouterConfiguration } from "../runtime/router-factory.js";
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

type DiagnosticSink = (event: unknown) => void;

/** Per-call and per-category diagnostics collected from one run. */
interface CorpusDiagnostics {
  readonly byCategory: Map<string, number>;
  readonly calls: { model: string; provider: string; outcome: string; durationMs: number }[];
  readonly referent: { total: number; inTable: number; notInTable: number; surfaceMismatch: number };
}

function newDiagnostics(): CorpusDiagnostics {
  return { byCategory: new Map(), calls: [], referent: { total: 0, inTable: 0, notInTable: 0, surfaceMismatch: 0 } };
}

function collect(diagnostics: CorpusDiagnostics, raw: unknown): void {
  const event = (raw ?? {}) as Record<string, unknown>;
  const failure = typeof event.failureCategory === "string" && event.failureCategory.length > 0
    ? event.failureCategory
    : typeof event.category === "string" && event.category.length > 0 ? event.category : "unknown";
  diagnostics.byCategory.set(failure, (diagnostics.byCategory.get(failure) ?? 0) + 1);
  // Provider calls: name the model and provider PER CALL, not just once.
  if (typeof event.model === "string" || event.kind === "llm") {
    diagnostics.calls.push({
      model: typeof event.model === "string" ? event.model : typeof event.configuredModel === "string" ? event.configuredModel : "?",
      provider: typeof event.provider === "string" ? event.provider : "?",
      outcome: typeof event.outcome === "string" ? event.outcome : "?",
      durationMs: typeof event.durationMs === "number" ? event.durationMs : 0,
    });
  }
  if (typeof event.referentInTable === "boolean") {
    diagnostics.referent.total += 1;
    if (event.referentInTable) diagnostics.referent.inTable += 1; else diagnostics.referent.notInTable += 1;
    if (event.referentSurfaceMatch === false) diagnostics.referent.surfaceMismatch += 1;
  }
}

function histogram(values: readonly string[]): Record<string, number> {
  const out = new Map<string, number>();
  for (const value of values) out.set(value, (out.get(value) ?? 0) + 1);
  return Object.fromEntries([...out.entries()].sort((a, b) => b[1] - a[1]));
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index]!;
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

  // Use the SAME router construction as skald.service: live discovery
  // activates the provider's working models. The sync configuration would
  // leave the interpret route on unprobed candidates and score fallback
  // instead of the model.
  const configuration = process.env["SKALD_AI_REQUIRED"] === "1"
    ? await createLiveRouterConfiguration()
    : createRouterConfiguration();
  const router = configuration?.router ?? null;
  const liveSelection = (router as unknown as { liveModelSelection?: () => { activeModel?: string; provider?: string; status?: string } | undefined })?.liveModelSelection?.();
  const activeModel = liveSelection?.activeModel ?? configuration?.selectionReport?.activeModel ?? null;

  const diagnosticsState = newDiagnostics();
  const diagnostics: DiagnosticSink = (event) => collect(diagnosticsState, event);

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
      failureCategories: Object.fromEntries([...diagnosticsState.byCategory.entries()].sort((a, b) => b[1] - a[1])),
      calls: {
        total: diagnosticsState.calls.length,
        byModel: histogram(diagnosticsState.calls.map((call) => call.model)),
        byProvider: histogram(diagnosticsState.calls.map((call) => call.provider)),
        outcomes: histogram(diagnosticsState.calls.map((call) => call.outcome)),
        latencyMs: {
          p50: percentile(diagnosticsState.calls.map((call) => call.durationMs), 50),
          p95: percentile(diagnosticsState.calls.map((call) => call.durationMs), 95),
          max: diagnosticsState.calls.reduce((max, call) => Math.max(max, call.durationMs), 0),
        },
      },
      referentRejections: {
        total: diagnosticsState.referent.total,
        inTable: diagnosticsState.referent.inTable,
        notInTable: diagnosticsState.referent.notInTable,
        surfaceMismatch: diagnosticsState.referent.surfaceMismatch,
      },
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
