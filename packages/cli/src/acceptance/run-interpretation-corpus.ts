/**
 * Opt-in interpretation-corpus runner (full-master Stage 1e).
 *
 * Runs the closed corpus through the real master-turn gateway with the
 * configured providers and scores valid + correctly interpreted plans. No
 * world is created and the Event Log is never written: `interpretMasterTurn`
 * only produces a transient plan/clarification.
 *
 *   npm run acceptance:interpretation:corpus
 *
 * Exit 0 when the correct rate is at least the threshold and no generic
 * clarification appeared; 1 otherwise.
 */

import {
  buildBootstrapEvents,
  buildMasterTurnSceneContext,
  rebuildProjection,
} from "@skald/world";
import { createRouterConfiguration } from "../runtime/router-factory.js";
import { buildMasterConversationContext } from "../conversation/context-builder.js";
import { interpretMasterTurn } from "../runtime/master-turn-gateway.js";
import { INTERPRETATION_CORPUS, classifyOutcome, scoreCorpus, type InterpretationObservation } from "./interpretation-corpus.js";

const THRESHOLD = 0.95;

async function main(): Promise<number> {
  const configuration = createRouterConfiguration();
  const router = configuration?.router ?? null;
  const events = buildBootstrapEvents("living_region");
  const world = rebuildProjection(events).getSnapshot();
  const snapshot = {
    events,
    world,
    scene: buildMasterTurnSceneContext(events, world),
    conversation: buildMasterConversationContext([], "interpretation-corpus"),
  };

  const observations: InterpretationObservation[] = [];
  for (const entry of INTERPRETATION_CORPUS) {
    try {
      const outcome = await interpretMasterTurn(entry.input, snapshot, router, { timeoutMs: 15_000, mode: "fallback" });
      observations.push(classifyOutcome(outcome));
    } catch {
      observations.push({ status: "error", kind: "unavailable", primary: null, queryId: null, genericFallback: false });
    }
  }

  const score = scoreCorpus(INTERPRETATION_CORPUS, observations);
  const ok = score.rate >= THRESHOLD && score.genericFallback === 0;
  process.stdout.write(`${JSON.stringify({ ok, threshold: THRESHOLD, score: { ...score, failures: score.failures.slice(0, 25) } }, null, 2)}\n`);
  return ok ? 0 : 1;
}

main().then(
  (code) => { process.exitCode = code; },
  () => { process.exitCode = 1; },
);
