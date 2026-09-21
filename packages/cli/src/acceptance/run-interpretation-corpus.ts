/**
 * Opt-in interpretation-corpus runner (full-master Stage 1e).
 *
 * Runs the closed corpus (each entry in its own scene fixture) and the
 * sequential scenarios through the real master-turn gateway with the
 * configured providers, then scores valid + correctly interpreted plans.
 * No player world is touched: corpus entries use read-only projections, and
 * each scenario runs in its own disposable scratch world.
 *
 *   npm run acceptance:interpretation:corpus
 *
 * Exit 0 when the correct rate is at least the threshold and no generic
 * clarification appeared; 1 otherwise.
 */

import { mkdtempSync } from "node:fs";
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
import { INTERPRETATION_SCENARIOS, classifyHttpResponse, evaluateScenarioStep, type Scenario } from "./interpretation-scenarios.js";

const THRESHOLD = 0.95;

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

async function runCorpus(router: ReturnType<typeof createRouterConfiguration>["router"]): Promise<InterpretationObservation[]> {
  const observations: InterpretationObservation[] = [];
  for (const entry of INTERPRETATION_CORPUS) {
    try {
      const outcome = await interpretMasterTurn(entry.input, snapshotAt(entry.location), router, { timeoutMs: 15_000, mode: "fallback" });
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

async function runScenario(router: ReturnType<typeof createRouterConfiguration>["router"], scenario: Scenario): Promise<ScenarioStepResult[]> {
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
    const runtime = await new WorldRuntimeManager(store, router).get(worldId);
    const results: ScenarioStepResult[] = [];
    let index = 0;
    for (const step of scenario.steps) {
      const response = await handleWorldCommand(runtime, { input: step.input, idempotencyKey: `${scenario.id}-${index}` });
      const body = JSON.parse(response.body) as unknown;
      const evaluation = evaluateScenarioStep(step, classifyHttpResponse(body));
      results.push({ scenario: scenario.id, input: step.input, ok: evaluation.ok, reason: evaluation.reason });
      index += 1;
    }
    return results;
  } finally {
    store.close();
  }
}

async function main(): Promise<number> {
  const configuration = createRouterConfiguration();
  const router = configuration?.router ?? null;

  const corpusScore = scoreCorpus(INTERPRETATION_CORPUS, await runCorpus(router));
  const scenarioResults: ScenarioStepResult[] = [];
  for (const scenario of INTERPRETATION_SCENARIOS) {
    scenarioResults.push(...await runScenario(router, scenario));
  }
  const scenarioFailures = scenarioResults.filter((result) => !result.ok);
  const ok = corpusScore.rate >= THRESHOLD && corpusScore.genericFallback === 0 && scenarioFailures.length === 0;
  process.stdout.write(`${JSON.stringify({
    ok,
    threshold: THRESHOLD,
    corpus: { total: corpusScore.total, correct: corpusScore.correct, rate: corpusScore.rate, genericFallback: corpusScore.genericFallback, failures: corpusScore.failures.slice(0, 25) },
    scenarios: { steps: scenarioResults.length, failures: scenarioFailures },
  }, null, 2)}\n`);
  return ok ? 0 : 1;
}

main().then(
  (code) => { process.exitCode = code; },
  () => { process.exitCode = 1; },
);
